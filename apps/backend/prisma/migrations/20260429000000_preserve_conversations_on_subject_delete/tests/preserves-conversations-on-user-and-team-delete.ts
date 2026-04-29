import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  const projectUserId = randomUUID();
  const teamId = randomUUID();
  const userConversationId = randomUUID();
  const teamConversationId = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Conversation Delete Test', '', false)
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
  await sql`
    INSERT INTO "Conversation" (
      "id",
      "tenancyId",
      "projectUserId",
      "teamId",
      "subject",
      "status",
      "priority",
      "source",
      "createdAt",
      "updatedAt",
      "lastMessageAt"
    )
    VALUES
      (
        ${userConversationId}::uuid,
        ${tenancyId}::uuid,
        ${projectUserId}::uuid,
        NULL,
        'User conversation',
        'open',
        'normal',
        'chat',
        NOW(),
        NOW(),
        NOW()
      ),
      (
        ${teamConversationId}::uuid,
        ${tenancyId}::uuid,
        NULL,
        ${teamId}::uuid,
        'Team conversation',
        'open',
        'normal',
        'chat',
        NOW(),
        NOW(),
        NOW()
      )
  `;

  return { tenancyId, projectUserId, teamId, userConversationId, teamConversationId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  await sql`
    DELETE FROM "ProjectUser"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "projectUserId" = ${ctx.projectUserId}::uuid
  `;

  const userConversationRows = await sql`
    SELECT "projectUserId", "tenancyId"
    FROM "Conversation"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${ctx.userConversationId}::uuid
  `;
  expect(userConversationRows).toHaveLength(1);
  expect(userConversationRows[0].projectUserId).toBeNull();
  expect(userConversationRows[0].tenancyId).toBe(ctx.tenancyId);

  await sql`
    DELETE FROM "Team"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "teamId" = ${ctx.teamId}::uuid
  `;

  const teamConversationRows = await sql`
    SELECT "teamId", "tenancyId"
    FROM "Conversation"
    WHERE "tenancyId" = ${ctx.tenancyId}::uuid
      AND "id" = ${ctx.teamConversationId}::uuid
  `;
  expect(teamConversationRows).toHaveLength(1);
  expect(teamConversationRows[0].teamId).toBeNull();
  expect(teamConversationRows[0].tenancyId).toBe(ctx.tenancyId);
};
