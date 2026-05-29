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
const ELEMENTS_CHAIN_LIMIT = 100;
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

// Device class buckets — kept as a back-compat shim for callers that still pass
// `device`. Internally collapsed into viewport_width_min/max so the MV order key
// (which leads with viewport_width) does the work instead of a multiIf scan.
const DEVICE_WIDTH_BUCKETS: Record<string, { min: number, max: number }> = {
  tv: { min: 1920, max: 65535 },
  widescreen: { min: 1440, max: 1919 },
  desktop: { min: 1200, max: 1439 },
  laptop: { min: 1024, max: 1199 },
  tablet: { min: 768, max: 1023 },
  mobile: { min: 0, max: 767 },
};

export function getDeviceViewportBucket(device: string | undefined): { min: number, max: number } | null {
  if (device == null || device === "") return null;
  return DEVICE_WIDTH_BUCKETS[device] ?? null;
}

// Translate a PostHog-style URL pattern with `*` wildcards into a SQL LIKE
// pattern, escaping the underlying `_` / `%` / `\` so they're treated literally.
// Empty string disables the filter.
export function buildClickmapUrlLikePattern(urlPattern: string | undefined): string | null {
  if (urlPattern == null || urlPattern === "") return null;
  const escaped = urlPattern.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  return escaped.replace(/\*/g, "%");
}

export function getClickmapRouteFilter(routePath: string | undefined, routeRegex: string | undefined, urlPatternLike: string | null): string {
  if (routeRegex != null && routeRegex !== "") {
    return "AND match(path, {routeRegex:String})";
  }
  if (urlPatternLike != null) {
    return "AND path LIKE {urlPatternLike:String}";
  }
  if (routePath != null && routePath !== "") {
    return "AND path = {routePath:String}";
  }
  return "";
}

export function getClickmapViewportFilter(min: number | undefined, max: number | undefined): string {
  const clauses: string[] = [];
  if (min != null) clauses.push("AND viewport_width >= {viewportWidthMin:UInt32}");
  if (max != null) clauses.push("AND viewport_width <= {viewportWidthMax:UInt32}");
  return clauses.join(" ");
}

export function getClickmapUserFilter(userId: string | undefined): string {
  if (userId == null || userId === "") return "";
  return "AND user_id = {userId:Nullable(String)}";
}

export function getClickmapReplayFilter(replayId: string | undefined): string {
  if (replayId == null || replayId === "") return "";
  return "AND session_replay_id = {replayId:Nullable(String)}";
}

export function getClickmapUserAndReplayFilter(userId: string | undefined, replayId: string | undefined): string {
  return [getClickmapUserFilter(userId), getClickmapReplayFilter(replayId)].filter((filter) => filter !== "").join(" ");
}

export function getClickmapOriginFilter(): string {
  return "AND (url = {origin:String} OR startsWith(url, {originSlashPrefix:String}) OR startsWith(url, {originQueryPrefix:String}) OR startsWith(url, {originHashPrefix:String}))";
}

export function getClickmapOriginParams(origin: string): {
  origin: string,
  originSlashPrefix: string,
  originQueryPrefix: string,
  originHashPrefix: string,
} {
  return {
    origin,
    originSlashPrefix: `${origin}/`,
    originQueryPrefix: `${origin}?`,
    originHashPrefix: `${origin}#`,
  };
}

export function getClickmapSystemElementFilter(): string {
  return [
    "AND position(elements_chain, '__hexclave-dev-tool-root') = 0",
    "AND position(elements_chain, 'stack-devtool') = 0",
    "AND position(elements_chain, 'sdt-') = 0",
    "AND position(selector, '#__hexclave-dev-tool-root') = 0",
    "AND position(selector, '.stack-devtool') = 0",
    "AND position(selector, '.sdt-') = 0",
  ].join(" ");
}

