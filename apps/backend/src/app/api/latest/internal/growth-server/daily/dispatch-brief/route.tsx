import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { dispatchGrowthBrief } from "@/lib/growth/orchestration";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Asks Eve to generate a "generating" brief's content. Any other brief status returns as-is (a
 * repeated dispatch is a no-op); an unreachable Eve is a 502 so the workflow owns the retry/skip
 * decision.
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
    const result = await dispatchGrowthBrief({
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      briefId: body.brief_id,
    });
    return { statusCode: 200, bodyType: "json", body: { brief_status: result.briefStatus } };
  },
});
