import type { Tenancy } from "@/lib/tenancies";
import { getBillingTeamId } from "@/lib/plan-entitlements";
import { getPrismaClientForTenancy, retryTransaction, type PrismaClientTransaction } from "@/prisma-client";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { Prisma } from "@/generated/prisma/client";
import type { IssueBatchDelta } from "./issue-materialization-contract";
import { ISSUE_LOCK_LEASE_MS } from "./issue-merge";
import { emitIssueWebhooks } from "./issue-webhooks";
import { dispatchIssueAlertsForMaterialization } from "./issue-alerts/ingestion";
import { randomUUID } from "node:crypto";
import { toDurableGroupingProvenance } from "./grouping-provenance";
import type { GroupingHashProvenance } from "./types";

/**
 * Turns a batch's grouped `$error` occurrences into persistent Issue records.
 *
 * ── Transaction boundary ─────────────────────────────────────────────────
 * The statements below are raw SQL. First-sighting allocation and the
 * lock/claim sequence need a short retrying transaction because they span
 * multiple statements; the repo's `retryTransaction` wrapper keeps transient
 * serialization failures from turning into duplicate issues or lost batches.
 *
 * ── The exactly-once story ────────────────────────────────────────────────
 * This runs off the request path, so it must survive being run twice (a
 * retried ingest batch that ClickHouse deduplicated by insert token, but which
 * reached Postgres again) and being run never (a process that died between the
 * ClickHouse insert and here).
 *
 *   Step 1  Ensure an Issue + IssueHash exists for every owning hash.
 *           Idempotent by construction (`ON CONFLICT DO NOTHING` on the hash
 *           primary key, which is also the first-sighting race arbiter).
 *           Losing first-sighting candidates are deleted before this function
 *           returns, so a race cannot expose an Issue with no owning hash.
 *
 *   Step 2  ONE statement: claim the batch in the ledger and apply the counter
 *           deltas, with the update gated on the claim having succeeded. Both
 *           commit or neither does. A second run finds the ledger row already
 *           present, the claim CTE returns no rows, and the update touches
 *           nothing.
 *
 * Ordering matters: creation before the claim, counters inside it. Doing
 * creation inside the claim would make a crash mid-way leave a claimed batch
 * with no issues at all, which the reconciler could not distinguish from a
 * fully-applied one. A candidate issue is bound to its owner hash before
 * aliases are inserted; this prevents a losing concurrent candidate from
 * surviving through an alias.
 */

export type IssueBatchApplyOutcome = {
  issueId: string,
  shortId: bigint,
  ownerHash: string,
  /** First time this issue has ever been seen. Drives `issue.created`. */
  isNew: boolean,
  /** A resolved issue recurred. Drives `issue.regressed`. */
  isRegression: boolean,
};

export type IssueMaterializationSideEffectState = {
  webhooksDispatchedAt: Date | null,
  alertsDispatchedAt: Date | null,
};

export type IssueMaterializationResult = {
  status: "applied" | "already_applied" | "deferred_locked",
  outcomes: IssueBatchApplyOutcome[],
  sideEffects: IssueMaterializationSideEffectState,
};

type IssueMaterializationLedgerRow = IssueMaterializationSideEffectState & {
  outcomes: IssueBatchApplyOutcome[],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeStoredOutcomes(value: unknown): IssueBatchApplyOutcome[] {
  if (value == null) return [];
  const parsedValue: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsedValue)) throw new Error("Issue materialization ledger outcomes must be an array");

  return parsedValue.map((entry) => {
    if (!isRecord(entry)
      || typeof entry.issueId !== "string"
      || typeof entry.shortId !== "string"
      || typeof entry.ownerHash !== "string"
      || typeof entry.isNew !== "boolean"
      || typeof entry.isRegression !== "boolean") {
      throw new Error("Issue materialization ledger contains an invalid outcome");
    }
    return {
      issueId: entry.issueId,
      shortId: BigInt(entry.shortId),
      ownerHash: entry.ownerHash,
      isNew: entry.isNew,
      isRegression: entry.isRegression,
    };
  });
}

