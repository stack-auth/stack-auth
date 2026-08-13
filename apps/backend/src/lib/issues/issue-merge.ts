import { getSharedClickhouseAdminClient } from "@/lib/clickhouse";
import { getBillingTeamId } from "@/lib/plan-entitlements";
import type { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { Prisma } from "@/generated/prisma/client";
import { TELEMETRY_TTL_DAYS } from "../../../scripts/clickhouse-migrations";

/**
 * Merging and unmerging issues.
 *
 * ── Why this is cheap here, and expensive at Sentry ───────────────────────
 * Sentry denormalizes `group_id` onto every event row, so merging two groups
 * means rewriting history: that is what forces their entire ClickHouse
 * "replacements" subsystem — a second Kafka topic, a `ReplacerWorker`,
 * `INSERT … SELECT … FINAL` rewrites, and Redis consistency flags that reads
 * have to consult.
 *
 * We store the immutable owning `issue_hash` on the occurrence row instead, and
 * reads expand issue → owned hashes. So merge and unmerge are Postgres metadata
 * updates with ZERO ClickHouse writes — and unmerge is *retroactive* (historical
 * occurrences follow their owning hash into the new issue) rather than
 * prospective-only, which is more than Sentry's own v1 manages.
 *
 * The invariant that makes it work: **every occurrence has exactly ONE owning
 * hash** (the scalar `issue_hash` column). `issue_hashes` is an alias array for
 * ingest-time lookup and diagnosis only, and is never used to resolve an
 * occurrence to an issue. If you find yourself writing `hasAny(issue_hashes, …)`
 * anywhere, stop: that is the bug this design was corrected to avoid, because
 * after an unmerge such an occurrence would match BOTH sides of the split.
 *
 * ── Why the lock is three phases and not one transaction ──────────────────
 * The obvious implementation sets `state = LOCKED` and clears it inside one
 * transaction. Under MVCC no other transaction can ever observe that state, so
 * the promised 409 and the promised "defer materialization" behaviour silently
 * do not exist. The lock must therefore be COMMITTED before the work happens:
 *
 *   tx1 (short)  lock the affected IssueHash rows, or 409
 *   (no tx)      compute (for unmerge: read ClickHouse) — never while holding a
 *                Postgres lock, which this repo explicitly warns against
 *   tx2 (short)  repoint, fold counters, clear the lock, write redirects, delete
 *
 * Each "tx" here is a SINGLE statement with CTEs rather than a Prisma
 * transaction: `retryTransaction` is deprecated in this codebase, and a single
 * statement already gets us the atomicity we need (see `issue-store.ts`).
 *
 * `issue-store.ts` skips LOCKED hashes during materialization and leaves the
 * batch unclaimed so the reconciler replays it. That is only safe because the
 * ClickHouse row carries the immutable hash rather than a mutable issue id — the
 * occurrence is delayed, never lost.
 */

/**
 * How long a `LOCKED` hash is respected before another merge may steal it.
 *
 * `lockedAt` is a LEASE, not a flag. Without expiry, a process that dies between
 * tx1 and tx2 wedges those hashes as LOCKED forever, and every future occurrence
 * of that error stops materializing — silently, because ingest treats a locked
 * hash as "retry later". Five minutes is comfortably longer than the middle
 * phase (a single ClickHouse rollup read) and short enough that a human
 * retrying a failed merge does not have to wait on an operator.
 */
export const ISSUE_LOCK_LEASE_MS = 5 * 60 * 1000;

/**
 * How far back the ClickHouse rollup can answer for. Imported rather than
 * restated so that changing the telemetry TTL cannot silently make
 * `countersTruncatedAt` a lie.
 */
export const ISSUE_COUNTER_WINDOW_DAYS = TELEMETRY_TTL_DAYS;

type IssueRow = {
  id: string,
  shortId: bigint,
  firstSeenAt: Date,
  lastSeenAt: Date,
  timesSeen: bigint,
  status: string,
  statusChangedAt: Date | null,
  resolvedAt: Date | null,
  ignoredUntil: Date | null,
  assigneeUserId: string | null,
  assignedTeamId: string | null,
  type: string,
  value: string,
  culprit: string,
  platform: string,
  handled: boolean,
  synthetic: boolean,
  serviceName: string | null,
  deploymentEnvironmentName: string | null,
  firstSeenRelease: string | null,
  lastSeenRelease: string | null,
  hashes: string[],
};

type TenancyPrismaClient = Awaited<ReturnType<typeof getPrismaClientForTenancy>>;

/**
 * Issues plus the hashes they own, in one round trip.
 *
 * The hashes are not decoration: they are the unit the lock is taken on, and the
 * unmerge subset check is defined against them. Reading them separately would
 * open a window in which the two disagree.
 */
async function readIssuesWithHashes(
  prisma: TenancyPrismaClient,
  tenancyId: string,
  issueIds: readonly string[],
): Promise<IssueRow[]> {
  if (issueIds.length === 0) return [];
  return await prisma.$queryRaw<IssueRow[]>`
    SELECT
      i."id", i."shortId", i."firstSeenAt", i."lastSeenAt", i."timesSeen",
      i."status"::text AS "status", i."statusChangedAt", i."resolvedAt", i."ignoredUntil",
      i."assigneeUserId", i."assignedTeamId", i."type", i."value", i."culprit", i."platform",
      i."handled", i."synthetic",
      i."serviceName", i."deploymentEnvironmentName",
      i."firstSeenRelease", i."lastSeenRelease",
      COALESCE(
        array_agg(h."hash" ORDER BY h."hash") FILTER (WHERE h."hash" IS NOT NULL),
        ARRAY[]::text[]
      ) AS "hashes"
    FROM "Issue" i
    LEFT JOIN "IssueHash" h ON h."tenancyId" = i."tenancyId" AND h."issueId" = i."id"
    WHERE i."tenancyId" = ${tenancyId}::uuid AND i."id" = ANY(${[...issueIds]}::uuid[])
    GROUP BY i."id", i."tenancyId"
  `;
}

/**
 * Sentry's rule, straight from `issues/merge.py`: `(firstSeenAt ASC, timesSeen
 * DESC, id ASC)`.
 *
 * The caller deliberately does NOT get to pick the primary. Two people merging
 * the same set in different orders must land on the same survivor, and the
 * oldest issue is the one that carries the most history and the most inbound
 * links (bookmarks, webhook payloads, chat messages), so it is the one worth
 * keeping resolvable at its original id.
 *
 * Exported because the ordering is the whole contract and is unit-tested
 * directly.
 */
export function orderIssuesForMerge<T extends { firstSeenAt: Date, timesSeen: bigint, id: string }>(issues: readonly T[]): T[] {
  return [...issues].sort((a, b) => {
    const byFirstSeen = a.firstSeenAt.getTime() - b.firstSeenAt.getTime();
    if (byFirstSeen !== 0) return byFirstSeen;
    // Descending, and compared as BigInt because `timesSeen` on a firehose
    // project can exceed Number.MAX_SAFE_INTEGER — subtracting Numbers here
    // would make the ordering non-deterministic exactly for the busiest issues.
    if (a.timesSeen !== b.timesSeen) return a.timesSeen > b.timesSeen ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Status / assignee / release precedence, stated explicitly.
 *
 * The tempting rule — "move the loser's value over if the primary has none" —
 * is unimplementable for `status`, which is non-null: every issue always has
 * one, so "the primary has none" never happens and the rule silently degenerates
 * into "the primary always wins" for status while meaning something else for
 * every other field. So each field gets its own stated rule instead:
 *
 *  - `status` (and the timestamps that qualify it): the PRIMARY's wins, always.
 *    A merge is not a lifecycle event; if you merge a resolved issue into an
 *    unresolved one you are saying "these are the same bug", not "reopen it".
 *  - `firstSeenAt` / `lastSeenAt`: earliest and latest across the set. Folded in
 *    SQL rather than here, so an in-flight delta cannot be lost.
 *  - `assigneeUserId`: the primary's, else the first non-null in merge order.
 *  - `firstSeenRelease` / `lastSeenRelease`: same rule. These are cosmetic
 *    labels attached to the counters, not counters themselves.
 */
export function resolveMergedMetadata(ordered: readonly {
  assigneeUserId: string | null,
  firstSeenRelease: string | null,
  lastSeenRelease: string | null,
}[]): { assigneeUserId: string | null, firstSeenRelease: string | null, lastSeenRelease: string | null } {
  const firstNonNull = <T>(pick: (issue: (typeof ordered)[number]) => T | null): T | null => {
    for (const issue of ordered) {
      const value = pick(issue);
      if (value !== null) return value;
    }
    return null;
  };
  return {
    assigneeUserId: firstNonNull((issue) => issue.assigneeUserId),
    firstSeenRelease: firstNonNull((issue) => issue.firstSeenRelease),
    lastSeenRelease: firstNonNull((issue) => issue.lastSeenRelease),
  };
}

/**
 * Acquires the lease on a set of hashes, all or nothing.
 *
 * Two things make this correct in a single statement:
 *
 *  1. The `ordered` CTE takes its row locks in `hash` order. A CTE containing
 *     `FOR UPDATE` is always materialized (never inlined), so it runs to
 *     completion first — which is what gives two concurrent merges over
 *     overlapping hash sets a deterministic lock order instead of a deadlock.
 *  2. The "is it free?" predicate sits on the TARGET row of the UPDATE, not in a
 *     subquery. That matters under READ COMMITTED: when a concurrent merge
 *     commits first, Postgres re-evaluates the UPDATE's quals against the new
 *     row version (EvalPlanQual), sees `state = 'LOCKED'` with a fresh lease,
 *     and skips the row. A count taken in a separate CTE would still be reading
 *     the pre-conflict snapshot and would wave the second merge through.
 *
 * A stale lease (older than {@link ISSUE_LOCK_LEASE_MS}) is treated as free, so
 * a crashed merge recovers on its own.
 */
async function acquireHashLocks(
  prisma: TenancyPrismaClient,
  tenancyId: string,
  hashes: readonly string[],
  now: Date,
): Promise<string[]> {
  const leaseCutoff = new Date(now.getTime() - ISSUE_LOCK_LEASE_MS);
  const rows = await prisma.$queryRaw<{ hash: string }[]>`
    WITH ordered AS (
      SELECT "hash"
      FROM "IssueHash"
      WHERE "tenancyId" = ${tenancyId}::uuid AND "hash" = ANY(${[...hashes]}::text[])
      ORDER BY "hash"
      FOR UPDATE
    )
    UPDATE "IssueHash" h
    SET "state" = 'LOCKED'::"IssueHashState", "lockedAt" = ${now}::timestamptz
    WHERE h."tenancyId" = ${tenancyId}::uuid
      AND h."hash" IN (SELECT "hash" FROM ordered)
      AND (h."state" IS NULL OR h."lockedAt" IS NULL OR h."lockedAt" < ${leaseCutoff}::timestamptz)
    RETURNING h."hash"
  `;
  return rows.map((row) => row.hash);
}

/** Undoes a partial or abandoned acquisition. Never touches hashes we did not lock. */
async function releaseHashLocks(
  prisma: TenancyPrismaClient,
  tenancyId: string,
  hashes: readonly string[],
  lockedAt: Date,
): Promise<void> {
  if (hashes.length === 0) return;
  await prisma.$executeRaw`
    UPDATE "IssueHash"
    SET "state" = NULL, "lockedAt" = NULL
    WHERE "tenancyId" = ${tenancyId}::uuid
      AND "hash" = ANY(${[...hashes]}::text[])
      AND "lockedAt" = ${lockedAt}::timestamptz
  `;
}

/**
 * Locks every hash or throws 409.
 *
 * All-or-nothing rather than best-effort: a merge that repointed half a set
 * would leave the two issues interleaved, which is not a state any later
 * operation knows how to undo. On partial acquisition we hand back what we took
 * so the winning merge is not blocked by our leftovers.
 */
async function lockHashesOrThrow(
  prisma: TenancyPrismaClient,
  tenancyId: string,
  hashes: readonly string[],
  now: Date,
): Promise<void> {
  const acquired = await acquireHashLocks(prisma, tenancyId, hashes, now);
  if (acquired.length === hashes.length) return;
  await releaseHashLocks(prisma, tenancyId, acquired, now);
  throw new StatusError(
    StatusError.Conflict,
    "Another merge or unmerge is currently in flight for one of these issues. Try again in a moment.",
  );
}

/**
 * Runs the middle + final phase under the lease, releasing it if either throws.
 *
 * The happy path clears the lease as part of the final statement (one fewer
 * round trip, and no window in which the work is done but the hashes still look
 * locked). This only has to clean up after failure.
 */
async function withHashLocks<T>(
  prisma: TenancyPrismaClient,
  tenancyId: string,
  hashes: readonly string[],
  now: Date,
  body: () => Promise<T>,
): Promise<T> {
  await lockHashesOrThrow(prisma, tenancyId, hashes, now);
  try {
    return await body();
  } catch (error) {
    // Not a catch-all: we release and RETHROW. Without this the lease would
    // still expire on its own, but every occurrence of these errors would stop
    // materializing for the next five minutes for no reason.
    await releaseHashLocks(prisma, tenancyId, hashes, now);
    throw error;
  }
}

/**
 * Follows `IssueRedirect` so a caller holding a stale id (a bookmark, a dashboard
 * row rendered before someone else merged) still means the right issue.
 *
 * Exactly one hop is enough — and is all that is ever needed — because merge
 * REWRITES inbound redirects instead of chaining them. See the `rewritten` CTE
 * in `mergeIssues`.
 */
async function resolveIssueIds(
  prisma: TenancyPrismaClient,
  tenancyId: string,
  issueIds: readonly string[],
): Promise<Map<string, string>> {
  const redirects = await prisma.$queryRaw<{ fromIssueId: string, toIssueId: string }[]>`
    SELECT "fromIssueId", "toIssueId"
    FROM "IssueRedirect"
    WHERE "tenancyId" = ${tenancyId}::uuid AND "fromIssueId" = ANY(${[...issueIds]}::uuid[])
  `;
  const byFrom = new Map(redirects.map((row) => [row.fromIssueId, row.toIssueId]));
  return new Map(issueIds.map((id) => [id, byFrom.get(id) ?? id]));
}

export type MergeIssuesResult = {
  primaryIssueId: string,
  mergedIssueIds: string[],
};

class RetryMerge extends Error {
  constructor() {
    super("The issue set changed while the merge was running.");
  }
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((value) => bSet.has(value));
}

export async function mergeIssues(options: {
  tenancy: Tenancy,
  issueIds: string[],
}): Promise<MergeIssuesResult> {
  const { tenancy, issueIds } = options;
  const prisma = await getPrismaClientForTenancy(tenancy);
  const tenancyId = tenancy.id;

  const requested = [...new Set(issueIds)];
  if (requested.length < 2) {
    throw new StatusError(StatusError.BadRequest, "Merging requires at least two distinct issues.");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date();
    const resolvedById = await resolveIssueIds(prisma, tenancyId, requested);
    const targetIds = [...new Set(resolvedById.values())];
    if (targetIds.length < 2) {
      // Repeating a successful merge is a no-op with the same survivor, rather
      // than an error. This is important for retried dashboard requests and for
      // a concurrent merge that completed while this request was waiting.
      const primaryIssueId = targetIds[0] ?? throwNoPrimary(requested);
      return { primaryIssueId, mergedIssueIds: [] };
    }

    const preLock = await readIssuesWithHashes(prisma, tenancyId, targetIds);
    if (preLock.length !== targetIds.length) {
      const found = new Set(preLock.map((issue) => issue.id));
      const missing = targetIds.find((id) => !found.has(id));
      // Cross-tenancy isolation falls out of this: the read is tenancy-scoped,
      // so another project's issue is indistinguishable from nonexistent one.
      throw new StatusError(StatusError.NotFound, `Issue ${missing} was not found in this project.`);
    }

    const lockedHashes = preLock.flatMap((issue) => issue.hashes);

    try {
      return await withHashLocks(prisma, tenancyId, lockedHashes, now, async () => {
        // Re-resolve ids and hashes under the committed lease. A merge or
        // unmerge may have won the race after the pre-lock read; retrying from
        // the top prevents repointing a hash that no longer belongs to this set.
        const currentResolvedById = await resolveIssueIds(prisma, tenancyId, requested);
        const currentTargetIds = [...new Set(currentResolvedById.values())];
        if (!sameStringSet(currentTargetIds, targetIds)) throw new RetryMerge();

        const issues = await readIssuesWithHashes(prisma, tenancyId, targetIds);
        if (issues.length !== targetIds.length) throw new RetryMerge();
        const currentHashes = issues.flatMap((issue) => issue.hashes);
        if (!sameStringSet(currentHashes, lockedHashes)) throw new RetryMerge();

        const ordered = orderIssuesForMerge(issues);
        const primary = ordered[0] ?? throwNoPrimary(targetIds);
        const losers = ordered.slice(1);
        const metadata = resolveMergedMetadata(ordered);

        const applied = await applyMerge(prisma, {
          tenancyId,
          primaryId: primary.id,
          loserIds: losers.map((issue) => issue.id),
          lockedHashes,
          metadata,
          now,
        });
        if (applied.primaryUpdated !== 1) throw new RetryMerge();

        return { primaryIssueId: primary.id, mergedIssueIds: losers.map((issue) => issue.id) };
      });
    } catch (error) {
      if (error instanceof StatusError && error.statusCode === StatusError.Conflict.statusCode) {
        if (attempt === 2) throw error;
        // A concurrent retry of the same merge should observe the redirect
        // written by the winner and become a no-op. Give the short lease holder
        // one scheduling window to finish before re-reading the issue set;
        // explicit fresh leases still return 409 after the bounded retries.
        await new Promise<void>((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        continue;
      }
      if (!(error instanceof RetryMerge)) throw error;
      if (attempt === 2) {
        throw new StatusError(StatusError.Conflict, "The issue set kept changing while the merge was running. Try again.");
      }
    }
  }

  throw new StatusError(StatusError.Conflict, "The merge did not complete.");
}

function throwNoPrimary(targetIds: readonly string[]): never {
  // Unreachable: `preLock.length === targetIds.length` was checked above and
  // `targetIds.length >= 2`. Stated as a throw rather than a `!` so a future
  // refactor that breaks the invariant fails loudly instead of at `undefined.id`.
  throw new StatusError(StatusError.NotFound, `No issues left to merge among ${targetIds.join(", ")}.`);
}

/** Row counts from the merge statement. Only `primaryUpdated` gates anything; the rest are for logging and tests. */
type MergeCounts = {
  primaryUpdated: number,
  repointedHashes: number,
  rewrittenRedirects: number,
  insertedRedirects: number,
  deletedIssues: number,
};

/**
 * The whole merge, in one statement.
 *
 * Counters are folded RELATIVELY (`i."timesSeen" + SUM(losers)`, `LEAST`,
 * `GREATEST`) rather than written as absolute values computed in Node. The lease
 * already keeps new deltas away, but a batch that resolved its hashes just
 * *before* we locked can still be in flight, and a relative fold absorbs it
 * where an absolute write would erase it.
 *
 * We deliberately never snapshot ClickHouse for these numbers. `timesSeen` and
 * `firstSeenAt` are ALL-TIME while the rollup retains
 * {@link ISSUE_COUNTER_WINDOW_DAYS} days, so a snapshot is not merely racy, it is
 * arithmetically incapable of producing the right answer.
 *
 * Redirects are REWRITTEN, not chained: any existing redirect pointing at a
 * loser is repointed at the new primary in the same statement, so resolving an
 * id is always exactly one hop no matter how many times an issue has been merged.
 *
 * Deleting the losers relies on `IssueHash`'s `ON DELETE CASCADE`, which is safe
 * only because `repointed` has already moved every hash off them: the cascade
 * runs as an AFTER trigger, i.e. after this statement's effects are visible, so
 * it finds nothing left to delete.
 */
async function applyMerge(
  prisma: TenancyPrismaClient,
  options: {
    tenancyId: string,
    primaryId: string,
    loserIds: readonly string[],
    lockedHashes: readonly string[],
    metadata: { assigneeUserId: string | null, firstSeenRelease: string | null, lastSeenRelease: string | null },
    now: Date,
  },
): Promise<MergeCounts> {
  const { tenancyId, primaryId, loserIds, lockedHashes, metadata, now } = options;
  const rows = await prisma.$queryRaw<MergeCounts[]>(Prisma.sql`
    WITH lease AS (
      SELECT COUNT(*) = ${lockedHashes.length} AS "held"
      FROM "IssueHash"
      WHERE "tenancyId" = ${tenancyId}::uuid
        AND "hash" = ANY(${[...lockedHashes]}::text[])
        AND "state" = 'LOCKED'::"IssueHashState"
        AND "lockedAt" = ${now}::timestamptz
    ),
    losers AS (
      SELECT "id", "shortId", "timesSeen", "firstSeenAt", "lastSeenAt"
      FROM "Issue"
      WHERE "tenancyId" = ${tenancyId}::uuid AND "id" = ANY(${[...loserIds]}::uuid[])
    ),
    folded AS (
      SELECT
        COALESCE(SUM("timesSeen"), 0)::bigint AS "timesSeen",
        MIN("firstSeenAt") AS "firstSeenAt",
        MAX("lastSeenAt") AS "lastSeenAt"
      FROM losers
    ),
    primary_updated AS (
      UPDATE "Issue" i
      SET "timesSeen"        = i."timesSeen" + f."timesSeen",
          "firstSeenAt"      = LEAST(i."firstSeenAt", COALESCE(f."firstSeenAt", i."firstSeenAt")),
          "lastSeenAt"       = GREATEST(i."lastSeenAt", COALESCE(f."lastSeenAt", i."lastSeenAt")),
          "assigneeUserId"   = ${metadata.assigneeUserId}::uuid,
          "firstSeenRelease" = ${metadata.firstSeenRelease},
          "lastSeenRelease"  = ${metadata.lastSeenRelease},
          "updatedAt"        = ${now}::timestamptz
      FROM folded f, lease l
      WHERE i."tenancyId" = ${tenancyId}::uuid
        AND i."id" = ${primaryId}::uuid
        AND l."held"
      RETURNING i."id"
    ),
    -- Everything below is gated on primary_updated having produced a row -- the
    -- same trick issue-store.ts uses for its ledger claim. Reading a
    -- data-modifying CTE's RETURNING output both forces it to run first and makes
    -- the rest conditional on it. Without the gate, a primary that somehow
    -- vanished would leave us deleting the losers with nothing to merge them
    -- into, i.e. losing issues outright.
    repointed AS (
      UPDATE "IssueHash" h
      SET "issueId" = ${primaryId}::uuid, "state" = NULL, "lockedAt" = NULL
      WHERE h."tenancyId" = ${tenancyId}::uuid
        AND h."hash" = ANY(${[...lockedHashes]}::text[])
        AND h."state" = 'LOCKED'::"IssueHashState"
        AND h."lockedAt" = ${now}::timestamptz
        AND EXISTS (SELECT 1 FROM primary_updated)
      RETURNING h."hash"
    ),
    rewritten AS (
      UPDATE "IssueRedirect" r
      SET "toIssueId" = ${primaryId}::uuid
      WHERE r."tenancyId" = ${tenancyId}::uuid
        AND r."toIssueId" = ANY(${[...loserIds]}::uuid[])
        AND EXISTS (SELECT 1 FROM primary_updated)
      RETURNING r."fromIssueId"
    ),
    inserted AS (
      INSERT INTO "IssueRedirect" ("tenancyId", "fromIssueId", "toIssueId", "fromShortId")
      SELECT ${tenancyId}::uuid, l."id", ${primaryId}::uuid, l."shortId"
      FROM losers l
      WHERE EXISTS (SELECT 1 FROM primary_updated)
      ON CONFLICT ("tenancyId", "fromIssueId") DO UPDATE SET "toIssueId" = EXCLUDED."toIssueId"
      RETURNING "fromIssueId"
    ),
    deleted AS (
      DELETE FROM "Issue" i
      WHERE i."tenancyId" = ${tenancyId}::uuid
        AND i."id" = ANY(${[...loserIds]}::uuid[])
        AND EXISTS (SELECT 1 FROM primary_updated)
      RETURNING i."id"
    )
    SELECT
      (SELECT COUNT(*)::int FROM primary_updated) AS "primaryUpdated",
      (SELECT COUNT(*)::int FROM repointed)       AS "repointedHashes",
      (SELECT COUNT(*)::int FROM rewritten)       AS "rewrittenRedirects",
      (SELECT COUNT(*)::int FROM inserted)        AS "insertedRedirects",
      (SELECT COUNT(*)::int FROM deleted)         AS "deletedIssues"
  `);
  return rows[0] ?? { primaryUpdated: 0, repointedHashes: 0, rewrittenRedirects: 0, insertedRedirects: 0, deletedIssues: 0 };
}

export type UnmergeIssueResult = {
  sourceIssueId: string,
  newIssueId: string,
  newIssueShortId: bigint,
  countersTruncatedAt: Date,
};

/**
 * Windowed counters for the hashes being split out.
 *
 * This is the ONE place in the whole issues subsystem where reading ClickHouse
 * to seed a Postgres counter is correct, and it happens in the middle phase —
 * outside both statements — so no Postgres lock is ever held across ClickHouse
 * I/O.
 */
async function readWindowedCountersForHashes(options: {
  projectId: string,
  branchId: string,
  hashes: readonly string[],
  windowStart: Date,
}): Promise<{ occurrences: bigint, firstSeenAt: Date, lastSeenAt: Date } | null> {
  const client = getSharedClickhouseAdminClient();
  const result = await client.query({
    query: `
      SELECT
        sum(occurrences) AS occurrences,
        toUnixTimestamp64Milli(min(first_seen)) AS first_seen_millis,
        toUnixTimestamp64Milli(max(last_seen)) AS last_seen_millis
      FROM analytics_internal.issue_occurrence_rollup
      WHERE project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND issue_hash IN {hashes:Array(String)}
        AND bucket_start >= {windowStart:DateTime}
    `,
    query_params: {
      projectId: options.projectId,
      branchId: options.branchId,
      hashes: [...options.hashes],
      windowStart: Math.floor(options.windowStart.getTime() / 1000),
    },
    format: "JSONEachRow",
  });
  // 64-bit integers come back as either a decimal string or a number depending on
  // the server's `output_format_json_quote_64bit_integers`, so both are accepted.
  // `occurrences` is then widened to BigInt rather than Number, because it seeds a
  // counter that on a firehose project can exceed Number.MAX_SAFE_INTEGER.
  const rows = await result.json() as {
    occurrences: string | number,
    first_seen_millis: string | number,
    last_seen_millis: string | number,
  }[];
  // `.length` rather than `rows[0] === undefined`: this tsconfig has
  // `noUncheckedIndexedAccess` off, so indexing types as non-optional and the
  // undefined comparison reads as dead code to the linter.
  if (rows.length === 0) return null;
  const row = rows[0];
  const occurrences = BigInt(row.occurrences);
  if (occurrences === 0n) return null;
  return {
    occurrences,
    firstSeenAt: new Date(Number(row.first_seen_millis)),
    lastSeenAt: new Date(Number(row.last_seen_millis)),
  };
}

/**
 * Validates that `requested` is a strict, non-empty subset of `owned`.
 *
 * Splitting *none* of them is nothing; splitting *all* of them would leave an
 * empty source issue, which is not a split at all — it is a rename with extra
 * steps, and it would break the invariant that every issue owns at least one
 * hash (which is in turn what makes the merge lock able to detect contention).
 *
 * Exported for direct unit testing.
 */
export function validateUnmergeSubset(owned: readonly string[], requested: readonly string[]): string[] {
  const ownedSet = new Set(owned);
  const unique = [...new Set(requested)];
  if (unique.length === 0) {
    throw new StatusError(StatusError.BadRequest, "Specify at least one hash to split out.");
  }
  const foreign = unique.find((hash) => !ownedSet.has(hash));
  if (foreign !== undefined) {
    throw new StatusError(StatusError.BadRequest, `Hash ${foreign} is not owned by this issue.`);
  }
  if (unique.length >= ownedSet.size) {
    throw new StatusError(StatusError.BadRequest, "Splitting out every hash would leave the issue empty; there is nothing to unmerge.");
  }
  return unique;
}

export async function unmergeIssue(options: {
  tenancy: Tenancy,
  issueId: string,
  hashes: string[],
}): Promise<UnmergeIssueResult> {
  const { tenancy, issueId, hashes } = options;
  const prisma = await getPrismaClientForTenancy(tenancy);
  const tenancyId = tenancy.id;
  const now = new Date();

  const resolvedIds = [...(await resolveIssueIds(prisma, tenancyId, [issueId])).values()];
  const sourceId = resolvedIds.length === 0 ? issueId : resolvedIds[0];

  const preLockRows = await readIssuesWithHashes(prisma, tenancyId, [sourceId]);
  if (preLockRows.length === 0) {
    throw new StatusError(StatusError.NotFound, `Issue ${issueId} was not found in this project.`);
  }
  const preLock = preLockRows[0];
  validateUnmergeSubset(preLock.hashes, hashes);

  // Lock ALL of the source's hashes, not just the ones moving. The subset check
  // is defined against the full owned set, so a concurrent merge repointing
  // another hash onto this issue would invalidate it mid-flight; and the source
  // issue's own counters must not move while we decide what the split-out issue
  // inherits.
  const lockedHashes = preLock.hashes;

  return await withHashLocks(prisma, tenancyId, lockedHashes, now, async () => {
    const sourceRows = await readIssuesWithHashes(prisma, tenancyId, [sourceId]);
    if (sourceRows.length === 0) {
      throw new StatusError(StatusError.NotFound, `Issue ${issueId} was not found in this project.`);
    }
    const source = sourceRows[0];
    const movedHashes = validateUnmergeSubset(source.hashes, hashes);

    // ── The one honest limitation ────────────────────────────────────────
    // Lifetime counters cannot be split. `timesSeen`/`firstSeenAt` are all-time,
    // and the only per-hash record of how they got that way is the occurrence
    // stream, which only goes back ISSUE_COUNTER_WINDOW_DAYS. So the new issue's
    // counters are seeded from the retained window and `countersTruncatedAt`
    // records where that window starts, so the UI can render "N events since
    // <date>" instead of an all-time number it cannot back up.
    //
    // The SOURCE issue's counters are deliberately left alone. Subtracting a
    // windowed number from a lifetime one produces a value that is neither —
    // and can even go negative for a hash whose traffic predates the window.
    // Leaving the source slightly high is the lesser and far more explicable
    // error.
    const countersTruncatedAt = new Date(now.getTime() - ISSUE_COUNTER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const windowed = await readWindowedCountersForHashes({
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      hashes: movedHashes,
      windowStart: countersTruncatedAt,
    });

    const created = await applyUnmerge(prisma, {
      tenancyId,
      source,
      movedHashes,
      lockedHashes,
      assignedTeamId: source.assignedTeamId ?? getBillingTeamId(tenancy.project),
      // No retained occurrences means the moved hashes have been quiet for the
      // whole window. Zero, seen "now", is the only claim we can actually
      // support; inheriting the source's timestamps would attribute history to
      // this issue that we have no evidence belongs to it.
      timesSeen: windowed?.occurrences ?? 0n,
      firstSeenAt: windowed?.firstSeenAt ?? now,
      lastSeenAt: windowed?.lastSeenAt ?? now,
      countersTruncatedAt,
      now,
    });

    return {
      sourceIssueId: source.id,
      newIssueId: created.id,
      newIssueShortId: created.shortId,
      countersTruncatedAt,
    };
  });
}

/**
 * Allocates the short id, creates the new issue, and moves the hashes — one
 * statement.
 *
 * Repointing `IssueHash` is the entire split. Nothing in ClickHouse moves,
 * because occurrences store their owning hash rather than an issue id, so every
 * historical occurrence of a moved hash resolves to the new issue the instant
 * this commits. That retroactivity is the payoff of the single-owner invariant.
 *
 * The short id uses the same single-statement `INSERT … ON CONFLICT … RETURNING
 * "nextShortId" - n` allocator as `issue-store.ts`, so unmerge takes exactly one
 * id out of the same sequence ingest uses and cannot interleave with it.
 *
 * The new issue inherits the source's display identity and lifecycle state. It
 * does NOT re-derive `type`/`value`/`culprit` from an occurrence: those fields
 * are contractually "from the occurrence that CREATED the issue", we have no
 * such occurrence here, and reconstructing a `platform` would mean duplicating
 * the runtime→platform mapping that lives in the ingest row builder.
 */
async function applyUnmerge(
  prisma: TenancyPrismaClient,
  options: {
    tenancyId: string,
    source: IssueRow,
    movedHashes: readonly string[],
    lockedHashes: readonly string[],
    assignedTeamId: string | null,
    timesSeen: bigint,
    firstSeenAt: Date,
    lastSeenAt: Date,
    countersTruncatedAt: Date,
    now: Date,
  },
): Promise<{ id: string, shortId: bigint }> {
  const { tenancyId, source, movedHashes, lockedHashes, assignedTeamId, timesSeen, firstSeenAt, lastSeenAt, countersTruncatedAt, now } = options;
  const rows = await prisma.$queryRaw<{ id: string, shortId: bigint, reboundHashes: number }[]>(Prisma.sql`
    WITH lease AS (
      SELECT COUNT(*) = ${lockedHashes.length} AS "held"
      FROM "IssueHash"
      WHERE "tenancyId" = ${tenancyId}::uuid
        AND "hash" = ANY(${[...lockedHashes]}::text[])
        AND "state" = 'LOCKED'::"IssueHashState"
        AND "lockedAt" = ${now}::timestamptz
    ),
    counter AS (
      INSERT INTO "IssueCounter" ("tenancyId", "nextShortId")
      VALUES (${tenancyId}::uuid, 2::bigint)
      ON CONFLICT ("tenancyId") DO UPDATE
        SET "nextShortId" = "IssueCounter"."nextShortId" + 1
      RETURNING "nextShortId" - 1 AS "shortId"
    ),
    created AS (
      INSERT INTO "Issue" (
        "id", "tenancyId", "shortId", "type", "value", "culprit", "platform",
        "handled", "synthetic",
        "status", "statusChangedAt", "resolvedAt", "ignoredUntil", "assigneeUserId", "assignedTeamId",
        "firstSeenAt", "lastSeenAt", "timesSeen", "countersTruncatedAt",
        "serviceName", "deploymentEnvironmentName", "firstSeenRelease", "lastSeenRelease",
        "updatedAt"
      )
      -- id is generated in SQL for the same reason issue-store.ts does it:
      -- Issue.id is @default(uuid()) at the PRISMA level only, so the column has
      -- no database default and a raw INSERT that omits it fails with 23502.
      SELECT
        gen_random_uuid(), ${tenancyId}::uuid, c."shortId",
        ${source.type}, ${source.value}, ${source.culprit}, ${source.platform},
        ${source.handled}::boolean, ${source.synthetic}::boolean,
        ${source.status}::"IssueStatus", ${source.statusChangedAt}::timestamptz,
        ${source.resolvedAt}::timestamptz, ${source.ignoredUntil}::timestamptz,
        ${source.assigneeUserId}::uuid, ${assignedTeamId}::uuid,
        ${firstSeenAt}::timestamptz, ${lastSeenAt}::timestamptz,
        ${timesSeen.toString()}::bigint, ${countersTruncatedAt}::timestamptz,
        ${source.serviceName}, ${source.deploymentEnvironmentName},
        ${source.firstSeenRelease}, ${source.lastSeenRelease},
        ${now}::timestamptz
      FROM counter c, lease l
      WHERE l."held"
      RETURNING "id", "shortId"
    ),
    rebound AS (
      UPDATE "IssueHash" h
      SET "issueId" = CASE
            WHEN h."hash" = ANY(${[...movedHashes]}::text[]) THEN (SELECT "id" FROM created)
            ELSE h."issueId"
          END,
          "state" = NULL,
          "lockedAt" = NULL
      WHERE h."tenancyId" = ${tenancyId}::uuid
        AND h."hash" = ANY(${[...lockedHashes]}::text[])
        AND h."state" = 'LOCKED'::"IssueHashState"
        AND h."lockedAt" = ${now}::timestamptz
      RETURNING h."hash"
    )
    SELECT c."id", c."shortId", (SELECT COUNT(*)::int FROM rebound) AS "reboundHashes"
    FROM created c
  `);
  if (rows.length === 0) {
    throw new StatusError(StatusError.Conflict, "The issue changed while the unmerge was running. Try again.");
  }
  const row = rows[0];
  return { id: row.id, shortId: row.shortId };
}
