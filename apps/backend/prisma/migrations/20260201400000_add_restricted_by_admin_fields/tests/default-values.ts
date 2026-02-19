import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const userId1 = randomUUID();
  const userId2 = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")`;
  await sql`INSERT INTO "ProjectUser" ("projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId", "createdAt", "updatedAt", "lastActiveAt") VALUES (${userId1}::uuid, ${tenancyId}::uuid, ${projectId}, 'main', NOW(), NOW(), NOW())`;
  await sql`INSERT INTO "ProjectUser" ("projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId", "createdAt", "updatedAt", "lastActiveAt") VALUES (${userId2}::uuid, ${tenancyId}::uuid, ${projectId}, 'main', NOW(), NOW(), NOW())`;

  return { projectId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const rows = await sql`
    SELECT "restrictedByAdmin", "restrictedByAdminReason"
    FROM "ProjectUser"
    WHERE "mirroredProjectId" = ${ctx.projectId}
  `;

  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row.restrictedByAdmin).toBe(false);
    expect(row.restrictedByAdminReason).toBeNull();
  }
};
