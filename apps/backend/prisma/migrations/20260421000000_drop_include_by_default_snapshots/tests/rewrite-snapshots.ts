import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

/**
 * Migration-level test for `20260421000000_drop_include_by_default_snapshots`.
 *
 * The migration's job is to rewrite historical product JSON snapshots in
 * three tables (`Subscription`, `OneTimePurchase`, `ProductVersion`) so that
 * the legacy `"include-by-default"` price sentinel is replaced with an empty
 * price record, and any missing `includedItems` field is filled in with `{}`
 * (downstream readers like `mapProductSnapshotToInlineProduct` assume both
 * fields exist as records).
 *
 * Edge cases covered:
 *  1. `Subscription`: sentinel + missing `includedItems` → prices `{}`, items `{}`.
 *  2. `Subscription`: sentinel + existing `includedItems` → items preserved.
 *  3. `Subscription`: NO sentinel (real prices) → row untouched.
 *  4. `OneTimePurchase`: sentinel → migrated identically to Subscription.
 *  5. `ProductVersion`: sentinel (in `productJson` not `product`) → migrated.
 *
 * `tenancyId` on these tables is a UUID column without an enforced FK to
 * `Tenancy`, so we can use random UUIDs without seeding the parent rows.
 */

type Ctx = {
  // Subscription IDs
  subSentinelMissingItemsId: string,
  subSentinelWithItemsId: string,
  subRealPricesId: string,
  subSentinelMissingItemsTenancy: string,
  subSentinelWithItemsTenancy: string,
  subRealPricesTenancy: string,
  // OneTimePurchase
  otpId: string,
  otpTenancy: string,
  // ProductVersion
  pvProductVersionId: string,
  pvTenancy: string,
};

export const preMigration = async (sql: Sql): Promise<Ctx> => {
  const ctx: Ctx = {
    subSentinelMissingItemsId: randomUUID(),
    subSentinelWithItemsId: randomUUID(),
    subRealPricesId: randomUUID(),
    subSentinelMissingItemsTenancy: randomUUID(),
    subSentinelWithItemsTenancy: randomUUID(),
    subRealPricesTenancy: randomUUID(),
    otpId: randomUUID(),
    otpTenancy: randomUUID(),
    pvProductVersionId: `pv-${randomUUID()}`,
    pvTenancy: randomUUID(),
  };

  // Case 1: Subscription with sentinel + no includedItems field at all.
  // `updatedAt` must be set explicitly — Prisma's `@updatedAt` annotation is
  // client-side, raw SQL inserts skip it and the column is NOT NULL.
  await sql`
    INSERT INTO "Subscription" (
      "id", "tenancyId", "customerId", "customerType",
      "productId", "priceId", "product", "quantity",
      "status", "currentPeriodStart", "currentPeriodEnd",
      "cancelAtPeriodEnd", "creationSource", "updatedAt"
    ) VALUES (
      ${ctx.subSentinelMissingItemsId}::uuid,
      ${ctx.subSentinelMissingItemsTenancy}::uuid,
      'customer-1', 'TEAM',
      'legacy-default', NULL,
      ${sql.json({
        displayName: 'Legacy Default',
        customerType: 'team',
        prices: 'include-by-default',
      })},
      1,
      'active'::"SubscriptionStatus",
      NOW(),
      NOW() + interval '30 days',
      false,
      'API_GRANT'::"PurchaseCreationSource",
      NOW()
    )
  `;

  // Case 2: Subscription with sentinel + already-populated includedItems.
  // The migration must NOT overwrite this — it only fills in when missing.
  await sql`
    INSERT INTO "Subscription" (
      "id", "tenancyId", "customerId", "customerType",
      "productId", "priceId", "product", "quantity",
      "status", "currentPeriodStart", "currentPeriodEnd",
      "cancelAtPeriodEnd", "creationSource", "updatedAt"
    ) VALUES (
      ${ctx.subSentinelWithItemsId}::uuid,
      ${ctx.subSentinelWithItemsTenancy}::uuid,
      'customer-2', 'TEAM',
      'legacy-default-2', NULL,
      ${sql.json({
        displayName: 'Legacy Default With Items',
        customerType: 'team',
        prices: 'include-by-default',
        includedItems: {
          'item-a': { quantity: 5, repeat: 'never', expires: 'never' },
        },
      })},
      1,
      'active'::"SubscriptionStatus",
      NOW(),
      NOW() + interval '30 days',
      false,
      'API_GRANT'::"PurchaseCreationSource",
      NOW()
    )
  `;

  // Case 3: Subscription with REAL prices — must remain untouched.
  await sql`
    INSERT INTO "Subscription" (
      "id", "tenancyId", "customerId", "customerType",
      "productId", "priceId", "product", "quantity",
      "status", "currentPeriodStart", "currentPeriodEnd",
      "cancelAtPeriodEnd", "creationSource", "updatedAt"
    ) VALUES (
      ${ctx.subRealPricesId}::uuid,
      ${ctx.subRealPricesTenancy}::uuid,
      'customer-3', 'USER',
      'paid-plan', 'monthly',
      ${sql.json({
        displayName: 'Paid Plan',
        customerType: 'user',
        prices: {
          monthly: { USD: '10.00', interval: [1, 'month'], serverOnly: false },
        },
        includedItems: {},
      })},
      1,
      'active'::"SubscriptionStatus",
      NOW(),
      NOW() + interval '30 days',
      false,
      'PURCHASE_PAGE'::"PurchaseCreationSource",
      NOW()
    )
  `;

  // Case 4: OneTimePurchase with sentinel.
  await sql`
    INSERT INTO "OneTimePurchase" (
      "id", "tenancyId", "customerId", "customerType",
      "productId", "priceId", "product", "quantity",
      "creationSource"
    ) VALUES (
      ${ctx.otpId}::uuid,
      ${ctx.otpTenancy}::uuid,
      'customer-4', 'USER',
      'legacy-otp', NULL,
      ${sql.json({
        displayName: 'Legacy OTP',
        customerType: 'user',
        prices: 'include-by-default',
      })},
      1,
      'API_GRANT'::"PurchaseCreationSource"
    )
  `;

  // Case 5: ProductVersion with sentinel (note: column is `productJson`, not `product`).
  await sql`
    INSERT INTO "ProductVersion" (
      "tenancyId", "productVersionId", "productId", "productJson"
    ) VALUES (
      ${ctx.pvTenancy}::uuid,
      ${ctx.pvProductVersionId},
      'legacy-pv',
      ${sql.json({
        displayName: 'Legacy PV',
        customerType: 'team',
        prices: 'include-by-default',
      })}
    )
  `;

  return ctx;
};

