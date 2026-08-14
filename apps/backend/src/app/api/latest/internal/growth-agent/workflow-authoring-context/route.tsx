import { authenticateGrowthAgentRequest } from "@/lib/growth/agent-auth";
import {
  getGrowthWorkflowAuthoringGuide,
  getGrowthWorkflowRules,
  getWorkflowPlatformEventTypes,
  listExistingGrowthWorkflowIds,
} from "@/lib/growth/workflow-authoring";
import { GROWTH_WORKFLOWS_EDITOR_AMBIENT_DTS, GROWTH_WORKFLOWS_EDITOR_DTS } from "@/lib/growth/workflow-authoring-dts";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

// Growth-agent machine route; see sql-query/route.tsx for the auth-opt-out rationale. One-stop
// context bundle for workflow authoring: the exact type contract the dashboard editor injects into
// Monaco, the skill guide (with the human deployment section swapped for growth rules), the
// growth-specific policy, and the tenancy's current growth-workflow namespace.
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
        // Both DTS blobs concatenated: the module contract plus the ambient stdlib declarations,
        // mirroring what the dashboard's Monaco editor loads (growth keeps its own copy; see
        // lib/growth/workflow-authoring-dts.ts for why).
        dts: `${GROWTH_WORKFLOWS_EDITOR_DTS}\n${GROWTH_WORKFLOWS_EDITOR_AMBIENT_DTS}`,
        guide: getGrowthWorkflowAuthoringGuide(),
        growth_rules: getGrowthWorkflowRules(),
        existing_growth_workflow_ids: await listExistingGrowthWorkflowIds(tenancy),
        platform_events: getWorkflowPlatformEventTypes(),
      },
    };
  },
});
