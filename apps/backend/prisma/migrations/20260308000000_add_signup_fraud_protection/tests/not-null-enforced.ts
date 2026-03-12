import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const postMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")`;

  const explicitNullUserId = randomUUID();
  await expect(sql`
    INSERT INTO "ProjectUser" (
      "projectUserId",
      "tenancyId",
      "mirroredProjectId",
      "mirroredBranchId",
      "createdAt",
      "updatedAt",
      "lastActiveAt",
      "signUpAt",
      "signUpRiskScoreBot",
      "signUpRiskScoreFreeTrialAbuse"
    ) VALUES (
      ${explicitNullUserId}::uuid,
      ${tenancyId}::uuid,
      ${projectId},
      'main',
      NOW(),
      NOW(),
      NOW(),
      NULL,
      0,
      0
    )
  `).rejects.toThrow(/not-null/i);

  const omittedUserId = randomUUID();
  await expect(sql`
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
      ${omittedUserId}::uuid,
      ${tenancyId}::uuid,
      ${projectId},
      'main',
      NOW(),
      NOW(),
      NOW(),
      0,
      0
    )
  `).rejects.toThrow(/not-null/i);
};
