import type { PrismaClientTransaction } from "@/prisma-client";
import type { PromoCodeCreate, PromoCodeRead, PromoCodeRedemptionRead, PromoCodeUpdate } from "@hexclave/shared/dist/interface/crud/promo-codes";
import type { productSchema } from "@hexclave/shared/dist/schema-fields";
import { StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { createHash, randomBytes } from "node:crypto";
import Stripe from "stripe";
import type * as yup from "yup";

type Product = yup.InferType<typeof productSchema>;
type SelectedPrice = Product["prices"][string];
type CustomerType = "user" | "team" | "custom";
type PromoCodeDiscountType = "PERCENT" | "AMOUNT_OFF_USD";
type PromoCodeSubscriptionDuration = "FIRST_INVOICE" | "FOREVER";
type PromoCodeRedemptionStatus = "RESERVED" | "APPLIED" | "VOIDED";

type PromoCodeRow = {
  id: string,
  tenancyId: string,
  displayName: string | null,
  codeHash: string,
  codePrefix: string | null,
  codeLast4: string | null,
  discountType: PromoCodeDiscountType,
  percentOffBps: number | null,
  amountOffUsdCents: number | null,
  subscriptionDuration: PromoCodeSubscriptionDuration,
  customerType: "USER" | "TEAM" | "CUSTOM" | null,
  customerId: string | null,
  productLineId: string | null,
  productId: string | null,
  priceId: string | null,
  maxRedemptions: number | null,
  maxRedemptionsPerCustomer: number | null,
  startsAt: Date | null,
  expiresAt: Date | null,
  disabledAt: Date | null,
  deletedAt: Date | null,
  createdAt: Date,
  updatedAt: Date,
};

type PromoCodeRedemptionRow = {
  id: string,
  tenancyId: string,
  promoCodeId: string,
  customerType: "USER" | "TEAM" | "CUSTOM",
  customerId: string,
  productId: string | null,
  priceId: string | null,
  productVersionId: string | null,
  quantity: number,
  currency: string,
  originalAmountUsdCents: number,
  discountAmountUsdCents: number,
  finalAmountUsdCents: number,
  subscriptionDuration: PromoCodeSubscriptionDuration | null,
  status: PromoCodeRedemptionStatus,
  reservationExpiresAt: Date | null,
  appliedAt: Date | null,
  voidedAt: Date | null,
  voidReason: string | null,
  stripePaymentIntentId: string | null,
  stripeSubscriptionId: string | null,
  stripeInvoiceId: string | null,
  subscriptionId: string | null,
  oneTimePurchaseId: string | null,
  subscriptionInvoiceId: string | null,
  createdAt: Date,
  updatedAt: Date,
};

export type PromoCodeQuote = {
  promoCodeId: string,
  displayName: string | null,
  discountType: "percent" | "amount_off_usd",
  percentOffBps: number | null,
  amountOffUsdCents: number | null,
  subscriptionDuration: "first_invoice" | "forever",
  originalAmountUsdCents: number,
  discountAmountUsdCents: number,
  finalAmountUsdCents: number,
};

export type ReservedPromoCodeRedemption = PromoCodeQuote & {
  redemptionId: string,
};

type PromoCodePurchaseContext = {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
  product: Product,
  productId: string | undefined,
  priceId: string | undefined,
  selectedPrice: SelectedPrice,
  quantity: number,
  productVersionId?: string,
  promoCode: string,
};

const RESERVATION_TTL_MS = 15 * 60 * 1000;

function enumCustomerType(customerType: CustomerType): "USER" | "TEAM" | "CUSTOM" {
  switch (customerType) {
    case "user": {
      return "USER";
    }
    case "team": {
      return "TEAM";
    }
    case "custom": {
      return "CUSTOM";
    }
  }
}

function apiCustomerType(customerType: "USER" | "TEAM" | "CUSTOM" | null): CustomerType | null {
  switch (customerType) {
    case null: {
      return null;
    }
    case "USER": {
      return "user";
    }
    case "TEAM": {
      return "team";
    }
    case "CUSTOM": {
      return "custom";
    }
  }
}

function apiRedemptionStatus(status: PromoCodeRedemptionStatus): "reserved" | "applied" | "voided" {
  switch (status) {
    case "RESERVED": {
      return "reserved";
    }
    case "APPLIED": {
      return "applied";
    }
    case "VOIDED": {
      return "voided";
    }
  }
}

function apiDiscountType(type: PromoCodeDiscountType): PromoCodeQuote["discountType"] {
  return type === "PERCENT" ? "percent" : "amount_off_usd";
}

function apiSubscriptionDuration(duration: PromoCodeSubscriptionDuration): PromoCodeQuote["subscriptionDuration"] {
  return duration === "FIRST_INVOICE" ? "first_invoice" : "forever";
}

export function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase().replaceAll(/\s+/g, "");
}

