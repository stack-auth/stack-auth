import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const projectUserId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Conversation Migration Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  await sql`
    INSERT INTO "ProjectUser" ("projectUserId", "tenancyId", "mirroredProjectId", "mirroredBranchId", "createdAt", "updatedAt", "lastActiveAt")
    VALUES (${projectUserId}::uuid, ${tenancyId}::uuid, ${projectId}, 'main', NOW(), NOW(), NOW())
  `;

  return { tenancyId, projectUserId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('Conversation', 'ConversationMetadata', 'ConversationChannel', 'ConversationMessage')
    ORDER BY table_name
  `;
  expect(Array.from(tables)).toMatchInlineSnapshot(`
    [
      {
        "table_name": "Conversation",
      },
      {
        "table_name": "ConversationChannel",
      },
      {
        "table_name": "ConversationMessage",
      },
      {
        "table_name": "ConversationMetadata",
      },
    ]
  `);

  const conversationId = randomUUID();
  const channelId = randomUUID();
  const messageId = randomUUID();

  await sql`
    INSERT INTO "Conversation" (
      "id",
      "tenancyId",
      "projectUserId",
      "subject",
      "status",
      "priority",
      "source",
      "createdAt",
      "updatedAt",
      "lastMessageAt"
    )
    VALUES (
      ${conversationId}::uuid,
      ${ctx.tenancyId}::uuid,
      ${ctx.projectUserId}::uuid,
      'Need support with onboarding',
      'open',
      'high',
      'chat',
      NOW(),
      NOW(),
      NOW()
    )
  `;

  await sql`
    INSERT INTO "ConversationMetadata" (
      "conversationId",
      "tenancyId",
      "assignedToUserId",
      "assignedToDisplayName",
      "tags",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${conversationId}::uuid,
      ${ctx.tenancyId}::uuid,
      'support-admin-1',
      'Support Admin',
      ${JSON.stringify(["vip", "auth"])}::jsonb,
      NOW(),
      NOW()
    )
  `;

  await sql`
    INSERT INTO "ConversationChannel" (
      "id",
      "tenancyId",
      "conversationId",
      "channelType",
      "adapterKey",
      "isEntryPoint",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${channelId}::uuid,
      ${ctx.tenancyId}::uuid,
      ${conversationId}::uuid,
      'chat',
      'support-chat',
      true,
      NOW(),
      NOW()
    )
  `;

  await sql`
    INSERT INTO "ConversationMessage" (
      "id",
      "tenancyId",
      "conversationId",
      "channelId",
      "messageType",
      "senderType",
      "senderId",
      "body",
      "attachments",
      "createdAt"
    )
    VALUES (
      ${messageId}::uuid,
      ${ctx.tenancyId}::uuid,
      ${conversationId}::uuid,
      ${channelId}::uuid,
      'message',
      'user',
      ${ctx.projectUserId},
      'The sign-in flow loops forever.',
      '[]'::jsonb,
      NOW()
    )
  `;

  const insertedConversation = await sql`
    SELECT "status", "priority", "source"
    FROM "Conversation"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${conversationId}::uuid
  `;
  expect(Array.from(insertedConversation)).toMatchInlineSnapshot(`
    [
      {
        "priority": "high",
        "source": "chat",
        "status": "open",
      },
    ]
  `);

  await expect(sql`
    INSERT INTO "Conversation" (
      "id",
      "tenancyId",
      "projectUserId",
      "subject",
      "status",
      "priority",
      "source",
      "createdAt",
      "updatedAt",
      "lastMessageAt"
    )
    VALUES (
      ${randomUUID()}::uuid,
      ${ctx.tenancyId}::uuid,
      ${ctx.projectUserId}::uuid,
      'Broken conversation row',
      'invalid',
      'high',
      'chat',
      NOW(),
      NOW(),
      NOW()
    )
  `).rejects.toThrow(/Conversation_status_check/);

  await expect(sql`
    INSERT INTO "ConversationMessage" (
      "id",
      "tenancyId",
      "conversationId",
      "messageType",
      "senderType",
      "createdAt"
    )
    VALUES (
      ${randomUUID()}::uuid,
      ${ctx.tenancyId}::uuid,
      ${conversationId}::uuid,
      'message',
      'invalid',
      NOW()
    )
  `).rejects.toThrow(/ConversationMessage_senderType_check/);
};
