import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const projectUserId = randomUUID();
  const authorizationCode = `code-${randomUUID()}`;

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  await sql`
    INSERT INTO "ProjectUser" ("projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId", "createdAt", "updatedAt", "lastActiveAt")
    VALUES (${projectUserId}::uuid, ${tenancyId}::uuid, ${projectId}, 'main', NOW(), NOW(), NOW())
  `;
  await sql`
    INSERT INTO "ProjectUserAuthorizationCode" (
      "tenancyId",
      "projectUserId",
      "authorizationCode",
      "redirectUri",
      "expiresAt",
      "codeChallenge",
      "codeChallengeMethod",
      "newUser",
      "afterCallbackRedirectUrl",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${tenancyId}::uuid,
      ${projectUserId}::uuid,
      ${authorizationCode},
      'https://example.com/callback',
      NOW() + INTERVAL '10 minutes',
      'challenge',
      'S256',
      false,
      'https://example.com/after-auth',
      NOW(),
      NOW()
    )
  `;

  return { tenancyId, projectUserId, authorizationCode };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const existing = await sql`
    SELECT "grantedRefreshTokenId"
    FROM "ProjectUserAuthorizationCode"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "authorizationCode" = ${ctx.authorizationCode}
  `;
  expect(existing).toHaveLength(1);
  expect(existing[0].grantedRefreshTokenId).toBeNull();

  const grantedRefreshTokenId = randomUUID();
  await sql`
    UPDATE "ProjectUserAuthorizationCode"
    SET "grantedRefreshTokenId" = ${grantedRefreshTokenId}::uuid
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "authorizationCode" = ${ctx.authorizationCode}
  `;

  const updated = await sql`
    SELECT "grantedRefreshTokenId"
    FROM "ProjectUserAuthorizationCode"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "authorizationCode" = ${ctx.authorizationCode}
  `;
  expect(updated).toHaveLength(1);
  expect(updated[0].grantedRefreshTokenId).toBe(grantedRefreshTokenId);
};