export function clampClickmapSampling(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 1;
  if (value <= 0) return 0.01;
  if (value > 1) return 1;
  return value;
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
      url_pattern: yupString().optional(),
      user_id: yupString().optional(),
      replay_id: yupString().optional(),
      device: yupString().oneOf(["tv", "widescreen", "desktop", "laptop", "tablet", "mobile"]).optional(),
      viewport_width_min: yupNumber().integer().min(0).max(65535).optional(),
      viewport_width_max: yupNumber().integer().min(0).max(65535).optional(),
      sampling: yupNumber().min(0).max(1).optional(),
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
        const deviceBucket = getDeviceViewportBucket(body.device);
        // Explicit min/max win over the legacy device bucket so callers can
        // narrow further (e.g. mobile + viewport_width_min=400).
        const viewportMin = body.viewport_width_min ?? deviceBucket?.min;
        const viewportMax = body.viewport_width_max ?? deviceBucket?.max;
        const urlPatternLike = buildClickmapUrlLikePattern(body.url_pattern);
        const samplingPct = Math.max(1, Math.round(clampClickmapSampling(body.sampling) * 100));
        const samplingScale = 100 / samplingPct;
        const samplingClause = samplingPct < 100
          ? "AND intHash32(toUInt32(toUnixTimestamp(event_at)) + cityHash64(coalesce(toString(user_id), ''))) % 100 < {samplingPct:UInt32}"
          : "";
        const routeFilter = getClickmapRouteFilter(body.route_path, body.route_regex, urlPatternLike);
        const userAndReplayFilter = getClickmapUserAndReplayFilter(body.user_id, body.replay_id);
        const viewportFilter = getClickmapViewportFilter(viewportMin, viewportMax);
        const systemElementFilter = getClickmapSystemElementFilter();
        const params: Record<string, unknown> = {
          projectId: auth.tenancy.project.id,
          branchId: auth.tenancy.branchId,
          since: formatClickhouseDateTimeParam(since),
          until: formatClickhouseDateTimeParam(until),
          linkedLimit: LINKED_LIMIT,
          routeLimit: ROUTE_LIMIT,
          elementsChainLimit: ELEMENTS_CHAIN_LIMIT,
          samplingPct,
          ...(body.route_path ? { routePath: body.route_path } : {}),
          ...(body.route_regex ? { routeRegex: body.route_regex } : {}),
          ...(urlPatternLike != null ? { urlPatternLike } : {}),
          ...(body.user_id ? { userId: body.user_id } : {}),
          ...(body.replay_id ? { replayId: body.replay_id } : {}),
          ...(viewportMin != null ? { viewportWidthMin: viewportMin } : {}),
          ...(viewportMax != null ? { viewportWidthMax: viewportMax } : {}),
        };
        const sharedWhere = `
          project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND event_at >= {since:DateTime}
            AND event_at < {until:DateTime}
            ${routeFilter}
            ${viewportFilter}
            ${systemElementFilter}
            ${samplingClause}
        `;
        const [routesResult, usersResult, replaysResult, selectorsResult, elementsResult] = await Promise.all([
          client.query({
            query: `
              SELECT
                path,
                count() AS clicks,
                uniqExactIf(assumeNotNull(user_id), user_id IS NOT NULL) AS users,
                uniqExactIf(assumeNotNull(session_replay_id), session_replay_id IS NOT NULL) AS replays
              FROM analytics_internal.clickmap_events
              WHERE ${sharedWhere}
                AND path != ''
                ${userAndReplayFilter}
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
              FROM analytics_internal.clickmap_events
              WHERE ${sharedWhere}
                AND user_id IS NOT NULL
                ${userAndReplayFilter}
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
                nullIf(any(path), '') AS route_path,
                toInt32(any(viewport_width)) AS viewport_width,
                toInt32(any(viewport_height)) AS viewport_height,
                count() AS clicks,
                toUnixTimestamp64Milli(max(event_at)) AS last_event_at_millis
              FROM analytics_internal.clickmap_events
              WHERE ${sharedWhere}
                AND session_replay_id IS NOT NULL
                ${userAndReplayFilter}
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
                nullIf(selector, '') AS selector,
                count() AS clicks
              FROM analytics_internal.clickmap_events
              WHERE ${sharedWhere}
                AND selector != ''
                ${userAndReplayFilter}
              GROUP BY selector
              ORDER BY clicks DESC
              LIMIT {linkedLimit:UInt32}
            `,
            query_params: params,
            format: "JSONEachRow",
          }),
          client.query({
            query: `
              SELECT
                elements_chain,
                any(elements_text) AS elements_text,
                any(tag_name) AS tag_name,
                any(href) AS href,
                count() AS clicks
              FROM analytics_internal.clickmap_events
              WHERE ${sharedWhere}
                AND elements_chain != ''
                ${userAndReplayFilter}
              GROUP BY elements_chain
              ORDER BY clicks DESC
              LIMIT {elementsChainLimit:UInt32}
            `,
            query_params: params,
            format: "JSONEachRow",
          }),
        ]);
        const routes: { path: string, clicks: number | string, users: number | string, replays: number | string }[] = await routesResult.json();
        const users: { id: string, clicks: number | string, replays: number | string, last_event_at_millis: number | string }[] = await usersResult.json();
        const replays: { id: string, linked_user_id: string | null, route_path: string | null, viewport_width: number | string | null, viewport_height: number | string | null, clicks: number | string, last_event_at_millis: number | string }[] = await replaysResult.json();
        const selectors: { selector: string, clicks: number | string }[] = await selectorsResult.json();
        const elements: { elements_chain: string, elements_text: string, tag_name: string, href: string | null, clicks: number | string }[] = await elementsResult.json();
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

        const scaleCount = (value: number | string) => Math.round(Number(value) * samplingScale);
        return {
          statusCode: 200,
          bodyType: "json",
          body: {
            kind: body.kind,
            cells: [],
            sampling: samplingPct / 100,
            routes: routes.map((row) => ({ path: row.path, clicks: scaleCount(row.clicks), users: scaleCount(row.users), replays: scaleCount(row.replays) })),
            users: users.map((row) => {
              const profile = userProfilesById.get(row.id);
              return {
                id: row.id,
                display_name: profile?.display_name ?? null,
                primary_email: profile?.primary_email ?? null,
                profile_image_url: profile?.profile_image_url ?? null,
                clicks: scaleCount(row.clicks),
                replays: scaleCount(row.replays),
                last_event_at_millis: Number(row.last_event_at_millis),
              };
            }),
            replays: replays.map((row) => ({
              id: row.id,
              user_id: row.linked_user_id,
              route_path: row.route_path,
              viewport_width: row.viewport_width == null ? null : Number(row.viewport_width),
              viewport_height: row.viewport_height == null ? null : Number(row.viewport_height),
              clicks: scaleCount(row.clicks),
              last_event_at_millis: Number(row.last_event_at_millis),
            })),
            selectors: selectors.map((row) => ({ selector: row.selector, clicks: scaleCount(row.clicks) })),
            elements: elements.map((row) => ({
              elements_chain: row.elements_chain,
              elements_text: row.elements_text,
              tag_name: row.tag_name,
              href: row.href,
              clicks: scaleCount(row.clicks),
            })),
          },
        };
      }

      if (body.member_user_ids.length === 0) {
        return { statusCode: 200, bodyType: "json", body: { kind: body.kind, cells: buildHourOfWeekHeatmapCells([]), sampling: 1, routes: [], users: [], replays: [], selectors: [], elements: [] } };
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
      return { statusCode: 200, bodyType: "json", body: { kind: body.kind, cells: buildHourOfWeekHeatmapCells(rows), sampling: 1, routes: [], users: [], replays: [], selectors: [], elements: [] } };
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
