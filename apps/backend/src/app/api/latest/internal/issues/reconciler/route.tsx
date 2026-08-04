import { reconcileIssues } from "@/lib/issues/issue-reconciler";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Minimum wall-clock gap between two reconciler passes in one process.
 *
 * This exists for `scripts/run-cron-jobs.ts`, which is a single long-lived
 * process that re-hits every registered endpoint on a ~1 second loop. The other
 * cron routes absorb that by looping internally for minutes; this one is a
 * single bounded pass, so without a cooldown a development machine would run a
 * full-history group-by against ClickHouse once a second.
 *
 * On Vercel each invocation is a fresh process, so this is a no-op there and the
 * `vercel.json` schedule is what paces it. Correctness never depends on it: the
 * `IssueMaterialization` ledger is what makes replay exactly-once, so running
 * this back-to-back is merely wasteful, never wrong.
 */
const RECONCILER_COOLDOWN_MS = 60 * 1000;

let lastRunAt: number | null = null;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Reconcile unmaterialized issue batches",
    description: "Internal endpoint invoked by Vercel Cron to replay `$error` batches that never reached the Postgres issue ledger.",
    tags: ["Observability"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["GET"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).defined(),
    }).defined(),
    query: yupObject({
      force: yupString().oneOf(["true", "false"]).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      ok: yupBoolean().defined(),
      /** False when the in-process cooldown skipped this pass; see RECONCILER_COOLDOWN_MS. */
      ran: yupBoolean().defined(),
      tenancies_scanned: yupNumber().defined(),
      batches_repaired: yupNumber().defined(),
      batches_deferred: yupNumber().defined(),
      occurrences_skipped: yupNumber().defined(),
    }).defined(),
  }),
  handler: async ({ headers, query }) => {
    const authHeader = headers.authorization[0];
    if (authHeader !== `Bearer ${getEnvVariable('CRON_SECRET')}`) {
      throw new StatusError(401, "Unauthorized");
    }

    // `performance.now()` rather than Date.now(): this measures elapsed real
    // time between two points in the same process, which a wall clock adjustment
    // would otherwise corrupt.
    const nowTicks = performance.now();
    const cooling = lastRunAt !== null && nowTicks - lastRunAt < RECONCILER_COOLDOWN_MS;
    if (cooling && query.force !== "true") {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          ok: true,
          ran: false,
          tenancies_scanned: 0,
          batches_repaired: 0,
          batches_deferred: 0,
          occurrences_skipped: 0,
        },
      };
    }
    lastRunAt = nowTicks;

    const result = await reconcileIssues();
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        ok: true,
        ran: true,
        tenancies_scanned: result.tenanciesScanned,
        batches_repaired: result.batchesRepaired,
        batches_deferred: result.batchesDeferred,
        occurrences_skipped: result.occurrencesSkipped,
      },
    };
  },
});
