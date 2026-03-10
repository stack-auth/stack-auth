import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const userId = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")`;
  await sql`
    INSERT INTO "ProjectUser" (
      "projectUserId",
      "tenancyId",
      "mirroredProjectId",
      "mirroredBranchId",
      "createdAt",
      "updatedAt",
      "lastActiveAt",
      "signUpRiskScoreBot",
      "signUpRiskScoreFreeTrialAbuse"
    ) VALUES (
      ${userId}::uuid,
      ${tenancyId}::uuid,
      ${projectId},
      'main',
      NOW(),
      NOW(),
      NOW(),
      0,
      0
    )
  `;

  return { userId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const rows = await sql`
    SELECT
      "signUpAt",
      "createdAt",
      "signUpIp",
      "signUpIpTrusted",
      "signUpEmailNormalized",
      "signUpEmailBase"
    FROM "ProjectUser"
    WHERE "projectUserId" = ${ctx.userId}::uuid
  `;

  expect(rows).toHaveLength(1);
  expect(rows[0].signUpAt?.toISOString()).toBe(rows[0].createdAt?.toISOString());
  expect(rows[0].signUpIp).toBeNull();
  expect(rows[0].signUpIpTrusted).toBeNull();
  expect(rows[0].signUpEmailNormalized).toBeNull();
  expect(rows[0].signUpEmailBase).toBeNull();
};
