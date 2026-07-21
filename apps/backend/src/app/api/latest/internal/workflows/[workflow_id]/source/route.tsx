import { syncWorkflowSource } from "@/lib/workflows/api";
import { ensureWorkflowsEnabled } from "@/lib/workflows/gate";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      workflow_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      source: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  async handler({ auth: { tenancy }, params, body }) {
    ensureWorkflowsEnabled(tenancy.project.id);
    // Every save of changed source mints a new version; unchanged source is
    // a no-op (created: false).
    const result = await syncWorkflowSource(tenancy, {
      workflowId: params.workflow_id,
      source: body.source,
      mustBeNew: false,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: result,
    };
  },
});
