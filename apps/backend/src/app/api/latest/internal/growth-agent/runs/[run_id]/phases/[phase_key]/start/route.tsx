import { authenticateGrowthAgentRequest } from "@/lib/growth/agent-auth";
import { startGrowthAgentPhase } from "@/lib/growth/agent-writes";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    // Machine route: authenticated by the shared growth agent secret, not the standard project auth.
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["POST"]).defined(),
    headers: yupObject({
      // Optional so a missing header reaches the auth helper and becomes a clean 401 instead of a
      // schema-validation 400.
      "authorization": yupTuple([yupString()]).optional(),
    }).defined(),
    params: yupObject({
      run_id: yupString().uuid().defined(),
      phase_key: yupString().defined(),
    }).defined(),
    body: yupObject({
      project_id: yupString().defined(),
      branch_id: yupString().defined(),
      // The dispatch-attempt echo (zombie fence). min(0), not min(1): phases are created with
      // attempt 0 and the engine bumps the counter on (re-)dispatch, so until the first re-dispatch
      // the live attempt genuinely is 0.
      attempt: yupNumber().integer().min(0).defined(),
      eve_session_id: yupString().optional(),
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
    await startGrowthAgentPhase(
      { tenancy, runId: params.run_id, phaseKey: params.phase_key, attempt: body.attempt },
      { eveSessionId: body.eve_session_id },
    );
    return { statusCode: 200, bodyType: "json", body: { status: "running" } };
  },
});
