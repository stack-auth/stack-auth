import type { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { Prisma } from "@/generated/prisma/client";
import type { IssueMaterializationInput } from "../analytics-telemetry-writers";
import { emitIssueWebhooks } from "./issue-webhooks";

/**
 * Turns a batch's grouped `$error` occurrences into persistent Issue records.
 *
 * ── Why this is not a Prisma transaction ──────────────────────────────────
 * `retryTransaction` is deprecated in this codebase ("Prisma transactions are
 * slow and lock the database. Use rawQuery with CTEs instead"). Everything
 * below is raw SQL, and the one place that genuinely needs atomicity gets it
 * from a single statement with a CTE rather than from a transaction.
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
 *           Crashing here leaves an Issue with zero counters, which the next
 *           occurrence or the reconciler corrects — it never double-counts.
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
 * fully-applied one.
 */

export type IssueMaterializationOutcome = {
  issueId: string,
  shortId: bigint,
  ownerHash: string,
  /** First time this issue has ever been seen. Drives `issue.created`. */
  isNew: boolean,
  /** A resolved issue recurred. Drives `issue.regressed`. */
  isRegression: boolean,
};

/** Per-issue deltas, after folding every hash that maps to the same issue. */
type IssueDelta = {
  issueId: string,
  count: number,
  firstEventAt: Date,
  lastEventAt: Date,
  release: string | null,
  serviceName: string | null,
};

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
  inputs: readonly IssueMaterializationInput[],
  receivedAt: Date,
): Promise<Map<string, { issueId: string, shortId: bigint, isNew: boolean }>> {
  const resolved = new Map<string, { issueId: string, shortId: bigint, isNew: boolean }>();
  const ownerHashes = inputs.map((input) => input.ownerHash);

  const existing = await prisma.$queryRaw<{ hash: string, issueId: string, shortId: bigint, state: string | null }[]>`
    SELECT h."hash", h."issueId", i."shortId", h."state"::text AS "state"
    FROM "IssueHash" h
    JOIN "Issue" i ON i."tenancyId" = h."tenancyId" AND i."id" = h."issueId"
    WHERE h."tenancyId" = ${tenancyId}::uuid AND h."hash" = ANY(${ownerHashes}::text[])
  `;
  for (const row of existing) {
    if (row.state !== null) continue; // LOCKED — see the doc comment above.
    resolved.set(row.hash, { issueId: row.issueId, shortId: row.shortId, isNew: false });
  }

  const missing = inputs.filter((input) => !resolved.has(input.ownerHash));
  if (missing.length === 0) return resolved;

  // Reserve a contiguous block of short ids in ONE statement, so the counter
  // row is locked once per batch rather than once per issue. A batch that then
  // fails burns its range; gaps are accepted and documented, because the
  // alternative (allocating lazily per insert) reintroduces per-issue
  // contention on a single hot row.
  const [{ firstShortId }] = await prisma.$queryRaw<{ firstShortId: bigint }[]>`
    INSERT INTO "IssueCounter" ("tenancyId", "nextShortId")
    VALUES (${tenancyId}::uuid, ${missing.length + 1}::bigint)
    ON CONFLICT ("tenancyId") DO UPDATE
      SET "nextShortId" = "IssueCounter"."nextShortId" + ${missing.length}::bigint
    RETURNING "nextShortId" - ${missing.length}::bigint AS "firstShortId"
  `;

  const created = await prisma.$queryRaw<{ id: string, shortId: bigint }[]>(buildIssueInsertSql(
    tenancyId,
    missing,
    firstShortId,
    receivedAt,
  ));

  // Bind each owning hash to its issue. `ON CONFLICT DO NOTHING` on the hash
  // primary key is the concurrency control: if a concurrent batch created the
  // same issue first, its row wins and ours is discarded.
  const hashValues = missing.flatMap((input, index) => {
    const issue = created[index] as { id: string } | undefined;
    if (issue === undefined) return [];
    return [input.ownerHash, ...input.aliasHashes].map((hash) => ({
      hash,
      issueId: issue.id,
      groupingConfigId: input.groupingConfigId,
    }));
  });
  if (hashValues.length > 0) {
    await prisma.$executeRaw`
      INSERT INTO "IssueHash" ("tenancyId", "hash", "issueId", "groupingConfigId")
      SELECT ${tenancyId}::uuid, v."hash", v."issueId"::uuid, v."groupingConfigId"
      FROM jsonb_to_recordset(${JSON.stringify(hashValues)}::jsonb)
        AS v("hash" text, "issueId" text, "groupingConfigId" text)
      ON CONFLICT ("tenancyId", "hash") DO NOTHING
    `;
  }

  // Re-read so a hash the race lost binds to the WINNER's issue, not to the
  // orphan we just inserted. Without this, two concurrent first-sightings would
  // each count into a different issue and the user would see a duplicate.
  const rebound = await prisma.$queryRaw<{ hash: string, issueId: string, shortId: bigint }[]>`
    SELECT h."hash", h."issueId", i."shortId"
    FROM "IssueHash" h
    JOIN "Issue" i ON i."tenancyId" = h."tenancyId" AND i."id" = h."issueId"
    WHERE h."tenancyId" = ${tenancyId}::uuid
      AND h."hash" = ANY(${missing.map((m) => m.ownerHash)}::text[])
      AND h."state" IS NULL
  `;
  const createdIds = new Set(created.map((c) => c.id));
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
}

