import { requireGrowthAppEnabled, restartGrowthOnboarding } from "@/lib/growth/dashboard";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Sends the project back to the onboarding form. Admin-authed like POST /onboarding itself, because
 * it is the same customer-facing decision in reverse — no growth history is destroyed (see
 * restartGrowthOnboarding), so this needs no stronger gate than starting onboarding did.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const result = await restartGrowthOnboarding({ tenancy: auth.tenancy });
    return { statusCode: 200, bodyType: "json", body: { cancelled_run_ids: result.cancelledRunIds } };
  },
});
