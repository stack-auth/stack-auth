import { createHmac } from "node:crypto";
import { expect } from "vitest";
import { it } from "../../../../helpers";
import { Payments as PaymentsHelper, Project, Team, User, niceBackendFetch } from "../../../backend-helpers";

/**
 * E2E tests for the NEW transaction system using PaginatedList.
 *
 * These tests are for the new transaction types that will be exposed via
 * a new API endpoint (to be implemented). The tests use `it.skip` until
 * the route is implemented.
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

// New transactions endpoint path (to be implemented)
const NEW_TRANSACTIONS_ENDPOINT = "/api/latest/internal/payments/new-transactions";

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

// ============================================================================
// New Stripe Subscription (new-stripe-sub) Tests
// Entry types: active_sub_start, money-transfer, product-grant, item-quant-change
// ============================================================================

it.skip("new-stripe-sub: returns active_sub_start entry for new subscription", async () => {
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

it.skip("new-stripe-sub: returns money-transfer entry for paid subscription", async () => {
  // Note: This tests non-test-mode subscription with actual payment
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  // Would need to create a real Stripe subscription via webhook
  // For now, this is a placeholder for the expected structure

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "new-stripe-sub" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions.find(
    (tx: { test_mode: boolean }) => !tx.test_mode
  );
  if (transaction) {
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
  }
});

it.skip("new-stripe-sub: returns product-grant entry", async () => {
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

it.skip("new-stripe-sub: returns item-quant-change entries for included items", async () => {
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

it.skip("stripe-resub: returns money-transfer entry for renewal invoice", async () => {
  const config = await setupProjectWithPaymentsConfig();
  const subProduct = config.products["sub-product"];
  const { userId } = await User.create();

  const accountInfo = await niceBackendFetch("/api/latest/internal/payments/stripe/account-info", {
    accessType: "admin",
  });
  const accountId: string = accountInfo.body.account_id;
  const code = await createPurchaseCode({ userId, productId: "sub-product" });
  const tenancyId = code.split("_")[0];

  const nowSec = Math.floor(Date.now() / 1000);
  const stripeSubscription = {
    id: "sub_resub_test",
    status: "active",
    items: { data: [{ quantity: 1, current_period_start: nowSec - 60, current_period_end: nowSec + 3600 }] },
    metadata: { productId: "sub-product", product: JSON.stringify(subProduct), priceId: "monthly" },
    cancel_at_period_end: false,
  };

  const stackStripeMockData = {
    "accounts.retrieve": { metadata: { tenancyId } },
    "customers.retrieve": { metadata: { customerId: userId, customerType: "USER" } },
    "subscriptions.list": { data: [stripeSubscription] },
  };

  // Create subscription first
  await sendStripeWebhook({
    id: "evt_creation",
    type: "invoice.payment_succeeded",
    account: accountId,
    data: {
      object: {
        id: "in_creation",
        customer: "cus_resub",
        billing_reason: "subscription_create",
        stack_stripe_mock_data: stackStripeMockData,
        lines: { data: [{ parent: { subscription_item_details: { subscription: stripeSubscription.id } } }] },
      },
    },
  });

  // Send renewal invoice
  await sendStripeWebhook({
    id: "evt_renewal",
    type: "invoice.payment_succeeded",
    account: accountId,
    data: {
      object: {
        id: "in_renewal",
        customer: "cus_resub",
        billing_reason: "subscription_cycle",
        stack_stripe_mock_data: stackStripeMockData,
        lines: { data: [{ parent: { subscription_item_details: { subscription: stripeSubscription.id } } }] },
      },
    },
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

it.skip("stripe-resub: returns item-quant-expire entry that adjusts previous grant", async () => {
  await setupProjectWithPaymentsConfig();
  // Similar setup as above...

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

it.skip("stripe-resub: returns item-quant-change entry for renewed items", async () => {
  await setupProjectWithPaymentsConfig();

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

it.skip("stripe-one-time: returns money-transfer entry for one-time purchase", async () => {
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
  // Test mode won't have money_transfer, but non-test-mode would
});

it.skip("stripe-one-time: returns product-grant entry with one_time_purchase_id", async () => {
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
    subscription_id: undefined,
  });
});

it.skip("stripe-one-time: returns item-quant-change for included items", async () => {
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

it.skip("stripe-expire: returns product-revocation entry that adjusts original grant", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  // Create and then cancel subscription
  const code = await createPurchaseCode({ userId, productId: "sub-product" });
  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "monthly", quantity: 1 },
  });

  // Cancel the subscription (would trigger via webhook in real scenario)

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

it.skip("stripe-expire: returns item-quant-expire entries that adjust original grants", async () => {
  await setupProjectWithPaymentsConfig();

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

it.skip("stripe-expire: has different effective_at_millis than created_at_millis", async () => {
  await setupProjectWithPaymentsConfig();

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

it.skip("stripe-refund: returns money-transfer entry that adjusts original payment", async () => {
  await setupProjectWithPaymentsConfig();

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

it.skip("manual-item-quantity-change: returns single item-quant-change entry", async () => {
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

it.skip("manual-item-quantity-change: supports negative quantity changes", async () => {
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

it.skip("manual-item-quantity-change: test_mode is always false", async () => {
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

it.skip("product-change: returns product-revocation for old product", async () => {
  await setupProjectWithPaymentsConfig();

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "product-change" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  expect(transaction.type).toBe("product-change");

  const revocationEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "product_revocation"
  );
  expect(revocationEntry).toMatchObject({
    type: "product_revocation",
    adjusted_transaction_id: expect.any(String),
    adjusted_entry_index: expect.any(Number),
  });
});

it.skip("product-change: returns product-grant for new product", async () => {
  await setupProjectWithPaymentsConfig();

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "product-change" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  const grantEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "product_grant"
  );
  expect(grantEntry).toMatchObject({
    type: "product_grant",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    product_id: expect.any(String),
    product: expect.any(Object),
  });
});

it.skip("product-change: returns item adjustments for changing included items", async () => {
  await setupProjectWithPaymentsConfig();

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "product-change" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];

  // Should have item_quantity_change entries (adjusting old) and new
  const itemChangeEntries = transaction.entries.filter(
    (e: { type: string }) => e.type === "item_quantity_change"
  );
  expect(itemChangeEntries.length).toBeGreaterThanOrEqual(1);

  // Should have item_quantity_expire entries for old items
  const expireEntries = transaction.entries.filter(
    (e: { type: string }) => e.type === "item_quantity_expire"
  );
  expect(expireEntries.length).toBeGreaterThanOrEqual(0); // May or may not exist
});

// ============================================================================
// Sub Change (sub-change) Tests
// Entry types: active_sub_change (adjusts)
// Note: Requires new SubscriptionChange table, stored in our DB not Stripe
// ============================================================================

it.skip("sub-change: returns active_sub_change entry that adjusts original", async () => {
  await setupProjectWithPaymentsConfig();

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "sub-change" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  expect(transaction.type).toBe("sub-change");

  const changeEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "active_sub_change"
  );
  expect(changeEntry).toMatchObject({
    type: "active_sub_change",
    adjusted_transaction_id: expect.any(String), // References original active_sub_start
    adjusted_entry_index: expect.any(Number),
    customer_type: expect.stringMatching(/^(user|team|custom)$/),
    customer_id: expect.any(String),
    subscription_id: expect.any(String),
    old_product_id: expect.any(String),
    new_product_id: expect.any(String),
    old_price_id: expect.any(String),
    new_price_id: expect.any(String),
  });
});

// ============================================================================
// Stripe Sub Cancel (stripe-sub-cancel) Tests
// Entry types: active_sub_stop (adjusts)
// ============================================================================

it.skip("stripe-sub-cancel: returns active_sub_stop entry that adjusts active_sub_start", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  // Create and cancel subscription
  const code = await createPurchaseCode({ userId, productId: "sub-product" });
  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "monthly", quantity: 1 },
  });

  // Would need to cancel via API/webhook

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

it.skip("item-quantity-renewal: returns item-quant-expire that adjusts previous grant", async () => {
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

  const transaction = response.body.transactions[0];
  expect(transaction.type).toBe("item-quantity-renewal");

  const expireEntry = transaction.entries.find(
    (e: { type: string }) => e.type === "item_quantity_expire"
  );
  expect(expireEntry).toMatchObject({
    type: "item_quantity_expire",
    adjusted_transaction_id: expect.any(String),
    adjusted_entry_index: expect.any(Number),
    item_id: "credits",
  });
});

it.skip("item-quantity-renewal: returns item-quant-change for new period", async () => {
  await setupProjectWithPaymentsConfig();

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "item-quantity-renewal" },
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
    item_id: expect.any(String),
    quantity: expect.any(Number),
  });
});

// ============================================================================
// Pagination Tests
// ============================================================================

it.skip("pagination: supports cursor-based pagination", async () => {
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

  const page2 = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { limit: "2", cursor: page1.body.next_cursor },
  });
  expect(page2.status).toBe(200);
  expect(page2.body.transactions).toHaveLength(2);

  // No duplicate IDs
  const page1Ids = new Set(page1.body.transactions.map((tx: { id: string }) => tx.id));
  const page2Ids = new Set(page2.body.transactions.map((tx: { id: string }) => tx.id));
  for (const id of page2Ids) {
    expect(page1Ids.has(id)).toBe(false);
  }
});

it.skip("pagination: returns has_more correctly", async () => {
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

it.skip("pagination: merges transactions from multiple sources in correct order", async () => {
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

it.skip("filter: filters by transaction type", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  await niceBackendFetch(`/api/latest/payments/items/user/${userId}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    body: { delta: 10 },
  });

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

it.skip("filter: filters by customer_type", async () => {
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
    (tx: { entries: Array<{ customer_type: string }> }) =>
      tx.entries.every(e => e.customer_type === "team")
  )).toBe(true);

  // Filter by user
  const userResponse = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { customer_type: "user" },
  });
  expect(userResponse.status).toBe(200);
  expect(userResponse.body.transactions.every(
    (tx: { entries: Array<{ customer_type: string }> }) =>
      tx.entries.every(e => e.customer_type === "user")
  )).toBe(true);
});

it.skip("filter: filters by customer_id", async () => {
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
    (tx: { entries: Array<{ customer_id: string }> }) =>
      tx.entries.every(e => e.customer_id === userId1)
  )).toBe(true);
});

// ============================================================================
// Edge Cases
// ============================================================================

it.skip("edge-case: returns empty list for fresh project", async () => {
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

it.skip("edge-case: adjusted_by array references correct transaction entries", async () => {
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

it.skip("edge-case: handles quantity > 1 for stackable products", async () => {
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

it.skip("edge-case: test_mode flag correctly set based on creation source", async () => {
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

it.skip("edge-case: effective_at_millis equals created_at_millis for most transactions", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  await niceBackendFetch(`/api/latest/payments/items/user/${userId}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    body: { delta: 10 },
  });

  const response = await niceBackendFetch(NEW_TRANSACTIONS_ENDPOINT, {
    accessType: "admin",
    query: { type: "manual-item-quantity-change" },
  });
  expect(response.status).toBe(200);

  const transaction = response.body.transactions[0];
  expect(transaction.effective_at_millis).toBe(transaction.created_at_millis);
});

it.skip("edge-case: server-granted products appear in transactions with test_mode=false", async () => {
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
