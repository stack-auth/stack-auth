import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const projectUserId = randomUUID();
  const teamId = randomUUID();

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
  await sql`
    INSERT INTO "Team" ("teamId", "tenancyId", "mirroredProjectId", "mirroredBranchId", "createdAt", "updatedAt", "displayName")
    VALUES (${teamId}::uuid, ${tenancyId}::uuid, ${projectId}, 'main', NOW(), NOW(), 'Conversation Team')
  `;

  return { tenancyId, projectUserId, teamId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('Conversation', 'ConversationEntryPoint', 'ConversationMessage')
    ORDER BY table_name
  `;
  expect(Array.from(tables)).toMatchInlineSnapshot(`
    [
      {
        "table_name": "Conversation",
      },
      {
        "table_name": "ConversationEntryPoint",
      },
      {
        "table_name": "ConversationMessage",
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
      "assignedToUserId",
      "assignedToDisplayName",
      "tags",
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
      'support-admin-1',
      'Support Admin',
      ${JSON.stringify(["vip", "auth"])}::jsonb,
      NOW(),
      NOW(),
      NOW()
    )
  `;

  await sql`
    INSERT INTO "ConversationEntryPoint" (
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
      'Broken conversation priority',
      'open',
      'invalid',
      'chat',
      NOW(),
      NOW(),
      NOW()
    )
  `).rejects.toThrow(/Conversation_priority_check/);

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
      'Broken conversation source',
      'open',
      'high',
      'invalid',
      NOW(),
      NOW(),
      NOW()
    )
  `).rejects.toThrow(/Conversation_source_check/);

  await expect(sql`
    INSERT INTO "ConversationEntryPoint" (
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
      ${randomUUID()}::uuid,
      ${ctx.tenancyId}::uuid,
      ${conversationId}::uuid,
      'invalid',
      'support-chat',
      true,
      NOW(),
      NOW()
    )
  `).rejects.toThrow(/ConversationEntryPoint_type_check/);

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
      'invalid',
      'user',
      NOW()
    )
  `).rejects.toThrow(/ConversationMessage_messageType_check/);

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

  await sql`
    DELETE FROM "ProjectUser"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "projectUserId" = ${ctx.projectUserId}::uuid
  `;

  const userConversationRows = await sql`
    SELECT "projectUserId"
    FROM "Conversation"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${conversationId}::uuid
  `;
  expect(userConversationRows).toHaveLength(1);
  expect(userConversationRows[0].projectUserId).toBe(ctx.projectUserId);

  const teamConversationId = randomUUID();
  await sql`
    INSERT INTO "Conversation" (
      "id",
      "tenancyId",
      "teamId",
      "subject",
      "status",
      "priority",
      "source",
      "createdAt",
      "updatedAt",
      "lastMessageAt"
    )
    VALUES (
      ${teamConversationId}::uuid,
      ${ctx.tenancyId}::uuid,
      ${ctx.teamId}::uuid,
      'Team conversation',
      'open',
      'normal',
      'chat',
      NOW(),
      NOW(),
      NOW()
    )
  `;

  await sql`
    DELETE FROM "Team"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "teamId" = ${ctx.teamId}::uuid
  `;

  const teamConversationRows = await sql`
    SELECT "teamId"
    FROM "Conversation"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${teamConversationId}::uuid
  `;
  expect(teamConversationRows).toHaveLength(1);
  expect(teamConversationRows[0].teamId).toBe(ctx.teamId);
};
