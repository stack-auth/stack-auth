import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";
import { createBrainTestTenancy } from "../test-helpers";

export const preMigration = async (sql: Sql) => {
  return await createBrainTestTenancy(sql, "Brain Singleton Test");
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  await sql`
    INSERT INTO "Brain" ("tenancyId", "updatedAt")
    VALUES (${ctx.tenancyId}::uuid, NOW())
  `;

  // Tenancy PK is the singleton: a second insert for the same tenancy fails.
  await expect(sql`
    INSERT INTO "Brain" ("tenancyId", "updatedAt")
    VALUES (${ctx.tenancyId}::uuid, NOW())
  `).rejects.toThrow();

  const messageId = randomUUID();
  await sql`
    INSERT INTO "BrainMessage" ("tenancyId", "id", "position", "role", "content", "idempotencyKey")
    VALUES (${ctx.tenancyId}::uuid, ${messageId}::uuid, 0, 'user', '{"text":"a"}'::jsonb, 'msg-key-1')
  `;

  // Position uniqueness.
  await expect(sql`
    INSERT INTO "BrainMessage" ("tenancyId", "id", "position", "role", "content")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, 0, 'assistant', '{"text":"b"}'::jsonb)
  `).rejects.toThrow();

  // Idempotency-key uniqueness (partial index).
  await expect(sql`
    INSERT INTO "BrainMessage" ("tenancyId", "id", "position", "role", "content", "idempotencyKey")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, 1, 'user', '{"text":"c"}'::jsonb, 'msg-key-1')
  `).rejects.toThrow();

  // NULL idempotency keys are allowed to collide (partial unique index).
  await sql`
    INSERT INTO "BrainMessage" ("tenancyId", "id", "position", "role", "content")
    VALUES
      (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, 1, 'assistant', '{"text":"d"}'::jsonb),
      (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, 2, 'assistant', '{"text":"e"}'::jsonb)
  `;

  await sql`
    INSERT INTO "BrainQueueItem" ("tenancyId", "id", "type", "payload", "idempotencyKey", "updatedAt")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, 'email.sent', '{}'::jsonb, 'queue-key-1', NOW())
  `;
  await expect(sql`
    INSERT INTO "BrainQueueItem" ("tenancyId", "id", "type", "payload", "idempotencyKey", "updatedAt")
    VALUES (${ctx.tenancyId}::uuid, ${randomUUID()}::uuid, 'email.sent', '{}'::jsonb, 'queue-key-1', NOW())
  `).rejects.toThrow();

  // Visibility default.
  const [row] = await sql`
    SELECT "visibility" FROM "BrainMessage" WHERE "id" = ${messageId}::uuid
  `;
  expect(row.visibility).toBe("visible");
};
