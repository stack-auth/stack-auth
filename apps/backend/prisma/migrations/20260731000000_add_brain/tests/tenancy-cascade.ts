import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";
import { createBrainTestTenancy } from "../test-helpers";

export const preMigration = async (sql: Sql) => {
  return await createBrainTestTenancy(sql, "Brain Cascade Test");
};

const countBrainRows = async (sql: Sql, tenancyId: string) => {
  const rows = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM "Brain" WHERE "tenancyId" = ${tenancyId}::uuid) AS "brains",
      (SELECT COUNT(*)::int FROM "BrainMessage" WHERE "tenancyId" = ${tenancyId}::uuid) AS "messages",
      (SELECT COUNT(*)::int FROM "BrainQueueItem" WHERE "tenancyId" = ${tenancyId}::uuid) AS "queueItems"
  `;
  return rows[0];
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  await sql`
    INSERT INTO "Brain" ("tenancyId", "updatedAt")
    VALUES (${ctx.tenancyId}::uuid, NOW())
  `;
  await sql`
    INSERT INTO "BrainMessage" ("tenancyId", "id", "position", "role", "content")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, 0, 'user', '{"text":"hi"}'::jsonb)
  `;
  await sql`
    INSERT INTO "BrainQueueItem" ("tenancyId", "id", "type", "payload", "updatedAt")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, 'user.signed_up', '{}'::jsonb, NOW())
  `;

  expect(await countBrainRows(sql, ctx.tenancyId)).toEqual({
    brains: 1,
    messages: 1,
    queueItems: 1,
  });

  // Project deletion cascades through Tenancy; Brain history must not outlive
  // the environment that owns it.
  await sql`DELETE FROM "Project" WHERE "id" = ${ctx.projectId}`;
  expect(await countBrainRows(sql, ctx.tenancyId)).toEqual({
    brains: 0,
    messages: 0,
    queueItems: 0,
  });
};
