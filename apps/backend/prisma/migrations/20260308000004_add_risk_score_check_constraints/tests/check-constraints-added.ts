import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const postMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")`;

  // Should reject bot score > 100
  await expect(sql`
    INSERT INTO "ProjectUser" (
      "projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId",
      "createdAt", "updatedAt", "lastActiveAt",
      "signedUpAt", "signUpRiskScoreBot", "signUpRiskScoreFreeTrialAbuse"
    ) VALUES (
      ${randomUUID()}::uuid, ${tenancyId}::uuid, ${projectId}, 'main',
      NOW(), NOW(), NOW(),
      NOW(), 101, 0
    )
  `).rejects.toThrow(/check/i);

  // Should reject bot score < 0
  await expect(sql`
    INSERT INTO "ProjectUser" (
      "projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId",
      "createdAt", "updatedAt", "lastActiveAt",
      "signedUpAt", "signUpRiskScoreBot", "signUpRiskScoreFreeTrialAbuse"
    ) VALUES (
      ${randomUUID()}::uuid, ${tenancyId}::uuid, ${projectId}, 'main',
      NOW(), NOW(), NOW(),
      NOW(), -1, 0
    )
  `).rejects.toThrow(/check/i);

  // Should reject free trial abuse score > 100
  await expect(sql`
    INSERT INTO "ProjectUser" (
      "projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId",
      "createdAt", "updatedAt", "lastActiveAt",
      "signedUpAt", "signUpRiskScoreBot", "signUpRiskScoreFreeTrialAbuse"
    ) VALUES (
      ${randomUUID()}::uuid, ${tenancyId}::uuid, ${projectId}, 'main',
      NOW(), NOW(), NOW(),
      NOW(), 0, 101
    )
  `).rejects.toThrow(/check/i);

  // Should accept valid scores (0 and 100 at boundaries)
  const validUserId = randomUUID();
  await sql`
    INSERT INTO "ProjectUser" (
      "projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId",
      "createdAt", "updatedAt", "lastActiveAt",
      "signedUpAt", "signUpRiskScoreBot", "signUpRiskScoreFreeTrialAbuse"
    ) VALUES (
      ${validUserId}::uuid, ${tenancyId}::uuid, ${projectId}, 'main',
      NOW(), NOW(), NOW(),
      NOW(), 0, 100
    )
  `;

  const rows = await sql`
    SELECT "signUpRiskScoreBot", "signUpRiskScoreFreeTrialAbuse"
    FROM "ProjectUser"
    WHERE "projectUserId" = ${validUserId}::uuid
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0].signUpRiskScoreBot).toBe(0);
  expect(rows[0].signUpRiskScoreFreeTrialAbuse).toBe(100);
};
