import { upgradeWorkflowRuns } from "@/lib/workflows/engine";
import { ensureWorkflowsEnabled } from "@/lib/workflows/gate";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

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
      to_version: yupNumber().defined(),
      run_key: yupString().optional(),
      from_version: yupNumber().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      upgraded_count: yupNumber().defined(),
      skipped: yupArray(yupMixed().defined()).defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params, body }) {
    ensureWorkflowsEnabled(tenancy.project.id);
    // upgradeWorkflowRuns throws StatusError(400) itself for unknown target
    // versions; anything else is a platform error.
    const result = await upgradeWorkflowRuns(tenancy, {
      workflowId: params.workflow_id,
      toVersion: body.to_version,
      runKey: body.run_key,
      fromVersion: body.from_version,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        upgraded_count: result.upgradedCount,
        // Mechanically divergent transfers are SKIPPED (the run keeps
        // executing its pinned version) and reported here with a
        // machine-readable diagnostic. There is no paused state.
        skipped: result.skipped.map((skip) => ({
          run_id: skip.runId,
          run_key: skip.runKey,
          from_version: skip.fromVersion,
          diagnostic: skip.diagnostic,
        })),
      },
    };
  },
});
