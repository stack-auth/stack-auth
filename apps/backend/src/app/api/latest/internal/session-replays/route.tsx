import { getClickhouseExternalClient } from "@/lib/clickhouse";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const CLICK_FILTER_ID_CAP = 1000;

function parseCsvIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

function parseNonNegativeInt(name: string, raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new StatusError(StatusError.BadRequest, `${name} must be a non-negative integer`);
  }
  return value;
}

function parseMillis(name: string, raw: string | undefined): Date | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new StatusError(StatusError.BadRequest, `${name} must be a non-negative timestamp in milliseconds`);
  }
  return new Date(value);
}

async function loadClickQualifiedReplayIds(options: {
  projectId: string,
  branchId: string,
  clickCountMin: number,
}): Promise<string[]> {
  const clickhouseClient = getClickhouseExternalClient();
  const result = await clickhouseClient.query({
    query: `
      SELECT session_replay_id
      FROM default.events
      WHERE project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND event_type = '$click'
      GROUP BY session_replay_id
      HAVING count() >= {clickCountMin:UInt64}
      LIMIT {cap:UInt64}
    `,
    query_params: {
      projectId: options.projectId,
      branchId: options.branchId,
      clickCountMin: options.clickCountMin,
      cap: CLICK_FILTER_ID_CAP,
    },
    clickhouse_settings: {
      SQL_project_id: options.projectId,
      SQL_branch_id: options.branchId,
    },
    format: "JSONEachRow",
  });

  const rows = await result.json() as Array<{ session_replay_id: string }>;
  return rows.map((row) => row.session_replay_id);
}

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    query: yupObject({
      cursor: yupString().optional(),
      limit: yupString().optional(),
      user_ids: yupString().optional(),
      team_ids: yupString().optional(),
      duration_ms_min: yupString().optional(),
      duration_ms_max: yupString().optional(),
      last_event_at_from_millis: yupString().optional(),
      last_event_at_to_millis: yupString().optional(),
      click_count_min: yupString().optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(yupObject({
        id: yupString().defined(),
        project_user: yupObject({
          id: yupString().defined(),
          display_name: yupString().nullable().defined(),
          primary_email: yupString().nullable().defined(),
        }).defined(),
        started_at_millis: yupNumber().defined(),
        last_event_at_millis: yupNumber().defined(),
        chunk_count: yupNumber().defined(),
        event_count: yupNumber().defined(),
      }).defined()).defined(),
      pagination: yupObject({
        next_cursor: yupString().nullable().defined(),
      }).defined(),
    }).defined(),
  }),
  async handler({ auth, query }) {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const schema = await getPrismaSchemaForTenancy(auth.tenancy);

    const rawLimit = query.limit ?? String(DEFAULT_LIMIT);
    const parsedLimit = Number.parseInt(rawLimit, 10);
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_LIMIT));

    const userIdsFilter = parseCsvIds(query.user_ids);
    const teamIdsFilter = parseCsvIds(query.team_ids);
    const durationMsMin = parseNonNegativeInt("duration_ms_min", query.duration_ms_min);
    const durationMsMax = parseNonNegativeInt("duration_ms_max", query.duration_ms_max);
    const clickCountMin = parseNonNegativeInt("click_count_min", query.click_count_min);
    const lastEventAtFrom = parseMillis("last_event_at_from_millis", query.last_event_at_from_millis);
    const lastEventAtTo = parseMillis("last_event_at_to_millis", query.last_event_at_to_millis);

    if (durationMsMin !== null && durationMsMax !== null && durationMsMin > durationMsMax) {
      throw new StatusError(StatusError.BadRequest, "duration_ms_min must be less than or equal to duration_ms_max");
    }
    if (lastEventAtFrom && lastEventAtTo && lastEventAtFrom.getTime() > lastEventAtTo.getTime()) {
      throw new StatusError(StatusError.BadRequest, "last_event_at_from_millis must be less than or equal to last_event_at_to_millis");
    }

    // If click filter is active, get qualifying replay IDs from ClickHouse in one query
    const clickQualifiedIds = clickCountMin && clickCountMin > 0
      ? await loadClickQualifiedReplayIds({
        projectId: auth.tenancy.project.id,
        branchId: auth.tenancy.branchId,
        clickCountMin,
      })
      : null;

    if (clickQualifiedIds && clickQualifiedIds.length === 0) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: { items: [], pagination: { next_cursor: null } },
      };
    }

    // Handle cursor-based pagination
    const cursorId = query.cursor;
    let cursorPivot: { id: string, lastEventAt: Date } | null = null;
    if (cursorId) {
      cursorPivot = await prisma.sessionReplay.findUnique({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: cursorId } },
        select: { id: true, lastEventAt: true },
      });
      if (!cursorPivot) {
        throw new KnownErrors.ItemNotFound(cursorId);
      }
    }

    type ReplayRow = {
      id: string,
      projectUserId: string,
      startedAt: Date,
      lastEventAt: Date,
      projectUserDisplayName: string | null,
      primaryEmail: string | null,
    };

    const rows = await prisma.$queryRaw<ReplayRow[]>`
      SELECT
        sr."id",
        sr."projectUserId",
        sr."startedAt",
        sr."lastEventAt",
        pu."displayName" AS "projectUserDisplayName",
        (
          SELECT cc."value"
          FROM ${sqlQuoteIdent(schema)}."ContactChannel" cc
          WHERE cc."projectUserId" = sr."projectUserId"
            AND cc."tenancyId" = sr."tenancyId"
            AND cc."type" = 'EMAIL'
            AND cc."isPrimary" = 'TRUE'::"BooleanTrue"
          LIMIT 1
        ) AS "primaryEmail"
      FROM ${sqlQuoteIdent(schema)}."SessionReplay" sr
      JOIN ${sqlQuoteIdent(schema)}."ProjectUser" pu
        ON pu."projectUserId" = sr."projectUserId"
        AND pu."tenancyId" = sr."tenancyId"
      WHERE sr."tenancyId" = ${auth.tenancy.id}::UUID
        ${userIdsFilter.length > 0 ? Prisma.sql`AND sr."projectUserId" IN (${Prisma.join(userIdsFilter)})` : Prisma.empty}
        ${lastEventAtFrom ? Prisma.sql`AND sr."lastEventAt" >= ${lastEventAtFrom}` : Prisma.empty}
        ${lastEventAtTo ? Prisma.sql`AND sr."lastEventAt" <= ${lastEventAtTo}` : Prisma.empty}
        ${teamIdsFilter.length > 0 ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM ${sqlQuoteIdent(schema)}."TeamMember" tm
          WHERE tm."projectUserId" = sr."projectUserId"
            AND tm."tenancyId" = sr."tenancyId"
            AND tm."teamId" IN (${Prisma.join(teamIdsFilter)})
        )` : Prisma.empty}
        ${clickQualifiedIds ? Prisma.sql`AND sr."id" IN (${Prisma.join(clickQualifiedIds)})` : Prisma.empty}
        ${durationMsMin !== null ? Prisma.sql`AND EXTRACT(EPOCH FROM (sr."lastEventAt" - sr."startedAt")) * 1000 >= ${durationMsMin}` : Prisma.empty}
        ${durationMsMax !== null ? Prisma.sql`AND EXTRACT(EPOCH FROM (sr."lastEventAt" - sr."startedAt")) * 1000 <= ${durationMsMax}` : Prisma.empty}
        ${cursorPivot ? Prisma.sql`AND (
          sr."lastEventAt" < ${cursorPivot.lastEventAt}
          OR (sr."lastEventAt" = ${cursorPivot.lastEventAt} AND sr."id" < ${cursorId})
        )` : Prisma.empty}
      ORDER BY sr."lastEventAt" DESC, sr."id" DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1]!.id : null;

    const sessionIds = page.map((row) => row.id);
    const chunkAggs = sessionIds.length
      ? await prisma.sessionReplayChunk.groupBy({
        by: ["sessionReplayId"],
        where: { tenancyId: auth.tenancy.id, sessionReplayId: { in: sessionIds } },
        _count: { _all: true },
        _sum: { eventCount: true },
      })
      : [];

    const aggBySessionId = new Map<string, { chunkCount: number, eventCount: number }>();
    for (const a of chunkAggs) {
      aggBySessionId.set(a.sessionReplayId, {
        chunkCount: a._count._all,
        eventCount: a._sum.eventCount ?? 0,
      });
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        items: page.map((row) => {
          const agg = aggBySessionId.get(row.id) ?? { chunkCount: 0, eventCount: 0 };
          return {
            id: row.id,
            project_user: {
              id: row.projectUserId,
              display_name: row.projectUserDisplayName ?? null,
              primary_email: row.primaryEmail ?? null,
            },
            started_at_millis: row.startedAt.getTime(),
            last_event_at_millis: row.lastEventAt.getTime(),
            chunk_count: agg.chunkCount,
            event_count: agg.eventCount,
          };
        }),
        pagination: { next_cursor: nextCursor },
      },
    };
  },
});
