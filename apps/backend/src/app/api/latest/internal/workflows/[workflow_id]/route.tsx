import { deleteWorkflow } from "@/lib/workflows/api";
import { ensureWorkflowsEnabled } from "@/lib/workflows/gate";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const DELETE = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      workflow_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  async handler({ auth: { tenancy }, params }) {
    ensureWorkflowsEnabled(tenancy.project.id);
    await deleteWorkflow(tenancy, params.workflow_id);
    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
