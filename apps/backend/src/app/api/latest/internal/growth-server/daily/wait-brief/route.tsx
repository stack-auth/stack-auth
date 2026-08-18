import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { waitForGrowthBriefStatusChange } from "@/lib/growth/orchestration";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
// Long-poll budget: the request-level timeout_ms is capped at 240s, leaving a comfortable slack
// under the 300s function budget for the final poll + response serialization.
export const maxDuration = 300;

/**
 * Long-polls one brief until it leaves "generating" (or the timeout elapses); returns the latest
 * status either way. Read-only.
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
      brief_id: yupString().uuid().defined(),
      timeout_ms: yupNumber().integer().min(0).max(240_000).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      brief_status: yupString().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const result = await waitForGrowthBriefStatusChange({
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      briefId: body.brief_id,
      timeoutMs: body.timeout_ms,
    });
    return { statusCode: 200, bodyType: "json", body: { brief_status: result.briefStatus } };
  },
});
