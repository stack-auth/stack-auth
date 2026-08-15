import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

const TEAM_FKS = [
  "IssueOwner_team_fkey",
  "IssueSubscription_team_fkey",
  "Issue_assigned_team_fkey",
] as const;

export const preMigration = async (sql: Sql) => {
  // Recreate the mistaken customer-tenancy FKs so this DROP is actually
  // exercised even when 20260731000000_add_issues no longer creates them.
  // NOT VALID: existing assignedTeamId values may already be internal owner
  // team ids that are not Team rows in this tenancy.
  await sql.unsafe(`ALTER TABLE "Issue" DROP CONSTRAINT IF EXISTS "Issue_assigned_team_fkey"`);
  await sql.unsafe(`
    ALTER TABLE "Issue" ADD CONSTRAINT "Issue_assigned_team_fkey"
      FOREIGN KEY ("tenancyId", "assignedTeamId") REFERENCES "Team"("tenancyId", "teamId")
      ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID
  `);
  await sql.unsafe(`ALTER TABLE "IssueOwner" DROP CONSTRAINT IF EXISTS "IssueOwner_team_fkey"`);
  await sql.unsafe(`
    ALTER TABLE "IssueOwner" ADD CONSTRAINT "IssueOwner_team_fkey"
      FOREIGN KEY ("tenancyId", "ownerTeamId") REFERENCES "Team"("tenancyId", "teamId")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID
  `);
  await sql.unsafe(`ALTER TABLE "IssueSubscription" DROP CONSTRAINT IF EXISTS "IssueSubscription_team_fkey"`);
  await sql.unsafe(`
    ALTER TABLE "IssueSubscription" ADD CONSTRAINT "IssueSubscription_team_fkey"
      FOREIGN KEY ("tenancyId", "subjectTeamId") REFERENCES "Team"("tenancyId", "teamId")
      ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID
  `);

  const present = await sql<{ constraint_name: string }[]>`
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name IN ('Issue_assigned_team_fkey', 'IssueOwner_team_fkey', 'IssueSubscription_team_fkey')
    ORDER BY constraint_name COLLATE "C"
  `;
  expect(present.map((row) => row.constraint_name)).toEqual([...TEAM_FKS]);
};

export const postMigration = async (sql: Sql) => {
  const leakedTeamFks = await sql<{ constraint_name: string }[]>`
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name IN ('Issue_assigned_team_fkey', 'IssueOwner_team_fkey', 'IssueSubscription_team_fkey')
    ORDER BY constraint_name COLLATE "C"
  `;
  expect(leakedTeamFks).toEqual([]);

  const projectId = `drop-issue-team-fks-${randomUUID()}`;
  const tenancyId = randomUUID();
  const issueId = randomUUID();
  const ownerTeamId = randomUUID();
  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Drop issue team FKs', '', false)`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")`;
  await sql`INSERT INTO "Issue" ("id", "tenancyId", "shortId", "type", "value", "culprit", "platform", "firstSeenAt", "lastSeenAt", "updatedAt") VALUES (${issueId}::uuid, ${tenancyId}::uuid, 1, 'TypeError', 'boom', 'app.ts', 'node', NOW(), NOW(), NOW())`;
  await sql`UPDATE "Issue" SET "assignedTeamId" = ${ownerTeamId}::uuid WHERE "id" = ${issueId}::uuid`;
  const assigned = await sql<{ assignedTeamId: string }[]>`SELECT "assignedTeamId" FROM "Issue" WHERE "id" = ${issueId}::uuid`;
  expect(assigned[0].assignedTeamId).toBe(ownerTeamId);
  await sql`DELETE FROM "Project" WHERE "id" = ${projectId}`;
};
