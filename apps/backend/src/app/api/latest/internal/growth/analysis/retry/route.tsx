import { requireGrowthAppEnabled, retryGrowthAnalysis } from "@/lib/growth/dashboard";
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
    // No engine kick anymore: the retry enqueues a fresh activation boundary
    // event transactionally, and the workflow engine picks it up on its own.
    const result = await retryGrowthAnalysis({ tenancy: auth.tenancy });
    return { statusCode: 200, bodyType: "json", body: { run_id: result.runId } };
  },
});
