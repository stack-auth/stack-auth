import {
  buildHourOfWeekClickmapCells,
  type ClickmapClicksQueryResult,
  formatClickhouseDateTimeParam,
  parseBoundedDateTime,
  runClickmapClicksQuery,
  throwClickhouseClickmapError,
} from "@/lib/analytics-clickmap-query";
import { getClickhouseAdminClientForMetrics } from "@/lib/clickhouse";
import type { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { AnalyticsClickmapResponseBodySchema, type AnalyticsClickmapResponse } from "@hexclave/shared/dist/interface/admin-metrics";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import yup from "yup";
import { userFullInclude, userPrismaToCrud } from "../../../users/crud";

const MAX_TEAM_MEMBER_IDS = 500;
const MAX_WINDOW_DAYS = 92;
const ROUTE_LIMIT = 50;
const LINKED_LIMIT = 25;
const ELEMENTS_CHAIN_LIMIT = 100;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const clickmapRequestBodySchema = yupObject({
  kind: yupString().oneOf(["team_user_hour_of_week", "session_replay_clicks"]).defined(),
  member_user_ids: yupArray(yupString().defined()).optional().default([]).max(MAX_TEAM_MEMBER_IDS),
  route_path: yupString().optional(),
  route_regex: yupString().optional(),
  url_pattern: yupString().optional(),
  user_id: yupString().optional(),
  replay_id: yupString().optional(),
  device: yupString().oneOf(["tv", "widescreen", "desktop", "laptop", "tablet", "mobile"]).optional(),
  viewport_width_min: yupNumber().integer().min(0).max(65535).optional(),
  viewport_width_max: yupNumber().integer().min(0).max(65535).optional(),
  sampling: yupNumber().min(0).max(1).optional(),
  since: yupString().defined(),
  until: yupString().defined(),
}).defined();

type ClickmapRequestBody = yup.InferType<typeof clickmapRequestBodySchema>;

function emptyClickmapResponse(kind: AnalyticsClickmapResponse["kind"], cells: AnalyticsClickmapResponse["cells"]): AnalyticsClickmapResponse {
  return { kind, cells, sampling: 1, routes: [], users: [], replays: [], selectors: [], elements: [] };
}

async function handleClickClickmap(tenancy: Tenancy, body: ClickmapRequestBody, since: Date, until: Date): Promise<AnalyticsClickmapResponse> {
  const client = getClickhouseAdminClientForMetrics();
  let result: ClickmapClicksQueryResult;
  try {
    result = await runClickmapClicksQuery(client, {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      since,
      until,
      routePath: body.route_path,
      routeRegex: body.route_regex,
      urlPattern: body.url_pattern,
      userId: body.user_id,
      replayId: body.replay_id,
      device: body.device,
      viewportWidthMin: body.viewport_width_min,
      viewportWidthMax: body.viewport_width_max,
      sampling: body.sampling,
      routeLimit: ROUTE_LIMIT,
      elementsChainLimit: ELEMENTS_CHAIN_LIMIT,
      linkedLimit: LINKED_LIMIT,
    });
  } catch (error) {
    throwClickhouseClickmapError(error, {
      captureLabel: "internal-analytics-clickmap-clickhouse-fallback",
      routeRegex: body.route_regex,
      context: { projectId: tenancy.project.id, branchId: tenancy.branchId, kind: body.kind },
    });
  }

  const userIds = result.users.map((row) => row.id);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const dbUsers = userIds.length === 0 ? [] : await prisma.$replica().projectUser.findMany({
    where: {
      tenancyId: tenancy.id,
      projectUserId: { in: userIds },
    },
    include: userFullInclude,
  });
  const userProfilesById = new Map(dbUsers.map((user) => {
    const crud = userPrismaToCrud(user, tenancy.config);
    return [crud.id, {
      display_name: crud.display_name,
      primary_email: crud.primary_email,
      profile_image_url: crud.profile_image_url,
    }];
  }));

  return {
    kind: "session_replay_clicks",
    cells: [],
    sampling: result.samplingPct / 100,
    routes: result.routes,
    users: result.users.map((row) => {
      const profile = userProfilesById.get(row.id);
      return {
        id: row.id,
        display_name: profile?.display_name ?? null,
        primary_email: profile?.primary_email ?? null,
        profile_image_url: profile?.profile_image_url ?? null,
        clicks: row.clicks,
        replays: row.replays,
        last_event_at_millis: row.last_event_at_millis,
      };
    }),
    replays: result.replays.map((row) => ({
      id: row.id,
      user_id: row.linked_user_id,
      route_path: row.route_path,
      viewport_width: row.viewport_width,
      viewport_height: row.viewport_height,
      clicks: row.clicks,
      last_event_at_millis: row.last_event_at_millis,
    })),
    selectors: result.selectors,
    elements: result.elements,
  };
}

async function handleTeamHourOfWeek(tenancy: Tenancy, body: ClickmapRequestBody, since: Date, until: Date): Promise<AnalyticsClickmapResponse> {
  if (body.member_user_ids.length === 0) {
    return emptyClickmapResponse(body.kind, buildHourOfWeekClickmapCells([]));
  }

  const client = getClickhouseAdminClientForMetrics();
  try {
    const result = await client.query({
      query: `
        SELECT toDayOfWeek(event_at) AS weekday, toHour(event_at) AS hour, uniqExact(assumeNotNull(user_id)) AS value
        FROM analytics_internal.events
        WHERE project_id = {projectId:String}
          AND branch_id = {branchId:String}
          AND user_id IN {memberUserIds:Array(String)}
          AND event_at >= {since:DateTime}
          AND event_at < {until:DateTime}
        GROUP BY weekday, hour
        ORDER BY weekday ASC, hour ASC
      `,
      query_params: {
        projectId: tenancy.project.id,
        branchId: tenancy.branchId,
        memberUserIds: body.member_user_ids,
        since: formatClickhouseDateTimeParam(since),
        until: formatClickhouseDateTimeParam(until),
      },
      format: "JSONEachRow",
    });
    const rows: { weekday: number | string, hour: number | string, value: number | string }[] = await result.json();
    return emptyClickmapResponse(body.kind, buildHourOfWeekClickmapCells(rows));
  } catch (error) {
    throwClickhouseClickmapError(error, {
      captureLabel: "internal-analytics-clickmap-clickhouse-fallback",
      context: { projectId: tenancy.project.id, branchId: tenancy.branchId, kind: body.kind },
    });
  }
}

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    body: clickmapRequestBodySchema,
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: AnalyticsClickmapResponseBodySchema,
  }),
  handler: async ({ auth, body }) => {
    const since = parseBoundedDateTime(body.since, "since");
    const until = parseBoundedDateTime(body.until, "until");
    if (until.getTime() <= since.getTime()) {
      throw new StatusError(StatusError.BadRequest, "until must be after since");
    }
    if (until.getTime() - since.getTime() > MAX_WINDOW_DAYS * ONE_DAY_MS) {
      throw new StatusError(StatusError.BadRequest, `Query window cannot exceed ${MAX_WINDOW_DAYS} days`);
    }

    const responseBody = body.kind === "session_replay_clicks"
      ? await handleClickClickmap(auth.tenancy, body, since, until)
      : await handleTeamHourOfWeek(auth.tenancy, body, since, until);

    return { statusCode: 200, bodyType: "json", body: responseBody } as const;
  },
});
