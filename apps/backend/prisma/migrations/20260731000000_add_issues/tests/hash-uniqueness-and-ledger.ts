import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

const seedTenancy = async (sql: Sql, label: string) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), ${label}, '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  return { projectId, tenancyId };
};

export const preMigration = async (sql: Sql) => {
  const a = await seedTenancy(sql, "Issues Constraint Test A");
  const b = await seedTenancy(sql, "Issues Constraint Test B");
  return { tenancyA: a.tenancyId, tenancyB: b.tenancyId };
};

const insertIssue = async (sql: Sql, tenancyId: string, shortId: number) => {
  const issueId = randomUUID();
  await sql`
    INSERT INTO "Issue" ("id", "tenancyId", "shortId", "type", "value", "culprit", "platform", "firstSeenAt", "lastSeenAt", "updatedAt")
    VALUES (${issueId}::uuid, ${tenancyId}::uuid, ${shortId}, 'TypeError', 'boom', 'app/page.tsx', 'javascript', NOW(), NOW(), NOW())
  `;
  return issueId;
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const sharedHash = "f".repeat(32);
  const issueA = await insertIssue(sql, ctx.tenancyA, 1);
  const issueB = await insertIssue(sql, ctx.tenancyB, 1);

  // ---- IssueHash: the (tenancyId, hash) primary key ----

  await sql`
    INSERT INTO "IssueHash" ("tenancyId", "hash", "issueId", "groupingConfigId")
    VALUES (${ctx.tenancyA}::uuid, ${sharedHash}, ${issueA}::uuid, 'v1')
  `;

  // The same error hashes identically for every project, so the hash space MUST
  // be per tenancy — otherwise one project's error would claim another's.
  await sql`
    INSERT INTO "IssueHash" ("tenancyId", "hash", "issueId", "groupingConfigId")
    VALUES (${ctx.tenancyB}::uuid, ${sharedHash}, ${issueB}::uuid, 'v1')
  `;

  // ...and exactly once within a tenancy. This rejection IS the first-sighting
  // concurrency control: when two ingest batches see the same brand-new error
  // simultaneously, both attempt this insert and one loses here rather than
  // creating a duplicate issue.
  const secondIssueA = await insertIssue(sql, ctx.tenancyA, 2);
  await expect(sql`
    INSERT INTO "IssueHash" ("tenancyId", "hash", "issueId", "groupingConfigId")
    VALUES (${ctx.tenancyA}::uuid, ${sharedHash}, ${secondIssueA}::uuid, 'v1')
  `).rejects.toThrow(/IssueHash_pkey/);

  // The losing writer's actual recovery path: ON CONFLICT DO NOTHING reports
  // zero rows and the caller re-reads the winner's issue.
  const contended = await sql`
    INSERT INTO "IssueHash" ("tenancyId", "hash", "issueId", "groupingConfigId")
    VALUES (${ctx.tenancyA}::uuid, ${sharedHash}, ${secondIssueA}::uuid, 'v1')
    ON CONFLICT ("tenancyId", "hash") DO NOTHING
    RETURNING "issueId"
  `;
  expect(contended).toHaveLength(0);
  const owner = await sql<{ issueId: string }[]>`
    SELECT "issueId" FROM "IssueHash" WHERE "tenancyId" = ${ctx.tenancyA}::uuid AND "hash" = ${sharedHash}
  `;
  expect(owner[0].issueId).toBe(issueA);

  // ---- IssueHash: the issueId foreign key ----

  await expect(sql`
    INSERT INTO "IssueHash" ("tenancyId", "hash", "issueId", "groupingConfigId")
    VALUES (${ctx.tenancyA}::uuid, ${"0".repeat(32)}, ${randomUUID()}::uuid, 'v1')
  `).rejects.toThrow(/IssueHash_tenancyId_issueId_fkey/);

  // The FK is composite, so it also stops a hash in tenancy A from pointing at
  // an issue that exists but belongs to tenancy B.
  await expect(sql`
    INSERT INTO "IssueHash" ("tenancyId", "hash", "issueId", "groupingConfigId")
    VALUES (${ctx.tenancyA}::uuid, ${"1".repeat(32)}, ${issueB}::uuid, 'v1')
  `).rejects.toThrow(/IssueHash_tenancyId_issueId_fkey/);

  // ---- IssueHash: the committed lease ----

  // A merge sets state + lockedAt in one transaction and clears them in another,
  // so both must survive a commit boundary and be readable by an unrelated
  // statement. (An uncommitted flag or a row lock would be invisible to the
  // ingest path, which needs to SKIP a locked hash, not block on it.)
  await sql`
    UPDATE "IssueHash" SET "state" = 'LOCKED', "lockedAt" = NOW()
    WHERE "tenancyId" = ${ctx.tenancyA}::uuid AND "hash" = ${sharedHash}
  `;
  const locked = await sql<{ hash: string, state: string | null, lockedAt: Date | null }[]>`
    SELECT "hash", "state", "lockedAt" FROM "IssueHash"
    WHERE "tenancyId" = ${ctx.tenancyA}::uuid AND "state" = 'LOCKED'
  `;
  expect(locked).toHaveLength(1);
  expect(locked[0].hash).toBe(sharedHash);
  expect(locked[0].state).toBe("LOCKED");
  expect(locked[0].lockedAt).not.toBeNull();

  await sql`
    UPDATE "IssueHash" SET "state" = NULL, "lockedAt" = NULL
    WHERE "tenancyId" = ${ctx.tenancyA}::uuid AND "hash" = ${sharedHash}
  `;
  const unlocked = await sql`
    SELECT 1 FROM "IssueHash" WHERE "tenancyId" = ${ctx.tenancyA}::uuid AND "state" IS NOT NULL
  `;
  expect(unlocked).toHaveLength(0);

  // ---- IssueMaterialization: the exactly-once ledger ----

  // The ledger's entire contract. The first insert claims the batch and returns
  // a row; the replay returns none, which is how a retried batch is prevented
  // from applying its counter deltas twice.
  const batchId = randomUUID();
  const firstApply = await sql`
    INSERT INTO "IssueMaterialization" ("tenancyId", "batchId") VALUES (${ctx.tenancyA}::uuid, ${batchId}::uuid)
    ON CONFLICT DO NOTHING
    RETURNING "batchId"
  `;
  expect(firstApply).toHaveLength(1);

  const replayApply = await sql`
    INSERT INTO "IssueMaterialization" ("tenancyId", "batchId") VALUES (${ctx.tenancyA}::uuid, ${batchId}::uuid)
    ON CONFLICT DO NOTHING
    RETURNING "batchId"
  `;
  expect(replayApply).toHaveLength(0);

  // Without ON CONFLICT the same claim is a hard error, so a caller that forgets
  // the clause fails loudly instead of double-counting.
  await expect(sql`
    INSERT INTO "IssueMaterialization" ("tenancyId", "batchId") VALUES (${ctx.tenancyA}::uuid, ${batchId}::uuid)
  `).rejects.toThrow(/IssueMaterialization_pkey/);

  // The ledger is keyed by tenancy too: the same batch id in another tenancy is
  // a different claim.
  await sql`INSERT INTO "IssueMaterialization" ("tenancyId", "batchId") VALUES (${ctx.tenancyB}::uuid, ${batchId}::uuid)`;

  // Batch identities are transport strings, not database UUIDs: Sentry
  // envelope batches use a content-derived identifier and OTLP batches may use
  // a deterministic request hash. The ledger must accept them directly or
  // valid non-UUID protocol batches get rejected before materialization.
  const transportBatchId = `sentry-envelope-${"a".repeat(64)}`;
  const transportApply = await sql`
    INSERT INTO "IssueMaterialization" ("tenancyId", "batchId") VALUES (${ctx.tenancyA}::uuid, ${transportBatchId})
    ON CONFLICT DO NOTHING
    RETURNING "batchId"
  `;
  expect(transportApply).toHaveLength(1);

  // The replay-side-effect bookkeeping lives on the ledger row itself: stored
  // outcomes plus one dispatch timestamp per notification phase, so webhook and
  // alert dispatch are each independently idempotent on retry.
  const sideEffectColumns = await sql<{ column_name: string, data_type: string }[]>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'IssueMaterialization'
      AND column_name IN ('outcomes', 'webhooksDispatchedAt', 'alertsDispatchedAt')
    ORDER BY column_name COLLATE "C"
  `;
  expect(sideEffectColumns).toEqual([
    { column_name: "alertsDispatchedAt", data_type: "timestamp without time zone" },
    { column_name: "outcomes", data_type: "jsonb" },
    { column_name: "webhooksDispatchedAt", data_type: "timestamp without time zone" },
  ]);

  // ---- Short ids ----

  // shortId is unique per tenancy (= per project AND branch, since a Tenancy is
  // (project, branch)) — hence HEXCLAVE-1 existing on two branches at once.
  await expect(insertIssue(sql, ctx.tenancyA, 1)).rejects.toThrow(/Issue_tenancyId_shortId_key/);
  expect(await insertIssue(sql, ctx.tenancyB, 2)).toBeTruthy();

  // Redirects: both the uuid (primary key) and the short id must resolve, and
  // each may only point somewhere once. Merge rewrites existing redirects rather
  // than chaining them, which is only sound if a short id maps to exactly one
  // target — that's what this unique index enforces.
  const goneIssueId = randomUUID();
  await sql`
    INSERT INTO "IssueRedirect" ("tenancyId", "fromIssueId", "toIssueId", "fromShortId")
    VALUES (${ctx.tenancyA}::uuid, ${goneIssueId}::uuid, ${issueA}::uuid, 7)
  `;
  await expect(sql`
    INSERT INTO "IssueRedirect" ("tenancyId", "fromIssueId", "toIssueId", "fromShortId")
    VALUES (${ctx.tenancyA}::uuid, ${randomUUID()}::uuid, ${secondIssueA}::uuid, 7)
  `).rejects.toThrow(/IssueRedirect_tenancyId_fromShortId_key/);
  await expect(sql`
    INSERT INTO "IssueRedirect" ("tenancyId", "fromIssueId", "toIssueId", "fromShortId")
    VALUES (${ctx.tenancyA}::uuid, ${goneIssueId}::uuid, ${secondIssueA}::uuid, 8)
  `).rejects.toThrow(/IssueRedirect_pkey/);

  // Same short id redirecting in a different tenancy is fine.
  await sql`
    INSERT INTO "IssueRedirect" ("tenancyId", "fromIssueId", "toIssueId", "fromShortId")
    VALUES (${ctx.tenancyB}::uuid, ${randomUUID()}::uuid, ${issueB}::uuid, 7)
  `;

  // A redirect deliberately survives the disappearance of its source issue —
  // there is no FK on fromIssueId, because the merge that created the redirect
  // already deleted that row.
  const orphanRedirect = await sql`
    SELECT 1 FROM "IssueRedirect" WHERE "tenancyId" = ${ctx.tenancyA}::uuid AND "fromIssueId" = ${goneIssueId}::uuid
  `;
  expect(orphanRedirect).toHaveLength(1);

  // ---- The short id allocator ----

  // One row per tenancy (it is the primary key), bumped under the row lock the
  // issue-creating transaction already holds.
  await sql`INSERT INTO "IssueCounter" ("tenancyId", "nextShortId") VALUES (${ctx.tenancyA}::uuid, 3)`;
  await expect(sql`
    INSERT INTO "IssueCounter" ("tenancyId") VALUES (${ctx.tenancyA}::uuid)
  `).rejects.toThrow(/IssueCounter_pkey/);
  const allocated = await sql<{ nextShortId: string }[]>`
    UPDATE "IssueCounter" SET "nextShortId" = "nextShortId" + 1
    WHERE "tenancyId" = ${ctx.tenancyA}::uuid
    RETURNING "nextShortId"
  `;
  expect(String(allocated[0].nextShortId)).toBe("4");

  // BIGINT, not INT: a firehose project must not be able to wrap the counter.
  await sql`
    UPDATE "IssueCounter" SET "nextShortId" = 9223372036854775807 WHERE "tenancyId" = ${ctx.tenancyA}::uuid
  `;
  const maxed = await sql<{ nextShortId: string }[]>`
    SELECT "nextShortId" FROM "IssueCounter" WHERE "tenancyId" = ${ctx.tenancyA}::uuid
  `;
  expect(String(maxed[0].nextShortId)).toBe("9223372036854775807");
};