export function hashPromoCode(code: string): string {
  return createHash("sha256").update(normalizePromoCode(code)).digest("hex");
}

export function generatePromoCode(): string {
  return `PROMO-${randomBytes(5).toString("hex").toUpperCase()}`;
}

export function getPromoCodeDisplayParts(code: string): { codePrefix: string, codeLast4: string } {
  const normalized = normalizePromoCode(code);
  return {
    codePrefix: normalized.slice(0, Math.min(6, normalized.length)),
    codeLast4: normalized.slice(Math.max(0, normalized.length - 4)),
  };
}

export function calculateOriginalAmountUsdCents(options: {
  selectedPrice: SelectedPrice,
  quantity: number,
}): number {
  const amount = Number(options.selectedPrice.USD);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new StatusError(400, "Selected price must have a finite non-negative USD amount.");
  }
  const cents = Math.round(amount * 100) * Math.max(1, options.quantity);
  if (!Number.isInteger(cents) || cents < 0) {
    throw new StatusError(400, "Selected price produced an invalid USD cent amount.");
  }
  return cents;
}

function calculateDiscountAmountUsdCents(options: {
  promoCode: PromoCodeRow,
  originalAmountUsdCents: number,
}): number {
  if (options.promoCode.discountType === "PERCENT") {
    const percentOffBps = options.promoCode.percentOffBps;
    if (percentOffBps == null || percentOffBps < 1 || percentOffBps > 10000) {
      throw new StatusError(400, "Promo code has an invalid percent discount.");
    }
    return Math.floor(options.originalAmountUsdCents * percentOffBps / 10000);
  }
  const amountOffUsdCents = options.promoCode.amountOffUsdCents;
  if (amountOffUsdCents == null || amountOffUsdCents < 1) {
    throw new StatusError(400, "Promo code has an invalid amount-off discount.");
  }
  return Math.min(amountOffUsdCents, options.originalAmountUsdCents);
}

function assertPromoCodeApplies(options: {
  promoCode: PromoCodeRow,
  customerType: CustomerType,
  customerId: string,
  product: Product,
  productId: string | undefined,
  priceId: string | undefined,
  now: Date,
}) {
  const promoCode = options.promoCode;
  if (promoCode.deletedAt != null) {
    throw new StatusError(400, "Promo code does not exist.");
  }
  if (promoCode.disabledAt != null) {
    throw new StatusError(400, "Promo code is disabled.");
  }
  if (promoCode.startsAt != null && promoCode.startsAt > options.now) {
    throw new StatusError(400, "Promo code is not active yet.");
  }
  if (promoCode.expiresAt != null && promoCode.expiresAt <= options.now) {
    throw new StatusError(400, "Promo code has expired.");
  }
  if (promoCode.customerType != null && promoCode.customerType !== enumCustomerType(options.customerType)) {
    throw new StatusError(400, "Promo code is not available for this customer.");
  }
  if (promoCode.customerId != null && promoCode.customerId !== options.customerId) {
    throw new StatusError(400, "Promo code is not available for this customer.");
  }
  if (promoCode.productLineId != null && promoCode.productLineId !== (options.product.productLineId ?? null)) {
    throw new StatusError(400, "Promo code is not available for this product line.");
  }
  if (promoCode.productId != null && promoCode.productId !== (options.productId ?? null)) {
    throw new StatusError(400, "Promo code is not available for this product.");
  }
  if (promoCode.priceId != null && promoCode.priceId !== (options.priceId ?? null)) {
    throw new StatusError(400, "Promo code is not available for this price.");
  }
}

