import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, Payments, Project, niceBackendFetch } from "../../../../backend-helpers";
import {
  createLiveModeOneTimePurchaseTransaction,
  createPurchaseCode,
  createTestModeTransaction,
  setupProjectWithPaymentsConfig,
} from "../../../../helpers/payments";

/**
 * Spin up a project that has a subscription product configured, sign up a
 * user, and create a test-mode subscription via the test-mode-purchase-session
 * endpoint. Returns the new subscription's id.
 */
async function createTestModeSubscription(): Promise<{ subscriptionId: string, userId: string }> {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      products: {
        "sub-product": {
          displayName: "Sub Product",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            monthly: { USD: "5000", interval: [1, "month"] },
          },
          includedItems: {},
        },
      },
      items: {},
    },
  });
  const { userId } = await Auth.fastSignUp();
  const code = await createPurchaseCode({ userId, productId: "sub-product" });
  const sessionRes = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "monthly", quantity: 1 },
  });
  expect(sessionRes.status).toBe(200);
  // The created subscription's id is on the resulting transaction's id.
  const txnsRes = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  const purchaseTxn = txnsRes.body.transactions.find((tx: any) => tx.type === "purchase");
  expect(purchaseTxn).toBeDefined();
  return { subscriptionId: purchaseTxn.id, userId };
}

it("rejects refund when target subscription does not exist", async () => {
  await setupProjectWithPaymentsConfig();

  const missingId = randomUUID();
  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "subscription",
      id: missingId,
      amount_usd: "0",
      revoke_product: true,
      end_subscription: true,
    },
  });
  expect(refundRes.status).toBe(404);
  expect(refundRes.body.code).toBe("SUBSCRIPTION_INVOICE_NOT_FOUND");
});

it("rejects refund when target one-time purchase does not exist", async () => {
  await setupProjectWithPaymentsConfig();

  const missingId = randomUUID();
  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: missingId,
      amount_usd: "0",
      revoke_product: true,
    },
  });
  expect(refundRes.status).toBe(404);
  expect(refundRes.body.code).toBe("ONE_TIME_PURCHASE_NOT_FOUND");
});

it("rejects revoke=true,end=false on a subscription as a footgun", async () => {
  await setupProjectWithPaymentsConfig();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "subscription",
      id: randomUUID(),
      amount_usd: "0",
      revoke_product: true,
      end_subscription: false,
    },
  });
  expect(refundRes.status).toBe(400);
  expect(refundRes.body.code).toBe("SCHEMA_ERROR");
  expect(refundRes.body.error).toMatch(/Revoking a subscription's product also requires ending the subscription/);
});

it("rejects no-op refund (amount=0, revoke=false, end=false)", async () => {
  await setupProjectWithPaymentsConfig();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: randomUUID(),
      amount_usd: "0",
      revoke_product: false,
    },
  });
  expect(refundRes.status).toBe(400);
  expect(refundRes.body.code).toBe("SCHEMA_ERROR");
  expect(refundRes.body.error).toMatch(/Refund must do something/);
});

it("rejects negative refund amount", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "-1",
      revoke_product: false,
    },
  });
  expect(refundRes.status).toBe(400);
  expect(refundRes.body.code).toBe("SCHEMA_ERROR");
});

it("refunds a test-mode one-time purchase by revoking the product (no money flow)", async () => {
  await setupProjectWithPaymentsConfig();
  const { transactionId, userId } = await createTestModeTransaction("otp-product", "single");

  const productsBefore = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(productsBefore.body.items).toHaveLength(1);

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: transactionId,
      amount_usd: "0",
      revoke_product: true,
    },
  });
  expect(refundRes.status).toBe(200);
  expect(refundRes.body.success).toBe(true);
  expect(typeof refundRes.body.refund_transaction_id).toBe("string");
  expect(refundRes.body.refund_transaction_id).toMatch(/^refund:otp:/);

  const productsAfter = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(productsAfter.body.items).toHaveLength(0);
});

it("rejects nonzero amount on a test-mode purchase (no money to refund)", async () => {
  await setupProjectWithPaymentsConfig();
  const { transactionId } = await createTestModeTransaction("otp-product", "single");

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: transactionId,
      amount_usd: "10",
      revoke_product: true,
    },
  });
  expect(refundRes.status).toBe(400);
  expect(refundRes.body.code).toBe("TEST_MODE_PURCHASE_NON_REFUNDABLE");
});

it("refunds a live-mode OTP fully (money + revoke), surfaces refund row, links via adjusted_by", async () => {
  const { userId, purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "5000",
      revoke_product: true,
    },
  });
  expect(refundRes.status).toBe(200);
  expect(refundRes.body.success).toBe(true);
  const refundTxnId = refundRes.body.refund_transaction_id as string;
  expect(refundTxnId).toMatch(/^refund:otp:/);

  const transactionsAfter = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(transactionsAfter.status).toBe(200);

  // Source purchase has adjusted_by linking to the refund.
  const refundedTransaction = transactionsAfter.body.transactions.find((tx: any) => tx.id === purchaseTransaction.id);
  expect(refundedTransaction).toBeDefined();
  expect(refundedTransaction.adjusted_by).toEqual([
    {
      entry_index: 0,
      transaction_id: refundTxnId,
    },
  ]);

  // Refund row appears in the listing with type="refund".
  const refundRow = transactionsAfter.body.transactions.find((tx: any) => tx.type === "refund");
  expect(refundRow).toBeDefined();

  const productsAfter = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(productsAfter.body.items).toHaveLength(0);
});