async function readMaterializationLedger(
  prisma: PrismaClientTransaction,
  tenancyId: string,
  batchId: string,
): Promise<IssueMaterializationLedgerRow | null> {
  const rows = await prisma.$queryRaw<{
    outcomes: unknown,
    webhooksDispatchedAt: Date | null,
    alertsDispatchedAt: Date | null,
  }[]>`
    SELECT "outcomes", "webhooksDispatchedAt", "alertsDispatchedAt"
    FROM "IssueMaterialization"
    WHERE "tenancyId" = ${tenancyId}::uuid AND "batchId" = ${batchId}
    LIMIT 1
  `;
  const row = rows.at(0);
  if (row === undefined) return null;
  return {
    outcomes: decodeStoredOutcomes(row.outcomes),
    webhooksDispatchedAt: row.webhooksDispatchedAt,
    alertsDispatchedAt: row.alertsDispatchedAt,
  };
}

function serializeOutcomes(outcomes: readonly IssueBatchApplyOutcome[]): Array<{
  issueId: string,
  shortId: string,
  ownerHash: string,
  isNew: boolean,
  isRegression: boolean,
}> {
  return outcomes.map((outcome) => ({
    issueId: outcome.issueId,
    shortId: outcome.shortId.toString(),
    ownerHash: outcome.ownerHash,
    isNew: outcome.isNew,
    isRegression: outcome.isRegression,
  }));
}

export async function markIssueMaterializationSideEffect(options: {
  tenancy: Tenancy,
  batchId: string,
  sideEffect: "webhooks" | "alerts",
}): Promise<void> {
  const prisma = await getPrismaClientForTenancy(options.tenancy);
  if (options.sideEffect === "webhooks") {
    await prisma.$executeRaw`
      UPDATE "IssueMaterialization"
      SET "webhooksDispatchedAt" = COALESCE("webhooksDispatchedAt", NOW())
      WHERE "tenancyId" = ${options.tenancy.id}::uuid AND "batchId" = ${options.batchId}
    `;
    return;
  }
  await prisma.$executeRaw`
    UPDATE "IssueMaterialization"
    SET "alertsDispatchedAt" = COALESCE("alertsDispatchedAt", NOW())
    WHERE "tenancyId" = ${options.tenancy.id}::uuid AND "batchId" = ${options.batchId}
  `;
}

/** Per-issue deltas, after folding every hash that maps to the same issue. */
type IssueDelta = {
  issueId: string,
  count: number,
  firstEventAt: Date,
  lastEventAt: Date,
  release: string | null,
  serviceName: string | null,
};

type PendingIssue = {
  id: string,
  input: IssueBatchDelta,
};

type IssueHashRole = "primary" | "secondary";

type StoredIssueHashValues = {
  hash: string,
  issueId: string,
  groupingConfigId: string,
  groupingRole: "PRIMARY" | "SECONDARY" | null,
  groupingVariant: string | null,
  groupingProvenance: ReturnType<typeof toDurableGroupingProvenance> | null,
};

/**
 * Selects the decision records for one stored hash. A hash can be observed
 * under more than one config during a transition, so the JSON column retains
 * every matching observation while the direct columns expose the first one for
 * cheap issue/hash reads. Materialization inputs from canonical ingest include
 * provenance; older reconciliation callers may omit it, in which case the new
 * nullable columns remain null instead of storing an invented decision.
 */
function issueHashValues(
  input: IssueBatchDelta,
  hash: string,
  role: IssueHashRole,
  issueId: string,
): StoredIssueHashValues {
  const matching = input.groupingProvenance?.filter((entry) => entry.hash === hash && entry.role === role) ?? [];
  const first = matching.at(0);
  if (first === undefined) {
    if (input.groupingProvenance !== undefined) {
      throw new Error(`Missing ${role} grouping provenance for hash ${JSON.stringify(hash)}`);
    }
    return {
      hash,
      issueId,
      groupingConfigId: input.groupingConfigId,
      groupingRole: null,
      groupingVariant: null,
      groupingProvenance: null,
    };
  }
  const observedConfigId = String(first.configId);
  const expectedConfigId = String(input.groupingConfigId);
  if (role === "primary" && observedConfigId !== expectedConfigId) {
    throw new Error(`Primary grouping provenance config does not match ${JSON.stringify(input.groupingConfigId)}`);
  }

  return {
    hash,
    issueId,
    groupingConfigId: first.configId,
    groupingRole: role === "primary" ? "PRIMARY" : "SECONDARY",
    groupingVariant: first.variant,
    groupingProvenance: toDurableGroupingProvenance(matching),
  };
}

/**
 * One materialization input is allowed per owning hash. The normalizer already
 * coalesces a batch this way, but keeping the invariant at the persistence
 * boundary prevents a malformed or future ingestion path from allocating two
 * short ids for the same first sighting and then leaving one candidate orphaned.
 */