export const postMigration = async (sql: Sql, ctx: Ctx) => {
  // ---- Case 1 ----
  const sub1 = await sql<Array<{ product: unknown }>>`
    SELECT "product" FROM "Subscription"
    WHERE "id" = ${ctx.subSentinelMissingItemsId}::uuid
  `;
  expect(sub1).toHaveLength(1);
  expect(sub1[0].product).toEqual({
    displayName: 'Legacy Default',
    customerType: 'team',
    prices: {},
    includedItems: {},
  });

  // ---- Case 2 ----
  const sub2 = await sql<Array<{ product: unknown }>>`
    SELECT "product" FROM "Subscription"
    WHERE "id" = ${ctx.subSentinelWithItemsId}::uuid
  `;
  expect(sub2).toHaveLength(1);
  expect(sub2[0].product).toEqual({
    displayName: 'Legacy Default With Items',
    customerType: 'team',
    prices: {},
    includedItems: {
      'item-a': { quantity: 5, repeat: 'never', expires: 'never' },
    },
  });

  // ---- Case 3 (regression guard: don't touch real-price rows) ----
  const sub3 = await sql<Array<{ product: unknown }>>`
    SELECT "product" FROM "Subscription"
    WHERE "id" = ${ctx.subRealPricesId}::uuid
  `;
  expect(sub3).toHaveLength(1);
  expect(sub3[0].product).toEqual({
    displayName: 'Paid Plan',
    customerType: 'user',
    prices: {
      monthly: { USD: '10.00', interval: [1, 'month'], serverOnly: false },
    },
    includedItems: {},
  });

  // ---- Case 4 ----
  const otp = await sql<Array<{ product: unknown }>>`
    SELECT "product" FROM "OneTimePurchase"
    WHERE "id" = ${ctx.otpId}::uuid
  `;
  expect(otp).toHaveLength(1);
  expect(otp[0].product).toEqual({
    displayName: 'Legacy OTP',
    customerType: 'user',
    prices: {},
    includedItems: {},
  });

  // ---- Case 5 ----
  const pv = await sql<Array<{ productJson: unknown }>>`
    SELECT "productJson" FROM "ProductVersion"
    WHERE "tenancyId" = ${ctx.pvTenancy}::uuid
      AND "productVersionId" = ${ctx.pvProductVersionId}
  `;
  expect(pv).toHaveLength(1);
  expect(pv[0].productJson).toEqual({
    displayName: 'Legacy PV',
    customerType: 'team',
    prices: {},
    includedItems: {},
  });

  // ---- Cross-table sanity: no row anywhere still has the sentinel ----
  const remainingSubs = await sql`
    SELECT 1 FROM "Subscription" WHERE "product"->>'prices' = 'include-by-default'
  `;
  const remainingOtps = await sql`
    SELECT 1 FROM "OneTimePurchase" WHERE "product"->>'prices' = 'include-by-default'
  `;
  const remainingPvs = await sql`
    SELECT 1 FROM "ProductVersion" WHERE "productJson"->>'prices' = 'include-by-default'
  `;
  expect(remainingSubs).toHaveLength(0);
  expect(remainingOtps).toHaveLength(0);
  expect(remainingPvs).toHaveLength(0);
};
