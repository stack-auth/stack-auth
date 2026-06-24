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

  await sql`
    UPDATE "PromoCode"
    SET "deletedAt" = NOW()
    WHERE "tenancyId" = ${ctx.tenancyId1}::uuid
      AND "id" = ${promoId1}::uuid
  `;
  const rows = await sql<{ redemption_count: string, deleted_count: string }[]>`
    SELECT
      COUNT(*) FILTER (WHERE "PromoCodeRedemption"."id" = ${redemptionId}::uuid)::text AS "redemption_count",
      COUNT(*) FILTER (WHERE "PromoCode"."deletedAt" IS NOT NULL)::text AS "deleted_count"
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
