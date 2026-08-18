import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

// The test database is built from the CURRENT migration files, where
// 20260731000000_add_issues already creates both natural-key indexes as NULLS
// NOT DISTINCT. This migration's compatibility branch only fires on databases
// that applied the OLDER add_issues shape, so preMigration recreates that
// legacy shape (default nulls-distinct index) and inserts the duplicates it
// allowed — otherwise the dedupe + rebuild path would go untested.
export const preMigration = async (sql: Sql) => {
  const projectId = `natural-key-${randomUUID()}`;
  const tenancyId = randomUUID();
  const branchId = "main";
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Natural key dedupe test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, ${branchId}, 'TRUE'::"BooleanTrue")
  `;
  const issueId = randomUUID();
  await sql`
    INSERT INTO "Issue" ("id", "tenancyId", "shortId", "type", "value", "culprit", "platform", "firstSeenAt", "lastSeenAt", "updatedAt")
    VALUES (${issueId}::uuid, ${tenancyId}::uuid, 1, 'TypeError', 'boom', 'app.ts', 'node', NOW(), NOW(), NOW())
  `;
  const userId = randomUUID();
  await sql`
    INSERT INTO "ProjectUser" ("tenancyId", "projectUserId", "mirroredProjectId", "mirroredBranchId", "createdAt", "updatedAt", "lastActiveAt", "signedUpAt")
    VALUES (${tenancyId}::uuid, ${userId}::uuid, ${projectId}, ${branchId}, NOW(), NOW(), NOW(), NOW())
  `;

  // Recreate the legacy pre-release index shape (no NULLS NOT DISTINCT).
  await sql`DROP INDEX "IssueOwner_scope_natural_key"`;
  await sql`
    CREATE UNIQUE INDEX "IssueOwner_scope_natural_key"
      ON "IssueOwner" ("tenancyId", "projectId", "branchId", "issueId", "ownerType", "ownerUserId", "ownerTeamId", "source")
  `;
  await sql`DROP INDEX "IssueSubscription_scope_natural_key"`;
  await sql`
    CREATE UNIQUE INDEX "IssueSubscription_scope_natural_key"
      ON "IssueSubscription" ("tenancyId", "projectId", "branchId", "issueId", "subjectType", "subjectUserId", "subjectTeamId")
  `;

  // Duplicates the legacy index admitted. Distinct updatedAt so the migration's
  // keep-most-recently-updated choice is observable.
  const staleOwnerId = randomUUID();
  const keptOwnerId = randomUUID();
  await sql`
    INSERT INTO "IssueOwner" ("tenancyId", "projectId", "branchId", "id", "issueId", "ownerType", "ownerUserId", "source", "createdAt", "updatedAt")
    VALUES
      (${tenancyId}::uuid, ${projectId}, ${branchId}, ${staleOwnerId}::uuid, ${issueId}::uuid, 'USER', ${userId}::uuid, 'MANUAL', NOW(), NOW() - interval '1 hour'),
      (${tenancyId}::uuid, ${projectId}, ${branchId}, ${keptOwnerId}::uuid, ${issueId}::uuid, 'USER', ${userId}::uuid, 'MANUAL', NOW(), NOW())
  `;
  const staleSubscriptionId = randomUUID();
  const keptSubscriptionId = randomUUID();
  await sql`
    INSERT INTO "IssueSubscription" ("tenancyId", "projectId", "branchId", "id", "issueId", "subjectType", "subjectUserId", "isActive", "createdAt", "updatedAt")
    VALUES
      (${tenancyId}::uuid, ${projectId}, ${branchId}, ${staleSubscriptionId}::uuid, ${issueId}::uuid, 'USER', ${userId}::uuid, false, NOW(), NOW() - interval '1 hour'),
      (${tenancyId}::uuid, ${projectId}, ${branchId}, ${keptSubscriptionId}::uuid, ${issueId}::uuid, 'USER', ${userId}::uuid, true, NOW(), NOW())
  `;

  return { projectId, tenancyId, branchId, issueId, userId, keptOwnerId, keptSubscriptionId };
};

export const postMigration = async (
  sql: Sql,
  ctx: Awaited<ReturnType<typeof preMigration>>,
) => {
  // Both indexes were rebuilt as NULLS NOT DISTINCT.
  const indexes = await sql<{ relname: string, indnullsnotdistinct: boolean }[]>`
    SELECT c.relname, i.indnullsnotdistinct
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname IN ('IssueOwner_scope_natural_key', 'IssueSubscription_scope_natural_key')
    ORDER BY c.relname COLLATE "C"
  `;
  expect(indexes).toEqual([
    { relname: "IssueOwner_scope_natural_key", indnullsnotdistinct: true },
    { relname: "IssueSubscription_scope_natural_key", indnullsnotdistinct: true },
  ]);

  // The dedupe kept exactly the most recently updated row of each pair.
  const owners = await sql<{ id: string }[]>`
    SELECT "id" FROM "IssueOwner" WHERE "tenancyId" = ${ctx.tenancyId}::uuid
  `;
  expect(owners).toEqual([{ id: ctx.keptOwnerId }]);
  const subscriptions = await sql<{ id: string, isActive: boolean }[]>`
    SELECT "id", "isActive" FROM "IssueSubscription" WHERE "tenancyId" = ${ctx.tenancyId}::uuid
  `;
  expect(subscriptions).toEqual([{ id: ctx.keptSubscriptionId, isActive: true }]);

  // The rebuilt keys reject the duplicates the legacy shape allowed. (The NULL
  // team column is what made the old index a no-op — every row has one.)
  await expect(sql`
    INSERT INTO "IssueOwner" ("tenancyId", "projectId", "branchId", "issueId", "ownerType", "ownerUserId", "source")
    VALUES (${ctx.tenancyId}::uuid, ${ctx.projectId}, ${ctx.branchId}, ${ctx.issueId}::uuid, 'USER', ${ctx.userId}::uuid, 'MANUAL')
  `).rejects.toThrow(/IssueOwner_scope_natural_key/);
  await expect(sql`
    INSERT INTO "IssueSubscription" ("tenancyId", "projectId", "branchId", "issueId", "subjectType", "subjectUserId", "isActive")
    VALUES (${ctx.tenancyId}::uuid, ${ctx.projectId}, ${ctx.branchId}, ${ctx.issueId}::uuid, 'USER', ${ctx.userId}::uuid, true)
  `).rejects.toThrow(/IssueSubscription_scope_natural_key/);

  // A DIFFERENT source is a different logical owner record and stays allowed.
  await sql`
    INSERT INTO "IssueOwner" ("tenancyId", "projectId", "branchId", "issueId", "ownerType", "ownerUserId", "source")
    VALUES (${ctx.tenancyId}::uuid, ${ctx.projectId}, ${ctx.branchId}, ${ctx.issueId}::uuid, 'USER', ${ctx.userId}::uuid, 'CODEOWNERS')
  `;

  await sql`DELETE FROM "Project" WHERE "id" = ${ctx.projectId}`;
};
