import { getSharedClickhouseAdminClient } from "@/lib/clickhouse";
import { getSoleTenancyFromProjectBranch, type Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { isUuid } from "@hexclave/shared/dist/utils/uuids";
import type { IssueMaterializationInput } from "../analytics-telemetry-writers";
import { isGroupingConfigId } from "./grouping-config";
import { materializeIssuesFromBatch } from "./issue-store";
import { emitIssueWebhooks } from "./issue-webhooks";

/**
 * Bounded-latency repair for issue materialization.
 *
 * Materialization runs off the request path (`runAsynchronouslyAndWaitUntil`
 * after the ClickHouse inserts resolve), so a process that dies in between
 * leaves durable, correctly-grouped occurrences in ClickHouse with no Issue row,
 * no counter delta, and possibly a missed regression. This sweep closes that gap.
 *
 * ── It works off the LEDGER, not off missing hashes ───────────────────────
 * The obvious implementation anti-joins `issue_hash` values against `IssueHash`
 * and creates whatever is missing. That is structurally incapable of detecting
 * the three failures that actually happen:
 *
 *   - a missing COUNTER delta (the issue exists, its `timesSeen` is short),
 *   - a missed REGRESSION (the issue exists and is still marked resolved),
 *   - a batch that hit a LOCKED hash and was deliberately left unclaimed.
 *
 * In all three the hash already exists, so a hash-based anti-join sees nothing
 * wrong. The ledger (`IssueMaterialization`, one row per (tenancy, batch)) is
 * the only thing that records whether a batch's deltas were APPLIED.
 *
 * So: find `batch_id`s with `$error` rows and no ledger row, rebuild their
 * `IssueMaterializationInput[]` from the ClickHouse columns, and feed them
 * through `materializeIssuesFromBatch` — the same function the live path calls.
 * Replay is therefore exactly-once by the very ledger that identified the gap,
 * and there is no second code path to keep in sync.
 */

/**
 * How far back a run looks. Materialization normally completes in well under a
 * second, so anything still unclaimed after an hour is a genuine failure rather
 * than work in progress. Bounded because the query it drives is a group-by over
 * `analytics_internal.logs`; an unbounded lookback would turn a repair sweep
 * into a full-history scan every minute.
 */
export const ISSUE_RECONCILER_LOOKBACK_MS = 60 * 60 * 1000;

/**
 * Batches newer than this are ignored: their live materialization is plausibly
 * still in flight. Replaying one early is *safe* (the ledger makes whichever
 * writer gets there second a no-op) but pointless, and it would make every run
 * re-read the busiest minute of traffic.
 */
export const ISSUE_RECONCILER_SETTLE_MS = 2 * 60 * 1000;

/** Per-run caps. A repair sweep must never become the reason the database is busy. */
export const ISSUE_RECONCILER_MAX_CANDIDATE_BATCHES = 5000;
export const ISSUE_RECONCILER_MAX_TENANCIES = 25;
export const ISSUE_RECONCILER_MAX_BATCHES_PER_TENANCY = 100;
export const ISSUE_RECONCILER_MAX_BATCHES_PER_RUN = 500;

export type IssueReconcilerResult = {
  tenanciesScanned: number,
  batchesRepaired: number,
  /** Candidates found unapplied but not attempted this run (cap reached). Non-zero means run more often. */
  batchesDeferred: number,
  /** Rows whose grouping config id we no longer recognise; see `rebuildInputs`. */
  occurrencesSkipped: number,
};

type CandidateRow = { project_id: string, branch_id: string, batch_id: string };

type OccurrenceGroupRow = {
  batch_id: string,
  issue_hash: string,
  issue_hashes: string[],
  grouping_config: string,
  // 64-bit integers come back as either a decimal string or a number depending on
  // the server's `output_format_json_quote_64bit_integers`; both are accepted.
  occurrences: string | number,
  first_event_at_millis: string | number,
  last_event_at_millis: string | number,
  received_at_millis: string | number,
  error_type: string,
  message: string,
  culprit: string,
  runtime: string,
  service_name: string | null,
  environment: string | null,
  release: string | null,
  /**
   * Mechanism facts, projected back out of the occurrence's `data`. The Issue
   * row persists them at CREATION time, and a reconciled batch may well be the
   * one that creates the issue.
   */
  handled: boolean,
  synthetic: boolean,
};

/**
 * `runtime` (where the code ran) → `platform` (what the grouper called it).
 *
 * Restated here rather than imported because the ingest row builder derives it
 * from its in-memory `BatchSignalContext` and never persists the mapping. Kept
 * to one line and next to the only other consumer's wording so a divergence is
 * obvious in review.
 */
function platformFromRuntime(runtime: string): string {
  return runtime === "browser" ? "javascript" : "node";
}

/**
 * Distinct (project, branch, batch) triples that produced grouped `$error` rows
 * recently.
 *
 * Bounded on `event_at` rather than `created_at` because `event_at` is in the
 * table's sorting key and `created_at` is not — filtering on server receipt time
 * would scan every granule in the partition. The cost is that a client with a
 * badly skewed clock can place its occurrences outside the window and go
 * unrepaired; that is acceptable because the live path materialized them
 * already, and this sweep only exists for the case where the live path died.
 */
async function findCandidateBatches(from: Date, to: Date): Promise<CandidateRow[]> {
  const client = getSharedClickhouseAdminClient();
  const result = await client.query({
    query: `
      SELECT project_id, branch_id, batch_id
      FROM analytics_internal.logs
      WHERE event_type = '$error'
        AND issue_hash != ''
        AND batch_id != ''
        AND event_at >= {from:DateTime64(3)}
        AND event_at < {to:DateTime64(3)}
      GROUP BY project_id, branch_id, batch_id
      LIMIT {cap:UInt64}
    `,
    query_params: {
      from: from.getTime() / 1000,
      to: to.getTime() / 1000,
      cap: ISSUE_RECONCILER_MAX_CANDIDATE_BATCHES,
    },
    format: "JSONEachRow",
  });
  return await result.json() as CandidateRow[];
}

/** Which of these batch ids already have a ledger row, i.e. were already applied. */
async function findAppliedBatchIds(tenancy: Tenancy, batchIds: readonly string[]): Promise<Set<string>> {
  const prisma = await getPrismaClientForTenancy(tenancy);
  const rows = await prisma.$queryRaw<{ batchId: string }[]>`
    SELECT "batchId"
    FROM "IssueMaterialization"
    WHERE "tenancyId" = ${tenancy.id}::uuid AND "batchId" = ANY(${[...batchIds]}::uuid[])
  `;
  return new Set(rows.map((row) => row.batchId));
}

/**
 * Rebuilds the per-batch materialization inputs from the occurrence columns.
 *
 * Everything the live path passed to `materializeIssuesFromBatch` was written to
 * a typed ClickHouse column precisely so this is a projection rather than a
 * re-derivation: no stack is re-parsed and no hash is recomputed here, so a
 * replay can never disagree with the original grouping even if the grouping code
 * changed in between.
 *
 * `receivedAt` comes from `max(created_at)` — the SERVER's insert timestamp, not
 * the client-supplied `event_at`. It drives regression detection, and using
 * `now()` instead would reopen an issue that was legitimately resolved *after*
 * this batch was ingested but before we got around to replaying it.
 */
async function rebuildInputs(options: {
  projectId: string,
  branchId: string,
  batchIds: readonly string[],
  from: Date,
  to: Date,
}): Promise<{ byBatch: Map<string, { inputs: IssueMaterializationInput[], receivedAt: Date }>, skipped: number }> {
  const client = getSharedClickhouseAdminClient();
  const result = await client.query({
    query: `
      SELECT
        batch_id,
        issue_hash,
        any(issue_hashes) AS issue_hashes,
        any(issue_grouping_config) AS grouping_config,
        count() AS occurrences,
        toUnixTimestamp64Milli(min(event_at)) AS first_event_at_millis,
        toUnixTimestamp64Milli(max(event_at)) AS last_event_at_millis,
        toUnixTimestamp64Milli(max(created_at)) AS received_at_millis,
        argMax(error_type, event_at) AS error_type,
        argMax(message, event_at) AS message,
        argMax(error_culprit, event_at) AS culprit,
        argMax(runtime, event_at) AS runtime,
        argMax(service_name, event_at) AS service_name,
        argMax(deployment_environment_name, event_at) AS environment,
        argMax(nullIf(toString(data.release), ''), event_at) AS release,
        -- Mechanism facts, read back out of the occurrence's \`data\` because the
        -- Issue row persists them at CREATION time and a reconciled batch may be
        -- the one that creates the issue. \`handled\` defaults to true: an error we
        -- cannot prove crashed the caller must not be reported as a crash.
        argMax(toString(data.handled) = 'true', event_at) AS handled,
        argMax(issue_variant = 'message' AND toString(data.synthetic) != '', event_at) AS synthetic
      FROM analytics_internal.logs
      WHERE project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND event_type = '$error'
        AND issue_hash != ''
        AND batch_id IN {batchIds:Array(String)}
        AND event_at >= {from:DateTime64(3)}
        AND event_at < {to:DateTime64(3)}
      GROUP BY batch_id, issue_hash
    `,
    query_params: {
      projectId: options.projectId,
      branchId: options.branchId,
      batchIds: [...options.batchIds],
      from: options.from.getTime() / 1000,
      to: options.to.getTime() / 1000,
    },
    format: "JSONEachRow",
  });
  const rows = await result.json() as OccurrenceGroupRow[];

  const byBatch = new Map<string, { inputs: IssueMaterializationInput[], receivedAt: Date }>();
  let skipped = 0;
  for (const row of rows) {
    if (!isGroupingConfigId(row.grouping_config)) {
      // A config id we no longer ship. Deliberately not defaulted: binding these
      // hashes to the current config would claim they were produced by an
      // algorithm that never saw them, and would silently re-group the project's
      // history the next time anything walked `IssueHash.groupingConfigId`.
      skipped += 1;
      continue;
    }
    const receivedAt = new Date(Number(row.received_at_millis));
    const entry = byBatch.get(row.batch_id) ?? { inputs: [], receivedAt };
    // One `receivedAt` per batch: the batch is the ledger's unit, so its
    // lifecycle comparison must be a single instant.
    if (receivedAt > entry.receivedAt) entry.receivedAt = receivedAt;
    entry.inputs.push({
      ownerHash: row.issue_hash,
      aliasHashes: row.issue_hashes.filter((hash) => hash !== row.issue_hash),
      groupingConfigId: row.grouping_config,
      type: row.error_type,
      value: row.message,
      culprit: row.culprit,
      handled: row.handled,
      synthetic: row.synthetic,
      platform: platformFromRuntime(row.runtime),
      count: Number(row.occurrences),
      firstEventAt: new Date(Number(row.first_event_at_millis)),
      lastEventAt: new Date(Number(row.last_event_at_millis)),
      serviceName: row.service_name,
      deploymentEnvironmentName: row.environment,
      release: row.release,
      level: "error",
    });
    byBatch.set(row.batch_id, entry);
  }
  return { byBatch, skipped };
}

/** Groups candidates by their (project, branch) pair, which is what a tenancy is. */
function groupCandidatesByProjectBranch(candidates: readonly CandidateRow[]): Map<string, { projectId: string, branchId: string, batchIds: string[] }> {
  const byKey = new Map<string, { projectId: string, branchId: string, batchIds: string[] }>();
  for (const candidate of candidates) {
    // `batch_id` is a plain ClickHouse String, but the ledger's column is a uuid.
    // Anything else cannot possibly have a ledger row, and would fail the cast.
    if (!isUuid(candidate.batch_id)) continue;
    const key = `${candidate.project_id} ${candidate.branch_id}`;
    const entry = byKey.get(key) ?? { projectId: candidate.project_id, branchId: candidate.branch_id, batchIds: [] };
    entry.batchIds.push(candidate.batch_id);
    byKey.set(key, entry);
  }
  return byKey;
}

export async function reconcileIssues(options?: { now?: Date }): Promise<IssueReconcilerResult> {
  const now = options?.now ?? new Date();
  const to = new Date(now.getTime() - ISSUE_RECONCILER_SETTLE_MS);
  const from = new Date(now.getTime() - ISSUE_RECONCILER_LOOKBACK_MS);

  const candidates = await findCandidateBatches(from, to);
  const byProjectBranch = groupCandidatesByProjectBranch(candidates);

  const result: IssueReconcilerResult = {
    tenanciesScanned: 0,
    batchesRepaired: 0,
    batchesDeferred: 0,
    occurrencesSkipped: 0,
  };

  for (const entry of [...byProjectBranch.values()].slice(0, ISSUE_RECONCILER_MAX_TENANCIES)) {
    if (result.batchesRepaired >= ISSUE_RECONCILER_MAX_BATCHES_PER_RUN) {
      result.batchesDeferred += entry.batchIds.length;
      continue;
    }
    try {
      const repaired = await reconcileTenancy({ ...entry, from, to });
      result.tenanciesScanned += 1;
      result.batchesRepaired += repaired.batchesRepaired;
      result.batchesDeferred += repaired.batchesDeferred;
      result.occurrencesSkipped += repaired.occurrencesSkipped;
    } catch (error) {
      // Scoped to one tenancy on purpose — this is a sweep over independent
      // tenants, and one project with (say) a deleted tenancy row must not stop
      // every other project's occurrences from being repaired. Reported rather
      // than swallowed, and the batch stays unclaimed so the next run retries it.
      captureError("issue-reconciler-tenancy", { error, projectId: entry.projectId, branchId: entry.branchId });
    }
  }

  if (result.batchesRepaired > 0 || result.occurrencesSkipped > 0) {
    console.log(
      `[IssueReconciler] repaired ${result.batchesRepaired} batch(es) across ${result.tenanciesScanned} tenancy(ies)`
      + `; deferred ${result.batchesDeferred}, skipped ${result.occurrencesSkipped} occurrence group(s) on unknown grouping configs`,
    );
  }
  return result;
}

async function reconcileTenancy(options: {
  projectId: string,
  branchId: string,
  batchIds: readonly string[],
  from: Date,
  to: Date,
}): Promise<{ batchesRepaired: number, batchesDeferred: number, occurrencesSkipped: number }> {
  const tenancy = await getSoleTenancyFromProjectBranch(options.projectId, options.branchId, true);
  if (tenancy === null) {
    // The project or branch was deleted after its telemetry landed. The
    // occurrences age out on the ClickHouse TTL; there is nothing to materialize
    // them into.
    return { batchesRepaired: 0, batchesDeferred: 0, occurrencesSkipped: 0 };
  }

  const applied = await findAppliedBatchIds(tenancy, options.batchIds);
  const unapplied = options.batchIds.filter((batchId) => !applied.has(batchId));
  if (unapplied.length === 0) return { batchesRepaired: 0, batchesDeferred: 0, occurrencesSkipped: 0 };

  const attempted = unapplied.slice(0, ISSUE_RECONCILER_MAX_BATCHES_PER_TENANCY);
  const { byBatch, skipped } = await rebuildInputs({
    projectId: options.projectId,
    branchId: options.branchId,
    batchIds: attempted,
    from: options.from,
    to: options.to,
  });

  let batchesRepaired = 0;
  for (const [batchId, { inputs, receivedAt }] of byBatch) {
    if (inputs.length === 0) continue;
    const outcomes = await materializeIssuesFromBatch({ tenancy, batchId, inputs, receivedAt });
    // An empty result means either "already in the ledger" (someone else won the
    // race, which is fine) or "every hash was still LOCKED" (the next run picks
    // it up). Neither counts as a repair.
    if (outcomes.length === 0) continue;
    batchesRepaired += 1;
    // A repaired batch is by definition one whose live path died before it could
    // announce anything, so this is the only chance these issues get to fire
    // `issue.created`/`issue.regressed`. Outcomes are only non-empty when THIS
    // run won the ledger claim, so a replay can never re-announce. `receivedAt`
    // is the original server receipt time, which makes the emit throttle
    // stricter than a wall clock would, never looser.
    await emitIssueWebhooks({ tenancy, outcomes, now: receivedAt });
  }

  return {
    batchesRepaired,
    batchesDeferred: unapplied.length - attempted.length,
    occurrencesSkipped: skipped,
  };
}
