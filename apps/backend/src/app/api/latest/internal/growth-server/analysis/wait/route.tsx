import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { waitForGrowthAnalysisChange } from "@/lib/growth/orchestration";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
// Long-poll budget: the request-level timeout_ms is capped at 240s, leaving a comfortable slack
// under the 300s function budget for the final poll + response serialization.
export const maxDuration = 300;

/**
 * Long-polls one analysis run until its snapshot fingerprint differs from the caller's (or the
 * timeout elapses; the caller tells the two apart by comparing fingerprints). When a change is
 * observed, the orchestration is advanced before the response is returned so settled phases and
 * their parent run status cannot visibly drift apart until the workflow's next polling round.
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
      fingerprint: yupString().defined(),
      timeout_ms: yupNumber().integer().min(0).max(240_000).defined(),
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
    const snapshot = await waitForGrowthAnalysisChange({
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      runId: body.run_id,
      fingerprint: body.fingerprint,
      timeoutMs: body.timeout_ms,
    });
    if (snapshot == null) {
      throw new StatusError(404, "Analysis run not found.");
    }
    return { statusCode: 200, bodyType: "json", body: snapshot };
  },
});
