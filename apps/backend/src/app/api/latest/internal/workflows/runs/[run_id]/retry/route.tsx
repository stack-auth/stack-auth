import { retryFailedWorkflowRun } from "@/lib/workflows/engine";
import { ensureWorkflowsEnabled } from "@/lib/workflows/gate";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

// Dashboard-internal in v1: a public SDK verb for retrying failed runs is
// deliberately post-v1 (spec section 2), hence admin-only here.
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      run_id: yupString().uuid().defined(),
    }).defined(),
    body: yupMixed(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      run_id: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params }) {
    ensureWorkflowsEnabled(tenancy.project.id);
    const retried = await retryFailedWorkflowRun(tenancy, params.run_id);
    if (!retried) {
      throw new StatusError(400, "This run cannot be retried: only failed runs can be retried, and only while no newer active run holds the same run key");
    }
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        run_id: params.run_id,
      },
    };
  },
});
