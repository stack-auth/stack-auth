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
    VALUES (${projectId}, NOW(), NOW(), 'Contact Migration Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  await sql`
    INSERT INTO "ProjectUser" (
      "projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId",
      "createdAt", "updatedAt", "lastActiveAt", "displayName", "clientMetadata"
    )
    VALUES (
      ${projectUserId}::uuid, ${tenancyId}::uuid, ${projectId}, 'main',
      NOW(), NOW(), NOW(), 'Ada Lovelace', '{"role":"admin"}'::jsonb
    )
  `;
  await sql`
    INSERT INTO "ContactChannel" (
      "tenancyId", "projectUserId", "id", "createdAt", "updatedAt",
      "type", "isPrimary", "usedForAuth", "isVerified", "value"
    )
    VALUES (
      ${tenancyId}::uuid, ${projectUserId}::uuid, ${contactChannelId}::uuid, NOW(), NOW(),
      'EMAIL', 'TRUE'::"BooleanTrue", 'TRUE'::"BooleanTrue", true, 'ada@example.com'
    )
  `;

  return { tenancyId, projectUserId, contactChannelId, projectId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'Contact', 'ContactMergeOperation', 'ProjectUserAuthContactChannel',
        'CommsConversation', 'CommsMessage', 'CommsMessageParticipant',
        'CommsMessageAttachment', 'CommsMessageRelation',
        'CommsConversationOperation', 'CommsMessageAssignment',
        'CommsDelivery', 'CommsDeliveryAttempt'
      )
    ORDER BY table_name
  `;
  expect(tables.map((t) => t.table_name)).toMatchInlineSnapshot(`
    [
      "CommsConversation",
      "CommsConversationOperation",
      "CommsDelivery",
      "CommsDeliveryAttempt",
      "CommsMessage",
      "CommsMessageAssignment",
      "CommsMessageAttachment",
      "CommsMessageParticipant",
      "CommsMessageRelation",
      "Contact",
      "ContactMergeOperation",
      "ProjectUserAuthContactChannel",
    ]
  `);

  const channelCols = await sql<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ContactChannel'
      AND column_name IN ('contactId', 'identityScope', 'data', 'verifiedAt', 'metadata', 'projectUserId', 'usedForAuth')
    ORDER BY column_name
  `;
  expect(channelCols.map((c) => c.column_name)).toMatchInlineSnapshot(`
    [
      "contactId",
      "data",
      "identityScope",
      "metadata",
      "projectUserId",
      "usedForAuth",
      "verifiedAt",
    ]
  `);

  const conversationId = randomUUID();
  const messageId = randomUUID();
  await sql`
    INSERT INTO "CommsConversation" ("tenancyId", "id", "createdAt", "updatedAt", "title", "lastMessageAt")
    VALUES (${ctx.tenancyId}::uuid, ${conversationId}::uuid, NOW(), NOW(), 'Hello', NOW())
  `;
  await sql`
    INSERT INTO "CommsMessage" (
      "tenancyId", "id", "conversationId", "occurredAt", "ingestedAt", "createdAt",
      "direction", "adapterKey", "ingestFingerprint", "payloadType", "payloadVersion", "payload"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${messageId}::uuid, ${conversationId}::uuid, NOW(), NOW(), NOW(),
      'inbound', 'email:resend', 'test-fingerprint', 'email', 1,
      ${JSON.stringify({ type: "email", version: 1, subject: "Hi", textBody: "Hello", htmlBody: null, ampHtmlBody: null, headers: [] })}::jsonb
    )
  `;

  await expect(sql`
    INSERT INTO "CommsMessage" (
      "tenancyId", "id", "conversationId", "occurredAt", "ingestedAt", "createdAt",
      "direction", "adapterKey", "ingestFingerprint", "payloadType", "payloadVersion", "payload"
    )
    VALUES (
      ${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, ${conversationId}::uuid, NOW(), NOW(), NOW(),
      'sideways', 'email:resend', 'test-fingerprint', 'email', 1, '{}'::jsonb
    )
  `).rejects.toThrow(/CommsMessage_direction_check/);

  const userStillExists = await sql`
    SELECT "displayName" FROM "ProjectUser"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid AND "projectUserId" = ${ctx.projectUserId}::uuid
  `;
  expect(userStillExists).toHaveLength(1);
  expect(userStillExists[0].displayName).toBe("Ada Lovelace");
};
