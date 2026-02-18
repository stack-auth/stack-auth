import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const unrestricted = randomUUID();
  const restrictedWithReason = randomUUID();
  const restrictedNoReason = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")`;

  // Unrestricted user (valid: false + null reason)
  await sql`INSERT INTO "ProjectUser" ("projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId", "createdAt", "updatedAt", "lastActiveAt") VALUES (${unrestricted}::uuid, ${tenancyId}::uuid, ${projectId}, 'main', NOW(), NOW(), NOW())`;

  // Restricted with reason
  await sql`INSERT INTO "ProjectUser" ("projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId", "createdAt", "updatedAt", "lastActiveAt", "restrictedByAdmin", "restrictedByAdminReason") VALUES (${restrictedWithReason}::uuid, ${tenancyId}::uuid, ${projectId}, 'main', NOW(), NOW(), NOW(), true, 'spam')`;

  // Restricted without reason
  await sql`INSERT INTO "ProjectUser" ("projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId", "createdAt", "updatedAt", "lastActiveAt", "restrictedByAdmin") VALUES (${restrictedNoReason}::uuid, ${tenancyId}::uuid, ${projectId}, 'main', NOW(), NOW(), NOW(), true)`;

  return { projectId, tenancyId, unrestricted, restrictedWithReason, restrictedNoReason };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  // Existing valid rows should still be there
  const rows = await sql`
    SELECT "projectUserId", "restrictedByAdmin", "restrictedByAdminReason", "restrictedByAdminPrivateDetails"
    FROM "ProjectUser"
    WHERE "mirroredProjectId" = ${ctx.projectId}
    ORDER BY "projectUserId"
  `;
  expect(rows).toHaveLength(3);

  for (const row of rows) {
    expect(row.restrictedByAdminPrivateDetails).toBeNull();
  }

  // Restricted user can have private details set
  await sql`UPDATE "ProjectUser" SET "restrictedByAdminPrivateDetails" = 'internal notes' WHERE "projectUserId" = ${ctx.restrictedWithReason}::uuid`;

  // INVALID: unrestricted user with a reason should fail
  await expect(sql`
    UPDATE "ProjectUser" SET "restrictedByAdminReason" = 'should fail' WHERE "projectUserId" = ${ctx.unrestricted}::uuid
  `).rejects.toThrow(/ProjectUser_restricted_by_admin_consistency/);

  // INVALID: unrestricted user with private details should fail
  await expect(sql`
    UPDATE "ProjectUser" SET "restrictedByAdminPrivateDetails" = 'should fail' WHERE "projectUserId" = ${ctx.unrestricted}::uuid
  `).rejects.toThrow(/ProjectUser_restricted_by_admin_consistency/);

  // VALID: new restricted user with all fields
  const newUser = randomUUID();
  await sql`INSERT INTO "ProjectUser" ("projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId", "createdAt", "updatedAt", "lastActiveAt", "restrictedByAdmin", "restrictedByAdminReason", "restrictedByAdminPrivateDetails") VALUES (${newUser}::uuid, ${ctx.tenancyId}::uuid, ${ctx.projectId}, 'main', NOW(), NOW(), NOW(), true, 'test', 'details')`;

  // VALID: un-restricting clears reason and details
  await sql`UPDATE "ProjectUser" SET "restrictedByAdmin" = false, "restrictedByAdminReason" = NULL, "restrictedByAdminPrivateDetails" = NULL WHERE "projectUserId" = ${newUser}::uuid`;
};
