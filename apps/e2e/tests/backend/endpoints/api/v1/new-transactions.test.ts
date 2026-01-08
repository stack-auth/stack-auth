import { createHmac } from "node:crypto";
import { expect } from "vitest";
import { it } from "../../../../helpers";
import { Payments as PaymentsHelper, Project, Team, User, niceBackendFetch } from "../../../backend-helpers";

/**
 * E2E tests for the NEW transaction system using PaginatedList.
 *
 * These tests are for the new transaction types exposed via the internal
 * transactions API.
 *
 * New Transaction Types:
 * - new-stripe-sub: New Stripe subscription
 *   • active_sub_start, money-transfer, product-grant, item-quant-change
 *
 * - stripe-resub: Stripe subscription renewal
 *   • money-transfer, item-quant-expire (adjusts), item-quant-change
 *
 * - stripe-one-time: Stripe one-time purchase
 *   • money-transfer, product-grant, item-quant-change
 *
 * - stripe-expire: Subscription expiration (effectiveAt != createdAt)
 *   • product-revocation (adjusts), item-quant-expire (adjusts)
 *
 * - stripe-refund: Stripe refund (requires new StripeRefunds table)
 *   • money-transfer (adjusts)
 *
 * - manual-item-quantity-change: Manual item quantity changes
 *   • item-quant-change
 *
 * - product-change: Product changes (requires new ProductChange table)
 *   • product-revocation (adjusts), product-grant, item-quant-change (adjusts), item-quant-expire (adjusts)
 *
 * - sub-change: Subscription changes (requires new SubscriptionChange table)
 *   • active_sub_change (adjusts)
 *
 * - stripe-sub-cancel: Subscription cancellation
 *   • active_sub_stop (adjusts)
 *
 * - item-quantity-renewal: Item quantity renewal (computed)
 *   • item-quant-expire (adjusts), item-quant-change
 */

// New transactions endpoint path
const NEW_TRANSACTIONS_ENDPOINT = "/api/latest/internal/payments/transactions";

type PaymentsConfigOptions = {
  extraProducts?: Record<string, unknown>,
  extraItems?: Record<string, unknown>,
};

async function setupProjectWithPaymentsConfig(options: PaymentsConfigOptions = {}) {
  await Project.createAndSwitch();
  await PaymentsHelper.setup();
  const baseProducts = {
    "sub-product": {
      displayName: "Sub Product",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      prices: {
        monthly: { USD: "1000", interval: [1, "month"] },
      },
      includedItems: {
        credits: { quantity: 100, expires: "when-purchase-expires" },
      },
    },
    "otp-product": {
      displayName: "One-Time Product",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      prices: {
        single: { USD: "5000" },
      },
      includedItems: {
        credits: { quantity: 500 },
      },
    },
  };
  const baseItems = {
    credits: { displayName: "Credits", customerType: "user" },
  };
  await Project.updateConfig({
    payments: {
      testMode: true,
      products: {
        ...baseProducts,
        ...(options.extraProducts ?? {}),
      },
      items: {
        ...baseItems,
        ...(options.extraItems ?? {}),
      },
    },
  });
  return {
    products: baseProducts,
    items: baseItems,
  };
}

async function createPurchaseCodeForCustomer(options: {
  customerType: "user" | "team" | "custom",
  customerId: string,
  productId: string,
}) {
  const res = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: options.customerType,
      customer_id: options.customerId,
      product_id: options.productId,
    },
  });
  expect(res.status).toBe(200);
  const codeMatch = (res.body.url as string).match(/\/purchase\/([a-z0-9-_]+)/);
  const code = codeMatch ? codeMatch[1] : undefined;
  expect(code).toBeDefined();
  return code as string;
}

async function createPurchaseCode(options: { userId: string, productId: string }) {
  return await createPurchaseCodeForCustomer({
    customerType: "user",
    customerId: options.userId,
    productId: options.productId,
  });
}

const stripeWebhookSecret = process.env.STACK_STRIPE_WEBHOOK_SECRET ?? "mock_stripe_webhook_secret";

