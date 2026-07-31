import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const userId = randomUUID();
  const crmContactId = randomUUID();
  const conversationAId = randomUUID();
  const conversationBId = randomUUID();
  const conversationCId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Contact FK Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  await sql`
    INSERT INTO "Contact" ("tenancyId", "id", "createdAt", "updatedAt", "displayName", "shouldUpdateSequenceId")
    VALUES
      (${tenancyId}::uuid, ${userId}::uuid, NOW(), NOW(), 'User', true),
      (${tenancyId}::uuid, ${crmContactId}::uuid, NOW(), NOW(), 'CRM Only', true)
  `;
  await sql`
    INSERT INTO "ProjectUser" (
      "projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId",
      "createdAt", "updatedAt", "lastActiveAt", "displayName", "temp_contact_backfilled"
    )
    VALUES (
      ${userId}::uuid, ${tenancyId}::uuid, ${projectId}, 'main',
      NOW(), NOW(), NOW(), 'User', true
    )
  `;

  await sql`
    INSERT INTO "CommsConversation" ("tenancyId", "id", "createdAt", "updatedAt")
    VALUES
      (${tenancyId}::uuid, ${conversationAId}::uuid, NOW(), NOW()),
      (${tenancyId}::uuid, ${conversationBId}::uuid, NOW(), NOW()),
      (${tenancyId}::uuid, ${conversationCId}::uuid, NOW(), NOW())
  `;

  return { tenancyId, userId, crmContactId, conversationAId, conversationBId, conversationCId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const userChannelId = randomUUID();
  const crmChannelId = randomUUID();
  const messageId = randomUUID();
  const deletableContactId = randomUUID();
  const deletableChannelId = randomUUID();
  const deletableParticipantId = randomUUID();

  // User-backed contact cannot be merged away
  await expect(sql`
    UPDATE "Contact"
    SET "mergedIntoContactId" = ${ctx.crmContactId}::uuid, "mergedAt" = NOW()
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${ctx.userId}::uuid
  `).rejects.toThrow(/Cannot merge a user-backed contact/);

  // CRM contact can merge into user
  await sql`
    UPDATE "Contact"
    SET "mergedIntoContactId" = ${ctx.userId}::uuid, "mergedAt" = NOW()
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${ctx.crmContactId}::uuid
  `;

  const merged = await sql<{ mergedIntoContactId: string }[]>`
    SELECT "mergedIntoContactId"::text AS "mergedIntoContactId"
    FROM "Contact"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${ctx.crmContactId}::uuid
  `;
  expect(merged).toHaveLength(1);
  expect(merged[0].mergedIntoContactId).toBe(ctx.userId);

  // Cannot delete contact while user exists (RESTRICT)
  await expect(sql`
    DELETE FROM "Contact"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${ctx.userId}::uuid
  `).rejects.toThrow(/ProjectUser_contact_fkey|violates foreign key/);

  // New standalone contacts can own channels without a legacy ProjectUser.
  await sql`
    INSERT INTO "ContactChannel" (
      "tenancyId", "contactId", "id", "createdAt", "updatedAt",
      "type", "isVerified", "value", "identityScope"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${ctx.crmContactId}::uuid, ${crmChannelId}::uuid, NOW(), NOW(),
      'EMAIL', false, 'standalone@example.com', ''
    )
  `;
  await sql`
    INSERT INTO "ContactChannel" (
      "tenancyId", "contactId", "id", "createdAt", "updatedAt",
      "type", "isVerified", "value", "identityScope"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${ctx.userId}::uuid, ${userChannelId}::uuid, NOW(), NOW(),
      'EMAIL', false, 'user@example.com', ''
    )
  `;

  // Auth selections must copy identity and ownership from their channel.
  await sql`
    INSERT INTO "ProjectUserAuthContactChannel" (
      "tenancyId", "projectUserId", "contactChannelId", "createdAt", "updatedAt",
      "type", "identityScope", "value"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${ctx.userId}::uuid, ${userChannelId}::uuid, NOW(), NOW(),
      'EMAIL', '', 'user@example.com'
    )
  `;
  await expect(sql`
    INSERT INTO "ProjectUserAuthContactChannel" (
      "tenancyId", "projectUserId", "contactChannelId", "createdAt", "updatedAt",
      "type", "identityScope", "value"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${ctx.userId}::uuid, ${crmChannelId}::uuid, NOW(), NOW(),
      'EMAIL', '', 'standalone@example.com'
    )
  `).rejects.toThrow(/Auth selection must match its user-owned contact channel/);

  await sql`
    INSERT INTO "CommsMessage" (
      "tenancyId", "id", "conversationId", "createdAt", "occurredAt", "ingestedAt",
      "direction", "adapterKey", "ingestFingerprint", "payloadType", "payloadVersion", "payload"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${messageId}::uuid, ${ctx.conversationCId}::uuid, NOW(), NOW(), NOW(),
      'inbound', 'migration-test', 'fingerprint', 'email', 1, '{}'::jsonb
    )
  `;
  await expect(sql`
    INSERT INTO "CommsMessageParticipant" (
      "tenancyId", "id", "messageId", "role", "position", "contactId",
      "contactChannelId", "addressSnapshot"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, ${messageId}::uuid, 'from', 0,
      ${ctx.userId}::uuid, ${crmChannelId}::uuid, 'standalone@example.com'
    )
  `).rejects.toThrow(/Message participant contact and channel owner must match/);

  const participantId = randomUUID();
  await sql`
    INSERT INTO "CommsMessageParticipant" (
      "tenancyId", "id", "messageId", "role", "position", "contactChannelId", "addressSnapshot"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${participantId}::uuid, ${messageId}::uuid, 'from', 0,
      ${crmChannelId}::uuid, 'standalone@example.com'
    )
  `;
  await sql`
    DELETE FROM "ContactChannel"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${crmChannelId}::uuid
  `;
  const participant = await sql<{ contactId: string, contactChannelId: string | null }[]>`
    SELECT "contactId"::text AS "contactId", "contactChannelId"::text AS "contactChannelId"
    FROM "CommsMessageParticipant"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${participantId}::uuid
  `;
  expect(participant).toEqual([{
    contactId: ctx.crmContactId,
    contactChannelId: null,
  }]);

  await sql`
    INSERT INTO "Contact" ("tenancyId", "id", "createdAt", "updatedAt", "shouldUpdateSequenceId")
    VALUES (${ctx.tenancyId}::uuid, ${deletableContactId}::uuid, NOW(), NOW(), true)
  `;
  await sql`
    INSERT INTO "ContactChannel" (
      "tenancyId", "contactId", "id", "createdAt", "updatedAt",
      "type", "isVerified", "value", "identityScope"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${deletableContactId}::uuid, ${deletableChannelId}::uuid, NOW(), NOW(),
      'EMAIL', false, 'delete-me@example.com', ''
    )
  `;
  await sql`
    INSERT INTO "CommsMessageParticipant" (
      "tenancyId", "id", "messageId", "role", "position", "contactId",
      "contactChannelId", "addressSnapshot"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${deletableParticipantId}::uuid, ${messageId}::uuid, 'from', 1,
      ${deletableContactId}::uuid, ${deletableChannelId}::uuid, 'delete-me@example.com'
    )
  `;
  await sql`
    DELETE FROM "Contact"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${deletableContactId}::uuid
  `;
  const detachedParticipant = await sql<{ contactId: string | null, contactChannelId: string | null }[]>`
    SELECT "contactId"::text AS "contactId", "contactChannelId"::text AS "contactChannelId"
    FROM "CommsMessageParticipant"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${deletableParticipantId}::uuid
  `;
  expect(detachedParticipant).toEqual([{ contactId: null, contactChannelId: null }]);

  const legacyColumns = await sql<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'ProjectUser'
      AND column_name IN ('displayName', 'profileImageUrl', 'clientMetadata', 'clientReadOnlyMetadata', 'serverMetadata')
  `;
  expect(legacyColumns).toHaveLength(5);

  await sql`
    UPDATE "CommsConversation"
    SET "mergedIntoConversationId" = ${ctx.conversationBId}::uuid, "mergedAt" = NOW()
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${ctx.conversationAId}::uuid
  `;
  await expect(sql`
    UPDATE "CommsConversation"
    SET "mergedIntoConversationId" = ${ctx.conversationCId}::uuid, "mergedAt" = NOW()
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${ctx.conversationBId}::uuid
  `).rejects.toThrow(/Cannot merge a conversation that already has merged source conversations/);

  // Removing user semantics preserves the Contact and its channel while
  // clearing the nullable rolling-deploy owner projection.
  await sql`
    DELETE FROM "ProjectUser"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "projectUserId" = ${ctx.userId}::uuid
  `;
  const retainedChannels = await sql<{ contactId: string, projectUserId: string | null }[]>`
    SELECT "contactId"::text AS "contactId", "projectUserId"::text AS "projectUserId"
    FROM "ContactChannel"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "id" = ${userChannelId}::uuid
  `;
  expect(retainedChannels).toEqual([{ contactId: ctx.userId, projectUserId: null }]);
};
