import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const projectUserId = randomUUID();
  const contactChannelId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Rolling Compatibility Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;

  // Simulate an old application instance: it only writes legacy ProjectUser
  // profile fields and legacy ContactChannel ownership/auth fields.
  await sql`
    INSERT INTO "ProjectUser" (
      "projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId",
      "createdAt", "updatedAt", "lastActiveAt", "displayName", "clientMetadata"
    )
    VALUES (
      ${projectUserId}::uuid, ${tenancyId}::uuid, ${projectId}, 'main',
      NOW(), NOW(), NOW(), 'Legacy Writer', '{"source":"legacy"}'::jsonb
    )
  `;
  await sql`
    INSERT INTO "ContactChannel" (
      "tenancyId", "projectUserId", "id", "createdAt", "updatedAt",
      "type", "usedForAuth", "isVerified", "value", "identityScope"
    )
    VALUES (
      ${tenancyId}::uuid, ${projectUserId}::uuid, ${contactChannelId}::uuid, NOW(), NOW(),
      'EMAIL', 'TRUE'::"BooleanTrue", true, 'rolling@example.com', ''
    )
  `;

  return { tenancyId, projectUserId, contactChannelId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const constraints = await sql<{ convalidated: boolean }[]>`
    SELECT convalidated
    FROM pg_constraint
    WHERE conname = 'ProjectUser_contact_fkey'
  `;
  expect(constraints).toEqual([{ convalidated: true }]);

  const contact = await sql<{ displayName: string, clientMetadata: unknown }[]>`
    SELECT "displayName", "clientMetadata"
    FROM "Contact"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${ctx.projectUserId}::uuid
  `;
  expect(contact).toEqual([{
    displayName: "Legacy Writer",
    clientMetadata: { source: "legacy" },
  }]);

  const channel = await sql<{ contactId: string }[]>`
    SELECT "contactId"::text AS "contactId"
    FROM "ContactChannel"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${ctx.contactChannelId}::uuid
  `;
  expect(channel).toEqual([{ contactId: ctx.projectUserId }]);

  const authRows = await sql`
    SELECT 1
    FROM "ProjectUserAuthContactChannel"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "projectUserId" = ${ctx.projectUserId}::uuid
      AND "contactChannelId" = ${ctx.contactChannelId}::uuid
  `;
  expect(authRows).toHaveLength(1);

  // Simulate a new application instance and verify old instances see its writes.
  await sql`
    UPDATE "ProjectUser"
    SET "shouldUpdateSequenceId" = false
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "projectUserId" = ${ctx.projectUserId}::uuid
  `;
  await sql`
    UPDATE "Contact"
    SET "displayName" = 'New Writer'
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${ctx.projectUserId}::uuid
  `;
  const legacyUser = await sql<{ displayName: string, shouldUpdateSequenceId: boolean }[]>`
    SELECT "displayName", "shouldUpdateSequenceId"
    FROM "ProjectUser"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "projectUserId" = ${ctx.projectUserId}::uuid
  `;
  expect(legacyUser).toEqual([{ displayName: "New Writer", shouldUpdateSequenceId: true }]);

  await sql`
    UPDATE "ContactChannel"
    SET "shouldUpdateSequenceId" = false
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${ctx.contactChannelId}::uuid
  `;
  await sql`
    DELETE FROM "ProjectUserAuthContactChannel"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "projectUserId" = ${ctx.projectUserId}::uuid
      AND "contactChannelId" = ${ctx.contactChannelId}::uuid
  `;
  const legacyChannel = await sql<{ usedForAuth: string | null, shouldUpdateSequenceId: boolean }[]>`
    SELECT "usedForAuth"::text AS "usedForAuth", "shouldUpdateSequenceId"
    FROM "ContactChannel"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${ctx.contactChannelId}::uuid
  `;
  expect(legacyChannel).toEqual([{ usedForAuth: null, shouldUpdateSequenceId: true }]);

  // Legacy profile updates still propagate after the original backfill.
  await sql`
    UPDATE "Contact"
    SET "shouldUpdateSequenceId" = false
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${ctx.projectUserId}::uuid
  `;
  await sql`
    UPDATE "ProjectUser"
    SET "displayName" = 'Legacy Writer Again'
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "projectUserId" = ${ctx.projectUserId}::uuid
  `;
  const legacyUpdatedContact = await sql<{ displayName: string, shouldUpdateSequenceId: boolean }[]>`
    SELECT "displayName", "shouldUpdateSequenceId"
    FROM "Contact"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${ctx.projectUserId}::uuid
  `;
  expect(legacyUpdatedContact).toEqual([{
    displayName: "Legacy Writer Again",
    shouldUpdateSequenceId: true,
  }]);

  const newUserId = randomUUID();
  await sql`
    INSERT INTO "Contact" (
      "tenancyId", "id", "createdAt", "updatedAt", "displayName", "shouldUpdateSequenceId"
    )
    VALUES (${ctx.tenancyId}::uuid, ${newUserId}::uuid, NOW(), NOW(), 'Contact First', true)
  `;
  const contactFirstChannelId = randomUUID();
  await sql`
    INSERT INTO "ContactChannel" (
      "tenancyId", "contactId", "id", "createdAt", "updatedAt",
      "type", "isVerified", "value", "identityScope"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${newUserId}::uuid, ${contactFirstChannelId}::uuid, NOW(), NOW(),
      'EMAIL', false, 'contact-first@example.com', ''
    )
  `;
  await sql`
    INSERT INTO "ProjectUser" (
      "projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId",
      "createdAt", "updatedAt", "lastActiveAt"
    )
    SELECT
      ${newUserId}::uuid, ${ctx.tenancyId}::uuid, "projectId", "branchId", NOW(), NOW(), NOW()
    FROM "Tenancy"
    WHERE "id" = ${ctx.tenancyId}::uuid
  `;
  const contactFirstUser = await sql<{ displayName: string | null }[]>`
    SELECT "displayName"
    FROM "ProjectUser"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "projectUserId" = ${newUserId}::uuid
  `;
  expect(contactFirstUser).toEqual([{ displayName: "Contact First" }]);

  const contactFirstChannel = await sql<{ projectUserId: string | null, shouldUpdateSequenceId: boolean }[]>`
    SELECT "projectUserId"::text AS "projectUserId", "shouldUpdateSequenceId"
    FROM "ContactChannel"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${contactFirstChannelId}::uuid
  `;
  expect(contactFirstChannel).toEqual([{
    projectUserId: newUserId,
    shouldUpdateSequenceId: true,
  }]);

  await expect(sql`
    INSERT INTO "ContactChannel" (
      "tenancyId", "contactId", "projectUserId", "id", "createdAt", "updatedAt",
      "type", "isVerified", "value", "identityScope"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${newUserId}::uuid, ${ctx.projectUserId}::uuid, ${randomUUID()}::uuid,
      NOW(), NOW(), 'EMAIL', false, 'mismatched@example.com', ''
    )
  `).rejects.toThrow(/must identify the same user-backed contact/);

  await sql`
    DELETE FROM "ProjectUser"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "projectUserId" = ${ctx.projectUserId}::uuid
  `;
  const preservedChannels = await sql`
    SELECT 1
    FROM "ContactChannel"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${ctx.contactChannelId}::uuid
  `;
  expect(preservedChannels).toHaveLength(1);
};