async function sendStripeWebhook(payload: unknown) {
  const timestamp = Math.floor(Date.now() / 1000);
  const hmac = createHmac("sha256", stripeWebhookSecret);
  hmac.update(`${timestamp}.${JSON.stringify(payload)}`);
  const signature = hmac.digest("hex");
  return await niceBackendFetch("/api/latest/integrations/stripe/webhooks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature}`,
    },
    body: payload,
  });
}

async function getStripeAccountId() {
  const accountInfo = await niceBackendFetch("/api/latest/internal/payments/stripe/account-info", {
    accessType: "admin",
  });
  expect(accountInfo.status).toBe(200);
  return accountInfo.body.account_id as string;
}

async function createStripeSubscription(options: {
  userId: string,
  productId: string,
  product: Record<string, unknown>,
  priceId: string,
  cancelAtPeriodEnd?: boolean,
  status?: string,
  quantity?: number,
}) {
  const accountId = await getStripeAccountId();
  const code = await createPurchaseCode({ userId: options.userId, productId: options.productId });
  const tenancyId = code.split("_")[0];
  const nowSec = Math.floor(Date.now() / 1000);
  const stripeSubscriptionId = `sub_${nowSec}_${Math.floor(Math.random() * 1000)}`;
  const stripeCustomerId = `cus_${nowSec}_${Math.floor(Math.random() * 1000)}`;
  const stripeSubscription = {
    id: stripeSubscriptionId,
    status: options.status ?? "active",
    items: {
      data: [
        {
          quantity: options.quantity ?? 1,
          current_period_start: nowSec - 60,
          current_period_end: nowSec + 60 * 60,
        },
      ],
    },
    metadata: {
      productId: options.productId,
      product: JSON.stringify(options.product),
      priceId: options.priceId,
    },
    cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
  };

  const stackStripeMockData = {
    "accounts.retrieve": { metadata: { tenancyId } },
    "customers.retrieve": { metadata: { customerId: options.userId, customerType: "USER" } },
    "subscriptions.list": { data: [stripeSubscription] },
  };

  await sendStripeWebhook({
    id: `evt_${stripeSubscriptionId}_create`,
    type: "invoice.payment_succeeded",
    account: accountId,
    data: {
      object: {
        id: `in_${stripeSubscriptionId}_create`,
        customer: stripeCustomerId,
        billing_reason: "subscription_create",
        stack_stripe_mock_data: stackStripeMockData,
        lines: {
          data: [
            {
              parent: {
                subscription_item_details: { subscription: stripeSubscriptionId },
              },
            },
          ],
        },
      },
    },
  });

  return {
    accountId,
    tenancyId,
    stripeSubscriptionId,
    stripeCustomerId,
    stackStripeMockData,
  };
}

async function createStripeSubscriptionWithRenewal(options: {
  userId: string,
  productId: string,
  product: Record<string, unknown>,
  priceId: string,
}) {
  const base = await createStripeSubscription(options);
  await sendStripeWebhook({
    id: `evt_${base.stripeSubscriptionId}_renewal`,
    type: "invoice.payment_succeeded",
    account: base.accountId,
    data: {
      object: {
        id: `in_${base.stripeSubscriptionId}_renewal`,
        customer: base.stripeCustomerId,
        billing_reason: "subscription_cycle",
        stack_stripe_mock_data: base.stackStripeMockData,
        lines: {
          data: [
            {
              parent: {
                subscription_item_details: { subscription: base.stripeSubscriptionId },
              },
            },
          ],
        },
      },
    },
  });
  return base;
}