function promoCodeToQuote(options: {
  promoCode: PromoCodeRow,
  originalAmountUsdCents: number,
}): PromoCodeQuote {
  const discountAmountUsdCents = calculateDiscountAmountUsdCents(options);
  return {
    promoCodeId: options.promoCode.id,
    displayName: options.promoCode.displayName,
    discountType: apiDiscountType(options.promoCode.discountType),
    percentOffBps: options.promoCode.percentOffBps,
    amountOffUsdCents: options.promoCode.amountOffUsdCents,
    subscriptionDuration: apiSubscriptionDuration(options.promoCode.subscriptionDuration),
    originalAmountUsdCents: options.originalAmountUsdCents,
    discountAmountUsdCents,
    finalAmountUsdCents: options.originalAmountUsdCents - discountAmountUsdCents,
  };
}

async function findPromoCodeByHash(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  codeHash: string,
}): Promise<PromoCodeRow | null> {
  const rows = await options.prisma.$queryRaw<PromoCodeRow[]>`
    SELECT *
    FROM "PromoCode"
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "codeHash" = ${options.codeHash}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function assertRedemptionLimits(options: {
  prisma: PrismaClientTransaction,
  promoCode: PromoCodeRow,
  customerType: CustomerType,
  customerId: string,
  now: Date,
}) {
  if (options.promoCode.maxRedemptions == null && options.promoCode.maxRedemptionsPerCustomer == null) {
    return;
  }
  const rows = await options.prisma.$queryRaw<Array<{ totalCount: bigint, customerCount: bigint }>>`
    SELECT
      COUNT(*) FILTER (
        WHERE "status" = 'APPLIED'::"PromoCodeRedemptionStatus"
           OR ("status" = 'RESERVED'::"PromoCodeRedemptionStatus" AND "reservationExpiresAt" > ${options.now})
      ) AS "totalCount",
      COUNT(*) FILTER (
        WHERE (
          "status" = 'APPLIED'::"PromoCodeRedemptionStatus"
          OR ("status" = 'RESERVED'::"PromoCodeRedemptionStatus" AND "reservationExpiresAt" > ${options.now})
        )
        AND "customerType" = ${enumCustomerType(options.customerType)}::"CustomerType"
        AND "customerId" = ${options.customerId}
      ) AS "customerCount"
    FROM "PromoCodeRedemption"
    WHERE "tenancyId" = ${options.promoCode.tenancyId}::uuid
      AND "promoCodeId" = ${options.promoCode.id}::uuid
  `;
  const counts = rows[0] ?? { totalCount: 0n, customerCount: 0n };
  if (options.promoCode.maxRedemptions != null && counts.totalCount >= BigInt(options.promoCode.maxRedemptions)) {
    throw new StatusError(400, "Promo code has reached its redemption limit.");
  }
  if (options.promoCode.maxRedemptionsPerCustomer != null && counts.customerCount >= BigInt(options.promoCode.maxRedemptionsPerCustomer)) {
    throw new StatusError(400, "Promo code has already been used by this customer.");
  }
}

export async function quotePromoCodeForPurchase(options: PromoCodePurchaseContext): Promise<PromoCodeQuote> {
  const normalized = normalizePromoCode(options.promoCode);
  if (normalized.length === 0) {
    throw new StatusError(400, "Promo code is required.");
  }
  const promoCode = await findPromoCodeByHash({
    prisma: options.prisma,
    tenancyId: options.tenancyId,
    codeHash: hashPromoCode(normalized),
  });
  if (!promoCode) {
    throw new StatusError(400, "Promo code does not exist.");
  }
  const now = new Date();
  assertPromoCodeApplies({
    promoCode,
    customerType: options.customerType,
    customerId: options.customerId,
    product: options.product,
    productId: options.productId,
    priceId: options.priceId,
    now,
  });
  await assertRedemptionLimits({
    prisma: options.prisma,
    promoCode,
    customerType: options.customerType,
    customerId: options.customerId,
    now,
  });
  return promoCodeToQuote({
    promoCode,
    originalAmountUsdCents: calculateOriginalAmountUsdCents(options),
  });
}

export async function reservePromoCodeRedemption(options: PromoCodePurchaseContext): Promise<ReservedPromoCodeRedemption> {
  const quote = await quotePromoCodeForPurchase(options);
  const reservationExpiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
  const rows = await options.prisma.$queryRaw<Array<{ id: string }>>`
    WITH "lockedPromo" AS (
      SELECT *
      FROM "PromoCode"
      WHERE "tenancyId" = ${options.tenancyId}::uuid
        AND "id" = ${quote.promoCodeId}::uuid
      FOR UPDATE
    ), "activeCounts" AS (
      SELECT
        COUNT(*) FILTER (
          WHERE "status" = 'APPLIED'::"PromoCodeRedemptionStatus"
             OR ("status" = 'RESERVED'::"PromoCodeRedemptionStatus" AND "reservationExpiresAt" > NOW())
        ) AS "totalCount",
        COUNT(*) FILTER (
          WHERE (
            "status" = 'APPLIED'::"PromoCodeRedemptionStatus"
            OR ("status" = 'RESERVED'::"PromoCodeRedemptionStatus" AND "reservationExpiresAt" > NOW())
          )
          AND "customerType" = ${enumCustomerType(options.customerType)}::"CustomerType"
          AND "customerId" = ${options.customerId}
        ) AS "customerCount"
      FROM "PromoCodeRedemption"
      WHERE "tenancyId" = ${options.tenancyId}::uuid
        AND "promoCodeId" = ${quote.promoCodeId}::uuid
    )
    INSERT INTO "PromoCodeRedemption" (
      "tenancyId",
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
      "reservationExpiresAt",
      "updatedAt"
    )
    SELECT
      ${options.tenancyId}::uuid,
      ${quote.promoCodeId}::uuid,
      ${enumCustomerType(options.customerType)}::"CustomerType",
      ${options.customerId},
      ${options.productId ?? null},
      ${options.priceId ?? null},
      ${options.productVersionId ?? null},
      ${options.quantity},
      ${quote.originalAmountUsdCents},
      ${quote.discountAmountUsdCents},
      ${quote.finalAmountUsdCents},
      ${quote.subscriptionDuration === "first_invoice" ? "FIRST_INVOICE" : "FOREVER"}::"PromoCodeSubscriptionDuration",
      'RESERVED'::"PromoCodeRedemptionStatus",
      ${reservationExpiresAt},
      NOW()
    FROM "lockedPromo", "activeCounts"
    WHERE ("lockedPromo"."maxRedemptions" IS NULL OR "activeCounts"."totalCount" < "lockedPromo"."maxRedemptions")
      AND ("lockedPromo"."maxRedemptionsPerCustomer" IS NULL OR "activeCounts"."customerCount" < "lockedPromo"."maxRedemptionsPerCustomer")
    RETURNING "id"
  `;
  const redemptionId = rows[0]?.id;
  if (!redemptionId) {
    throw new StatusError(400, "Promo code has reached its redemption limit.");
  }
  return {
    ...quote,
    redemptionId,
  };
}

export async function attachStripePaymentIntentToPromoRedemption(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  redemptionId: string,
  stripePaymentIntentId: string,
}) {
  await options.prisma.$executeRaw`
    UPDATE "PromoCodeRedemption"
    SET "stripePaymentIntentId" = ${options.stripePaymentIntentId},
        "updatedAt" = NOW()
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "id" = ${options.redemptionId}::uuid
      AND "status" = 'RESERVED'::"PromoCodeRedemptionStatus"
  `;
}

export async function attachStripeSubscriptionToPromoRedemption(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  redemptionId: string,
  stripeSubscriptionId: string,
}) {
  await options.prisma.$executeRaw`
    UPDATE "PromoCodeRedemption"
    SET "stripeSubscriptionId" = ${options.stripeSubscriptionId},
        "updatedAt" = NOW()
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "id" = ${options.redemptionId}::uuid
      AND "status" = 'RESERVED'::"PromoCodeRedemptionStatus"
  `;
}

export async function markPromoCodeRedemptionApplied(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  redemptionId?: string | null,
  stripePaymentIntentId?: string | null,
  stripeSubscriptionId?: string | null,
  stripeInvoiceId?: string | null,
  subscriptionId?: string | null,
  oneTimePurchaseId?: string | null,
  subscriptionInvoiceId?: string | null,
}) {
  if (!options.redemptionId && !options.stripePaymentIntentId && !options.stripeSubscriptionId && !options.stripeInvoiceId) {
    return;
  }
  const redemptionId = options.redemptionId ?? null;
  const stripePaymentIntentId = options.stripePaymentIntentId ?? null;
  const stripeSubscriptionId = options.stripeSubscriptionId ?? null;
  const stripeInvoiceId = options.stripeInvoiceId ?? null;
  const subscriptionId = options.subscriptionId ?? null;
  const oneTimePurchaseId = options.oneTimePurchaseId ?? null;
  const subscriptionInvoiceId = options.subscriptionInvoiceId ?? null;
  await options.prisma.$executeRaw`
    UPDATE "PromoCodeRedemption"
    SET "status" = 'APPLIED'::"PromoCodeRedemptionStatus",
        "appliedAt" = COALESCE("appliedAt", NOW()),
        "stripePaymentIntentId" = COALESCE(${stripePaymentIntentId}::text, "stripePaymentIntentId"),
        "stripeSubscriptionId" = COALESCE(${stripeSubscriptionId}::text, "stripeSubscriptionId"),
        "stripeInvoiceId" = COALESCE(${stripeInvoiceId}::text, "stripeInvoiceId"),
        "subscriptionId" = COALESCE(${subscriptionId}::uuid, "subscriptionId"),
        "oneTimePurchaseId" = COALESCE(${oneTimePurchaseId}::uuid, "oneTimePurchaseId"),
        "subscriptionInvoiceId" = COALESCE(${subscriptionInvoiceId}::uuid, "subscriptionInvoiceId"),
        "updatedAt" = NOW()
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND (
        (${redemptionId}::uuid IS NOT NULL AND "id" = ${redemptionId}::uuid)
        OR (${stripePaymentIntentId}::text IS NOT NULL AND "stripePaymentIntentId" = ${stripePaymentIntentId}::text)
        OR (${stripeSubscriptionId}::text IS NOT NULL AND "stripeSubscriptionId" = ${stripeSubscriptionId}::text)
        OR (${stripeInvoiceId}::text IS NOT NULL AND "stripeInvoiceId" = ${stripeInvoiceId}::text)
      )
      AND "status" IN ('RESERVED'::"PromoCodeRedemptionStatus", 'APPLIED'::"PromoCodeRedemptionStatus")
      AND (
        ${stripeInvoiceId}::text IS NULL
        OR "subscriptionDuration" = 'FOREVER'::"PromoCodeSubscriptionDuration"
        OR "subscriptionInvoiceId" IS NULL
      )
  `;
}

export async function voidExpiredOrFailedPromoCodeRedemption(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  redemptionId: string,
  reason: string,
}) {
  await options.prisma.$executeRaw`
    UPDATE "PromoCodeRedemption"
    SET "status" = 'VOIDED'::"PromoCodeRedemptionStatus",
        "voidedAt" = COALESCE("voidedAt", NOW()),
        "voidReason" = ${options.reason},
        "updatedAt" = NOW()
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "id" = ${options.redemptionId}::uuid
      AND "status" = 'RESERVED'::"PromoCodeRedemptionStatus"
  `;
}

export function createStripeCouponParamsForPromoCode(options: {
  quote: ReservedPromoCodeRedemption,
  promoCode: string,
}): Stripe.CouponCreateParams {
  const duration = options.quote.subscriptionDuration === "first_invoice" ? "once" : "forever";
  if (options.quote.discountType === "percent") {
    return {
      duration,
      percent_off: options.quote.percentOffBps == null ? 0 : options.quote.percentOffBps / 100,
      name: normalizePromoCode(options.promoCode),
      metadata: {
        promoCodeId: options.quote.promoCodeId,
        promoCodeRedemptionId: options.quote.redemptionId,
      },
    };
  }
  return {
    duration,
    amount_off: options.quote.discountAmountUsdCents,
    currency: "usd",
    name: normalizePromoCode(options.promoCode),
    metadata: {
      promoCodeId: options.quote.promoCodeId,
      promoCodeRedemptionId: options.quote.redemptionId,
    },
  };
}

export function promoRedemptionMetadata(redemption: ReservedPromoCodeRedemption): Record<string, string> {
  return {
    promoCodeId: redemption.promoCodeId,
    promoCodeRedemptionId: redemption.redemptionId,
    promoOriginalAmountUsdCents: String(redemption.originalAmountUsdCents),
    promoDiscountAmountUsdCents: String(redemption.discountAmountUsdCents),
    promoFinalAmountUsdCents: String(redemption.finalAmountUsdCents),
  };
}

function millis(date: Date | null): number | null {
  return date ? date.getTime() : null;
}

export function promoCodeRowToApi(row: PromoCodeRow): PromoCodeRead {
  return {
    id: row.id,
    display_name: row.displayName,
    code_prefix: row.codePrefix,
    code_last4: row.codeLast4,
    discount_type: apiDiscountType(row.discountType),
    percent_off_bps: row.percentOffBps,
    amount_off_usd_cents: row.amountOffUsdCents,
    subscription_duration: apiSubscriptionDuration(row.subscriptionDuration),
    customer_type: apiCustomerType(row.customerType),
    customer_id: row.customerId,
    product_line_id: row.productLineId,
    product_id: row.productId,
    price_id: row.priceId,
    max_redemptions: row.maxRedemptions,
    max_redemptions_per_customer: row.maxRedemptionsPerCustomer,
    starts_at_millis: millis(row.startsAt),
    expires_at_millis: millis(row.expiresAt),
    disabled_at_millis: millis(row.disabledAt),
    deleted_at_millis: millis(row.deletedAt),
    created_at_millis: row.createdAt.getTime(),
    updated_at_millis: row.updatedAt.getTime(),
  };
}

function redemptionRowToApi(row: PromoCodeRedemptionRow): PromoCodeRedemptionRead {
  const customerType = apiCustomerType(row.customerType) ?? throwErr("Promo code redemption customer type should never be null.");
  return {
    id: row.id,
    promo_code_id: row.promoCodeId,
    customer_type: customerType,
    customer_id: row.customerId,
    product_id: row.productId,
    price_id: row.priceId,
    quantity: row.quantity,
    original_amount_usd_cents: row.originalAmountUsdCents,
    discount_amount_usd_cents: row.discountAmountUsdCents,
    final_amount_usd_cents: row.finalAmountUsdCents,
    subscription_duration: row.subscriptionDuration ? apiSubscriptionDuration(row.subscriptionDuration) : null,
    status: apiRedemptionStatus(row.status),
    applied_at_millis: millis(row.appliedAt),
    voided_at_millis: millis(row.voidedAt),
    created_at_millis: row.createdAt.getTime(),
  };
}

function dateFromMillis(value: number | null | undefined): Date | null {
  return value == null ? null : new Date(value);
}

function enumDiscountType(value: "percent" | "amount_off_usd"): PromoCodeDiscountType {
  return value === "percent" ? "PERCENT" : "AMOUNT_OFF_USD";
}

function enumSubscriptionDuration(value: "first_invoice" | "forever"): PromoCodeSubscriptionDuration {
  return value === "first_invoice" ? "FIRST_INVOICE" : "FOREVER";
}

function validatePromoCodeMutation(data: {
  discountType: PromoCodeDiscountType,
  percentOffBps: number | null,
  amountOffUsdCents: number | null,
  startsAt: Date | null,
  expiresAt: Date | null,
  customerType: CustomerType | null,
  customerId: string | null,
}) {
  if (data.discountType === "PERCENT") {
    if (data.percentOffBps == null || data.percentOffBps < 1 || data.percentOffBps > 10000) {
      throw new StatusError(400, "percent_off_bps must be between 1 and 10000 for percent promo codes.");
    }
    if (data.amountOffUsdCents != null) {
      throw new StatusError(400, "amount_off_usd_cents must not be set for percent promo codes.");
    }
  } else {
    if (data.amountOffUsdCents == null || data.amountOffUsdCents < 1) {
      throw new StatusError(400, "amount_off_usd_cents must be positive for amount-off promo codes.");
    }
    if (data.percentOffBps != null) {
      throw new StatusError(400, "percent_off_bps must not be set for amount-off promo codes.");
    }
  }
  if (data.expiresAt != null && data.startsAt != null && data.expiresAt <= data.startsAt) {
    throw new StatusError(400, "expires_at_millis must be after starts_at_millis.");
  }
  if (data.customerId != null && data.customerType == null) {
    throw new StatusError(400, "customer_type is required when customer_id is set.");
  }
}

export async function createPromoCode(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  data: PromoCodeCreate,
}): Promise<PromoCodeRead & { code: string }> {
  const rawCode = options.data.code ?? generatePromoCode();
  const normalizedCode = normalizePromoCode(rawCode);
  if (normalizedCode.length < 4) {
    throw new StatusError(400, "Promo code must be at least 4 characters.");
  }
  const discountType = enumDiscountType(options.data.discount_type);
  const percentOffBps = options.data.percent_off_bps ?? null;
  const amountOffUsdCents = options.data.amount_off_usd_cents ?? null;
  const startsAt = dateFromMillis(options.data.starts_at_millis);
  const expiresAt = dateFromMillis(options.data.expires_at_millis);
  validatePromoCodeMutation({
    discountType,
    percentOffBps,
    amountOffUsdCents,
    startsAt,
    expiresAt,
    customerType: options.data.customer_type ?? null,
    customerId: options.data.customer_id ?? null,
  });
  const displayParts = getPromoCodeDisplayParts(normalizedCode);
  const rows = await options.prisma.$queryRaw<PromoCodeRow[]>`
    INSERT INTO "PromoCode" (
      "tenancyId",
      "displayName",
      "codeHash",
      "codePrefix",
      "codeLast4",
      "discountType",
      "percentOffBps",
      "amountOffUsdCents",
      "subscriptionDuration",
      "customerType",
      "customerId",
      "productLineId",
      "productId",
      "priceId",
      "maxRedemptions",
      "maxRedemptionsPerCustomer",
      "startsAt",
      "expiresAt",
      "updatedAt"
    )
    VALUES (
      ${options.tenancyId}::uuid,
      ${options.data.display_name ?? null},
      ${hashPromoCode(normalizedCode)},
      ${displayParts.codePrefix},
      ${displayParts.codeLast4},
      ${discountType}::"PromoCodeDiscountType",
      ${percentOffBps},
      ${amountOffUsdCents},
      ${enumSubscriptionDuration(options.data.subscription_duration)}::"PromoCodeSubscriptionDuration",
      ${options.data.customer_type ? enumCustomerType(options.data.customer_type) : null}::"CustomerType",
      ${options.data.customer_id ?? null},
      ${options.data.product_line_id ?? null},
      ${options.data.product_id ?? null},
      ${options.data.price_id ?? null},
      ${options.data.max_redemptions ?? null},
      ${options.data.max_redemptions_per_customer ?? null},
      ${startsAt},
      ${expiresAt},
      NOW()
    )
    RETURNING *
  `;
  if (rows.length === 0) {
    throw new StatusError(500, "Failed to create promo code.");
  }
  const row = rows[0];
  return {
    ...promoCodeRowToApi(row),
    code: normalizedCode,
  };
}

export async function listPromoCodes(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  includeDeleted: boolean,
  limit: number,
}): Promise<PromoCodeRead[]> {
  const rows = await options.prisma.$queryRaw<PromoCodeRow[]>`
    SELECT *
    FROM "PromoCode"
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND (${options.includeDeleted} OR "deletedAt" IS NULL)
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT ${options.limit}
  `;
  return rows.map(promoCodeRowToApi);
}

export async function getPromoCode(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  promoCodeId: string,
}): Promise<PromoCodeRead> {
  const rows = await options.prisma.$queryRaw<PromoCodeRow[]>`
    SELECT *
    FROM "PromoCode"
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "id" = ${options.promoCodeId}::uuid
    LIMIT 1
  `;
  if (rows.length === 0) {
    throw new StatusError(404, "Promo code not found.");
  }
  const row = rows[0];
  return promoCodeRowToApi(row);
}

export async function updatePromoCode(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  promoCodeId: string,
  data: PromoCodeUpdate,
}): Promise<PromoCodeRead> {
  const currentRows = await options.prisma.$queryRaw<PromoCodeRow[]>`
    SELECT *
    FROM "PromoCode"
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "id" = ${options.promoCodeId}::uuid
      AND "deletedAt" IS NULL
    LIMIT 1
  `;
  if (currentRows.length === 0) {
    throw new StatusError(404, "Promo code not found.");
  }
  const current = currentRows[0];
  const next = {
    displayName: "display_name" in options.data ? options.data.display_name ?? null : current.displayName,
    subscriptionDuration: options.data.subscription_duration ? enumSubscriptionDuration(options.data.subscription_duration) : current.subscriptionDuration,
    customerType: "customer_type" in options.data ? options.data.customer_type ?? null : apiCustomerType(current.customerType),
    customerId: "customer_id" in options.data ? options.data.customer_id ?? null : current.customerId,
    productLineId: "product_line_id" in options.data ? options.data.product_line_id ?? null : current.productLineId,
    productId: "product_id" in options.data ? options.data.product_id ?? null : current.productId,
    priceId: "price_id" in options.data ? options.data.price_id ?? null : current.priceId,
    maxRedemptions: "max_redemptions" in options.data ? options.data.max_redemptions ?? null : current.maxRedemptions,
    maxRedemptionsPerCustomer: "max_redemptions_per_customer" in options.data ? options.data.max_redemptions_per_customer ?? null : current.maxRedemptionsPerCustomer,
    startsAt: "starts_at_millis" in options.data ? dateFromMillis(options.data.starts_at_millis) : current.startsAt,
    expiresAt: "expires_at_millis" in options.data ? dateFromMillis(options.data.expires_at_millis) : current.expiresAt,
    disabledAt: options.data.disabled === undefined ? current.disabledAt : (options.data.disabled ? new Date() : null),
  };
  validatePromoCodeMutation({
    discountType: current.discountType,
    percentOffBps: current.percentOffBps,
    amountOffUsdCents: current.amountOffUsdCents,
    startsAt: next.startsAt,
    expiresAt: next.expiresAt,
    customerType: next.customerType,
    customerId: next.customerId,
  });
  const rows = await options.prisma.$queryRaw<PromoCodeRow[]>`
    UPDATE "PromoCode"
    SET "displayName" = ${next.displayName},
        "subscriptionDuration" = ${next.subscriptionDuration}::"PromoCodeSubscriptionDuration",
        "customerType" = ${next.customerType ? enumCustomerType(next.customerType) : null}::"CustomerType",
        "customerId" = ${next.customerId},
        "productLineId" = ${next.productLineId},
        "productId" = ${next.productId},
        "priceId" = ${next.priceId},
        "maxRedemptions" = ${next.maxRedemptions},
        "maxRedemptionsPerCustomer" = ${next.maxRedemptionsPerCustomer},
        "startsAt" = ${next.startsAt},
        "expiresAt" = ${next.expiresAt},
        "disabledAt" = ${next.disabledAt},
        "updatedAt" = NOW()
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "id" = ${options.promoCodeId}::uuid
    RETURNING *
  `;
  if (rows.length === 0) {
    throw new StatusError(404, "Promo code not found.");
  }
  const row = rows[0];
  return promoCodeRowToApi(row);
}

export async function softDeletePromoCode(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  promoCodeId: string,
}): Promise<void> {
  await options.prisma.$executeRaw`
    UPDATE "PromoCode"
    SET "deletedAt" = COALESCE("deletedAt", NOW()),
        "updatedAt" = NOW()
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "id" = ${options.promoCodeId}::uuid
  `;
}

export async function listPromoCodeRedemptions(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  promoCodeId: string,
  limit: number,
}): Promise<PromoCodeRedemptionRead[]> {
  const rows = await options.prisma.$queryRaw<PromoCodeRedemptionRow[]>`
    SELECT *
    FROM "PromoCodeRedemption"
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "promoCodeId" = ${options.promoCodeId}::uuid
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT ${options.limit}
  `;
  return rows.map(redemptionRowToApi);
}