export function deduplicateIssueMaterializationInputs(
  inputs: readonly IssueBatchDelta[],
): IssueBatchDelta[] {
  const byOwnerHash = new Map<string, IssueBatchDelta>();
  for (const input of inputs) {
    if (!byOwnerHash.has(input.ownerHash)) byOwnerHash.set(input.ownerHash, input);
  }
  return [...byOwnerHash.values()];
}

/** A locked hash defers the complete ledger batch, never just one delta. */
export function shouldDeferIssueMaterialization(
  rows: readonly { state: string | null }[],
): boolean {
  return rows.some((row) => row.state !== null);
}

/**
 * Clears EXPIRED merge/unmerge leases on the given hashes so materialization
 * can proceed.
 *
 * `lockedAt` is a lease (see `issue-merge.ts`): a process that dies between
 * acquiring the lock and finishing its work leaves the rows `LOCKED` forever,
 * and only another merge attempt on the same hashes would ever steal the stale
 * lease. Without this reclamation the materializer and the reconciler would
 * defer those hashes on every run, indefinitely — a crashed merge would
 * silently stop the affected errors from ever materializing again.
 *
 * Safe against a zombie holder that is merely slow rather than dead: its final
 * statement re-validates `state = 'LOCKED' AND lockedAt = <its own acquisition
 * instant>` and no-ops when the lease was taken away — the exact same contract
 * `acquireHashLocks` relies on when IT steals a stale lease.
 */
async function reclaimExpiredIssueHashLeases(
  tx: PrismaClientTransaction,
  tenancyId: string,
  hashes: readonly string[],
  now: Date,
): Promise<void> {
  if (hashes.length === 0) return;
  const leaseCutoff = new Date(now.getTime() - ISSUE_LOCK_LEASE_MS);
  await tx.$executeRaw`
    UPDATE "IssueHash"
    SET "state" = NULL, "lockedAt" = NULL
    WHERE "tenancyId" = ${tenancyId}::uuid
      AND "hash" = ANY(${[...hashes]}::text[])
      AND "state" IS NOT NULL
      AND ("lockedAt" IS NULL OR "lockedAt" < ${leaseCutoff}::timestamptz)
  `;
}

/**
 * Resolves owning hashes to issues, creating any that don't exist yet.
 *
 * Hashes whose `IssueHash` row is `LOCKED` (a merge or unmerge is in flight)
 * are deliberately left unresolved: rebinding them mid-migration would race the
 * migration's own repoint. The occurrence is already durable in ClickHouse
 * carrying its hash, so the reconciler picks it up once the lock clears — the
 * occurrence is delayed, never lost. This is only safe *because* the ClickHouse
 * row stores the immutable hash rather than a mutable issue id.
 */
