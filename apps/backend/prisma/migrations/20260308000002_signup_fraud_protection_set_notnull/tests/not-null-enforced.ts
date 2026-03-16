import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const postMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();

  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)`;
  await sql`INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization") VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")`;

  // signedUpAt is intentionally nullable (anonymous users have NULL until upgrade).
  // Verify that NULL is accepted for signedUpAt.
  const anonUserId = randomUUID();
  await sql`
    INSERT INTO "ProjectUser" (
      "projectUserId",
      "tenancyId",
      "mirroredProjectId",
      "mirroredBranchId",
      "createdAt",
      "updatedAt",
      "lastActiveAt",
      "signedUpAt",
      "signUpRiskScoreBot",
      "signUpRiskScoreFreeTrialAbuse",
      "isAnonymous"
    ) VALUES (
      ${anonUserId}::uuid,
      ${tenancyId}::uuid,
      ${projectId},
      'main',
      NOW(),
      NOW(),
      NOW(),
      NULL,
      0,
      0,
      true
    )
  `;

  const rows = await sql`
    SELECT "signedUpAt" FROM "ProjectUser" WHERE "projectUserId" = ${anonUserId}::uuid
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0].signedUpAt).toBeNull();
};
