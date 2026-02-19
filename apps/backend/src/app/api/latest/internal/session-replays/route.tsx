import { getClickhouseExternalClient } from "@/lib/clickhouse";
import { BooleanTrue, Prisma } from "@/generated/prisma/client";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DURATION_OVERFETCH_MULTIPLIER = 5;

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
    `,
    query_params: {
      projectId: options.projectId,
      branchId: options.branchId,
      clickCountMin: options.clickCountMin,
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

    // Build WHERE with all filters that can be pushed to the DB
    const baseWhere: Prisma.SessionReplayWhereInput = {
      tenancyId: auth.tenancy.id,
      ...(userIdsFilter.length > 0 ? { projectUserId: { in: userIdsFilter } } : {}),
      ...((lastEventAtFrom || lastEventAtTo) ? {
        lastEventAt: {
          ...(lastEventAtFrom ? { gte: lastEventAtFrom } : {}),
          ...(lastEventAtTo ? { lte: lastEventAtTo } : {}),
        },
      } : {}),
      ...(teamIdsFilter.length > 0 ? {
        projectUser: {
          teamMembers: {
            some: {
              teamId: { in: teamIdsFilter },
            },
          },
        },
      } : {}),
      ...(clickQualifiedIds ? { id: { in: clickQualifiedIds } } : {}),
    };

    // Handle cursor-based pagination
    const cursorId = query.cursor;
    let cursorWhere: Prisma.SessionReplayWhereInput = {};
    if (cursorId) {
      const cursorPivot = await prisma.sessionReplay.findUnique({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: cursorId } },
        select: { id: true, lastEventAt: true },
      });
      if (!cursorPivot) {
        throw new KnownErrors.ItemNotFound(cursorId);
      }
      cursorWhere = {
        OR: [
          { lastEventAt: { lt: cursorPivot.lastEventAt } },
          { AND: [{ lastEventAt: { equals: cursorPivot.lastEventAt } }, { id: { lt: cursorId } }] },
        ],
      };
    }

    const finalWhere: Prisma.SessionReplayWhereInput = cursorId
      ? { AND: [baseWhere, cursorWhere] }
      : baseWhere;

    // Overfetch when duration filter is active since it must be applied in memory
    const hasDurationFilter = durationMsMin !== null || durationMsMax !== null;
    const fetchSize = hasDurationFilter
      ? Math.min((limit + 1) * DURATION_OVERFETCH_MULTIPLIER, MAX_LIMIT * DURATION_OVERFETCH_MULTIPLIER)
      : limit + 1;

    const sessions = await prisma.sessionReplay.findMany({
      where: finalWhere,
      orderBy: [{ lastEventAt: "desc" }, { id: "desc" }],
      take: fetchSize,
      select: {
        id: true,
        projectUserId: true,
        startedAt: true,
        lastEventAt: true,
        projectUser: {
          select: {
            displayName: true,
            contactChannels: {
              where: { type: "EMAIL", isPrimary: BooleanTrue.TRUE },
              select: { value: true },
              take: 1,
            },
          },
        },
      },
    });

    // Apply duration filter in memory (only filter that can't be pushed to the DB)
    const filtered = hasDurationFilter
      ? sessions.filter((row) => {
        const durationMs = row.lastEventAt.getTime() - row.startedAt.getTime();
        if (durationMsMin !== null && durationMs < durationMsMin) return false;
        if (durationMsMax !== null && durationMs > durationMsMax) return false;
        return true;
      })
      : sessions;

    const hasMore = filtered.length > limit || (hasDurationFilter && sessions.length === fetchSize);
    const page = filtered.slice(0, limit);
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1]!.id : null;

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
              display_name: row.projectUser.displayName ?? null,
              primary_email: row.projectUser.contactChannels[0]?.value ?? null,
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