async function resolveOrCreateIssues(
  prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
  tenancyId: string,
  inputs: readonly IssueBatchDelta[],
  receivedAt: Date,
  ownerTeamId: string | null,
): Promise<Map<string, { issueId: string, shortId: bigint, isNew: boolean }>> {
  return await retryTransaction(prisma, async (tx) => {
    const resolved = new Map<string, { issueId: string, shortId: bigint, isNew: boolean }>();
    const uniqueInputs = deduplicateIssueMaterializationInputs(inputs);
    const ownerHashes = uniqueInputs.map((input) => input.ownerHash);

    // Wall clock, not `receivedAt`: the reconciler replays batches with their
    // original (old) receipt time, and lease expiry is a wall-clock contract.
    await reclaimExpiredIssueHashLeases(tx, tenancyId, ownerHashes, new Date());

    const existing = await tx.$queryRaw<{ hash: string, issueId: string, shortId: bigint, state: string | null }[]>`
      SELECT h."hash", h."issueId", i."shortId", h."state"::text AS "state"
      FROM "IssueHash" h
      JOIN "Issue" i ON i."tenancyId" = h."tenancyId" AND i."id" = h."issueId"
      WHERE h."tenancyId" = ${tenancyId}::uuid AND h."hash" = ANY(${ownerHashes}::text[])
    `;
    for (const row of existing) {
      if (row.state !== null) continue; // LOCKED — see the doc comment above.
      resolved.set(row.hash, { issueId: row.issueId, shortId: row.shortId, isNew: false });
    }

    // A materialization batch is the unit of ledger idempotency. Claiming it while
    // even one owner hash is locked would permanently discard that hash when the
    // caller returns: the next retry would see the batch already applied. Do not
    // create candidates for the other hashes either; the whole batch is retried
    // after the merge/unmerge lease clears.
    if (shouldDeferIssueMaterialization(existing)) return new Map();

    const missing: PendingIssue[] = uniqueInputs
      .filter((input) => !resolved.has(input.ownerHash))
      .map((input) => ({ id: randomUUID(), input }));
    if (missing.length === 0) return resolved;

    // Reserve a contiguous block of short ids in ONE statement, so the counter
    // row is locked once per batch rather than once per issue. A batch that then
    // fails burns its range; gaps are accepted and documented, because the
    // alternative (allocating lazily per insert) reintroduces per-issue
    // contention on a single hot row.
    const [{ firstShortId }] = await tx.$queryRaw<{ firstShortId: bigint }[]>`
      INSERT INTO "IssueCounter" ("tenancyId", "nextShortId")
      VALUES (${tenancyId}::uuid, ${missing.length + 1}::bigint)
      ON CONFLICT ("tenancyId") DO UPDATE
        SET "nextShortId" = "IssueCounter"."nextShortId" + ${missing.length}::bigint
      RETURNING "nextShortId" - ${missing.length}::bigint AS "firstShortId"
    `;

    const created = await tx.$queryRaw<{ id: string, shortId: bigint }[]>(buildIssueInsertSql(
      tenancyId,
      missing,
      firstShortId,
      receivedAt,
      ownerTeamId,
    ));

    // Bind ONLY each owning hash first. `ON CONFLICT DO NOTHING` on the hash
    // primary key is the concurrency control: if a concurrent batch created the
    // same issue first, its row wins and ours is discarded. Aliases are delayed
    // until after the owner winner is known; otherwise an alias that happened to
    // be unique could keep a losing candidate Issue visible with no owner hash.
    const ownerHashValues = missing.map(({ id, input }) => issueHashValues(input, input.ownerHash, "primary", id));
    if (ownerHashValues.length > 0) {
      await tx.$executeRaw`
        INSERT INTO "IssueHash" (
          "tenancyId", "hash", "issueId", "groupingConfigId", "groupingRole", "groupingVariant", "groupingProvenance"
        )
        SELECT
          ${tenancyId}::uuid, v."hash", v."issueId"::uuid, v."groupingConfigId",
          v."groupingRole"::"IssueHashGroupingRole", v."groupingVariant", v."groupingProvenance"
        FROM jsonb_to_recordset(${JSON.stringify(ownerHashValues)}::jsonb)
          AS v(
            "hash" text, "issueId" text, "groupingConfigId" text,
            "groupingRole" text, "groupingVariant" text, "groupingProvenance" jsonb
          )
        ON CONFLICT ("tenancyId", "hash") DO NOTHING
      `;
    }

    // Re-read so a hash the race lost binds to the WINNER's issue, not to the
    // orphan we just inserted. Without this, two concurrent first-sightings would
    // each count into a different issue and the user would see a duplicate.
    const rebound = await tx.$queryRaw<{ hash: string, issueId: string, shortId: bigint }[]>`
      SELECT h."hash", h."issueId", i."shortId"
      FROM "IssueHash" h
      JOIN "Issue" i ON i."tenancyId" = h."tenancyId" AND i."id" = h."issueId"
      WHERE h."tenancyId" = ${tenancyId}::uuid
        AND h."hash" = ANY(${missing.map((candidate) => candidate.input.ownerHash)}::text[])
        AND h."state" IS NULL
    `;
    const createdIds = new Set(created.map((candidate) => candidate.id));

    // The owner-hash insert is the race arbiter. Candidates that lost it are not
    // addressable by any materializer and must be removed in the same retry
    // window; leaving them behind makes the issue list show zero-count orphan
    // issues forever. The NOT EXISTS guard preserves a candidate if a future
    // aliasing operation has already attached a hash to it.
    await tx.$executeRaw`
      DELETE FROM "Issue" i
      WHERE i."tenancyId" = ${tenancyId}::uuid
        AND i."id" = ANY(${[...createdIds]}::uuid[])
        AND NOT EXISTS (
          SELECT 1
          FROM "IssueHash" h
          WHERE h."tenancyId" = i."tenancyId" AND h."issueId" = i."id"
        )
    `;

    const pendingByOwnerHash = new Map(missing.map((candidate) => [candidate.input.ownerHash, candidate]));
    const aliasHashValues = rebound.flatMap((row) => {
      const candidate = pendingByOwnerHash.get(row.hash);
      if (candidate === undefined || row.issueId !== candidate.id) return [];
      return candidate.input.aliasHashes.map((hash) => issueHashValues(candidate.input, hash, "secondary", candidate.id));
    });
    if (aliasHashValues.length > 0) {
      await tx.$executeRaw`
        INSERT INTO "IssueHash" (
          "tenancyId", "hash", "issueId", "groupingConfigId", "groupingRole", "groupingVariant", "groupingProvenance"
        )
        SELECT
          ${tenancyId}::uuid, v."hash", v."issueId"::uuid, v."groupingConfigId",
          v."groupingRole"::"IssueHashGroupingRole", v."groupingVariant", v."groupingProvenance"
        FROM jsonb_to_recordset(${JSON.stringify(aliasHashValues)}::jsonb)
          AS v(
            "hash" text, "issueId" text, "groupingConfigId" text,
            "groupingRole" text, "groupingVariant" text, "groupingProvenance" jsonb
          )
        ON CONFLICT ("tenancyId", "hash") DO NOTHING
      `;
    }

    for (const row of rebound) {
      resolved.set(row.hash, {
        issueId: row.issueId,
        shortId: row.shortId,
        // Only genuinely new if OUR insert is the one that survived; otherwise a
        // concurrent batch already emitted `issue.created` for it.
        isNew: createdIds.has(row.issueId),
      });
    }

    return resolved;
  });
}

