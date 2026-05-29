import { getClickhouseAdminClientForMetrics } from "@/lib/clickhouse";
import { verifyAnalyticsHeatmapToken } from "@/lib/analytics-heatmap-tokens";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { ClickHouseError } from "@clickhouse/client";
import { AnalyticsHeatmapResponseBodySchema, type AnalyticsHeatmapResponse } from "@stackframe/stack-shared/dist/interface/admin-metrics";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { HexclaveAssertionError, StatusError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import {
  buildClickmapUrlLikePattern,
  clampClickmapSampling,
  formatClickhouseDateTimeParam,
  getClickmapOriginFilter,
  getClickmapOriginParams,
  getClickmapRouteFilter,
  getClickmapSystemElementFilter,
  getClickmapUserAndReplayFilter,
  getClickmapViewportFilter,
  getDeviceViewportBucket,
  isClickhouseRegexpError,
  parseBoundedDateTime,
} from "../../internal/analytics/heatmap/route";

const MAX_WINDOW_DAYS = 31;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ROUTE_LIMIT = 50;
const ELEMENTS_CHAIN_LIMIT = 200;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Get page heatmap data",
    description: "Returns click heatmap data for the current browser origin when authorized by a short-lived heatmap token.",
    tags: ["Analytics"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
      user: adaptSchema.optional(),
    }).defined(),
    body: yupObject({
      heatmap_token: yupString().defined(),
      origin: yupString().defined(),
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
  handler: async ({ body }) => {
    // The dashboard mint path is the feature gate for heatmap overlays. This
    // public read endpoint is authorized by the short-lived origin-bound token
    // below, so avoid app/user gates that can disagree with the launching
    // dashboard or anonymous customer pages.

    const heatmapToken = await verifyAnalyticsHeatmapToken({
      token: body.heatmap_token,
      origin: body.origin,
    });

    const since = parseBoundedDateTime(body.since, "since");
    const until = parseBoundedDateTime(body.until, "until");
    if (until.getTime() <= since.getTime()) {
      throw new StatusError(StatusError.BadRequest, "until must be after since");
    }
    if (until.getTime() - since.getTime() > MAX_WINDOW_DAYS * ONE_DAY_MS) {
      throw new StatusError(StatusError.BadRequest, `Heatmap window cannot exceed ${MAX_WINDOW_DAYS} days`);
    }

    const deviceBucket = getDeviceViewportBucket(body.device);
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
    const originFilter = getClickmapOriginFilter();
    const viewportFilter = getClickmapViewportFilter(viewportMin, viewportMax);
    const systemElementFilter = getClickmapSystemElementFilter();
    const params: Record<string, unknown> = {
      projectId: heatmapToken.project_id,
      branchId: heatmapToken.branch_id,
      ...getClickmapOriginParams(heatmapToken.origin),
      since: formatClickhouseDateTimeParam(since),
      until: formatClickhouseDateTimeParam(until),
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
        ${originFilter}
        ${routeFilter}
        ${viewportFilter}
        ${systemElementFilter}
        ${samplingClause}
    `;

    const client = getClickhouseAdminClientForMetrics();
    let routes: { path: string, clicks: number | string, users: number | string, replays: number | string }[];
    let selectors: { selector: string, clicks: number | string }[];
    let elements: { elements_chain: string, elements_text: string, tag_name: string, href: string | null, clicks: number | string }[];
    try {
      const [routesResult, selectorsResult, elementsResult] = await Promise.all([
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
              nullIf(selector, '') AS selector,
              count() AS clicks
            FROM analytics_internal.clickmap_events
            WHERE ${sharedWhere}
              AND selector != ''
              ${userAndReplayFilter}
            GROUP BY selector
            ORDER BY clicks DESC
            LIMIT {routeLimit:UInt32}
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

      routes = await routesResult.json();
      selectors = await selectorsResult.json();
      elements = await elementsResult.json();
    } catch (error) {
      if (!(error instanceof ClickHouseError)) {
        throw error;
      }
      if (body.route_regex != null && body.route_regex !== "" && isClickhouseRegexpError(error)) {
        throw new StatusError(StatusError.BadRequest, "Invalid route regex");
      }
      captureError("analytics-heatmap-clickhouse-fallback", new HexclaveAssertionError(
        "Failed to load analytics heatmap due to ClickHouse query failure.",
        { cause: error, projectId: heatmapToken.project_id, branchId: heatmapToken.branch_id },
      ));
      throw new StatusError(StatusError.ServiceUnavailable, "Analytics heatmap is temporarily unavailable.");
    }

    const scaleCount = (value: number | string) => Math.round(Number(value) * samplingScale);
    const responseBody: AnalyticsHeatmapResponse = {
      kind: "session_replay_clicks",
      cells: [],
      sampling: samplingPct / 100,
      routes: routes.map((row) => ({ path: row.path, clicks: scaleCount(row.clicks), users: scaleCount(row.users), replays: scaleCount(row.replays) })),
      users: [],
      replays: [],
      selectors: selectors.map((row) => ({ selector: row.selector, clicks: scaleCount(row.clicks) })),
      elements: elements.map((row) => ({
        elements_chain: row.elements_chain,
        elements_text: row.elements_text,
        tag_name: row.tag_name,
        href: row.href,
        clicks: scaleCount(row.clicks),
      })),
    };

    return {
      statusCode: 200,
      bodyType: "json",
      body: responseBody,
    };
  },
});