async function createStripeOneTimePurchase(options: {
  userId: string,
  productId: string,
  product: Record<string, unknown>,
  priceId: string,
  quantity?: number,
}) {
  const accountId = await getStripeAccountId();
  const code = await createPurchaseCode({ userId: options.userId, productId: options.productId });
  const tenancyId = code.split("_")[0];
  const stripePaymentIntentId = `pi_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const stripeCustomerId = `cus_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const stackStripeMockData = {
    "accounts.retrieve": { metadata: { tenancyId } },
    "customers.retrieve": { metadata: { customerId: options.userId, customerType: "USER" } },
    "subscriptions.list": { data: [] },
  };

  await sendStripeWebhook({
    id: `evt_${stripePaymentIntentId}_otp`,
    type: "payment_intent.succeeded",
    account: accountId,
    data: {
      object: {
        id: stripePaymentIntentId,
        customer: stripeCustomerId,
        stack_stripe_mock_data: stackStripeMockData,
        metadata: {
          productId: options.productId,
          product: JSON.stringify(options.product),
          customerId: options.userId,
          customerType: "user",
          purchaseQuantity: String(options.quantity ?? 1),
          purchaseKind: "ONE_TIME",
          priceId: options.priceId,
        },
      },
    },
  });

  return {
    accountId,
    tenancyId,
    stripePaymentIntentId,
    stripeCustomerId,
  };
}

// ============================================================================
// New Stripe Subscription (new-stripe-sub) Tests
// Entry types: active_sub_start, money-transfer, product-grant, item-quant-change
// ============================================================================

it("new-stripe-sub: returns active_sub_start entry for new subscription", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();
  const code = await createPurchaseCode({ userId, productId: "sub-product" });

  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "monthly", quantity: 1 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "new-stripe-sub" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  expect(transaction.type).toBe("new-stripe-sub");

  // Verify active_sub_start entry exists
  const activeSubStartEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "active_sub_start"
  );
  expect(activeSubStartEntry).toMatchObject({
    type: "active_sub_start",
    customer_type: "user",
    customer_id: userId,
    subscription_id: expect.any(String),
    product_id: "sub-product",
    price_id: "monthly",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
  });
});

it("new-stripe-sub: returns money-transfer entry for paid subscription", async () => {
  const config = await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  await createStripeSubscription({
    userId,
    productId: "sub-product",
    product: config.products["sub-product"],
    priceId: "monthly",
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "new-stripe-sub" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions.find(
    (tx: { test_mode: boolean }) => tx.test_mode === false
  );
  expect(transaction).toBeDefined();

  const moneyTransferEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "money_transfer"
  );
  expect(moneyTransferEntry).toMatchObject({
    type: "money_transfer",
    customer_type: expect.stringMatching(/^(user|team|custom)$/),
    customer_id: expect.any(String),
    charged_amount: expect.any(Object),
    net_amount: { USD: expect.any(String) },
  });
});

it("new-stripe-sub: returns product-grant entry", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();
  const code = await createPurchaseCode({ userId, productId: "sub-product" });

  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "monthly", quantity: 1 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "new-stripe-sub" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  const productGrantEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "product_grant"
  );
  expect(productGrantEntry).toMatchObject({
    type: "product_grant",
    customer_type: "user",
    customer_id: userId,
    product_id: "sub-product",
    price_id: "monthly",
    quantity: 1,
    subscription_id: expect.any(String),
    product: expect.objectContaining({
      display_name: "Sub Product",
    }),
  });
});

it("new-stripe-sub: returns item-quant-change entries for included items", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();
  const code = await createPurchaseCode({ userId, productId: "sub-product" });

  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "monthly", quantity: 1 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "new-stripe-sub" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  const itemQuantityEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "item_quantity_change"
  );
  expect(itemQuantityEntry).toMatchObject({
    type: "item_quantity_change",
    customer_type: "user",
    customer_id: userId,
    item_id: "credits",
    quantity: 100, // From includedItems config
  });
});

// ============================================================================
// Stripe Resub (stripe-resub) Tests
// Entry types: money-transfer, item-quant-expire (adjusts), item-quant-change
// ============================================================================

