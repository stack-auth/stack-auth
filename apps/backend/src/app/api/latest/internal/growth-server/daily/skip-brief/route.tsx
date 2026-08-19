import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { skipGrowthBrief } from "@/lib/growth/orchestration";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Gives up on a brief that never got content. CAS generating → skipped; if the agent's "ready"
 * write raced the skip and won, the call is a no-op and returns the winning status.
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
    const result = await skipGrowthBrief({
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      briefId: body.brief_id,
    });
    return { statusCode: 200, bodyType: "json", body: { brief_status: result.briefStatus } };
  },
});
