import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

const insertSubscription = async (sql: Sql, options: {
  tenancyId: string,
  status: string,
  currentPeriodEnd: Date,
  endedAt?: Date | null,
}) => {
  const id = randomUUID();
  await sql`
    INSERT INTO "Subscription" (
      "id", "tenancyId", "customerId", "customerType", "product", "quantity",
      "stripeSubscriptionId", "status", "currentPeriodStart", "currentPeriodEnd",
      "cancelAtPeriodEnd", "endedAt", "creationSource", "createdAt", "updatedAt"
    ) VALUES (
      ${id}::uuid, ${options.tenancyId}::uuid, ${`customer-${id}`}, 'TEAM',
      ${sql.json({ displayName: 'Test Product', customerType: 'team' })}, 1,
      ${`sub_${id}`}, ${options.status}::"SubscriptionStatus",
      '2026-01-01', ${options.currentPeriodEnd},
      false, ${options.endedAt ?? null}, 'PURCHASE_PAGE', NOW(), NOW()
    )
  `;
  return id;
};

export const preMigration = async (sql: Sql) => {
  const tenancyId = randomUUID();
  const pastPeriodEnd = new Date('2026-02-01T00:00:00Z');

  // One row per terminal status, all with null endedAt and a past period end.
  const canceledId = await insertSubscription(sql, { tenancyId, status: 'canceled', currentPeriodEnd: pastPeriodEnd });
  const incompleteExpiredId = await insertSubscription(sql, { tenancyId, status: 'incomplete_expired', currentPeriodEnd: pastPeriodEnd });
  const unpaidId = await insertSubscription(sql, { tenancyId, status: 'unpaid', currentPeriodEnd: pastPeriodEnd });

  // Terminal row whose period end is in the future: endedAt must be capped at
  // the migration's NOW() (matching getEndedAtForSync's last-resort fallback),
  // not scheduled for the future.
  const futurePeriodEnd = new Date('2100-01-01T00:00:00Z');
  const futureCanceledId = await insertSubscription(sql, { tenancyId, status: 'canceled', currentPeriodEnd: futurePeriodEnd });

  // The DB's own clock, so the post-migration bound check compares
  // apples-to-apples (the Subscription timestamp columns have no time zone,
  // so JS-side Date comparisons would be off by the session's tz offset).
  const [{ now: dbNowBeforeMigration }] = await sql`SELECT NOW() AS now`;

  return { tenancyId, canceledId, incompleteExpiredId, unpaidId, futureCanceledId, dbNowBeforeMigration: dbNowBeforeMigration as Date };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  // Compare in SQL so stored values never round-trip through JS Dates.
  const rows = await sql`
    SELECT
      "id",
      ("endedAt" IS NOT NULL) AS "hasEndedAt",
      ("endedAt" = "currentPeriodEnd") AS "matchesPeriodEnd",
      ("endedAt" >= ${ctx.dbNowBeforeMigration} AND "endedAt" <= NOW() AND "endedAt" < "currentPeriodEnd") AS "cappedAtNow"
    FROM "Subscription" WHERE "tenancyId" = ${ctx.tenancyId}::uuid
  `;
  const byId = new Map(rows.map((row) => [row.id, row]));

  // Past period end: backfilled to exactly currentPeriodEnd.
  for (const id of [ctx.canceledId, ctx.incompleteExpiredId, ctx.unpaidId]) {
    expect(byId.get(id)?.hasEndedAt).toBe(true);
    expect(byId.get(id)?.matchesPeriodEnd).toBe(true);
  }

  // Future period end: capped at the migration's NOW(), not scheduled for 2100.
  expect(byId.get(ctx.futureCanceledId)?.hasEndedAt).toBe(true);
  expect(byId.get(ctx.futureCanceledId)?.cappedAtNow).toBe(true);
};
