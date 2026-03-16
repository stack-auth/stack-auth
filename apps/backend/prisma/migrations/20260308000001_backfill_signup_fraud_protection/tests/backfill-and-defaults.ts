import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const regularUserId = randomUUID();
  const anonUserId = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")`;

  // Regular (non-anonymous) user
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

  // Anonymous user
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

  return { projectId, tenancyId, regularUserId, anonUserId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  // Regular user: signedUpAt should be backfilled from createdAt
  const regularRows = await sql`
    SELECT
      "signedUpAt",
      "createdAt",
      "signUpRiskScoreBot",
      "signUpRiskScoreFreeTrialAbuse"
    FROM "ProjectUser"
    WHERE "projectUserId" = ${ctx.regularUserId}::uuid
  `;

  expect(regularRows).toHaveLength(1);
  expect(regularRows[0].signedUpAt.toISOString()).toBe(regularRows[0].createdAt.toISOString());
  expect(regularRows[0].signUpRiskScoreBot).toBe(0);
  expect(regularRows[0].signUpRiskScoreFreeTrialAbuse).toBe(0);

  // Anonymous user: signedUpAt should remain NULL
  const anonRows = await sql`
    SELECT
      "signedUpAt",
      "signUpRiskScoreBot",
      "signUpRiskScoreFreeTrialAbuse"
    FROM "ProjectUser"
    WHERE "projectUserId" = ${ctx.anonUserId}::uuid
  `;

  expect(anonRows).toHaveLength(1);
  expect(anonRows[0].signedUpAt).toBeNull();
  expect(anonRows[0].signUpRiskScoreBot).toBe(0);
  expect(anonRows[0].signUpRiskScoreFreeTrialAbuse).toBe(0);
};