function buildIssueInsertSql(
  tenancyId: string,
  missing: readonly PendingIssue[],
  firstShortId: bigint,
  receivedAt: Date,
  ownerTeamId: string | null,
): Prisma.Sql {
  const rows = missing.map(({ id, input }, index) => Prisma.sql`(
    ${id}::uuid,
    ${tenancyId}::uuid,
    ${(firstShortId + BigInt(index)).toString()}::bigint,
    ${input.type}, ${input.value}, ${input.culprit}, ${input.platform},
    ${input.handled}, ${input.synthetic},
    ${input.firstEventAt}::timestamptz, ${input.lastEventAt}::timestamptz,
    ${input.serviceName}, ${input.deploymentEnvironmentName},
    ${input.release}, ${input.release},
    ${ownerTeamId}::uuid,
    ${receivedAt}::timestamptz
  )`);
  // assignedTeamId is the Hexclave project owner team, stamped at first
  // sighting so the dashboard never has to ask. It is not a Team row in this
  // tenancy; see Issue.assignedTeamId.
  //
  // `Issue.id` is declared `@default(uuid())`, which Prisma applies CLIENT-side
  // in its own query builder. The generated migration therefore emits a bare
  // `"id" UUID NOT NULL`, so raw INSERTs must provide the candidate id
  // explicitly. Supplying it from Node also lets us identify and delete the
  // loser of a concurrent owner-hash insert without relying on unspecified
  // `RETURNING` row order.
  return Prisma.sql`
    INSERT INTO "Issue" (
      "id", "tenancyId", "shortId", "type", "value", "culprit", "platform",
      "handled", "synthetic",
      "firstSeenAt", "lastSeenAt", "serviceName", "deploymentEnvironmentName",
      "firstSeenRelease", "lastSeenRelease", "assignedTeamId", "updatedAt"
    )
    VALUES ${Prisma.join(rows, ",")}
    RETURNING "id", "shortId"
  `;
}

/**
 * Folds per-hash inputs into per-ISSUE deltas.
 *
 * This is not cosmetic. After a merge, several hashes map to one issue, and
 * PostgreSQL's `UPDATE … FROM (VALUES …)` does NOT apply every matching source
 * row — it updates the target once, from an unspecified one. Feeding it
 * per-hash rows would therefore silently drop deltas for merged issues.
 */
function foldDeltasByIssue(
  inputs: readonly IssueBatchDelta[],
  resolved: ReadonlyMap<string, { issueId: string }>,
): IssueDelta[] {
  const byIssue = new Map<string, IssueDelta>();
  for (const input of inputs) {
    const target = resolved.get(input.ownerHash);
    if (target === undefined) continue; // locked hash; the reconciler will retry
    const existing = byIssue.get(target.issueId);
    if (existing === undefined) {
      byIssue.set(target.issueId, {
        issueId: target.issueId,
        count: input.count,
        firstEventAt: input.firstEventAt,
        lastEventAt: input.lastEventAt,
        release: input.release,
        serviceName: input.serviceName,
      });
      continue;
    }
    existing.count += input.count;
    if (input.firstEventAt < existing.firstEventAt) existing.firstEventAt = input.firstEventAt;
    if (input.lastEventAt > existing.lastEventAt) existing.lastEventAt = input.lastEventAt;
    existing.release = input.release ?? existing.release;
    existing.serviceName = input.serviceName ?? existing.serviceName;
  }
  return [...byIssue.values()];
}

