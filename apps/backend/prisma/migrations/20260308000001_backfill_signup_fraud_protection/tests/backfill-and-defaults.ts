import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const regularUserId = randomUUID();
  const anonUserId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  await sql`
    INSERT INTO "ProjectUser" (
      "projectUserId",
      "tenancyId",
      "mirroredProjectId",
      "mirroredBranchId",
      "createdAt",
      "updatedAt",
      "lastActiveAt"
    ) VALUES (
      ${regularUserId}::uuid,
      ${tenancyId}::uuid,
      ${projectId},
      'main',
      NOW(),
      NOW(),
      NOW()
    )
  `;
  await sql`
    INSERT INTO "ProjectUser" (
      "projectUserId",
      "tenancyId",
      "mirroredProjectId",
      "mirroredBranchId",
      "createdAt",
      "updatedAt",
      "lastActiveAt",
      "isAnonymous"
    ) VALUES (
      ${anonUserId}::uuid,
      ${tenancyId}::uuid,
      ${projectId},
      'main',
      NOW(),
      NOW(),
      NOW(),
      true
    )
  `;

  return { regularUserId, anonUserId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  for (const userId of [ctx.regularUserId, ctx.anonUserId]) {
    const rows = await sql`
      SELECT "signedUpAt", "createdAt", "signUpRiskScoreBot", "signUpRiskScoreFreeTrialAbuse"
      FROM "ProjectUser"
      WHERE "projectUserId" = ${userId}::uuid
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0].signedUpAt.toISOString()).toBe(rows[0].createdAt.toISOString());
    expect(rows[0].signUpRiskScoreBot).toBe(0);
    expect(rows[0].signUpRiskScoreFreeTrialAbuse).toBe(0);
  }
};