it("supports multiple partial refunds capped at remaining amount", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  // Partial $20.00 refund — succeeds.
  const refund1 = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "2000",
      revoke_product: false,
    },
  });
  expect(refund1.status).toBe(200);

  // Partial $30.00 refund — succeeds (total now $50.00).
  const refund2 = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "3000",
      revoke_product: false,
    },
  });
  expect(refund2.status).toBe(200);

  // Third $0.01 refund — exceeds remaining ($0).
  const refund3 = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "0.01",
      revoke_product: false,
    },
  });
  expect(refund3.status).toBe(400);
  expect(refund3.body.code).toBe("SCHEMA_ERROR");
  expect(refund3.body.error).toMatch(/cannot exceed the remaining refundable amount/);
});

it("rejects revoking a product that has already been revoked", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refund1 = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "0",
      revoke_product: true,
    },
  });
  expect(refund1.status).toBe(200);

  const refund2 = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "0",
      revoke_product: true,
    },
  });
  expect(refund2.status).toBe(400);
  expect(refund2.body.code).toBe("SCHEMA_ERROR");
  expect(refund2.body.error).toMatch(/already been revoked/);
});

it("rejects refund amount exceeding original purchase amount", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "5001",
      revoke_product: false,
    },
  });
  expect(refundRes.status).toBe(400);
  expect(refundRes.body.code).toBe("SCHEMA_ERROR");
  expect(refundRes.body.error).toMatch(/cannot exceed the remaining refundable amount/);
});

it("refunds a test-mode subscription with revoke=true and end=true", async () => {
  const { subscriptionId, userId } = await createTestModeSubscription();

  // Customer has the product before refund.
  const productsBefore = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(productsBefore.body.items).toHaveLength(1);

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "subscription",
      id: subscriptionId,
      amount_usd: "0",
      revoke_product: true,
      end_subscription: true,
    },
  });
  expect(refundRes.status).toBe(200);
  expect(refundRes.body.success).toBe(true);
  expect(refundRes.body.refund_transaction_id).toMatch(/^refund:sub-start:/);

  // Subscription-end auto-emit should have stripped the customer's product.
  const productsAfter = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(productsAfter.body.items).toHaveLength(0);
});

it("rejects a second product revocation on the same subscription (productRevoked short-circuit)", async () => {
  const { subscriptionId } = await createTestModeSubscription();

  const refund1 = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "subscription",
      id: subscriptionId,
      amount_usd: "0",
      revoke_product: true,
      end_subscription: true,
    },
  });
  expect(refund1.status).toBe(200);

  const refund2 = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "subscription",
      id: subscriptionId,
      amount_usd: "0",
      revoke_product: true,
      end_subscription: true,
    },
  });
  expect(refund2.status).toBe(400);
  expect(refund2.body.code).toBe("SCHEMA_ERROR");
  expect(refund2.body.error).toMatch(/already been revoked/);
});

it("refunds a test-mode subscription with end=true only (no revoke), no money", async () => {
  const { subscriptionId } = await createTestModeSubscription();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "subscription",
      id: subscriptionId,
      amount_usd: "0",
      revoke_product: false,
      end_subscription: true,
    },
  });
  expect(refundRes.status).toBe(200);
  expect(refundRes.body.success).toBe(true);
});

/**
 * Spin up a live-mode subscription via Stripe webhooks (creation + renewal
 * invoices), and return the prisma ids of both invoices plus the user/sub.
 * Used to exercise the `invoice_id` refund path against a renewal.
 */
