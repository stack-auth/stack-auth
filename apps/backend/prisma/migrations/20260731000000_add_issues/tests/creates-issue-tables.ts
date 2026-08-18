import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Issues DDL Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;

  return { projectId, tenancyId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('Issue', 'IssueHash', 'IssueMaterialization', 'IssueRedirect', 'IssueCounter')
    ORDER BY table_name
  `;
  expect(tables.map(t => t.table_name)).toMatchInlineSnapshot(`
    [
      "Issue",
      "IssueCounter",
      "IssueHash",
      "IssueMaterialization",
      "IssueRedirect",
    ]
  `);

  // Both enums exist with exactly the labels the app switches on. A stray or
  // missing label here would only surface as a runtime insert failure.
  const enumLabels = await sql<{ typname: string, enumlabel: string }[]>`
    SELECT t.typname, e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname IN ('IssueStatus', 'IssueHashState')
    ORDER BY t.typname, e.enumsortorder
  `;
  expect(enumLabels.map(e => `${e.typname}.${e.enumlabel}`)).toMatchInlineSnapshot(`
    [
      "IssueHashState.LOCKED",
      "IssueStatus.UNRESOLVED",
      "IssueStatus.RESOLVED",
      "IssueStatus.IGNORED",
    ]
  `);

  // Every index and unique/primary-key constraint this migration creates. These are
  // load-bearing: the four Issue indexes are the four list-view sort orders, and
  // the unique ones are the concurrency controls (see the migration header).
  // COLLATE "C" so the ordering is plain byte order and the snapshot doesn't
  // depend on the test database's locale (en_US-style collations sort
  // punctuation differently, which would reorder the _pkey entries).
  const indexes = await sql<{ indexname: string }[]>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('Issue', 'IssueHash', 'IssueMaterialization', 'IssueRedirect', 'IssueCounter')
    ORDER BY indexname COLLATE "C"
  `;
  expect(indexes.map(i => i.indexname)).toMatchInlineSnapshot(`
    [
      "IssueCounter_pkey",
      "IssueHash_pkey",
      "IssueHash_tenancyId_issueId_idx",
      "IssueHash_tenancyId_state_idx",
      "IssueMaterialization_appliedAt_idx",
      "IssueMaterialization_pkey",
      "IssueRedirect_pkey",
      "IssueRedirect_tenancyId_fromShortId_key",
      "Issue_pkey",
      "Issue_tenancyId_lastSeenAt_idx",
      "Issue_tenancyId_shortId_key",
      "Issue_tenancyId_status_firstSeenAt_idx",
      "Issue_tenancyId_status_lastSeenAt_idx",
      "Issue_tenancyId_status_timesSeen_idx",
    ]
  `);

  // A minimal row in every table, exercising the column defaults the
  // materialization path relies on.
  const issueId = randomUUID();
  await sql`
    INSERT INTO "Issue" ("id", "tenancyId", "shortId", "type", "value", "culprit", "platform", "firstSeenAt", "lastSeenAt", "updatedAt")
    VALUES (${issueId}::uuid, ${ctx.tenancyId}::uuid, 1, 'TypeError', 'x is not a function', 'app/page.tsx', 'javascript', NOW(), NOW(), NOW())
  `;
  await sql`
    INSERT INTO "IssueHash" ("tenancyId", "hash", "issueId", "groupingConfigId")
    VALUES (${ctx.tenancyId}::uuid, ${"a".repeat(32)}, ${issueId}::uuid, 'v1')
  `;
  await sql`
    INSERT INTO "IssueMaterialization" ("tenancyId", "batchId")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid)
  `;
  await sql`
    INSERT INTO "IssueRedirect" ("tenancyId", "fromIssueId", "toIssueId", "fromShortId")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, ${issueId}::uuid, 99)
  `;
  await sql`
    INSERT INTO "IssueCounter" ("tenancyId") VALUES (${ctx.tenancyId}::uuid)
  `;

  // BIGINT columns come back from the driver as strings; the API layer relies on
  // that (shortId and timesSeen serialize as decimal strings because
  // JSON.stringify throws on BigInt).
  const issue = await sql<{ status: string, timesSeen: string, shortId: string, countersTruncatedAt: Date | null }[]>`
    SELECT "status", "timesSeen", "shortId", "countersTruncatedAt" FROM "Issue" WHERE "id" = ${issueId}::uuid
  `;
  expect(issue[0].status).toBe("UNRESOLVED");
  expect(String(issue[0].timesSeen)).toBe("0");
  expect(String(issue[0].shortId)).toBe("1");
  expect(issue[0].countersTruncatedAt).toBeNull();

  const counter = await sql<{ nextShortId: string }[]>`
    SELECT "nextShortId" FROM "IssueCounter" WHERE "tenancyId" = ${ctx.tenancyId}::uuid
  `;
  expect(String(counter[0].nextShortId)).toBe("1");

  // A hash with no lease reads back as NULL state — "no lease" costs no extra
  // column, which is why state is a nullable enum rather than a boolean.
  const hash = await sql<{ state: string | null, lockedAt: Date | null }[]>`
    SELECT "state", "lockedAt" FROM "IssueHash" WHERE "tenancyId" = ${ctx.tenancyId}::uuid
  `;
  expect(hash[0].state).toBeNull();
  expect(hash[0].lockedAt).toBeNull();

  // Invalid enum labels are rejected rather than coerced.
  await expect(sql`
    UPDATE "Issue" SET "status" = 'NOT_A_STATUS' WHERE "id" = ${issueId}::uuid
  `).rejects.toThrow(/invalid input value for enum/);
};
