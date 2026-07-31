import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const projectUserId = randomUUID();
  const contactChannelId = randomUUID();
  const otherChannelId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Retarget Channels Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  await sql`
    INSERT INTO "Contact" ("tenancyId", "id", "createdAt", "updatedAt", "displayName", "shouldUpdateSequenceId")
    VALUES (${tenancyId}::uuid, ${projectUserId}::uuid, NOW(), NOW(), 'User Contact', true)
  `;
  await sql`
    INSERT INTO "ProjectUser" (
      "projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId",
      "createdAt", "updatedAt", "lastActiveAt", "displayName", "temp_contact_backfilled"
    )
    VALUES (
      ${projectUserId}::uuid, ${tenancyId}::uuid, ${projectId}, 'main',
      NOW(), NOW(), NOW(), 'User Contact', true
    )
  `;
  // Model rows written before compatibility triggers were installed.
  await sql`ALTER TABLE "ContactChannel" DISABLE TRIGGER USER`;
  await sql`
    INSERT INTO "ContactChannel" (
      "tenancyId", "projectUserId", "id", "createdAt", "updatedAt",
      "type", "isPrimary", "usedForAuth", "isVerified", "value", "identityScope"
    )
    VALUES
      (
        ${tenancyId}::uuid, ${projectUserId}::uuid, ${contactChannelId}::uuid, NOW(), NOW(),
        'EMAIL', 'TRUE'::"BooleanTrue", 'TRUE'::"BooleanTrue", true, 'auth@example.com', ''
      ),
      (
        ${tenancyId}::uuid, ${projectUserId}::uuid, ${otherChannelId}::uuid, NOW(), NOW(),
        'EMAIL', NULL, NULL, false, 'other@example.com', ''
      )
  `;
  await sql`ALTER TABLE "ContactChannel" ENABLE TRIGGER USER`;

  return { tenancyId, projectUserId, contactChannelId, otherChannelId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const channels = await sql<{ id: string, contactId: string }[]>`
    SELECT "id", "contactId"
    FROM "ContactChannel"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
    ORDER BY "value"
  `;
  expect(channels).toHaveLength(2);
  expect(channels.every((c) => c.contactId === ctx.projectUserId)).toBe(true);

  const authRows = await sql<{ contactChannelId: string, value: string }[]>`
    SELECT "contactChannelId", "value"
    FROM "ProjectUserAuthContactChannel"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "projectUserId" = ${ctx.projectUserId}::uuid
  `;
  expect(authRows).toHaveLength(1);
  expect(authRows[0].contactChannelId).toBe(ctx.contactChannelId);
  expect(authRows[0].value).toBe("auth@example.com");

  // The compatibility cleanup trigger prevents rows deleted during the
  // backfill window from blocking the later channel FK validation.
  await sql`
    DELETE FROM "ContactChannel"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "projectUserId" = ${ctx.projectUserId}::uuid
      AND "id" = ${ctx.contactChannelId}::uuid
  `;
  const orphanedAuthRows = await sql`
    SELECT 1
    FROM "ProjectUserAuthContactChannel"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "contactChannelId" = ${ctx.contactChannelId}::uuid
  `;
  expect(orphanedAuthRows).toHaveLength(0);
};
