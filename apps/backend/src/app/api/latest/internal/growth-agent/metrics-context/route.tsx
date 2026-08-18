import { authenticateGrowthAgentRequest } from "@/lib/growth/agent-auth";
import { GROWTH_METRIC_CATALOG } from "@/lib/growth/metric-catalog";
import { buildGrowthMetricsContextStaticBody, loadGrowthMetricFreshness } from "@/lib/growth/metrics-context";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

// Growth-agent machine route; see sql-query/route.tsx for the auth-opt-out rationale. The metrics
// analogue of workflow-authoring-context: everything the agent needs to know about the metric
// system in one call — the stored/on-the-fly/not-possible catalog (serialized from
// lib/growth/metric-catalog.ts, never re-declared here), the queryable-table list, the markdown
// correlation rules, and a per-tenancy freshness read of the two ClickHouse stores.
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
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        ...buildGrowthMetricsContextStaticBody(GROWTH_METRIC_CATALOG),
        freshness: await loadGrowthMetricFreshness(tenancy.project.id, tenancy.branchId),
      },
    };
  },
});