async function createLiveModeSubscriptionWithRenewal(): Promise<{
  userId: string,
  subscriptionId: string,
  startInvoiceId: string,
  renewalInvoiceId: string,
}> {
  await Project.createAndSwitch();
  await Payments.setup();
  const subProduct = {
    displayName: "Sub Product",
    customerType: "user",
    serverOnly: false,
    stackable: false,
    prices: {
      monthly: { USD: "1000", interval: [1, "month"] },
    },
    includedItems: {},
  };
  await Project.updateConfig({
    payments: {
      testMode: false,
      products: { "sub-product": subProduct },
      items: {},
    },
  });

  const { userId } = await Auth.fastSignUp();

  const accountInfo = await niceBackendFetch("/api/latest/internal/payments/stripe/account-info", {
    accessType: "admin",
  });
  expect(accountInfo.status).toBe(200);
  const accountId: string = accountInfo.body.account_id;

  const code = await createPurchaseCode({ userId, productId: "sub-product" });
  const tenancyId = code.split("_")[0];

  const nowSec = Math.floor(Date.now() / 1000);
  const stripeSubscription = {
    id: "sub_renewal_refund_1",
    status: "active",
    items: {
      data: [
        {
          quantity: 1,
          current_period_start: nowSec - 60,
          current_period_end: nowSec + 60 * 60,
        },
      ],
    },
    metadata: {
      productId: "sub-product",
      product: JSON.stringify(subProduct),
      priceId: "monthly",
    },
    cancel_at_period_end: false,
  };

  const stackStripeMockData = {
    "accounts.retrieve": { metadata: { tenancyId } },
    "customers.retrieve": { metadata: { customerId: userId, customerType: "USER" } },
    "subscriptions.list": { data: [stripeSubscription] },
  };

  const baseInvoiceObject = {
    customer: "cus_renewal_refund_1",
    stack_stripe_mock_data: stackStripeMockData,
    lines: {
      data: [
        {
          parent: {
            subscription_item_details: { subscription: stripeSubscription.id },
          },
        },
      ],
    },
  };

  const startWebhook = await Payments.sendStripeWebhook({
    id: "evt_renewal_refund_start",
    type: "invoice.payment_succeeded",
    account: accountId,
    data: {
      object: {
        ...baseInvoiceObject,
        id: "in_renewal_refund_start",
        billing_reason: "subscription_create",
      },
    },
  });
  expect(startWebhook.status).toBe(200);

  const renewalWebhook = await Payments.sendStripeWebhook({
    id: "evt_renewal_refund_cycle",
    type: "invoice.payment_succeeded",
    account: accountId,
    data: {
      object: {
        ...baseInvoiceObject,
        id: "in_renewal_refund_cycle",
        billing_reason: "subscription_cycle",
      },
    },
  });
  expect(renewalWebhook.status).toBe(200);

  const txnsRes = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(txnsRes.status).toBe(200);

  const purchaseTxn = txnsRes.body.transactions.find((tx: any) => tx.type === "purchase");
  expect(purchaseTxn).toBeDefined();
  const renewalTxn = txnsRes.body.transactions.find((tx: any) => tx.type === "subscription-renewal");
  expect(renewalTxn).toBeDefined();

  return {
    userId,
    subscriptionId: purchaseTxn.id,
    startInvoiceId: purchaseTxn.id,
    renewalInvoiceId: renewalTxn.id,
  };
}

it("refunds a renewal invoice (invoice_id path) without money or revoke — sourceTxnId is sub-renewal", async () => {
  const { subscriptionId, renewalInvoiceId } = await createLiveModeSubscriptionWithRenewal();

  // Use amount_usd=0 and end_subscription=true to exercise the invoice_id
  // resolution path without touching Stripe refund-side calls (which require
  // the stripe-mock to return an invoice with paid payments — out of scope
  // for this test). The route must still resolve the renewal invoice and
  // stamp the refund row with `sourceTxnId = sub-renewal:<id>`.
  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "subscription",
      id: subscriptionId,
      invoice_id: renewalInvoiceId,
      amount_usd: "0",
      revoke_product: false,
      end_subscription: true,
    },
  });
  expect(refundRes.status).toBe(200);
  expect(refundRes.body.success).toBe(true);
  expect(refundRes.body.refund_transaction_id).toMatch(
    new RegExp(`^refund:sub-renewal:${renewalInvoiceId}:`),
  );

  // The refund row should link the *renewal* transaction via adjusted_by,
  // not the subscription-start row.
  const txnsAfter = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(txnsAfter.status).toBe(200);
  const renewalTxn = txnsAfter.body.transactions.find(
    (tx: any) => tx.type === "subscription-renewal" && tx.id === renewalInvoiceId,
  );
  expect(renewalTxn).toBeDefined();
  expect(renewalTxn.adjusted_by).toEqual([
    {
      entry_index: 0,
      transaction_id: refundRes.body.refund_transaction_id,
    },
  ]);

  // And the source subscription row should NOT be linked, since this refund
  // targeted the renewal invoice.
  const startTxn = txnsAfter.body.transactions.find(
    (tx: any) => tx.type === "purchase" && tx.id === subscriptionId,
  );
  expect(startTxn?.adjusted_by ?? []).toEqual([]);
});

it("rejects refund with invoice_id that does not belong to the subscription", async () => {
  const { subscriptionId } = await createLiveModeSubscriptionWithRenewal();
  const unrelatedInvoiceId = randomUUID();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "subscription",
      id: subscriptionId,
      invoice_id: unrelatedInvoiceId,
      amount_usd: "0",
      revoke_product: false,
      end_subscription: true,
    },
  });
  expect(refundRes.status).toBe(404);
  expect(refundRes.body.code).toBe("SUBSCRIPTION_INVOICE_NOT_FOUND");
});

it("rejects invoice_id on a one-time purchase", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      invoice_id: randomUUID(),
      amount_usd: "0",
      revoke_product: true,
    },
  });
  expect(refundRes.status).toBe(400);
  expect(refundRes.body.code).toBe("SCHEMA_ERROR");
  expect(refundRes.body.error).toMatch(/invoice_id is not applicable to one-time purchases/);
});
