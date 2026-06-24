import { randomUUID } from "node:crypto";
import { it } from "../../../../../helpers";
import { Auth, Payments, Project, niceBackendFetch } from "../../../../backend-helpers";
import { createPurchaseCode } from "../../../../helpers/payments";

function uniquePromoCode(prefix: string) {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 12)}`.toUpperCase();
}

async function setupProjectWithPromoProducts() {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      productLines: {
        promo: { displayName: "Promo Products" },
      },
      products: {
        "promo-subscription": {
          displayName: "Promo Subscription",
          customerType: "user",
          serverOnly: false,
          productLineId: "promo",
          stackable: false,
          prices: {
            monthly: {
              USD: "20",
              interval: [1, "month"],
            },
          },
          includedItems: {},
        },
        "promo-one-time": {
          displayName: "Promo One-Time",
          customerType: "user",
          serverOnly: false,
          productLineId: "promo",
          stackable: true,
          prices: {
            single: {
              USD: "50",
            },
          },
          includedItems: {},
        },
      },
    },
  });
}

async function createPercentPromoCode(options: {
  code?: string,
  productId?: string,
  priceId?: string,
  expiresAtMillis?: number,
} = {}) {
  const response = await niceBackendFetch("/api/latest/internal/payments/promo-codes", {
    method: "POST",
    accessType: "admin",
    body: {
      code: options.code ?? uniquePromoCode("PERCENT"),
      display_name: "E2E percent promo",
      discount_type: "percent",
      percent_off_bps: 2500,
      subscription_duration: "first_invoice",
      product_id: options.productId,
      price_id: options.priceId,
      expires_at_millis: options.expiresAtMillis,
    },
  });
  return response;
}

async function createAmountOffPromoCode(options: { code?: string } = {}) {
  const response = await niceBackendFetch("/api/latest/internal/payments/promo-codes", {
    method: "POST",
    accessType: "admin",
    body: {
      code: options.code ?? uniquePromoCode("AMOUNT"),
      display_name: "E2E fixed promo",
      discount_type: "amount_off_usd",
      amount_off_usd_cents: 1250,
      subscription_duration: "forever",
    },
  });
  return response;
}

it("should manage promo codes with admin CRUD and soft-delete", async ({ expect }) => {
  await setupProjectWithPromoProducts();
  const rawCode = uniquePromoCode("CRUD");

  const createRes = await createPercentPromoCode({
    code: rawCode,
    productId: "promo-subscription",
    priceId: "monthly",
  });
  expect(createRes.status).toBe(200);
  expect(createRes.body).toMatchObject({
    code: rawCode,
    display_name: "E2E percent promo",
    discount_type: "percent",
    percent_off_bps: 2500,
    amount_off_usd_cents: null,
    subscription_duration: "first_invoice",
    product_id: "promo-subscription",
    price_id: "monthly",
    deleted_at_millis: null,
  });

  const promoCodeId = createRes.body.id;
  const listRes = await niceBackendFetch("/api/latest/internal/payments/promo-codes?limit=100", {
    accessType: "admin",
  });
  expect(listRes.status).toBe(200);
  expect(listRes.body.items.some((item: { id: string }) => item.id === promoCodeId)).toBe(true);

  const detailRes = await niceBackendFetch(`/api/latest/internal/payments/promo-codes/${promoCodeId}`, {
    accessType: "admin",
  });
  expect(detailRes.status).toBe(200);
  expect(detailRes.body).toMatchObject({
    id: promoCodeId,
    display_name: "E2E percent promo",
  });

  const patchRes = await niceBackendFetch(`/api/latest/internal/payments/promo-codes/${promoCodeId}`, {
    method: "PATCH",
    accessType: "admin",
    body: {
      display_name: "E2E percent promo disabled",
      disabled: true,
    },
  });
  expect(patchRes.status).toBe(200);
  expect(patchRes.body).toMatchObject({
    id: promoCodeId,
    display_name: "E2E percent promo disabled",
    disabled_at_millis: expect.any(Number),
  });

  const deleteRes = await niceBackendFetch(`/api/latest/internal/payments/promo-codes/${promoCodeId}`, {
    method: "DELETE",
    accessType: "admin",
  });
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ success: true });

  const deletedListRes = await niceBackendFetch("/api/latest/internal/payments/promo-codes?include_deleted=true&limit=100", {
    accessType: "admin",
  });
  expect(deletedListRes.status).toBe(200);
  const deleted = deletedListRes.body.items.find((item: { id: string }) => item.id === promoCodeId);
  expect(deleted).toMatchObject({
    id: promoCodeId,
    deleted_at_millis: expect.any(Number),
  });
});

it("should validate promo code quotes and reject invalid, disabled, deleted, and expired codes", async ({ expect }) => {
  await setupProjectWithPromoProducts();
  const { userId } = await Auth.fastSignUp();
  const purchaseCode = await createPurchaseCode({ userId, productId: "promo-subscription" });
  const createRes = await createPercentPromoCode({ code: uniquePromoCode("VALIDATE") });
  expect(createRes.status).toBe(200);

  const validQuote = await niceBackendFetch("/api/latest/payments/purchases/validate-promo-code", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: purchaseCode,
      price_id: "monthly",
      quantity: 1,
      promo_code: createRes.body.code,
    },
  });
  expect(validQuote.status).toBe(200);
  if (validQuote.body.valid !== true) {
    throw new Error(`Expected promo code to validate, received ${JSON.stringify(validQuote.body)}`);
  }
  expect(validQuote.body).toMatchObject({
    valid: true,
    promo_code_id: createRes.body.id,
    discount_type: "percent",
    percent_off_bps: 2500,
    original_amount_usd_cents: 2000,
    discount_amount_usd_cents: 500,
    final_amount_usd_cents: 1500,
    subscription_duration: "first_invoice",
  });

  const invalidQuote = await niceBackendFetch("/api/latest/payments/purchases/validate-promo-code", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: purchaseCode,
      price_id: "monthly",
      quantity: 1,
      promo_code: uniquePromoCode("MISSING"),
    },
  });
  expect(invalidQuote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: "Promo code does not exist.",
    },
  });

  const disabledRes = await niceBackendFetch(`/api/latest/internal/payments/promo-codes/${createRes.body.id}`, {
    method: "PATCH",
    accessType: "admin",
    body: {
      disabled: true,
    },
  });
  expect(disabledRes.status).toBe(200);

  const disabledQuote = await niceBackendFetch("/api/latest/payments/purchases/validate-promo-code", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: purchaseCode,
      price_id: "monthly",
      quantity: 1,
      promo_code: createRes.body.code,
    },
  });
  expect(disabledQuote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: "Promo code is disabled.",
    },
  });

  const expiredRes = await createPercentPromoCode({
    code: uniquePromoCode("EXPIRED"),
    expiresAtMillis: Date.now() - 60_000,
  });
  expect(expiredRes.status).toBe(200);

  const expiredQuote = await niceBackendFetch("/api/latest/payments/purchases/validate-promo-code", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: purchaseCode,
      price_id: "monthly",
      quantity: 1,
      promo_code: expiredRes.body.code,
    },
  });
  expect(expiredQuote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: "Promo code has expired.",
    },
  });

  const deletedRes = await createAmountOffPromoCode({ code: uniquePromoCode("DELETED") });
  expect(deletedRes.status).toBe(200);
  const deleteRes = await niceBackendFetch(`/api/latest/internal/payments/promo-codes/${deletedRes.body.id}`, {
    method: "DELETE",
    accessType: "admin",
  });
  expect(deleteRes.status).toBe(200);

  const deletedQuote = await niceBackendFetch("/api/latest/payments/purchases/validate-promo-code", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: purchaseCode,
      price_id: "monthly",
      quantity: 1,
      promo_code: deletedRes.body.code,
    },
  });
  expect(deletedQuote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: "Promo code does not exist.",
    },
  });
});

it("should prevent cross-project promo code validation", async ({ expect }) => {
  await setupProjectWithPromoProducts();
  const createRes = await createPercentPromoCode({ code: uniquePromoCode("PROJECTA") });
  expect(createRes.status).toBe(200);
  const projectACode = createRes.body.code;

  await setupProjectWithPromoProducts();
  const { userId } = await Auth.fastSignUp();
  const projectBPurchaseCode = await createPurchaseCode({ userId, productId: "promo-subscription" });

  const quote = await niceBackendFetch("/api/latest/payments/purchases/validate-promo-code", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: projectBPurchaseCode,
      price_id: "monthly",
      quantity: 1,
      promo_code: projectACode,
    },
  });
  expect(quote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: "Promo code does not exist.",
    },
  });
});

it("should keep checkout unchanged without promo_code and apply promo codes in test mode when supplied", async ({ expect }) => {
  await setupProjectWithPromoProducts();

  const { userId: defaultUserId } = await Auth.fastSignUp();
  const defaultPurchaseCode = await createPurchaseCode({ userId: defaultUserId, productId: "promo-one-time" });
  const defaultCheckout = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: {
      full_code: defaultPurchaseCode,
      price_id: "single",
      quantity: 1,
    },
  });
  expect(defaultCheckout.status).toBe(200);
  expect(defaultCheckout.body).toEqual({ success: true });

  const fixedPromo = await createAmountOffPromoCode({ code: uniquePromoCode("CHECKOUT") });
  expect(fixedPromo.status).toBe(200);
  const { userId: discountedUserId } = await Auth.fastSignUp();
  const discountedPurchaseCode = await createPurchaseCode({ userId: discountedUserId, productId: "promo-one-time" });

  const discountedCheckout = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: {
      full_code: discountedPurchaseCode,
      price_id: "single",
      quantity: 2,
      promo_code: fixedPromo.body.code,
    },
  });
  expect(discountedCheckout.status).toBe(200);
  expect(discountedCheckout.body).toEqual({ success: true });

  const redemptions = await niceBackendFetch(`/api/latest/internal/payments/promo-codes/${fixedPromo.body.id}/redemptions`, {
    accessType: "admin",
  });
  expect(redemptions.status).toBe(200);
  expect(redemptions.body.items).toHaveLength(1);
  expect(redemptions.body.items[0]).toMatchObject({
    promo_code_id: fixedPromo.body.id,
    customer_type: "user",
    customer_id: discountedUserId,
    product_id: "promo-one-time",
    price_id: "single",
    quantity: 2,
    original_amount_usd_cents: 10000,
    discount_amount_usd_cents: 1250,
    final_amount_usd_cents: 8750,
    subscription_duration: "forever",
    status: "applied",
    applied_at_millis: expect.any(Number),
  });
});
