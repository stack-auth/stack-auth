import { getClickhouseAdminClientForMetrics } from "@/lib/clickhouse";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { AnalyticsHeatmapResponseBodySchema } from "@stackframe/stack-shared/dist/interface/admin-metrics";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { ClickHouseError } from "@clickhouse/client";
import { HexclaveAssertionError, StatusError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { userFullInclude, userPrismaToCrud } from "../../../users/crud";

const MAX_TEAM_MEMBER_IDS = 500;
const MAX_WINDOW_DAYS = 92;
const ROUTE_LIMIT = 50;
const LINKED_LIMIT = 25;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function formatClickhouseDateTimeParam(date: Date): string {
  return date.toISOString().slice(0, 19);
}

function parseBoundedDateTime(value: string, name: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new StatusError(StatusError.BadRequest, `Invalid ${name}`);
  }
  return date;
}

function getDeviceClassExpression(widthExpression: string): string {
  return `multiIf(
    ${widthExpression} >= 1920, 'tv',
    ${widthExpression} >= 1440, 'widescreen',
    ${widthExpression} >= 1200, 'desktop',
    ${widthExpression} >= 1024, 'laptop',
    ${widthExpression} >= 768, 'tablet',
    'mobile'
  )`;
}

export function getSessionReplayHeatmapDeviceFilter(device: string | undefined): string {
  if (device == null) {
    return "";
  }
  return `AND ${getDeviceClassExpression("toFloat64OrZero(toString(data.viewport_width))")} = {device:String}`;
}

export function getSessionReplayHeatmapRouteFilter(routePath: string | undefined, routeRegex: string | undefined): string {
  if (routeRegex != null && routeRegex !== "") {
    return "AND match(toString(data.path), {routeRegex:String})";
  }
  if (routePath != null && routePath !== "") {
    return "AND toString(data.path) = {routePath:String}";
  }
  return "";
}

export function getSessionReplayHeatmapUserFilter(userId: string | undefined): string {
  if (userId == null || userId === "") {
    return "";
  }
  return "AND user_id = {userId:Nullable(String)}";
}

export function getSessionReplayHeatmapReplayFilter(replayId: string | undefined): string {
  if (replayId == null || replayId === "") {
    return "";
  }
  return "AND session_replay_id = {replayId:Nullable(String)}";
}

