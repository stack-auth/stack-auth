import { authenticateGrowthAgentRequest } from "@/lib/growth/agent-auth";
import { completeGrowthAgentPhase } from "@/lib/growth/agent-writes";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    // Machine route: authenticated by the shared growth agent secret, not the standard project auth.
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["POST"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).optional(),
    }).defined(),
    params: yupObject({
      run_id: yupString().uuid().defined(),
      phase_key: yupString().defined(),
    }).defined(),
    body: yupObject({
      project_id: yupString().defined(),
      branch_id: yupString().defined(),
      // See the start route for why min(0) rather than min(1).
      attempt: yupNumber().integer().min(0).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ headers, params, body }) => {
    const tenancy = await authenticateGrowthAgentRequest({
      authorizationHeader: headers.authorization?.[0],
      projectId: body.project_id,
      branchId: body.branch_id,
    });
    await completeGrowthAgentPhase({ tenancy, runId: params.run_id, phaseKey: params.phase_key, attempt: body.attempt });
    return { statusCode: 200, bodyType: "json", body: { status: "completed" } };
  },
});