/**
 * Claims the batch and applies the deltas in one retrying transaction.
 *
 * The `claim` CTE is the idempotency check: `ON CONFLICT DO NOTHING` returns no
 * rows when this batch was already materialized. The transaction explicitly
 * locks every owner hash and target Issue before claiming. A merge that deleted
 * one after hash resolution therefore wins the race and leaves this batch
 * unclaimed for reconciliation instead of losing its delta. The lock query is
 * intentionally separate from the claim aggregate: PostgreSQL rejects row-lock
 * clauses once the planner has to evaluate the target count.
 *
 * Lifecycle transitions ride in the same `CASE` rather than in a separate
 * read-decide-write, which also makes them race-free against a concurrent
 * `PATCH status=resolved`:
 *
 *  - A RESOLVED issue recurring after it was resolved goes back to UNRESOLVED
 *    and records `regressedAt`. The comparison uses `receivedAt` (SERVER receipt
 *    time), never the client-supplied `event_at_ms`: a client with a fast clock
 *    would otherwise reopen a resolved issue, and one with a slow clock would
 *    hide a real regression.
 *  - An IGNORED issue whose snooze has expired wakes up on its next occurrence.
 *    There is deliberately no cron for this: an ignored issue that never recurs
 *    *should* stay ignored.
 */
type AppliedIssue = { issueId: string, isRegression: boolean };

type ClaimAndApplyResult =
  | { status: "applied", outcomes: IssueBatchApplyOutcome[] }
  | { status: "already_applied", ledger: IssueMaterializationLedgerRow }
  | { status: "deferred_locked" };

function buildMaterializationOutcomes(
  resolved: ReadonlyMap<string, { issueId: string, shortId: bigint, isNew: boolean }>,
  applied: readonly AppliedIssue[],
): IssueBatchApplyOutcome[] {
  const regressionByIssueId = new Map(applied.map((row) => [row.issueId, row.isRegression]));
  return [...resolved.entries()].flatMap(([ownerHash, target]) => {
    const isRegression = regressionByIssueId.get(target.issueId);
    if (isRegression === undefined) return [];
    return [{
      issueId: target.issueId,
      shortId: target.shortId,
      ownerHash,
      isNew: target.isNew,
      isRegression,
    }];
  });
}

