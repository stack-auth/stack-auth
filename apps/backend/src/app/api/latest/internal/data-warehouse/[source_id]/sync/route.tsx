import { enqueueSyncRun } from "@/lib/data-warehouse/sync";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * "Sync now". Enqueues a run for the cron to pick up rather than doing the work
 * inline: the same bounded state machine advances manual and scheduled runs, so
 * a manual sync of a large source cannot outlive the request that asked for it.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      source_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      run_id: yupString().defined(),
      already_running: yupBoolean().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params }) {
    const result = await enqueueSyncRun({
      tenancy,
      dataSourceId: params.source_id,
      trigger: "manual",
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { run_id: result.runId, already_running: result.alreadyRunning },
    };
  },
});
