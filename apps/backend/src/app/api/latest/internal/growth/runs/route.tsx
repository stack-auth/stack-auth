import { requireGrowthAppEnabled, startGrowthManualRun } from "@/lib/growth/dashboard";
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
    body: yupObject({
      // Only manual runs can be started from the dashboard; initial runs are created by onboarding and
      // milestone runs by the daily-brief workflow's milestone evaluation.
      trigger: yupString().oneOf(["manual"]).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth }) => {
    requireGrowthAppEnabled(auth.tenancy);
    // No engine kick anymore: run creation enqueues the workflow boundary
    // event transactionally, and the workflow engine picks it up on its own.
    const result = await startGrowthManualRun({ tenancy: auth.tenancy });
    return { statusCode: 200, bodyType: "json", body: { run_id: result.runId } };
  },
});