export function buildHourOfWeekHeatmapCells(rows: { weekday: number | string, hour: number | string, value: number | string }[]) {
  const byCell = new Map<string, number>();
  for (const row of rows) {
    const weekday = Number(row.weekday);
    const hour = Number(row.hour);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) continue;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    byCell.set(`${weekday}:${hour}`, Number(row.value));
  }

  const cells: { weekday: number, hour: number, value: number }[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      cells.push({ weekday, hour, value: byCell.get(`${weekday}:${hour}`) ?? 0 });
    }
  }
  return cells;
}

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    body: yupObject({
      kind: yupString().oneOf(["team_user_hour_of_week", "session_replay_clicks"]).defined(),
      member_user_ids: yupArray(yupString().defined()).optional().default([]).max(MAX_TEAM_MEMBER_IDS),
      route_path: yupString().optional(),
      route_regex: yupString().optional(),
      user_id: yupString().optional(),
      replay_id: yupString().optional(),
      device: yupString().oneOf(["tv", "widescreen", "desktop", "laptop", "tablet", "mobile"]).optional(),
      since: yupString().defined(),
      until: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: AnalyticsHeatmapResponseBodySchema,
  }),
  handler: async ({ auth, body }) => {
    const since = parseBoundedDateTime(body.since, "since");
    const until = parseBoundedDateTime(body.until, "until");
    if (until.getTime() <= since.getTime()) {
      throw new StatusError(StatusError.BadRequest, "until must be after since");
    }
    if (until.getTime() - since.getTime() > MAX_WINDOW_DAYS * ONE_DAY_MS) {
      throw new StatusError(StatusError.BadRequest, `Heatmap window cannot exceed ${MAX_WINDOW_DAYS} days`);
    }

    const client = getClickhouseAdminClientForMetrics();

    try {
      if (body.kind === "session_replay_clicks") {
        const routeFilter = getSessionReplayHeatmapRouteFilter(body.route_path, body.route_regex);
        const userFilter = getSessionReplayHeatmapUserFilter(body.user_id);
        const replayFilter = getSessionReplayHeatmapReplayFilter(body.replay_id);
        const deviceFilter = getSessionReplayHeatmapDeviceFilter(body.device);
        const params = {
          projectId: auth.tenancy.project.id,
          branchId: auth.tenancy.branchId,
          since: formatClickhouseDateTimeParam(since),
          until: formatClickhouseDateTimeParam(until),
          linkedLimit: LINKED_LIMIT,
          routeLimit: ROUTE_LIMIT,
          ...(body.route_path ? { routePath: body.route_path } : {}),
          ...(body.route_regex ? { routeRegex: body.route_regex } : {}),
          ...(body.user_id ? { userId: body.user_id } : {}),
          ...(body.replay_id ? { replayId: body.replay_id } : {}),
          ...(body.device ? { device: body.device } : {}),
        };
        const [pointsResult, routesResult, usersResult, replaysResult, selectorsResult] = await Promise.all([
          client.query({
            query: `
              SELECT
                round(toFloat64OrZero(toString(data.x)) / nullIf(toFloat64OrZero(toString(data.viewport_width)), 0) * 100, 1) AS x_percent,
                round(toFloat64OrZero(toString(data.y)) / nullIf(toFloat64OrZero(toString(data.viewport_height)), 0) * 100, 1) AS y_percent,
                count() AS count
              FROM analytics_internal.events
              WHERE event_type = '$click'
                AND project_id = {projectId:String}
                AND branch_id = {branchId:String}
                AND event_at >= {since:DateTime}
                AND event_at < {until:DateTime}
                AND toFloat64OrNull(toString(data.x)) IS NOT NULL
                AND toFloat64OrNull(toString(data.y)) IS NOT NULL
                AND toFloat64OrNull(toString(data.viewport_width)) > 0
                AND toFloat64OrNull(toString(data.viewport_height)) > 0
                ${routeFilter}
                ${userFilter}
                ${replayFilter}
                ${deviceFilter}
              GROUP BY x_percent, y_percent
            `,
            query_params: params,
            format: "JSONEachRow",
          }),
          client.query({
            query: `
              SELECT
                toString(data.path) AS path,
                count() AS clicks,
                uniqExactIf(assumeNotNull(user_id), user_id IS NOT NULL) AS users,
                uniqExactIf(assumeNotNull(session_replay_id), session_replay_id IS NOT NULL) AS replays
              FROM analytics_internal.events
              WHERE event_type = '$click'
                AND project_id = {projectId:String}
                AND branch_id = {branchId:String}
                AND event_at >= {since:DateTime}
                AND event_at < {until:DateTime}
                AND toString(data.path) != ''
                ${routeFilter}
                ${userFilter}
                ${replayFilter}
                ${deviceFilter}
              GROUP BY path
              ORDER BY clicks DESC
              LIMIT {routeLimit:UInt32}
            `,
            query_params: params,
            format: "JSONEachRow",
          }),
          client.query({
            query: `
              SELECT
                assumeNotNull(user_id) AS id,
                count() AS clicks,
                uniqExactIf(assumeNotNull(session_replay_id), session_replay_id IS NOT NULL) AS replays,
                toUnixTimestamp64Milli(max(event_at)) AS last_event_at_millis
              FROM analytics_internal.events
              WHERE event_type = '$click'
                AND project_id = {projectId:String}
                AND branch_id = {branchId:String}
                AND event_at >= {since:DateTime}
                AND event_at < {until:DateTime}
                AND user_id IS NOT NULL
                ${routeFilter}
                ${replayFilter}
                ${deviceFilter}
              GROUP BY id
              ORDER BY last_event_at_millis DESC, clicks DESC
              LIMIT {linkedLimit:UInt32}
            `,
            query_params: params,
            format: "JSONEachRow",
          }),
          client.query({
            query: `
              SELECT
                assumeNotNull(session_replay_id) AS id,
                any(user_id) AS linked_user_id,
                nullIf(any(toString(data.path)), '') AS route_path,
                toInt32OrNull(any(toString(data.viewport_width))) AS viewport_width,
                toInt32OrNull(any(toString(data.viewport_height))) AS viewport_height,
                count() AS clicks,
                toUnixTimestamp64Milli(max(event_at)) AS last_event_at_millis
              FROM analytics_internal.events
              WHERE event_type = '$click'
                AND project_id = {projectId:String}
                AND branch_id = {branchId:String}
                AND event_at >= {since:DateTime}
                AND event_at < {until:DateTime}
                AND session_replay_id IS NOT NULL
                ${routeFilter}
                ${userFilter}
                ${deviceFilter}
              GROUP BY id
              ORDER BY clicks DESC
              LIMIT {linkedLimit:UInt32}
            `,
            query_params: params,
            format: "JSONEachRow",
          }),
          client.query({
            query: `
              SELECT
                nullIf(toString(data.selector), '') AS selector,
                count() AS clicks
              FROM analytics_internal.events
              WHERE event_type = '$click'
                AND project_id = {projectId:String}
                AND branch_id = {branchId:String}
                AND event_at >= {since:DateTime}
                AND event_at < {until:DateTime}
                AND nullIf(toString(data.selector), '') IS NOT NULL
                ${routeFilter}
                ${userFilter}
                ${replayFilter}
                ${deviceFilter}
              GROUP BY selector
              ORDER BY clicks DESC
              LIMIT {linkedLimit:UInt32}
            `,
            query_params: params,
            format: "JSONEachRow",
          }),
        ]);
        const points: { x_percent: number | string, y_percent: number | string, count: number | string }[] = await pointsResult.json();
        const routes: { path: string, clicks: number | string, users: number | string, replays: number | string }[] = await routesResult.json();
        const users: { id: string, clicks: number | string, replays: number | string, last_event_at_millis: number | string }[] = await usersResult.json();
        const replays: { id: string, linked_user_id: string | null, route_path: string | null, viewport_width: number | string | null, viewport_height: number | string | null, clicks: number | string, last_event_at_millis: number | string }[] = await replaysResult.json();
        const selectors: { selector: string, clicks: number | string }[] = await selectorsResult.json();
        const userIds = users.map((row) => row.id);
        const prisma = await getPrismaClientForTenancy(auth.tenancy);
        const dbUsers = userIds.length === 0 ? [] : await prisma.$replica().projectUser.findMany({
          where: {
            tenancyId: auth.tenancy.id,
            projectUserId: { in: userIds },
          },
          include: userFullInclude,
        });
        const userProfilesById = new Map(dbUsers.map((user) => {
          const crud = userPrismaToCrud(user, auth.tenancy.config);
          return [crud.id, {
            display_name: crud.display_name,
            primary_email: crud.primary_email,
            profile_image_url: crud.profile_image_url,
          }];
        }));

        return {
          statusCode: 200,
          bodyType: "json",
          body: {
            kind: body.kind,
            cells: [],
            points: points.map((row) => ({ x_percent: Number(row.x_percent), y_percent: Number(row.y_percent), count: Number(row.count) })),
            routes: routes.map((row) => ({ path: row.path, clicks: Number(row.clicks), users: Number(row.users), replays: Number(row.replays) })),
            users: users.map((row) => {
              const profile = userProfilesById.get(row.id);
              return {
                id: row.id,
                display_name: profile?.display_name ?? null,
                primary_email: profile?.primary_email ?? null,
                profile_image_url: profile?.profile_image_url ?? null,
                clicks: Number(row.clicks),
                replays: Number(row.replays),
                last_event_at_millis: Number(row.last_event_at_millis),
              };
            }),
            replays: replays.map((row) => ({
              id: row.id,
              user_id: row.linked_user_id,
              route_path: row.route_path,
              viewport_width: row.viewport_width == null ? null : Number(row.viewport_width),
              viewport_height: row.viewport_height == null ? null : Number(row.viewport_height),
              clicks: Number(row.clicks),
              last_event_at_millis: Number(row.last_event_at_millis),
            })),
            selectors: selectors.map((row) => ({ selector: row.selector, clicks: Number(row.clicks) })),
          },
        };
      }

      if (body.member_user_ids.length === 0) {
        return { statusCode: 200, bodyType: "json", body: { kind: body.kind, cells: buildHourOfWeekHeatmapCells([]), points: [], routes: [], users: [], replays: [], selectors: [] } };
      }

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
          projectId: auth.tenancy.project.id,
          branchId: auth.tenancy.branchId,
          memberUserIds: body.member_user_ids,
          since: formatClickhouseDateTimeParam(since),
          until: formatClickhouseDateTimeParam(until),
        },
        format: "JSONEachRow",
      });
      const rows: { weekday: number | string, hour: number | string, value: number | string }[] = await result.json();
      return { statusCode: 200, bodyType: "json", body: { kind: body.kind, cells: buildHourOfWeekHeatmapCells(rows), points: [], routes: [], users: [], replays: [], selectors: [] } };
    } catch (error) {
      if (!(error instanceof ClickHouseError)) {
        throw error;
      }
      if (body.kind === "session_replay_clicks" && body.route_regex != null && body.route_regex !== "") {
        throw new StatusError(StatusError.BadRequest, "Invalid route regex");
      }
      captureError("internal-analytics-heatmap-clickhouse-fallback", new HexclaveAssertionError(
        "Failed to load analytics heatmap due to ClickHouse query failure.",
        { cause: error, projectId: auth.tenancy.project.id, branchId: auth.tenancy.branchId, kind: body.kind },
      ));
      throw new StatusError(StatusError.ServiceUnavailable, "Analytics heatmap is temporarily unavailable.");
    }
  },
});