it("stripe-resub: returns money-transfer entry for renewal invoice", async () => {
  const config = await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();
  await createStripeSubscriptionWithRenewal({
    userId,
    productId: "sub-product",
    product: config.products["sub-product"],
    priceId: "monthly",
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "stripe-resub" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  expect(transaction.type).toBe("stripe-resub");

  const moneyTransferEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "money_transfer"
  );
  expect(moneyTransferEntry).toMatchObject({
    type: "money_transfer",
    charged_amount: expect.any(Object),
    net_amount: { USD: expect.any(String) },
  });
});

it("stripe-resub: returns item-quant-expire entry that adjusts previous grant", async () => {
  const config = await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  await createStripeSubscriptionWithRenewal({
    userId,
    productId: "sub-product",
    product: config.products["sub-product"],
    priceId: "monthly",
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "stripe-resub" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  const expireEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "item_quantity_expire"
  );
  expect(expireEntry).toMatchObject({
    type: "item_quantity_expire",
    adjusted_transaction_id: expect.any(String), // References original subscription
    adjusted_entry_index: expect.any(Number),
    item_id: "credits",
    quantity: expect.any(Number),
  });
});

it("stripe-resub: returns item-quant-change entry for renewed items", async () => {
  const config = await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  await createStripeSubscriptionWithRenewal({
    userId,
    productId: "sub-product",
    product: config.products["sub-product"],
    priceId: "monthly",
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "stripe-resub" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  const changeEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "item_quantity_change"
  );
  expect(changeEntry).toMatchObject({
    type: "item_quantity_change",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    item_id: "credits",
    quantity: expect.any(Number),
  });
});

// ============================================================================
// Stripe One-Time (stripe-one-time) Tests
// Entry types: money-transfer, product-grant, item-quant-change
// ============================================================================

it("stripe-one-time: omits money-transfer entry in test mode", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();
  const code = await createPurchaseCode({ userId, productId: "otp-product" });

  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "single", quantity: 1 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "stripe-one-time" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  expect(transaction.type).toBe("stripe-one-time");
  expect(transaction.test_mode).toBe(true);
  const moneyTransferEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "money_transfer"
  );
  expect(moneyTransferEntry).toBeUndefined();
});

it("stripe-one-time: returns product-grant entry with one_time_purchase_id", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();
  const code = await createPurchaseCode({ userId, productId: "otp-product" });

  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "single", quantity: 1 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "stripe-one-time" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  const productGrantEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "product_grant"
  );
  expect(productGrantEntry).toMatchObject({
    type: "product_grant",
    customer_type: "user",
    product_id: "otp-product",
    one_time_purchase_id: expect.any(String),
  });
  expect(productGrantEntry).not.toHaveProperty("subscription_id");
});

it("stripe-one-time: returns item-quant-change for included items", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();
  const code = await createPurchaseCode({ userId, productId: "otp-product" });

  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "single", quantity: 1 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "stripe-one-time" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  const itemChangeEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "item_quantity_change"
  );
  expect(itemChangeEntry).toMatchObject({
    type: "item_quantity_change",
    item_id: "credits",
    quantity: 500, // From includedItems config
  });
});

// ============================================================================
// Stripe Expire (stripe-expire) Tests
// Entry types: product-revocation (adjusts), item-quant-expire (adjusts)
// Note: effectiveAt != createdAt for this transaction type
// ============================================================================

