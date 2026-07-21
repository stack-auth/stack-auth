import { cancelWorkflowRuns } from "@/lib/workflows/engine";
import { ensureWorkflowsEnabled } from "@/lib/workflows/gate";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["server", "admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      workflow_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      run_key: yupString().optional(),
      run_id: yupString().uuid().optional(),
      state: yupString().oneOf(["queued", "running", "sleeping"]).optional(),
      version: yupNumber().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      canceled_count: yupNumber().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params, body }) {
    ensureWorkflowsEnabled(tenancy.project.id);
    // Atomic server-side query-cancel: a single transactional UPDATE, so it
    // is race-safe against concurrently waking runs. Cancellation lands at
    // step boundaries — a run mid-step finishes that step, then the engine's
    // guarded transition sees the cancellation.
    const result = await cancelWorkflowRuns(tenancy, {
      workflowId: params.workflow_id,
      runKey: body.run_key,
      runId: body.run_id,
      state: body.state as "queued" | "running" | "sleeping" | undefined,
      version: body.version,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        canceled_count: result.canceledCount,
      },
    };
  },
});
