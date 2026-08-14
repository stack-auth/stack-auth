import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { wireGrowthBriefDeliveries } from "@/lib/growth/orchestration";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Wires delivery rows (and invokes the channels) for a "ready" brief. The unique on
 * (brief, channel) makes row creation the claim, so hostile repetition can never double-send.
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
      deliveries: yupArray(yupObject({
        channel: yupString().defined(),
        status: yupString().defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const result = await wireGrowthBriefDeliveries({
      tenancy: auth.tenancy,
      briefId: body.brief_id,
    });
    return { statusCode: 200, bodyType: "json", body: { deliveries: result.deliveries } };
  },
});
