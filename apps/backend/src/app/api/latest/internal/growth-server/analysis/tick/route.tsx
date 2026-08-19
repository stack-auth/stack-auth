import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { tickGrowthAnalysisRun } from "@/lib/growth/orchestration";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

/**
 * Advances one analysis run by one orchestration tick and returns its snapshot. Called by the
 * growth analysis workflow; authenticates as ordinary server auth (workflow run tokens are plain
 * server-scope credentials), so the lib treats every call as potentially hostile repetition — all
 * mutations are CAS-guarded no-ops when the run already moved.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({
      run_id: yupString().uuid().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      state: yupString().defined(),
      resting: yupBoolean().defined(),
      fingerprint: yupString().defined(),
      phases: yupArray(yupObject({
        key: yupString().defined(),
        status: yupString().defined(),
        attempt: yupNumber().defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const snapshot = await tickGrowthAnalysisRun({
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      runId: body.run_id,
    });
    if (snapshot == null) {
      throw new StatusError(404, "Analysis run not found.");
    }
    return { statusCode: 200, bodyType: "json", body: snapshot };
  },
});
