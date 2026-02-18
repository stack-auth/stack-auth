import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const dedupKey = `dedup-${randomUUID()}`;
  const fulfilledKey = `fulfilled-${randomUUID()}`;

  // Pending request
  await sql`INSERT INTO "OutgoingRequest" ("id", "deduplicationKey", "qstashOptions") VALUES (${randomUUID()}::uuid, ${dedupKey}, '{"url":"http://test"}'::jsonb)`;

  // Fulfilled request with a different key
  await sql`INSERT INTO "OutgoingRequest" ("id", "deduplicationKey", "qstashOptions", "startedFulfillingAt") VALUES (${randomUUID()}::uuid, ${fulfilledKey}, '{"url":"http://test"}'::jsonb, NOW())`;

  return { dedupKey, fulfilledKey };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  // Duplicate pending requests should still be rejected
  await expect(sql`
    INSERT INTO "OutgoingRequest" ("id", "deduplicationKey", "qstashOptions") VALUES (${randomUUID()}::uuid, ${ctx.dedupKey}, '{"url":"http://test2"}'::jsonb)
  `).rejects.toThrow(/OutgoingRequest_deduplicationKey_pending_key/);

  // Fulfill the original pending request
  await sql`UPDATE "OutgoingRequest" SET "startedFulfillingAt" = NOW() WHERE "deduplicationKey" = ${ctx.dedupKey}`;

  // Now we CAN insert a new pending request with the same dedup key
  await sql`INSERT INTO "OutgoingRequest" ("id", "deduplicationKey", "qstashOptions") VALUES (${randomUUID()}::uuid, ${ctx.dedupKey}, '{"url":"http://test3"}'::jsonb)`;

  // Fulfilled requests can share dedup keys freely
  await sql`INSERT INTO "OutgoingRequest" ("id", "deduplicationKey", "qstashOptions", "startedFulfillingAt") VALUES (${randomUUID()}::uuid, ${ctx.fulfilledKey}, '{"url":"http://test4"}'::jsonb, NOW())`;

  const pending = await sql`SELECT COUNT(*) as count FROM "OutgoingRequest" WHERE "deduplicationKey" = ${ctx.dedupKey} AND "startedFulfillingAt" IS NULL`;
  expect(Number(pending[0].count)).toBe(1);

  const fulfilled = await sql`SELECT COUNT(*) as count FROM "OutgoingRequest" WHERE "deduplicationKey" = ${ctx.dedupKey} AND "startedFulfillingAt" IS NOT NULL`;
  expect(Number(fulfilled[0].count)).toBe(1);
};