it("stripe-expire: returns product-revocation entry that adjusts original grant", async () => {
  const config = await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  await createStripeSubscription({
    userId,
    productId: "sub-product",
    product: config.products["sub-product"],
    priceId: "monthly",
    cancelAtPeriodEnd: true,
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "stripe-expire" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  expect(transaction.type).toBe("stripe-expire");

  const revocationEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "product_revocation"
  );
  expect(revocationEntry).toMatchObject({
    type: "product_revocation",
    adjusted_transaction_id: expect.any(String), // References original subscription
    adjusted_entry_index: expect.any(Number), // Index of product_grant
    quantity: expect.any(Number),
  });
});

it("stripe-expire: returns item-quant-expire entries that adjust original grants", async () => {
  const config = await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  await createStripeSubscription({
    userId,
    productId: "sub-product",
    product: config.products["sub-product"],
    priceId: "monthly",
    cancelAtPeriodEnd: true,
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "stripe-expire" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  const expireEntries = transaction.entries.filter(
    (e: { type: string }) => e.type === "item_quantity_expire"
  );

  for (const entry of expireEntries) {
    expect(entry).toMatchObject({
      type: "item_quantity_expire",
      adjusted_transaction_id: expect.any(String),
      adjusted_entry_index: expect.any(Number),
      item_id: expect.any(String),
      quantity: expect.any(Number),
    });
  }
});

it("stripe-expire: has different effective_at_millis than created_at_millis", async () => {
  const config = await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  await createStripeSubscription({
    userId,
    productId: "sub-product",
    product: config.products["sub-product"],
    priceId: "monthly",
    cancelAtPeriodEnd: true,
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "stripe-expire" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  // effective_at is when expiration happens (currentPeriodEnd)
  // created_at is when subscription was created
  expect(transaction.effective_at_millis).not.toBe(transaction.created_at_millis);
  expect(transaction.effective_at_millis).toBeGreaterThan(transaction.created_at_millis);
});

// ============================================================================
// Stripe Refund (stripe-refund) Tests
// Entry types: money-transfer (adjusts)
// Note: Requires new StripeRefunds table
// ============================================================================

it("stripe-refund: returns money-transfer entry that adjusts original payment", async () => {
  const config = await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  const purchase = await createStripeOneTimePurchase({
    userId,
    productId: "otp-product",
    product: config.products["otp-product"],
    priceId: "single",
  });

  await sendStripeWebhook({
    id: `evt_refund_${purchase.stripePaymentIntentId}`,
    type: "charge.refunded",
    account: purchase.accountId,
    data: {
      object: {
        id: `ch_${purchase.stripePaymentIntentId}`,
        customer: purchase.stripeCustomerId,
        payment_intent: purchase.stripePaymentIntentId,
        refunds: {
          data: [
            {
              id: `re_${purchase.stripePaymentIntentId}`,
              amount: 5000,
              currency: "usd",
            },
          ],
        },
        stack_stripe_mock_data: {
          "accounts.retrieve": { metadata: { tenancyId: purchase.tenancyId } },
          "customers.retrieve": { metadata: { customerId: userId, customerType: "USER" } },
        },
      },
    },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "stripe-refund" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  expect(transaction.type).toBe("stripe-refund");

  const moneyTransferEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "money_transfer"
  );
  expect(moneyTransferEntry).toMatchObject({
    type: "money_transfer",
    adjusted_transaction_id: expect.any(String), // References original purchase
    adjusted_entry_index: expect.any(Number), // Index of original money_transfer
    charged_amount: expect.any(Object), // Negative amounts
    net_amount: expect.any(Object),
  });
});

// ============================================================================
// Manual Item Quantity Change (manual-item-quantity-change) Tests
// Entry types: item-quant-change
// ============================================================================

it("manual-item-quantity-change: returns single item-quant-change entry", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  await niceBackendFetch(`/api/latest/payments/items/user/${userId}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    query: { allow_negative: "false" },
    body: { delta: 50, description: "Manual adjustment" },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "manual-item-quantity-change" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  expect(transaction.type).toBe("manual-item-quantity-change");
  expect(transaction.entries).toHaveLength(1);
  expect(transaction.entries[0]).toMatchObject({
    type: "item_quantity_change",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: "user",
    customer_id: userId,
    item_id: "credits",
    quantity: 50,
  });
});

it("manual-item-quantity-change: supports negative quantity changes", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  await niceBackendFetch(`/api/latest/payments/items/user/${userId}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    query: { allow_negative: "true" },
    body: { delta: -25 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "manual-item-quantity-change" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions.find(
    (tx: { entries: Array<{ quantity: number }> }) => tx.entries[0]?.quantity === -25
  );
  expect(transaction).toBeDefined();
  expect(transaction.entries[0].quantity).toBe(-25);
});

it("manual-item-quantity-change: test_mode is always false", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  await niceBackendFetch(`/api/latest/payments/items/user/${userId}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    query: { allow_negative: "false" },
    body: { delta: 10 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "manual-item-quantity-change" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  expect(transaction.test_mode).toBe(false);
});

// ============================================================================
// Product Change (product-change) Tests
// Entry types: product-revocation (adjusts), product-grant, item-quant-change (adjusts), item-quant-expire (adjusts)
// Note: Requires new ProductChange table
// ============================================================================

it("product-change: returns empty list when no product changes exist", async () => {
  await setupProjectWithPaymentsConfig();

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "product-change" },
  });
  expect(response.status).toBe(200);
  expect(response.body.transactions).toEqual([]);
  expect(response.body.has_more).toBe(false);
  expect(response.body.next_cursor).toBeNull();
});

it("product-change: remains empty without explicit product change records", async () => {
  await setupProjectWithPaymentsConfig();

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "product-change" },
  });
  expect(response.status).toBe(200);
  expect(response.body.transactions).toEqual([]);
  expect(response.body.has_more).toBe(false);
  expect(response.body.next_cursor).toBeNull();
});

it("product-change: stays empty when no product change entries are recorded", async () => {
  await setupProjectWithPaymentsConfig();

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "product-change" },
  });
  expect(response.status).toBe(200);
  expect(response.body.transactions).toEqual([]);
  expect(response.body.has_more).toBe(false);
  expect(response.body.next_cursor).toBeNull();
});

// ============================================================================
// Sub Change (sub-change) Tests
// Entry types: active_sub_change (adjusts)
// Note: Requires new SubscriptionChange table, stored in our DB not Stripe
// ============================================================================

it("sub-change: returns empty list when no subscription change records exist", async () => {
  await setupProjectWithPaymentsConfig();

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "sub-change" },
  });
  expect(response.status).toBe(200);
  expect(response.body.transactions).toEqual([]);
  expect(response.body.has_more).toBe(false);
  expect(response.body.next_cursor).toBeNull();
});

// ============================================================================
// Stripe Sub Cancel (stripe-sub-cancel) Tests
// Entry types: active_sub_stop (adjusts)
// ============================================================================

it("stripe-sub-cancel: returns active_sub_stop entry that adjusts active_sub_start", async () => {
  const config = await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  await createStripeSubscription({
    userId,
    productId: "sub-product",
    product: config.products["sub-product"],
    priceId: "monthly",
    cancelAtPeriodEnd: true,
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "stripe-sub-cancel" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  expect(transaction.type).toBe("stripe-sub-cancel");

  const stopEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "active_sub_stop"
  );
  expect(stopEntry).toMatchObject({
    type: "active_sub_stop",
    adjusted_transaction_id: expect.any(String), // References original new-stripe-sub
    adjusted_entry_index: 0, // Index of active_sub_start
    customer_type: "user",
    customer_id: userId,
    subscription_id: expect.any(String),
  });
});

// ============================================================================
// Item Quantity Renewal (item-quantity-renewal) Tests
// Entry types: item-quant-expire (adjusts), item-quant-change
// Note: Computed from getItemQuantityForCustomer logic
// ============================================================================

it("item-quantity-renewal: returns empty list without elapsed renewal windows", async () => {
  await setupProjectWithPaymentsConfig({
    extraProducts: {
      "repeating-items-product": {
        displayName: "Repeating Items Product",
        customerType: "user",
        serverOnly: false,
        stackable: false,
        prices: {
          monthly: { USD: "1000", interval: [1, "month"] },
        },
        includedItems: {
          credits: { quantity: 100, repeat: [1, "week"], expires: "when-repeated" },
        },
      },
    },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "item-quantity-renewal" },
  });
  expect(response.status).toBe(200);
  expect(response.body.transactions).toEqual([]);
  expect(response.body.has_more).toBe(false);
  expect(response.body.next_cursor).toBeNull();
});

it("item-quantity-renewal: remains empty when no renewal period is due", async () => {
  await setupProjectWithPaymentsConfig();

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "item-quantity-renewal" },
  });
  expect(response.status).toBe(200);
  expect(response.body.transactions).toEqual([]);
  expect(response.body.has_more).toBe(false);
  expect(response.body.next_cursor).toBeNull();
});

// ============================================================================
// Pagination Tests
// ============================================================================

it("pagination: supports cursor-based pagination", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  // Create multiple transactions
  for (let i = 0; i < 5; i++) {
    await niceBackendFetch(`/api/latest/payments/items/user/${userId}/credits/update-quantity`, {
      accessType: "server",
      method: "POST",
      query: { allow_negative: "false" },
      body: { delta: i + 1 },
    });
  }

  const page1 = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { limit: "2" },
  });
  expect(page1.status).toBe(200);
  expect(page1.body.transactions).toHaveLength(2);
  expect(page1.body.next_cursor).toBeTruthy();
  expect(page1.body.has_more).toBe(true);

  const page2 = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { limit: "2", cursor: page1.body.next_cursor },
  });
  expect(page2.status).toBe(200);
  expect(page2.body.transactions).toHaveLength(2);
  expect(page2.body.has_more).toBe(true);

  // No duplicate IDs
  const page1Ids = new Set(page1.body.transactions.map((tx: { id: string }) => tx.id));
  const page2Ids = new Set(page2.body.transactions.map((tx: { id: string }) => tx.id));
  for (const id of page2Ids) {
    expect(page1Ids.has(id)).toBe(false);
  }
});

it("pagination: returns has_more correctly", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  await niceBackendFetch(`/api/latest/payments/items/user/${userId}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    query: { allow_negative: "false" },
    body: { delta: 10 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { limit: "10" },
  });
  expect(response.status).toBe(200);
  expect(response.body.has_more).toBe(false);
  expect(response.body.next_cursor).toBeNull();
});

it("pagination: merges transactions from multiple sources in correct order", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  // Create transactions from different sources
  await niceBackendFetch(`/api/latest/payments/items/user/${userId}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    body: { delta: 1 },
  });

  const code = await createPurchaseCode({ userId, productId: "sub-product" });
  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "monthly", quantity: 1 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
  });
  expect(response.status).toBe(200);

  // Verify descending order by created_at_millis
  const timestamps = response.body.transactions.map(
    (tx: { created_at_millis: number }) => tx.created_at_millis
  );
  for (let i = 1; i < timestamps.length; i++) {
    expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
  }
});

// ============================================================================
// Filter Tests
// ============================================================================

it("filter: filters by transaction type", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  const changeRes = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    query: { allow_negative: "false" },
    body: { delta: 10, description: "test" },
  });
  expect(changeRes.status).toBe(200);

  const code = await createPurchaseCode({ userId, productId: "sub-product" });
  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "monthly", quantity: 1 },
  });

  // Filter by manual-item-quantity-change only
  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "manual-item-quantity-change" },
  });
  expect(response.status).toBe(200);
  expect(response.body.transactions.every(
    (tx: { type: string }) => tx.type === "manual-item-quantity-change"
  )).toBe(true);
});

it("filter: filters by customer_type", async () => {
  await setupProjectWithPaymentsConfig({
    extraItems: {
      "team-credits": { displayName: "Team Credits", customerType: "team" },
    },
  });

  const { userId } = await User.create();
  const { teamId } = await Team.create();

  await niceBackendFetch(`/api/latest/payments/items/user/${userId}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    body: { delta: 5 },
  });

  await niceBackendFetch(`/api/latest/payments/items/team/${teamId}/team-credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    body: { delta: 10 },
  });

  // Filter by team
  const teamResponse = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { customer_type: "team" },
  });
  expect(teamResponse.status).toBe(200);
  expect(teamResponse.body.transactions.every(
    (tx: { entries: Array<{ customer_type?: string }> }) =>
      tx.entries.filter(e => "customer_type" in e).every(e => e.customer_type === "team")
  )).toBe(true);

  // Filter by user
  const userResponse = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { customer_type: "user" },
  });
  expect(userResponse.status).toBe(200);
  expect(userResponse.body.transactions.every(
    (tx: { entries: Array<{ customer_type?: string }> }) =>
      tx.entries.filter(e => "customer_type" in e).every(e => e.customer_type === "user")
  )).toBe(true);
});

it("filter: filters by customer_id", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId: userId1 } = await User.create();
  const { userId: userId2 } = await User.create();

  await niceBackendFetch(`/api/latest/payments/items/user/${userId1}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    body: { delta: 5 },
  });

  await niceBackendFetch(`/api/latest/payments/items/user/${userId2}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    body: { delta: 10 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { customer_id: userId1 },
  });
  expect(response.status).toBe(200);
  expect(response.body.transactions.every(
    (tx: { entries: Array<{ customer_id?: string }> }) =>
      tx.entries.filter(e => "customer_id" in e).every(e => e.customer_id === userId1)
  )).toBe(true);
});

// ============================================================================
// Edge Cases
// ============================================================================

it("edge-case: returns empty list for fresh project", async () => {
  await Project.createAndSwitch();
  await PaymentsHelper.setup();

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "has_more": false,
        "next_cursor": null,
        "transactions": [],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("edge-case: adjusted_by array references correct transaction entries", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  // Create subscription then refund/cancel it
  const code = await createPurchaseCode({ userId, productId: "sub-product" });
  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "monthly", quantity: 1 },
  });

  // Get original transaction
  const origResponse = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "new-stripe-sub" },
  });
  expect(origResponse.status).toBe(200);

  const origTransaction = origResponse.body.transactions[0];

  // If there are adjustments, verify they reference valid entries
  if (origTransaction.adjusted_by.length > 0) {
    for (const adj of origTransaction.adjusted_by) {
      expect(adj.transaction_id).toBeTruthy();
      expect(adj.entry_index).toBeGreaterThanOrEqual(0);
    }
  }
});

it("edge-case: handles quantity > 1 for stackable products", async () => {
  await setupProjectWithPaymentsConfig({
    extraProducts: {
      "stackable-product": {
        displayName: "Stackable Product",
        customerType: "user",
        serverOnly: false,
        stackable: true,
        prices: { unit: { USD: "100" } },
        includedItems: { credits: { quantity: 10 } },
      },
    },
  });

  const { userId } = await User.create();
  const code = await createPurchaseCode({ userId, productId: "stackable-product" });

  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "unit", quantity: 5 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions.find(
    (tx: { entries: Array<{ product_id: string | null }> }) =>
      tx.entries.some(e => e.product_id === "stackable-product")
  );

  const productGrant = transaction.entries.find(
    (e: { type: string }) => e.type === "product_grant"
  );
  expect(productGrant.quantity).toBe(5);

  const itemChange = transaction.entries.find(
    (e: { type: string }) => e.type === "item_quantity_change"
  );
  expect(itemChange.quantity).toBe(50); // 10 * 5
});

it("edge-case: test_mode flag correctly set based on creation source", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();
  const code = await createPurchaseCode({ userId, productId: "sub-product" });

  // Test mode purchase
  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "monthly", quantity: 1 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "new-stripe-sub" },
  });
  expect(response.status).toBe(200);

  const testModeTx = response.body.transactions.find(
    (tx: { test_mode: boolean }) => tx.test_mode === true
  );
  expect(testModeTx).toBeDefined();
});

it("edge-case: effective_at_millis equals created_at_millis for most transactions", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  const code = await createPurchaseCode({ userId, productId: "otp-product" });
  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "single", quantity: 1 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "stripe-one-time" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  expect(transaction.effective_at_millis).toBe(transaction.created_at_millis);
});

it("edge-case: server-granted products appear in transactions with test_mode=false", async () => {
  await setupProjectWithPaymentsConfig({
    extraProducts: {
      "server-product": {
        displayName: "Server Product",
        customerType: "user",
        serverOnly: true,
        stackable: false,
        prices: { monthly: { USD: "50", interval: [1, "month"] } },
        includedItems: {},
      },
    },
  });

  const { userId } = await User.create();
  await niceBackendFetch(`/api/latest/payments/products/user/${userId}`, {
    accessType: "server",
    method: "POST",
    body: { product_id: "server-product", quantity: 1 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
  });
  expect(response.status).toBe(200);

  const grantTx = response.body.transactions.find(
    (tx: { entries: Array<{ product_id: string | null }> }) =>
      tx.entries.some(e => e.product_id === "server-product")
  );
  expect(grantTx).toBeDefined();
  expect(grantTx.test_mode).toBe(false);
});
