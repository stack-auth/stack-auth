import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Issues Cascade Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;

  return { projectId, tenancyId };
};

const seedIssueWithHashes = async (sql: Sql, tenancyId: string, shortId: number, hashPrefix: string) => {
  const issueId = randomUUID();
  await sql`
    INSERT INTO "Issue" ("id", "tenancyId", "shortId", "type", "value", "culprit", "platform", "firstSeenAt", "lastSeenAt", "updatedAt")
    VALUES (${issueId}::uuid, ${tenancyId}::uuid, ${shortId}, 'TypeError', 'boom', 'app/page.tsx', 'javascript', NOW(), NOW(), NOW())
  `;
  // Two hashes on one issue — the many-to-one shape a merged issue has, so the
  // cascade is exercised on more than the trivial 1:1 case.
  for (const suffix of ["1", "2"]) {
    await sql`
      INSERT INTO "IssueHash" ("tenancyId", "hash", "issueId", "groupingConfigId")
      VALUES (${tenancyId}::uuid, ${`${hashPrefix}${suffix}`}, ${issueId}::uuid, 'v1')
    `;
  }
  return issueId;
};

const countRows = async (sql: Sql, tenancyId: string) => {
  const [issues, hashes, redirects, counters, materializations] = await Promise.all([
    sql`SELECT count(*)::int AS count FROM "Issue" WHERE "tenancyId" = ${tenancyId}::uuid`,
    sql`SELECT count(*)::int AS count FROM "IssueHash" WHERE "tenancyId" = ${tenancyId}::uuid`,
    sql`SELECT count(*)::int AS count FROM "IssueRedirect" WHERE "tenancyId" = ${tenancyId}::uuid`,
    sql`SELECT count(*)::int AS count FROM "IssueCounter" WHERE "tenancyId" = ${tenancyId}::uuid`,
    sql`SELECT count(*)::int AS count FROM "IssueMaterialization" WHERE "tenancyId" = ${tenancyId}::uuid`,
  ]);
  return {
    issues: issues[0].count as number,
    hashes: hashes[0].count as number,
    redirects: redirects[0].count as number,
    counters: counters[0].count as number,
    materializations: materializations[0].count as number,
  };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  // Deleting an issue takes its hashes with it. This is what makes unmerge and
  // grouping-config changes a row-level rewrite instead of a schema migration.
  const doomedIssueId = await seedIssueWithHashes(sql, ctx.tenancyId, 1, "cascade-a-");
  expect(await countRows(sql, ctx.tenancyId)).toEqual({ issues: 1, hashes: 2, redirects: 0, counters: 0, materializations: 0 });

  await sql`DELETE FROM "Issue" WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${doomedIssueId}::uuid`;
  expect(await countRows(sql, ctx.tenancyId)).toEqual({ issues: 0, hashes: 0, redirects: 0, counters: 0, materializations: 0 });

  // Now seed one of everything and delete the project, which cascades through
  // the tenancy.
  const survivingIssueId = await seedIssueWithHashes(sql, ctx.tenancyId, 2, "cascade-b-");
  await sql`
    INSERT INTO "IssueRedirect" ("tenancyId", "fromIssueId", "toIssueId", "fromShortId")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, ${survivingIssueId}::uuid, 1)
  `;
  await sql`INSERT INTO "IssueCounter" ("tenancyId", "nextShortId") VALUES (${ctx.tenancyId}::uuid, 3)`;
  await sql`INSERT INTO "IssueMaterialization" ("tenancyId", "batchId") VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid)`;
  expect(await countRows(sql, ctx.tenancyId)).toEqual({ issues: 1, hashes: 2, redirects: 1, counters: 1, materializations: 1 });

  await sql`DELETE FROM "Project" WHERE "id" = ${ctx.projectId}`;

  // Everything with a Tenancy foreign key is gone. IssueMaterialization is NOT:
  // it deliberately has no Tenancy FK so the per-batch ledger INSERT on the
  // ingest write path doesn't take a row-share lock on the hot Tenancy row.
  // Orphans are reclaimed by the same appliedAt-based pruning that bounds the
  // ledger generally — asserted here so the omission reads as a decision rather
  // than an oversight if anyone revisits it.
  expect(await countRows(sql, ctx.tenancyId)).toEqual({ issues: 0, hashes: 0, redirects: 0, counters: 0, materializations: 1 });

  await sql`DELETE FROM "IssueMaterialization" WHERE "tenancyId" = ${ctx.tenancyId}::uuid`;
};
