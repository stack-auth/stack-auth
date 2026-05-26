import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const projectUserId = randomUUID();
  const oauthAccountId = randomUUID();

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
    INSERT INTO "ProjectUserOAuthAccount" (
      "id",
      "tenancyId",
      "projectUserId",
      "configOAuthProviderId",
      "providerAccountId",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${oauthAccountId}::uuid,
      ${tenancyId}::uuid,
      ${projectUserId}::uuid,
      'github',
      'github-account',
      NOW(),
      NOW()
    )
  `;

  return { tenancyId, oauthAccountId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const columnRows = await sql`
    SELECT is_nullable, data_type
    FROM information_schema.columns
    WHERE table_name = 'OAuthAccessToken'
      AND column_name = 'expiresAt'
  `;
  expect(columnRows).toHaveLength(1);
  expect(columnRows[0].is_nullable).toBe("YES");
  expect(columnRows[0].data_type).toBe("timestamp without time zone");

  await sql`
    INSERT INTO "OAuthAccessToken" (
      "id",
      "tenancyId",
      "oauthAccountId",
      "accessToken",
      "scopes",
      "expiresAt"
    )
    VALUES (
      ${randomUUID()}::uuid,
      ${ctx.tenancyId}::uuid,
      ${ctx.oauthAccountId}::uuid,
      'github-access-token-without-expiry',
      ARRAY['user:email']::text[],
      NULL
    )
  `;

  const tokenRows = await sql`
    SELECT "expiresAt"
    FROM "OAuthAccessToken"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "oauthAccountId" = ${ctx.oauthAccountId}::uuid
      AND "accessToken" = 'github-access-token-without-expiry'
  `;
  expect(tokenRows).toHaveLength(1);
  expect(tokenRows[0].expiresAt).toBeNull();
};
