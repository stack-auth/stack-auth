import { authenticateGrowthAgentRequest } from "@/lib/growth/agent-auth";
import { computeGrowthDailySeries, computeGrowthMetrics } from "@/lib/growth/metrics";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

const DAILY_SERIES_DAYS = 30;

// Growth-agent machine route; see sql-query/route.tsx for the auth-opt-out rationale.
export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["GET"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).optional(),
    }).defined(),
    query: yupObject({
      project_id: yupString().defined(),
      branch_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ headers, query }) => {
    const tenancy = await authenticateGrowthAgentRequest({
      authorizationHeader: headers.authorization?.[0],
      projectId: query.project_id,
      branchId: query.branch_id,
    });
    // Share one `now` across both computations so the scalars and the series describe the same
    // instant (the loaders bucket by day relative to `now`).
    const now = new Date();
    const [metrics, dailySeries] = await Promise.all([
      computeGrowthMetrics(tenancy, now),
      computeGrowthDailySeries(tenancy, now, DAILY_SERIES_DAYS),
    ]);
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        metrics,
        daily_series: dailySeries,
        computed_at_millis: now.getTime(),
      },
    };
  },
});
