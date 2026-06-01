import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")`;

  const projectUserId = randomUUID();
  await sql`
    INSERT INTO "ProjectUser" ("tenancyId", "projectUserId", "mirroredProjectId", "mirroredBranchId", "createdAt", "updatedAt", "lastActiveAt")
    VALUES (${tenancyId}::uuid, ${projectUserId}::uuid, ${projectId}, 'main', NOW(), NOW(), NOW())
  `;

  const refreshTokenId = randomUUID();
  const refreshToken = `rt-${randomUUID()}`;
  await sql`
    INSERT INTO "ProjectUserRefreshToken" ("id", "tenancyId", "projectUserId", "createdAt", "updatedAt", "lastActiveAt", "refreshToken")
    VALUES (${refreshTokenId}::uuid, ${tenancyId}::uuid, ${projectUserId}::uuid, NOW(), NOW(), NOW(), ${refreshToken})
  `;

  return { tenancyId, refreshTokenId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  // Existing rows get a NULL scope (= unrestricted session)
  const rows = await sql`
    SELECT "scope"
    FROM "ProjectUserRefreshToken"
    WHERE "id" = ${ctx.refreshTokenId}::uuid AND "tenancyId" = ${ctx.tenancyId}::uuid
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0].scope).toBeNull();

  // The column accepts a space-separated scope string
  await sql`
    UPDATE "ProjectUserRefreshToken"
    SET "scope" = ${'users:read teams:read'}
    WHERE "id" = ${ctx.refreshTokenId}::uuid AND "tenancyId" = ${ctx.tenancyId}::uuid
  `;
  const updated = await sql`
    SELECT "scope"
    FROM "ProjectUserRefreshToken"
    WHERE "id" = ${ctx.refreshTokenId}::uuid AND "tenancyId" = ${ctx.tenancyId}::uuid
  `;
  expect(updated[0].scope).toBe('users:read teams:read');
};
