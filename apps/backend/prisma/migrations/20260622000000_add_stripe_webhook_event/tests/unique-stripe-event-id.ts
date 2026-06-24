import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  // Table does not exist before the migration, so nothing to seed.
  return {};
};

export const postMigration = async (sql: Sql) => {
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'StripeWebhookEvent'
  `;
  expect(Array.from(tables)).toMatchInlineSnapshot(`
    [
      {
        "table_name": "StripeWebhookEvent",
      },
    ]
  `);

  const eventId = `evt_${randomUUID()}`;

  await sql`
    INSERT INTO "StripeWebhookEvent" ("id", "stripeEventId", "eventType", "payload", "updatedAt")
    VALUES (${randomUUID()}::uuid, ${eventId}, 'invoice.payment_succeeded', '{"id":"evt"}'::jsonb, NOW())
  `;

  // Status defaults to PENDING.
  const inserted = await sql`
    SELECT "status" FROM "StripeWebhookEvent" WHERE "stripeEventId" = ${eventId}
  `;
  expect(Array.from(inserted)).toMatchInlineSnapshot(`
    [
      {
        "status": "PENDING",
      },
    ]
  `);

  // The same Stripe event id cannot be inserted twice (idempotency guarantee).
  await expect(sql`
    INSERT INTO "StripeWebhookEvent" ("id", "stripeEventId", "eventType", "payload", "updatedAt")
    VALUES (${randomUUID()}::uuid, ${eventId}, 'invoice.payment_succeeded', '{"id":"evt2"}'::jsonb, NOW())
  `).rejects.toThrow(/StripeWebhookEvent_stripeEventId_key/);

  // A different event id is fine, and the status enum rejects invalid values.
  await sql`
    INSERT INTO "StripeWebhookEvent" ("id", "stripeEventId", "eventType", "payload", "status", "updatedAt")
    VALUES (${randomUUID()}::uuid, ${`evt_${randomUUID()}`}, 'invoice.paid', '{}'::jsonb, 'PROCESSED', NOW())
  `;

  await expect(sql`
    INSERT INTO "StripeWebhookEvent" ("id", "stripeEventId", "eventType", "payload", "status", "updatedAt")
    VALUES (${randomUUID()}::uuid, ${`evt_${randomUUID()}`}, 'invoice.paid', '{}'::jsonb, 'NOT_A_STATUS', NOW())
  `).rejects.toThrow();
};