function buildIssueInsertSql(
  tenancyId: string,
  missing: readonly IssueMaterializationInput[],
  firstShortId: bigint,
  receivedAt: Date,
): Prisma.Sql {
  const rows = missing.map((input, index) => Prisma.sql`(
    gen_random_uuid(),
    ${tenancyId}::uuid,
    ${(firstShortId + BigInt(index)).toString()}::bigint,
    ${input.type}, ${input.value}, ${input.culprit}, ${input.platform},
    ${input.handled}, ${input.synthetic},
    ${input.firstEventAt}::timestamptz, ${input.lastEventAt}::timestamptz,
    ${input.serviceName}, ${input.deploymentEnvironmentName},
    ${input.release}, ${input.release},
    ${receivedAt}::timestamptz
  )`);
  // `id` is generated in SQL, not omitted and left to Prisma.
  //
  // `Issue.id` is declared `@default(uuid())`, which Prisma applies CLIENT-side
  // in its own query builder. The generated migration therefore emits a bare
  // `"id" UUID NOT NULL` with no database default, so a raw INSERT that leaves
  // the column out fails with 23502. That failure was invisible in practice:
  // `materializeIssuesFromBatchSafely` reports it and returns, ingest still
  // answers 200, and the issue list just stays permanently empty.
  return Prisma.sql`
    INSERT INTO "Issue" (
      "id", "tenancyId", "shortId", "type", "value", "culprit", "platform",
      "handled", "synthetic",
      "firstSeenAt", "lastSeenAt", "serviceName", "deploymentEnvironmentName",
      "firstSeenRelease", "lastSeenRelease", "updatedAt"
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
  inputs: readonly IssueMaterializationInput[],
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
 * Claims the batch and applies the deltas in a single statement.
 *
 * The `claim` CTE is the idempotency check: `ON CONFLICT DO NOTHING` returns no
 * rows when this batch was already materialized, and the `WHERE EXISTS (SELECT
 * 1 FROM claim)` makes the update a no-op in that case. Because both live in
 * one statement they share one implicit transaction, so a crash can never leave
 * the ledger claiming work that was not applied.
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
async function claimAndApply(
  prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
  tenancyId: string,
  batchId: string,
  deltas: readonly IssueDelta[],
  receivedAt: Date,
): Promise<{ issueId: string, isRegression: boolean }[]> {
  const valueRows = deltas.map((delta) => Prisma.sql`(
    ${delta.issueId}::uuid, ${delta.count}::bigint,
    ${delta.firstEventAt}::timestamptz, ${delta.lastEventAt}::timestamptz,
    ${delta.release}, ${delta.serviceName}
  )`);

  return await prisma.$queryRaw<{ issueId: string, isRegression: boolean }[]>(Prisma.sql`
    WITH claim AS (
      INSERT INTO "IssueMaterialization" ("tenancyId", "batchId")
      VALUES (${tenancyId}::uuid, ${batchId}::uuid)
      ON CONFLICT ("tenancyId", "batchId") DO NOTHING
      RETURNING 1
    ),
    deltas (issue_id, cnt, first_event_at, last_event_at, release, service_name) AS (
      VALUES ${Prisma.join(valueRows, ",")}
    ),
    updated AS (
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
      RETURNING i."id" AS "issueId", (i."regressedAt" = ${receivedAt}::timestamptz) AS "isRegression"
    )
    SELECT * FROM updated
  `);
}

export async function materializeIssuesFromBatch(options: {
  tenancy: Tenancy,
  batchId: string,
  inputs: readonly IssueMaterializationInput[],
  receivedAt: Date,
}): Promise<IssueMaterializationOutcome[]> {
  const { tenancy, batchId, inputs, receivedAt } = options;
  if (inputs.length === 0) return [];

  const prisma = await getPrismaClientForTenancy(tenancy);
  const tenancyId = tenancy.id;

  const resolved = await resolveOrCreateIssues(prisma, tenancyId, inputs, receivedAt);
  const deltas = foldDeltasByIssue(inputs, resolved);
  if (deltas.length === 0) {
    // Every hash in this batch was locked by an in-flight merge/unmerge. Leave
    // the batch unclaimed so the reconciler replays it once the lock clears.
    return [];
  }

  const applied = await claimAndApply(prisma, tenancyId, batchId, deltas, receivedAt);
  if (applied.length === 0) {
    // The ledger already had this batch: it was materialized by an earlier run.
    // Not an error — this is the retried-batch path working as designed.
    return [];
  }

  const regressionByIssueId = new Map(applied.map((row) => [row.issueId, row.isRegression]));
  return [...resolved.entries()].flatMap(([ownerHash, target]) => {
    if (!regressionByIssueId.has(target.issueId)) return [];
    return [{
      issueId: target.issueId,
      shortId: target.shortId,
      ownerHash,
      isNew: target.isNew,
      isRegression: regressionByIssueId.get(target.issueId) === true,
    }];
  });
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
  inputs: readonly IssueMaterializationInput[],
  receivedAt: Date,
}): Promise<void> {
  try {
    const outcomes = await materializeIssuesFromBatch(options);
    // Webhooks are emitted only for issues this run actually materialized, so a
    // replayed batch (which returns no outcomes) cannot re-announce anything.
    await emitIssueWebhooks({ tenancy: options.tenancy, outcomes, now: options.receivedAt });
  } catch (error) {
    captureError("issue-materialization", {
      error,
      batchId: options.batchId,
      tenancyId: options.tenancy.id,
      hashes: options.inputs.map((input) => input.ownerHash),
    });
  }
}