async function claimAndApply(
  prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
  tenancyId: string,
  batchId: string,
  deltas: readonly IssueDelta[],
  ownerHashes: readonly string[],
  resolved: ReadonlyMap<string, { issueId: string, shortId: bigint, isNew: boolean }>,
  receivedAt: Date,
): Promise<ClaimAndApplyResult> {
  const valueRows = deltas.map((delta) => Prisma.sql`(
    ${delta.issueId}::uuid, ${delta.count}::bigint,
    ${delta.firstEventAt}::timestamptz, ${delta.lastEventAt}::timestamptz,
    ${delta.release}, ${delta.serviceName}
  )`);

  return await retryTransaction(prisma, async (tx) => {
    const existingLedger = await readMaterializationLedger(tx, tenancyId, batchId);
    if (existingLedger !== null) return { status: "already_applied", ledger: existingLedger };

    // Same reclamation as `resolveOrCreateIssues`: a lease that expired between
    // the resolve transaction and this one must not defer the batch forever.
    await reclaimExpiredIssueHashLeases(tx, tenancyId, ownerHashes, new Date());

    const lockedHashes = await tx.$queryRaw<{ hash: string, state: string | null }[]>(Prisma.sql`
      SELECT h."hash", h."state"::text AS "state"
      FROM "IssueHash" AS h
      WHERE h."tenancyId" = ${tenancyId}::uuid
        AND h."hash" = ANY(${[...ownerHashes]}::text[])
      ORDER BY h."hash"
      FOR UPDATE OF h
    `);
    if (lockedHashes.length !== ownerHashes.length || lockedHashes.some((row) => row.state !== null)) {
      return { status: "deferred_locked" };
    }

    const lockedIssues = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH target_ids (issue_id) AS (
        VALUES ${Prisma.join(deltas.map((delta) => Prisma.sql`(${delta.issueId}::uuid)`), ",")}
      )
      SELECT i."id"
      FROM "Issue" AS i
      JOIN target_ids AS d ON d.issue_id = i."id"
      WHERE i."tenancyId" = ${tenancyId}::uuid
      FOR UPDATE OF i
    `);
    if (lockedIssues.length !== deltas.length) return { status: "deferred_locked" };

    const applied = await tx.$queryRaw<AppliedIssue[]>(Prisma.sql`
      WITH deltas (issue_id, cnt, first_event_at, last_event_at, release, service_name) AS (
        VALUES ${Prisma.join(valueRows, ",")}
      ),
      claim AS (
        INSERT INTO "IssueMaterialization" ("tenancyId", "batchId")
        VALUES (${tenancyId}::uuid, ${batchId})
        ON CONFLICT ("tenancyId", "batchId") DO NOTHING
        RETURNING 1
      ),
      applied AS (
        UPDATE "Issue" AS i
        SET "timesSeen"   = i."timesSeen" + d.cnt,
            "lastSeenAt"  = GREATEST(i."lastSeenAt",  d.last_event_at),
            "firstSeenAt" = LEAST(i."firstSeenAt",    d.first_event_at),
            "lastSeenRelease" = COALESCE(d.release, i."lastSeenRelease"),
            "serviceName"     = COALESCE(d.service_name, i."serviceName"),
            "status" = CASE
                WHEN i."status" = 'RESOLVED'
                     AND ${receivedAt}::timestamptz > COALESCE(i."resolvedAt", '-infinity'::timestamptz) THEN 'UNRESOLVED'
                WHEN i."status" = 'IGNORED'
                     AND i."ignoredUntil" IS NOT NULL
                     AND ${receivedAt}::timestamptz > i."ignoredUntil" THEN 'UNRESOLVED'
                ELSE i."status"
              END::"IssueStatus",
            "regressedAt" = CASE
                WHEN i."status" = 'RESOLVED'
                     AND ${receivedAt}::timestamptz > COALESCE(i."resolvedAt", '-infinity'::timestamptz) THEN ${receivedAt}::timestamptz
                ELSE i."regressedAt"
              END,
            "ignoredUntil" = CASE
                WHEN i."status" = 'IGNORED'
                     AND i."ignoredUntil" IS NOT NULL
                     AND ${receivedAt}::timestamptz > i."ignoredUntil" THEN NULL
                ELSE i."ignoredUntil"
              END,
            "updatedAt" = ${receivedAt}::timestamptz
        FROM deltas d
        WHERE i."tenancyId" = ${tenancyId}::uuid
          AND i."id" = d.issue_id
          AND EXISTS (SELECT 1 FROM claim)
        RETURNING i."id" AS "issueId",
          -- NULL = timestamptz is NULL, not false. New issues have no
          -- regressedAt; storing that NULL makes a retry fail the boolean
          -- ledger decoder.
          COALESCE(i."regressedAt" = ${receivedAt}::timestamptz, false) AS "isRegression"
      )
      SELECT * FROM applied
    `);
    if (applied.length === 0) {
      const ledger = await readMaterializationLedger(tx, tenancyId, batchId);
      if (ledger === null) throw new Error("Issue materialization claim disappeared without a ledger row");
      return { status: "already_applied", ledger };
    }

    const outcomes = buildMaterializationOutcomes(resolved, applied);
    await tx.$executeRaw`
      UPDATE "IssueMaterialization"
      SET "outcomes" = ${JSON.stringify(serializeOutcomes(outcomes))}::jsonb
      WHERE "tenancyId" = ${tenancyId}::uuid AND "batchId" = ${batchId}
    `;
    return { status: "applied", outcomes };
  });
}

export async function materializeIssuesFromBatchWithStatus(options: {
  tenancy: Tenancy,
  batchId: string,
  inputs: readonly IssueBatchDelta[],
  receivedAt: Date,
}): Promise<IssueMaterializationResult> {
  const { tenancy, batchId, inputs, receivedAt } = options;
  const emptySideEffects = {
    webhooksDispatchedAt: null,
    alertsDispatchedAt: null,
  };
  if (inputs.length === 0) {
    return { status: "already_applied", outcomes: [], sideEffects: emptySideEffects };
  }

  const prisma = await getPrismaClientForTenancy(tenancy);
  const tenancyId = tenancy.id;
  const existingLedger = await readMaterializationLedger(prisma, tenancyId, batchId);
  if (existingLedger !== null) {
    return {
      status: "already_applied",
      outcomes: existingLedger.outcomes,
      sideEffects: {
        webhooksDispatchedAt: existingLedger.webhooksDispatchedAt,
        alertsDispatchedAt: existingLedger.alertsDispatchedAt,
      },
    };
  }

  const resolved = await resolveOrCreateIssues(prisma, tenancyId, inputs, receivedAt, getBillingTeamId(tenancy.project));
  const deltas = foldDeltasByIssue(inputs, resolved);
  if (deltas.length === 0) {
    // Every hash in this batch was locked by an in-flight merge/unmerge. Leave
    // the batch unclaimed so the QStash delivery and reconciler can retry it.
    return { status: "deferred_locked", outcomes: [], sideEffects: emptySideEffects };
  }

  const ownerHashes = [...new Set(inputs.map((input) => input.ownerHash))];
  const result = await claimAndApply(prisma, tenancyId, batchId, deltas, ownerHashes, resolved, receivedAt);
  if (result.status === "applied") {
    return { status: "applied", outcomes: result.outcomes, sideEffects: emptySideEffects };
  }
  if (result.status === "deferred_locked") {
    return { status: "deferred_locked", outcomes: [], sideEffects: emptySideEffects };
  }
  return {
    status: "already_applied",
    outcomes: result.ledger.outcomes,
    sideEffects: {
      webhooksDispatchedAt: result.ledger.webhooksDispatchedAt,
      alertsDispatchedAt: result.ledger.alertsDispatchedAt,
    },
  };
}

/**
 * Backward-compatible array-shaped API for existing reconciliation callers.
 * New workers should use `materializeIssuesFromBatchWithStatus` so they can
 * distinguish a completed batch from one deferred behind a merge lock.
 */
export async function materializeIssuesFromBatch(options: {
  tenancy: Tenancy,
  batchId: string,
  inputs: readonly IssueBatchDelta[],
  receivedAt: Date,
}): Promise<IssueBatchApplyOutcome[]> {
  const result = await materializeIssuesFromBatchWithStatus(options);
  return result.outcomes;
}

/**
 * Wrapper for the ingest hot path.
 *
 * Materialization must never be able to fail a customer's telemetry request:
 * the occurrences are already durable in ClickHouse and self-describing (they
 * carry `issue_hash`), so the worst case of a failure here is a delayed Issue
 * record, which the reconciler repairs. Reporting through `captureError` rather
 * than rethrowing is deliberate — this runs inside
 * `runAsynchronouslyAndWaitUntil`, where a throw would be logged but would also
 * leave no record of WHICH batch to replay.
 */
export async function materializeIssuesFromBatchSafely(options: {
  tenancy: Tenancy,
  batchId: string,
  inputs: readonly IssueBatchDelta[],
  receivedAt: Date,
}): Promise<void> {
  try {
    const result = await materializeIssuesFromBatchWithStatus(options);
    if (result.status === "deferred_locked") return;
    // Alert email never calls a provider from ingestion. The dispatcher claims
    // a typed delivery row and writes the Workflows event in the same
    // serializable transaction; the built-in workflow owns the existing
    // ServerApp -> EmailOutbox delivery boundary.
    //
    // Alerts run BEFORE webhooks for the same reason as the reconciler's
    // `dispatchMaterializationSideEffects`: webhook emission talks to Svix, and
    // a Svix outage in a shared try path must not prevent the Postgres-only
    // alert rows from being written.
    if (result.sideEffects.alertsDispatchedAt === null) {
      await dispatchIssueAlertsForMaterialization({
        tenancy: options.tenancy,
        outcomes: result.outcomes,
        inputs: options.inputs,
        receivedAt: options.receivedAt,
      });
      await markIssueMaterializationSideEffect({
        tenancy: options.tenancy,
        batchId: options.batchId,
        sideEffect: "alerts",
      });
    }
    if (result.sideEffects.webhooksDispatchedAt === null) {
      await emitIssueWebhooks({
        tenancy: options.tenancy,
        outcomes: result.outcomes,
        now: options.receivedAt,
        batchId: options.batchId,
        force: result.status === "already_applied",
      });
      await markIssueMaterializationSideEffect({
        tenancy: options.tenancy,
        batchId: options.batchId,
        sideEffect: "webhooks",
      });
    }
  } catch (error) {
    captureError("issue-materialization", {
      error,
      batchId: options.batchId,
      tenancyId: options.tenancy.id,
      hashes: options.inputs.map((input) => input.ownerHash),
    });
  }
}
