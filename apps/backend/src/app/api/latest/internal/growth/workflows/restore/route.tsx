import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { GROWTH_WORKFLOW_IDS, restoreGrowthWorkflow } from "@/lib/growth/workflows";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Resets one canonical Growth workflow back to its shipped source (recreating
 * it if the customer deleted it). This is the ONLY path that overwrites a
 * customer-edited growth workflow — it exists precisely so "restore default"
 * is an explicit dashboard action rather than something Growth ever does on
 * its own.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({
      workflow_id: yupString().oneOf(GROWTH_WORKFLOW_IDS).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      workflow_id: yupString().defined(),
      version: yupNumber().defined(),
      created: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const result = await restoreGrowthWorkflow(auth.tenancy, body.workflow_id);
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        workflow_id: result.workflowId,
        version: result.version,
        created: result.created,
      },
    };
  },
});
