import {
  type ClickmapClicksQueryResult,
  parseBoundedDateTime,
  runClickmapClicksQuery,
  throwClickhouseClickmapError,
} from "@/lib/analytics-clickmap-query";
import { verifyAnalyticsClickmapToken } from "@/lib/analytics-clickmap-tokens";
import { getClickhouseAdminClientForMetrics } from "@/lib/clickhouse";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { AnalyticsClickmapResponseBodySchema, type AnalyticsClickmapResponse } from "@hexclave/shared/dist/interface/admin-metrics";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

const MAX_WINDOW_DAYS = 31;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ROUTE_LIMIT = 50;
const ELEMENTS_CHAIN_LIMIT = 200;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Get page clickmap data",
    description: "Returns aggregated click data for the current browser origin when authorized by a short-lived clickmap token.",
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
      clickmap_token: yupString().defined(),
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
    body: AnalyticsClickmapResponseBodySchema,
  }),
  handler: async ({ body }) => {
    // The dashboard mint path is the feature gate for clickmap overlays. This
    // public read endpoint is authorized by the short-lived origin-bound token
    // below, so avoid app/user gates that can disagree with the launching
    // dashboard or anonymous customer pages.

    const clickmapToken = await verifyAnalyticsClickmapToken({
      token: body.clickmap_token,
      origin: body.origin,
    });

    const since = parseBoundedDateTime(body.since, "since");
    const until = parseBoundedDateTime(body.until, "until");
    if (until.getTime() <= since.getTime()) {
      throw new StatusError(StatusError.BadRequest, "until must be after since");
    }
    if (until.getTime() - since.getTime() > MAX_WINDOW_DAYS * ONE_DAY_MS) {
      throw new StatusError(StatusError.BadRequest, `Clickmap window cannot exceed ${MAX_WINDOW_DAYS} days`);
    }

    const client = getClickhouseAdminClientForMetrics();
    let result: ClickmapClicksQueryResult;
    try {
      result = await runClickmapClicksQuery(client, {
        projectId: clickmapToken.project_id,
        branchId: clickmapToken.branch_id,
        since,
        until,
        origin: clickmapToken.origin,
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
      });
    } catch (error) {
      throwClickhouseClickmapError(error, {
        captureLabel: "analytics-clickmap-clickhouse-fallback",
        routeRegex: body.route_regex,
        context: { projectId: clickmapToken.project_id, branchId: clickmapToken.branch_id },
      });
    }

    // The public overlay only consumes routes/selectors/elements; per-user and
    // per-replay aggregates are intentionally not fetched here (no linkedLimit).
    const responseBody: AnalyticsClickmapResponse = {
      kind: "session_replay_clicks",
      cells: [],
      sampling: result.samplingPct / 100,
      routes: result.routes,
      users: [],
      replays: [],
      selectors: result.selectors,
      elements: result.elements,
    };

    return {
      statusCode: 200,
      bodyType: "json",
      body: responseBody,
    };
  },
});
