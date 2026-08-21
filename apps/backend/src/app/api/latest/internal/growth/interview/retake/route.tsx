import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { retakeGrowthInterview } from "@/lib/growth/interview";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

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
    const result = await retakeGrowthInterview(auth.tenancy);
    // Ack returns the resulting interview status (back to "pending"), matching the skip route's
    // shape, plus the run id so the dashboard can keep polling the right run. Mapped here rather
    // than in the lib because the snake_case wire shape belongs to the route, not the lib.
    return { statusCode: 200, bodyType: "json", body: { status: result.status, run_id: result.runId } };
  },
});
