import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId1 = randomUUID();
  const tenancyId2 = randomUUID();

  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Promo Code Migration Test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId1}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId2}::uuid, NOW(), NOW(), ${projectId}, 'preview', 'TRUE'::"BooleanTrue")
  `;

  return { tenancyId1, tenancyId2 };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('PromoCode', 'PromoCodeRedemption')
    ORDER BY table_name
  `;
  expect(Array.from(tables)).toMatchInlineSnapshot(`
    [
      {
        "table_name": "PromoCode",
      },
      {
        "table_name": "PromoCodeRedemption",
      },
    ]
  `);

  const promoId1 = randomUUID();
  const promoId2 = randomUUID();
  const redemptionId = randomUUID();
  const productVersionId = randomUUID();
  const codeHash = "same-normalized-code-hash";

  await sql`
    INSERT INTO "PromoCode" (
      "tenancyId",
      "id",
      "displayName",
      "codeHash",
      "discountType",
      "percentOffBps",
      "subscriptionDuration",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${promoId1}::uuid,
      'Launch',
      ${codeHash},
      'PERCENT'::"PromoCodeDiscountType",
      2500,
      'FIRST_INVOICE'::"PromoCodeSubscriptionDuration",
      NOW()
    )
  `;

  await expect(sql`
    INSERT INTO "PromoCode" (
      "tenancyId",
      "id",
      "codeHash",
      "discountType",
      "subscriptionDuration",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${randomUUID()}::uuid,
      'missing-percent',
      'PERCENT'::"PromoCodeDiscountType",
      'FIRST_INVOICE'::"PromoCodeSubscriptionDuration",
      NOW()
    )
  `).rejects.toThrow(/PromoCode_discount_fields_check/);

  await expect(sql`
    INSERT INTO "PromoCode" (
      "tenancyId",
      "id",
      "codeHash",
      "discountType",
      "percentOffBps",
      "subscriptionDuration",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${randomUUID()}::uuid,
      'too-large-percent',
      'PERCENT'::"PromoCodeDiscountType",
      10001,
      'FIRST_INVOICE'::"PromoCodeSubscriptionDuration",
      NOW()
    )
  `).rejects.toThrow(/PromoCode_discount_fields_check/);

  await expect(sql`
    INSERT INTO "PromoCode" (
      "tenancyId",
      "id",
      "codeHash",
      "discountType",
      "percentOffBps",
      "amountOffUsdCents",
      "subscriptionDuration",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${randomUUID()}::uuid,
      'mixed-discount',
      'AMOUNT_OFF_USD'::"PromoCodeDiscountType",
      1000,
      500,
      'FOREVER'::"PromoCodeSubscriptionDuration",
      NOW()
    )
  `).rejects.toThrow(/PromoCode_discount_fields_check/);

  await expect(sql`
    INSERT INTO "PromoCode" (
      "tenancyId",
      "id",
      "codeHash",
      "discountType",
      "amountOffUsdCents",
      "subscriptionDuration",
      "maxRedemptions",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${randomUUID()}::uuid,
      'bad-max',
      'AMOUNT_OFF_USD'::"PromoCodeDiscountType",
      500,
      'FOREVER'::"PromoCodeSubscriptionDuration",
      0,
      NOW()
    )
  `).rejects.toThrow(/PromoCode_max_redemptions_check/);

  await expect(sql`
    INSERT INTO "PromoCode" (
      "tenancyId",
      "id",
      "codeHash",
      "discountType",
      "amountOffUsdCents",
      "subscriptionDuration",
      "startsAt",
      "expiresAt",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${randomUUID()}::uuid,
      'bad-window',
      'AMOUNT_OFF_USD'::"PromoCodeDiscountType",
      500,
      'FOREVER'::"PromoCodeSubscriptionDuration",
      NOW(),
      NOW() - INTERVAL '1 minute',
      NOW()
    )
  `).rejects.toThrow(/PromoCode_time_window_check/);

  await expect(sql`
    INSERT INTO "PromoCode" (
      "tenancyId",
      "id",
      "codeHash",
      "discountType",
      "amountOffUsdCents",
      "subscriptionDuration",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${randomUUID()}::uuid,
      ${codeHash},
      'AMOUNT_OFF_USD'::"PromoCodeDiscountType",
      500,
      'FOREVER'::"PromoCodeSubscriptionDuration",
      NOW()
    )
  `).rejects.toThrow(/PromoCode_tenancyId_codeHash_key/);

  await sql`
    INSERT INTO "PromoCode" (
      "tenancyId",
      "id",
      "codeHash",
      "discountType",
      "amountOffUsdCents",
      "subscriptionDuration",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId2}::uuid,
      ${promoId2}::uuid,
      ${codeHash},
      'AMOUNT_OFF_USD'::"PromoCodeDiscountType",
      500,
      'FOREVER'::"PromoCodeSubscriptionDuration",
      NOW()
    )
  `;

  await sql`
    INSERT INTO "ProductVersion" ("tenancyId", "productVersionId", "productId", "productJson")
    VALUES (${ctx.tenancyId1}::uuid, ${productVersionId}, 'prod-1', '{}'::jsonb)
  `;
  await sql`
    INSERT INTO "PromoCodeRedemption" (
      "tenancyId",
      "id",
      "promoCodeId",
      "customerType",
      "customerId",
      "productId",
      "priceId",
      "productVersionId",
      "quantity",
      "originalAmountUsdCents",
      "discountAmountUsdCents",
      "finalAmountUsdCents",
      "subscriptionDuration",
      "status",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${redemptionId}::uuid,
      ${promoId1}::uuid,
      'CUSTOM'::"CustomerType",
      'customer-1',
      'prod-1',
      'price-1',
      ${productVersionId},
      1,
      1000,
      250,
      750,
      'FIRST_INVOICE'::"PromoCodeSubscriptionDuration",
      'APPLIED'::"PromoCodeRedemptionStatus",
      NOW()
    )
  `;

  const oneTimePurchaseId = randomUUID();
  const subscriptionId = randomUUID();
  const subscriptionInvoiceId = randomUUID();
  await sql`
    INSERT INTO "OneTimePurchase" (
      "tenancyId",
      "id",
      "customerId",
      "customerType",
      "product",
      "quantity",
      "creationSource"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${oneTimePurchaseId}::uuid,
      'customer-1',
      'CUSTOM'::"CustomerType",
      '{}'::jsonb,
      1,
      'TEST_MODE'::"PurchaseCreationSource"
    )
  `;
  await sql`
    INSERT INTO "Subscription" (
      "tenancyId",
      "id",
      "customerId",
      "customerType",
      "product",
      "quantity",
      "stripeSubscriptionId",
      "status",
      "currentPeriodEnd",
      "currentPeriodStart",
      "cancelAtPeriodEnd",
      "creationSource",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${subscriptionId}::uuid,
      'customer-1',
      'CUSTOM'::"CustomerType",
      '{}'::jsonb,
      1,
      'sub_promo_migration',
      'active'::"SubscriptionStatus",
      NOW() + INTERVAL '1 month',
      NOW(),
      FALSE,
      'TEST_MODE'::"PurchaseCreationSource",
      NOW(),
      NOW()
    )
  `;
  await sql`
    INSERT INTO "SubscriptionInvoice" (
      "tenancyId",
      "id",
      "stripeSubscriptionId",
      "stripeInvoiceId",
      "isSubscriptionCreationInvoice",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${subscriptionInvoiceId}::uuid,
      'sub_promo_migration',
      'in_promo_migration',
      TRUE,
      NOW(),
      NOW()
    )
  `;

  await sql`
    INSERT INTO "PromoCodeRedemption" (
      "tenancyId",
      "id",
      "promoCodeId",
      "customerType",
      "customerId",
      "quantity",
      "originalAmountUsdCents",
      "discountAmountUsdCents",
      "finalAmountUsdCents",
      "status",
      "oneTimePurchaseId",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${randomUUID()}::uuid,
      ${promoId1}::uuid,
      'CUSTOM'::"CustomerType",
      'customer-1',
      1,
      1000,
      250,
      750,
      'APPLIED'::"PromoCodeRedemptionStatus",
      ${oneTimePurchaseId}::uuid,
      NOW()
    )
  `;
  await expect(sql`
    INSERT INTO "PromoCodeRedemption" (
      "tenancyId",
      "id",
      "promoCodeId",
      "customerType",
      "customerId",
      "quantity",
      "originalAmountUsdCents",
      "discountAmountUsdCents",
      "finalAmountUsdCents",
      "status",
      "oneTimePurchaseId",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${randomUUID()}::uuid,
      ${promoId1}::uuid,
      'CUSTOM'::"CustomerType",
      'customer-1',
      1,
      1000,
      250,
      750,
      'APPLIED'::"PromoCodeRedemptionStatus",
      ${oneTimePurchaseId}::uuid,
      NOW()
    )
  `).rejects.toThrow(/PromoCodeRedemption_applied_one_time_purchase_key/);

  await sql`
    INSERT INTO "PromoCodeRedemption" (
      "tenancyId",
      "id",
      "promoCodeId",
      "customerType",
      "customerId",
      "quantity",
      "originalAmountUsdCents",
      "discountAmountUsdCents",
      "finalAmountUsdCents",
      "status",
      "subscriptionId",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${randomUUID()}::uuid,
      ${promoId1}::uuid,
      'CUSTOM'::"CustomerType",
      'customer-1',
      1,
      1000,
      250,
      750,
      'APPLIED'::"PromoCodeRedemptionStatus",
      ${subscriptionId}::uuid,
      NOW()
    )
  `;
  await expect(sql`
    INSERT INTO "PromoCodeRedemption" (
      "tenancyId",
      "id",
      "promoCodeId",
      "customerType",
      "customerId",
      "quantity",
      "originalAmountUsdCents",
      "discountAmountUsdCents",
      "finalAmountUsdCents",
      "status",
      "subscriptionId",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${randomUUID()}::uuid,
      ${promoId1}::uuid,
      'CUSTOM'::"CustomerType",
      'customer-1',
      1,
      1000,
      250,
      750,
      'APPLIED'::"PromoCodeRedemptionStatus",
      ${subscriptionId}::uuid,
      NOW()
    )
  `).rejects.toThrow(/PromoCodeRedemption_applied_subscription_promo_key/);

  await sql`
    INSERT INTO "PromoCodeRedemption" (
      "tenancyId",
      "id",
      "promoCodeId",
      "customerType",
      "customerId",
      "quantity",
      "originalAmountUsdCents",
      "discountAmountUsdCents",
      "finalAmountUsdCents",
      "status",
      "subscriptionInvoiceId",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${randomUUID()}::uuid,
      ${promoId1}::uuid,
      'CUSTOM'::"CustomerType",
      'customer-1',
      1,
      1000,
      250,
      750,
      'APPLIED'::"PromoCodeRedemptionStatus",
      ${subscriptionInvoiceId}::uuid,
      NOW()
    )
  `;
  await expect(sql`
    INSERT INTO "PromoCodeRedemption" (
      "tenancyId",
      "id",
      "promoCodeId",
      "customerType",
      "customerId",
      "quantity",
      "originalAmountUsdCents",
      "discountAmountUsdCents",
      "finalAmountUsdCents",
      "status",
      "subscriptionInvoiceId",
      "updatedAt"
    )
    VALUES (
      ${ctx.tenancyId1}::uuid,
      ${randomUUID()}::uuid,
      ${promoId1}::uuid,
      'CUSTOM'::"CustomerType",
      'customer-1',
      1,
      1000,
      250,
      750,
      'APPLIED'::"PromoCodeRedemptionStatus",
      ${subscriptionInvoiceId}::uuid,
      NOW()
    )
  `).rejects.toThrow(/PromoCodeRedemption_applied_subscription_invoice_promo_key/);

  await sql`
    UPDATE "PromoCode"
    SET "deletedAt" = NOW()
    WHERE "tenancyId" = ${ctx.tenancyId1}::uuid
      AND "id" = ${promoId1}::uuid
  `;
  const rows = await sql<{ redemption_count: string, deleted_count: string }[]>`
    SELECT
      COUNT(*) FILTER (WHERE "PromoCodeRedemption"."id" = ${redemptionId}::uuid)::text AS "redemption_count",
      COUNT(DISTINCT "PromoCode"."id") FILTER (WHERE "PromoCode"."deletedAt" IS NOT NULL)::text AS "deleted_count"
    FROM "PromoCode"
    LEFT JOIN "PromoCodeRedemption"
      ON "PromoCodeRedemption"."tenancyId" = "PromoCode"."tenancyId"
      AND "PromoCodeRedemption"."promoCodeId" = "PromoCode"."id"
    WHERE "PromoCode"."tenancyId" = ${ctx.tenancyId1}::uuid
      AND "PromoCode"."id" = ${promoId1}::uuid
  `;
  expect(Array.from(rows)).toMatchInlineSnapshot(`
    [
      {
        "deleted_count": "1",
        "redemption_count": "1",
      },
    ]
  `);
};
