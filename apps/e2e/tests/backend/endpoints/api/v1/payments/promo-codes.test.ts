import { randomUUID } from "node:crypto";
import { wait } from "@hexclave/shared/dist/utils/promises";
import { it } from "../../../../../helpers";
import { Auth, Payments, Project, niceBackendFetch } from "../../../../backend-helpers";
import { createPurchaseCode } from "../../../../helpers/payments";

function uniquePromoCode(prefix: string) {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 12)}`.toUpperCase();
}

const promoUnavailableMessage = "Promo code is invalid or not available for this purchase.";
const promoWindowBufferMillis = 60 * 60 * 1000;

async function setupProjectWithPromoProducts(options: { testMode?: boolean } = {}) {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: options.testMode ?? true,
      productLines: {
        promo: { displayName: "Promo Products" },
        other: { displayName: "Other Products" },
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
            yearly: {
              USD: "200",
              interval: [1, "year"],
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
        "other-one-time": {
          displayName: "Other One-Time",
          customerType: "user",
          serverOnly: false,
          productLineId: "other",
          stackable: true,
          prices: {
            single: {
              USD: "30",
            },
          },
          includedItems: {},
        },
        "zero-subscription": {
          displayName: "Zero Subscription",
          customerType: "user",
          serverOnly: false,
          productLineId: "promo",
          stackable: false,
          prices: {
            zero: {
              USD: "0.00",
              interval: [1, "month"],
            },
          },
          includedItems: {},
        },
        "tiny-one-time": {
          displayName: "Tiny One-Time",
          customerType: "user",
          serverOnly: false,
          productLineId: "promo",
          stackable: true,
          prices: {
            zero: {
              USD: "0.00",
            },
            belowMinimum: {
              USD: "0.01",
            },
          },
          includedItems: {},
        },
      },
    },
  });
}

type CreatePromoCodeOptions = {
  code?: string,
  displayName?: string,
  discountType?: "percent" | "amount_off_usd",
  percentOffBps?: number,
  amountOffUsdCents?: number,
  subscriptionDuration?: "first_invoice" | "forever",
  customerType?: "user" | "team" | "custom",
  customerId?: string,
  productLineId?: string,
  productId?: string,
  priceId?: string,
  maxRedemptions?: number,
  maxRedemptionsPerCustomer?: number,
  startsAtMillis?: number,
  expiresAtMillis?: number,
};

async function createPromoCode(options: CreatePromoCodeOptions = {}) {
  const response = await niceBackendFetch("/api/latest/internal/payments/promo-codes", {
    method: "POST",
    accessType: "admin",
    body: {
      code: options.code ?? uniquePromoCode("PERCENT"),
      display_name: options.displayName ?? "E2E percent promo",
      discount_type: options.discountType ?? "percent",
      percent_off_bps: options.percentOffBps,
      amount_off_usd_cents: options.amountOffUsdCents,
      subscription_duration: options.subscriptionDuration ?? "first_invoice",
      customer_type: options.customerType,
      customer_id: options.customerId,
      product_line_id: options.productLineId,
      product_id: options.productId,
      price_id: options.priceId,
      max_redemptions: options.maxRedemptions,
      max_redemptions_per_customer: options.maxRedemptionsPerCustomer,
      starts_at_millis: options.startsAtMillis,
      expires_at_millis: options.expiresAtMillis,
    },
  });
  return response;
}

async function createPercentPromoCode(options: CreatePromoCodeOptions = {}) {
  return await createPromoCode({
    ...options,
    discountType: "percent",
    percentOffBps: options.percentOffBps ?? 2500,
  });
}

async function createAmountOffPromoCode(options: { code?: string } = {}) {
  return await createPromoCode({
    code: options.code ?? uniquePromoCode("AMOUNT"),
    displayName: "E2E fixed promo",
    discountType: "amount_off_usd",
    amountOffUsdCents: 1250,
    subscriptionDuration: "forever",
  });
}

async function quotePromoCode(options: {
  fullCode: string,
  priceId: string,
  quantity?: number,
  promoCode: string,
}) {
  return await niceBackendFetch("/api/latest/payments/purchases/validate-promo-code", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: options.fullCode,
      price_id: options.priceId,
      quantity: options.quantity ?? 1,
      promo_code: options.promoCode,
    },
  });
}

async function redeemTestModePurchase(options: {
  fullCode: string,
  priceId: string,
  quantity?: number,
  promoCode?: string,
}) {
  return await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: {
      full_code: options.fullCode,
      price_id: options.priceId,
      quantity: options.quantity,
      promo_code: options.promoCode,
    },
  });
}

async function listPromoRedemptions(promoCodeId: string, options: { limit?: number, cursor?: string } = {}) {
  const query = new URLSearchParams();
  if (options.limit != null) query.set("limit", String(options.limit));
  if (options.cursor) query.set("cursor", options.cursor);
  return await niceBackendFetch(`/api/latest/internal/payments/promo-codes/${promoCodeId}/redemptions${query.size ? `?${query.toString()}` : ""}`, {
    accessType: "admin",
  });
}

async function waitForPromoRedemptionStatus(promoCodeId: string, status: "reserved" | "applied" | "voided") {
  let lastStatus: string | undefined;
  for (let i = 0; i < 30; i++) {
    const redemptions = await listPromoRedemptions(promoCodeId);
    if (redemptions.status !== 200) {
      throw new Error(`Unexpected ${redemptions.status} reading promo redemptions`);
    }
    lastStatus = redemptions.body.items[0]?.status;
    if (lastStatus === status) {
      return redemptions.body.items[0];
    }
    await wait(500);
  }
  throw new Error(`Promo redemption never reached ${status} (last seen: ${lastStatus})`);
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

  const defaultListRes = await niceBackendFetch("/api/latest/internal/payments/promo-codes", {
    accessType: "admin",
  });
  expect(defaultListRes.status).toBe(200);
  expect(defaultListRes.body.items.some((item: { id: string }) => item.id === promoCodeId)).toBe(true);

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

it("should reject malformed promo-code ids before database lookup", async ({ expect }) => {
  await setupProjectWithPromoProducts();

  const detailRes = await niceBackendFetch("/api/latest/internal/payments/promo-codes/not-a-uuid", {
    accessType: "admin",
  });
  expect(detailRes.status).toBe(400);

  const updateRes = await niceBackendFetch("/api/latest/internal/payments/promo-codes/not-a-uuid", {
    method: "PATCH",
    accessType: "admin",
    body: { display_name: "bad id" },
  });
  expect(updateRes.status).toBe(400);

  const deleteRes = await niceBackendFetch("/api/latest/internal/payments/promo-codes/not-a-uuid", {
    method: "DELETE",
    accessType: "admin",
  });
  expect(deleteRes.status).toBe(400);

  const redemptionsRes = await niceBackendFetch("/api/latest/internal/payments/promo-codes/not-a-uuid/redemptions", {
    accessType: "admin",
  });
  expect(redemptionsRes.status).toBe(400);
});

it("should reject invalid admin promo-code mutations", async ({ expect }) => {
  await setupProjectWithPromoProducts();
  const validCode = uniquePromoCode("MUTATION");

  const missingPercent = await createPromoCode({
    code: validCode,
    discountType: "percent",
    subscriptionDuration: "first_invoice",
  });
  expect(missingPercent).toMatchObject({
    status: 400,
    body: "percent_off_bps must be between 1 and 10000 for percent promo codes.",
  });

  const conflictingPercent = await createPromoCode({
    code: uniquePromoCode("CONFLICT"),
    discountType: "percent",
    percentOffBps: 1000,
    amountOffUsdCents: 100,
    subscriptionDuration: "first_invoice",
  });
  expect(conflictingPercent).toMatchObject({
    status: 400,
    body: "amount_off_usd_cents must not be set for percent promo codes.",
  });

  const customerWithoutType = await createPromoCode({
    code: uniquePromoCode("CUSTOMER"),
    discountType: "amount_off_usd",
    amountOffUsdCents: 100,
    customerId: "customer-without-type",
    subscriptionDuration: "forever",
  });
  expect(customerWithoutType).toMatchObject({
    status: 400,
    body: "customer_type is required when customer_id is set.",
  });

  const invalidWindow = await createPromoCode({
    code: uniquePromoCode("WINDOW"),
    discountType: "amount_off_usd",
    amountOffUsdCents: 100,
    startsAtMillis: 2_000,
    expiresAtMillis: 1_000,
    subscriptionDuration: "forever",
  });
  expect(invalidWindow).toMatchObject({
    status: 400,
    body: "expires_at_millis must be after starts_at_millis.",
  });

  const shortCode = await createPercentPromoCode({
    code: "ABC",
  });
  expect(shortCode).toMatchObject({
    status: 400,
    body: "Promo code must be at least 4 characters.",
  });

  const duplicateCode = uniquePromoCode("DUPLICATE");
  const firstDuplicate = await createPercentPromoCode({ code: duplicateCode });
  expect(firstDuplicate.status).toBe(200);
  const secondDuplicate = await createPercentPromoCode({ code: duplicateCode });
  expect(secondDuplicate).toMatchObject({
    status: 409,
    body: "Promo code already exists.",
  });

  const unauthorizedList = await niceBackendFetch("/api/latest/internal/payments/promo-codes", {
    accessType: "client",
  });
  expect(unauthorizedList.status).toBeGreaterThanOrEqual(400);
  expect(unauthorizedList.status).toBeLessThan(500);
});

it("should validate promo code quotes and reject invalid, disabled, deleted, and expired codes", async ({ expect }) => {
  await setupProjectWithPromoProducts();
  const { userId } = await Auth.fastSignUp();
  const purchaseCode = await createPurchaseCode({ userId, productId: "promo-subscription" });
  const createRes = await createPercentPromoCode({ code: uniquePromoCode("VALIDATE") });
  expect(createRes.status).toBe(200);

  const validQuote = await quotePromoCode({
    fullCode: purchaseCode,
    priceId: "monthly",
    promoCode: createRes.body.code,
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

  const invalidQuote = await quotePromoCode({
    fullCode: purchaseCode,
    priceId: "monthly",
    promoCode: uniquePromoCode("MISSING"),
  });
  expect(invalidQuote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: promoUnavailableMessage,
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

  const disabledQuote = await quotePromoCode({
    fullCode: purchaseCode,
    priceId: "monthly",
    promoCode: createRes.body.code,
  });
  expect(disabledQuote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: promoUnavailableMessage,
    },
  });

  const expiredRes = await createPercentPromoCode({
    code: uniquePromoCode("EXPIRED"),
    expiresAtMillis: Date.now() - promoWindowBufferMillis,
  });
  expect(expiredRes.status).toBe(200);

  const expiredQuote = await quotePromoCode({
    fullCode: purchaseCode,
    priceId: "monthly",
    promoCode: expiredRes.body.code,
  });
  expect(expiredQuote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: promoUnavailableMessage,
    },
  });

  const deletedRes = await createAmountOffPromoCode({ code: uniquePromoCode("DELETED") });
  expect(deletedRes.status).toBe(200);
  const deleteRes = await niceBackendFetch(`/api/latest/internal/payments/promo-codes/${deletedRes.body.id}`, {
    method: "DELETE",
    accessType: "admin",
  });
  expect(deleteRes.status).toBe(200);

  const deletedQuote = await quotePromoCode({
    fullCode: purchaseCode,
    priceId: "monthly",
    promoCode: deletedRes.body.code,
  });
  expect(deletedQuote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: promoUnavailableMessage,
    },
  });
});

it("should enforce promo-code start windows and customer/product scopes", async ({ expect }) => {
  await setupProjectWithPromoProducts();
  const { userId: allowedUserId } = await Auth.fastSignUp();
  const subscriptionCode = await createPurchaseCode({ userId: allowedUserId, productId: "promo-subscription" });
  const otherLineCode = await createPurchaseCode({ userId: allowedUserId, productId: "other-one-time" });
  const { userId: otherUserId } = await Auth.fastSignUp();
  const otherCustomerCode = await createPurchaseCode({ userId: otherUserId, productId: "promo-subscription" });

  const notStarted = await createPercentPromoCode({
    code: uniquePromoCode("FUTURE"),
    startsAtMillis: Date.now() + promoWindowBufferMillis,
  });
  expect(notStarted.status).toBe(200);
  const notStartedQuote = await quotePromoCode({
    fullCode: subscriptionCode,
    priceId: "monthly",
    promoCode: notStarted.body.code,
  });
  expect(notStartedQuote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: promoUnavailableMessage,
    },
  });

  const productLineScoped = await createPercentPromoCode({
    code: uniquePromoCode("LINE"),
    productLineId: "promo",
  });
  expect(productLineScoped.status).toBe(200);
  const wrongLineQuote = await quotePromoCode({
    fullCode: otherLineCode,
    priceId: "single",
    promoCode: productLineScoped.body.code,
  });
  expect(wrongLineQuote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: promoUnavailableMessage,
    },
  });

  const productScoped = await createPercentPromoCode({
    code: uniquePromoCode("PRODUCT"),
    productId: "promo-subscription",
  });
  expect(productScoped.status).toBe(200);
  const wrongProductQuote = await quotePromoCode({
    fullCode: otherLineCode,
    priceId: "single",
    promoCode: productScoped.body.code,
  });
  expect(wrongProductQuote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: promoUnavailableMessage,
    },
  });

  const priceScoped = await createPercentPromoCode({
    code: uniquePromoCode("PRICE"),
    priceId: "monthly",
  });
  expect(priceScoped.status).toBe(200);
  const wrongPriceQuote = await quotePromoCode({
    fullCode: subscriptionCode,
    priceId: "yearly",
    promoCode: priceScoped.body.code,
  });
  expect(wrongPriceQuote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: promoUnavailableMessage,
    },
  });

  const customerScoped = await createPercentPromoCode({
    code: uniquePromoCode("CUSTOMERSCOPE"),
    customerType: "user",
    customerId: allowedUserId,
  });
  expect(customerScoped.status).toBe(200);
  const wrongCustomerQuote = await quotePromoCode({
    fullCode: otherCustomerCode,
    priceId: "monthly",
    promoCode: customerScoped.body.code,
  });
  expect(wrongCustomerQuote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: promoUnavailableMessage,
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
      error: promoUnavailableMessage,
    },
  });
});

it("should keep checkout unchanged without promo_code and apply promo codes in test mode when supplied", async ({ expect }) => {
  await setupProjectWithPromoProducts();

  const { userId: defaultUserId } = await Auth.fastSignUp();
  const defaultPurchaseCode = await createPurchaseCode({ userId: defaultUserId, productId: "promo-one-time" });
  const fixedPromo = await createAmountOffPromoCode({ code: uniquePromoCode("CHECKOUT") });
  expect(fixedPromo.status).toBe(200);

  const defaultCheckout = await redeemTestModePurchase({
    fullCode: defaultPurchaseCode,
    priceId: "single",
    quantity: 1,
  });
  expect(defaultCheckout.status).toBe(200);
  expect(defaultCheckout.body).toEqual({ success: true });

  const defaultRedemptions = await listPromoRedemptions(fixedPromo.body.id);
  expect(defaultRedemptions.status).toBe(200);
  expect(defaultRedemptions.body.items).toHaveLength(0);

  const { userId: discountedUserId } = await Auth.fastSignUp();
  const discountedPurchaseCode = await createPurchaseCode({ userId: discountedUserId, productId: "promo-one-time" });

  const discountedCheckout = await redeemTestModePurchase({
    fullCode: discountedPurchaseCode,
    priceId: "single",
    quantity: 2,
    promoCode: fixedPromo.body.code,
  });
  expect(discountedCheckout.status).toBe(200);
  expect(discountedCheckout.body).toEqual({ success: true });

  const redemptions = await listPromoRedemptions(fixedPromo.body.id);
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

it("should paginate promo-code redemptions with cursors", async ({ expect }) => {
  await setupProjectWithPromoProducts();
  const promo = await createAmountOffPromoCode({ code: uniquePromoCode("PAGED") });
  expect(promo.status).toBe(200);

  for (let i = 0; i < 3; i++) {
    const { userId } = await Auth.fastSignUp();
    const code = await createPurchaseCode({ userId, productId: "promo-one-time" });
    const checkout = await redeemTestModePurchase({
      fullCode: code,
      priceId: "single",
      promoCode: promo.body.code,
    });
    expect(checkout.status).toBe(200);
  }

  const firstPage = await listPromoRedemptions(promo.body.id, { limit: 2 });
  expect(firstPage.status).toBe(200);
  expect(firstPage.body.items).toHaveLength(2);
  expect(firstPage.body.next_cursor).toEqual(expect.any(String));

  const secondPage = await listPromoRedemptions(promo.body.id, { limit: 2, cursor: firstPage.body.next_cursor });
  expect(secondPage.status).toBe(200);
  expect(secondPage.body.items).toHaveLength(1);
  expect(secondPage.body.next_cursor).toBeNull();

  const seenIds = new Set([...firstPage.body.items, ...secondPage.body.items].map((item: { id: string }) => item.id));
  expect(seenIds.size).toBe(3);
});

it("should void one-time promo redemptions when Stripe cancels the payment intent", async ({ expect }) => {
  await setupProjectWithPromoProducts({ testMode: false });
  const promo = await createAmountOffPromoCode({ code: uniquePromoCode("CANCELED") });
  expect(promo.status).toBe(200);

  const accountInfo = await niceBackendFetch("/api/latest/internal/payments/stripe/account-info", {
    accessType: "admin",
  });
  expect(accountInfo.status).toBe(200);
  const accountId: string = accountInfo.body.account_id;

  const { userId } = await Auth.fastSignUp();
  const code = await createPurchaseCode({ userId, productId: "promo-one-time" });
  const purchaseSession = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: code,
      price_id: "single",
      quantity: 1,
      promo_code: promo.body.code,
    },
  });
  expect(purchaseSession.status).toBe(200);
  const clientSecret = purchaseSession.body.client_secret;
  expect(clientSecret).toEqual(expect.any(String));
  const paymentIntentId = clientSecret.split("_secret_")[0];
  const tenancyId = code.split("_")[0];

  const beforeCancel = await listPromoRedemptions(promo.body.id);
  expect(beforeCancel.status).toBe(200);
  expect(beforeCancel.body.items).toHaveLength(1);
  expect(beforeCancel.body.items[0]).toMatchObject({
    status: "reserved",
  });

  const webhook = await Payments.sendStripeWebhook({
    id: `evt_promo_cancel_${randomUUID()}`,
    type: "payment_intent.canceled",
    account: accountId,
    data: {
      object: {
        id: paymentIntentId,
        stack_stripe_mock_data: {
          "accounts.retrieve": { metadata: { tenancyId } },
        },
        metadata: {
          purchaseKind: "ONE_TIME",
          promoCodeRedemptionId: beforeCancel.body.items[0].id,
        },
      },
    },
  });
  expect(webhook.status).toBe(200);

  await expect(waitForPromoRedemptionStatus(promo.body.id, "voided")).resolves.toMatchObject({
    status: "voided",
    voided_at_millis: expect.any(Number),
  });
});

it("should only apply subscription promo redemptions after Stripe sync reports an active subscription", async ({ expect }) => {
  await setupProjectWithPromoProducts({ testMode: false });
  const promo = await createPercentPromoCode({ code: uniquePromoCode("SUBSTATUS") });
  expect(promo.status).toBe(200);

  const accountInfo = await niceBackendFetch("/api/latest/internal/payments/stripe/account-info", {
    accessType: "admin",
  });
  expect(accountInfo.status).toBe(200);
  const accountId: string = accountInfo.body.account_id;

  const { userId } = await Auth.fastSignUp();
  const code = await createPurchaseCode({ userId, productId: "promo-subscription" });
  const purchaseSession = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: code,
      price_id: "monthly",
      quantity: 1,
      promo_code: promo.body.code,
    },
  });
  expect(purchaseSession.status).toBe(200);

  const redemptions = await listPromoRedemptions(promo.body.id);
  expect(redemptions.status).toBe(200);
  expect(redemptions.body.items).toHaveLength(1);
  const redemptionId = redemptions.body.items[0].id;
  expect(redemptions.body.items[0]).toMatchObject({ status: "reserved" });

  const tenancyId = code.split("_")[0];
  const nowSec = Math.floor(Date.now() / 1000);
  const product = {
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
      yearly: {
        USD: "200",
        interval: [1, "year"],
      },
    },
    includedItems: {},
  };
  const sendSubscriptionSync = async (status: "incomplete" | "active") => await Payments.sendStripeWebhook({
    id: `evt_promo_sub_${status}_${randomUUID()}`,
    type: "customer.subscription.updated",
    account: accountId,
    data: {
      object: {
        customer: "cus_promo_subscription_status",
        stack_stripe_mock_data: {
          "accounts.retrieve": { metadata: { tenancyId } },
          "customers.retrieve": { metadata: { customerId: userId, customerType: "USER" } },
          "subscriptions.list": {
            data: [{
              id: "sub_promo_subscription_status",
              status,
              items: {
                data: [{
                  quantity: 1,
                  current_period_start: nowSec,
                  current_period_end: nowSec + 30 * 24 * 60 * 60,
                }],
              },
              metadata: {
                promoCodeRedemptionId: redemptionId,
                productId: "promo-subscription",
                product: JSON.stringify(product),
                priceId: "monthly",
              },
              cancel_at_period_end: false,
            }],
          },
        },
      },
    },
  });

  const incompleteWebhook = await sendSubscriptionSync("incomplete");
  expect(incompleteWebhook.status).toBe(200);
  const afterIncomplete = await listPromoRedemptions(promo.body.id);
  expect(afterIncomplete.status).toBe(200);
  expect(afterIncomplete.body.items[0]).toMatchObject({ status: "reserved" });

  const activeWebhook = await sendSubscriptionSync("active");
  expect(activeWebhook.status).toBe(200);
  await expect(waitForPromoRedemptionStatus(promo.body.id, "applied")).resolves.toMatchObject({
    status: "applied",
    applied_at_millis: expect.any(Number),
  });
});

it("should enforce redemption limits during validation and checkout", async ({ expect }) => {
  await setupProjectWithPromoProducts();
  const limitedPromo = await createPercentPromoCode({
    code: uniquePromoCode("LIMIT"),
    maxRedemptions: 1,
    maxRedemptionsPerCustomer: 1,
  });
  expect(limitedPromo.status).toBe(200);

  const { userId: firstUserId } = await Auth.fastSignUp();
  const firstCode = await createPurchaseCode({ userId: firstUserId, productId: "promo-one-time" });
  const firstCheckout = await redeemTestModePurchase({
    fullCode: firstCode,
    priceId: "single",
    promoCode: limitedPromo.body.code,
  });
  expect(firstCheckout.status).toBe(200);

  const firstUserSecondCode = await createPurchaseCode({ userId: firstUserId, productId: "promo-one-time" });
  const perCustomerQuote = await quotePromoCode({
    fullCode: firstUserSecondCode,
    priceId: "single",
    promoCode: limitedPromo.body.code,
  });
  expect(perCustomerQuote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: promoUnavailableMessage,
    },
  });

  const { userId: secondUserId } = await Auth.fastSignUp();
  const secondCode = await createPurchaseCode({ userId: secondUserId, productId: "promo-one-time" });
  const globalLimitCheckout = await redeemTestModePurchase({
    fullCode: secondCode,
    priceId: "single",
    promoCode: limitedPromo.body.code,
  });
  expect(globalLimitCheckout).toMatchObject({
    status: 400,
    body: promoUnavailableMessage,
  });
});

it("should enforce per-customer redemption limits independently from global limits", async ({ expect }) => {
  await setupProjectWithPromoProducts();
  const perCustomerPromo = await createPercentPromoCode({
    code: uniquePromoCode("PERUSER"),
    maxRedemptionsPerCustomer: 1,
  });
  expect(perCustomerPromo.status).toBe(200);

  const { userId: firstUserId } = await Auth.fastSignUp();
  const firstCode = await createPurchaseCode({ userId: firstUserId, productId: "promo-one-time" });
  const firstCheckout = await redeemTestModePurchase({
    fullCode: firstCode,
    priceId: "single",
    promoCode: perCustomerPromo.body.code,
  });
  expect(firstCheckout.status).toBe(200);

  const firstUserSecondCode = await createPurchaseCode({ userId: firstUserId, productId: "promo-one-time" });
  const perCustomerQuote = await quotePromoCode({
    fullCode: firstUserSecondCode,
    priceId: "single",
    promoCode: perCustomerPromo.body.code,
  });
  expect(perCustomerQuote).toMatchObject({
    status: 200,
    body: {
      valid: false,
      error: promoUnavailableMessage,
    },
  });

  const { userId: secondUserId } = await Auth.fastSignUp();
  const secondCode = await createPurchaseCode({ userId: secondUserId, productId: "promo-one-time" });
  const secondCheckout = await redeemTestModePurchase({
    fullCode: secondCode,
    priceId: "single",
    promoCode: perCustomerPromo.body.code,
  });
  expect(secondCheckout.status).toBe(200);
});

it("should cap fixed discounts and round percent discounts", async ({ expect }) => {
  await setupProjectWithPromoProducts();
  const cappedPromo = await createPromoCode({
    code: uniquePromoCode("CAP"),
    displayName: "E2E cap promo",
    discountType: "amount_off_usd",
    amountOffUsdCents: 10_000,
    subscriptionDuration: "forever",
  });
  expect(cappedPromo.status).toBe(200);

  const { userId: cappedUserId } = await Auth.fastSignUp();
  const cappedCode = await createPurchaseCode({ userId: cappedUserId, productId: "promo-one-time" });
  const cappedQuote = await quotePromoCode({
    fullCode: cappedCode,
    priceId: "single",
    promoCode: cappedPromo.body.code,
  });
  expect(cappedQuote).toMatchObject({
    status: 200,
    body: {
      valid: true,
      original_amount_usd_cents: 5000,
      discount_amount_usd_cents: 5000,
      final_amount_usd_cents: 0,
    },
  });

  const roundedPromo = await createPercentPromoCode({
    code: uniquePromoCode("ROUND"),
    percentOffBps: 3333,
  });
  expect(roundedPromo.status).toBe(200);
  const { userId: roundedUserId } = await Auth.fastSignUp();
  const roundedCode = await createPurchaseCode({ userId: roundedUserId, productId: "other-one-time" });
  const roundedQuote = await quotePromoCode({
    fullCode: roundedCode,
    priceId: "single",
    promoCode: roundedPromo.body.code,
  });
  expect(roundedQuote).toMatchObject({
    status: 200,
    body: {
      valid: true,
      original_amount_usd_cents: 3000,
      discount_amount_usd_cents: 999,
      final_amount_usd_cents: 2001,
    },
  });
});

it("should apply percent promo codes to subscription checkout in test mode", async ({ expect }) => {
  await setupProjectWithPromoProducts();
  const promo = await createPercentPromoCode({
    code: uniquePromoCode("SUB"),
    subscriptionDuration: "first_invoice",
  });
  expect(promo.status).toBe(200);

  const { userId } = await Auth.fastSignUp();
  const code = await createPurchaseCode({ userId, productId: "promo-subscription" });
  const checkout = await redeemTestModePurchase({
    fullCode: code,
    priceId: "monthly",
    promoCode: promo.body.code,
  });
  expect(checkout.status).toBe(200);
  expect(checkout.body).toEqual({ success: true });

  const redemptions = await listPromoRedemptions(promo.body.id);
  expect(redemptions.status).toBe(200);
  expect(redemptions.body.items).toHaveLength(1);
  expect(redemptions.body.items[0]).toMatchObject({
    promo_code_id: promo.body.id,
    customer_type: "user",
    customer_id: userId,
    product_id: "promo-subscription",
    price_id: "monthly",
    quantity: 1,
    original_amount_usd_cents: 2000,
    discount_amount_usd_cents: 500,
    final_amount_usd_cents: 1500,
    subscription_duration: "first_invoice",
    status: "applied",
    applied_at_millis: expect.any(Number),
  });
});

it("should return a setup client secret for live first-invoice promos that discount subscriptions to zero", async ({ expect }) => {
  await setupProjectWithPromoProducts({ testMode: false });
  const promo = await createPercentPromoCode({
    code: uniquePromoCode("SETUP"),
    percentOffBps: 10000,
    subscriptionDuration: "first_invoice",
  });
  expect(promo.status).toBe(200);

  const { userId } = await Auth.fastSignUp();
  const code = await createPurchaseCode({ userId, productId: "promo-subscription" });
  const purchaseSession = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: code,
      price_id: "monthly",
      quantity: 1,
      promo_code: promo.body.code,
    },
  });

  expect(purchaseSession).toMatchObject({
    status: 200,
    body: {
      client_secret: expect.any(String),
      client_secret_type: "setup",
    },
  });
});

it("should skip Stripe confirmation for live forever promos that discount subscriptions to zero", async ({ expect }) => {
  await setupProjectWithPromoProducts({ testMode: false });
  const promo = await createPercentPromoCode({
    code: uniquePromoCode("FOREVER"),
    percentOffBps: 10000,
    subscriptionDuration: "forever",
  });
  expect(promo.status).toBe(200);

  const { userId } = await Auth.fastSignUp();
  const code = await createPurchaseCode({ userId, productId: "promo-subscription" });
  const purchaseSession = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: code,
      price_id: "monthly",
      quantity: 1,
      promo_code: promo.body.code,
    },
  });

  expect(purchaseSession).toMatchObject({
    status: 200,
    body: {},
  });
});

it("should use Stripe cents for free and minimum purchase-session checks", async ({ expect }) => {
  await setupProjectWithPromoProducts({ testMode: false });

  const { userId: subscriptionUserId } = await Auth.fastSignUp();
  const subscriptionCode = await createPurchaseCode({ userId: subscriptionUserId, productId: "zero-subscription" });
  const subscriptionSession = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: subscriptionCode,
      price_id: "zero",
      quantity: 1,
    },
  });
  expect(subscriptionSession).toMatchObject({
    status: 200,
    body: {},
  });

  const { userId: zeroOneTimeUserId } = await Auth.fastSignUp();
  const zeroOneTimeCode = await createPurchaseCode({ userId: zeroOneTimeUserId, productId: "tiny-one-time" });
  const zeroOneTimeSession = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: zeroOneTimeCode,
      price_id: "zero",
      quantity: 1,
    },
  });
  expect(zeroOneTimeSession).toMatchObject({
    status: 400,
    body: "Free products must have a billing interval",
  });

  const { userId: belowMinimumUserId } = await Auth.fastSignUp();
  const belowMinimumCode = await createPurchaseCode({ userId: belowMinimumUserId, productId: "tiny-one-time" });
  const belowMinimumSession = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: belowMinimumCode,
      price_id: "belowMinimum",
      quantity: 1,
    },
  });
  expect(belowMinimumSession).toMatchObject({
    status: 400,
    body: "One-time prices must be at least $0.50 (Stripe minimum)",
  });
});
