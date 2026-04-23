import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { Auth, Payments, Project, niceBackendFetch } from "../backend-helpers";

export function createDefaultPaymentsConfig(testMode: boolean | undefined) {
  return {
    payments: {
      testMode: testMode ?? true,
      products: {
        "sub-product": {
          displayName: "Sub Product",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            monthly: { USD: "1000", interval: [1, "month"] },
          },
          includedItems: {},
        },
        "otp-product": {
          displayName: "One-Time Product",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            single: { USD: "5000" },
          },
          includedItems: {},
        },
      },
      items: {},
    },
  };
}

export async function setupProjectWithPaymentsConfig(options: { testMode?: boolean } = {}) {
  await Project.createAndSwitch();
  await Payments.setup();
  const config = createDefaultPaymentsConfig(options.testMode);
  await Project.updateConfig(config);
  return config;
}

export async function createPurchaseCode(options: { userId: string, productId: string }) {
  const res = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: options.userId,
      product_id: options.productId,
    },
  });
  expect(res.status).toBe(200);
  const codeMatch = (res.body.url as string).match(/\/purchase\/([a-z0-9-_]+)/);
  const code = codeMatch ? codeMatch[1] : undefined;
  expect(code).toBeDefined();
  return code as string;
}

export async function createTestModeTransaction(productId: string, priceId: string) {
  const { userId } = await Auth.fastSignUp();
  const code = await createPurchaseCode({ userId, productId });
  const response = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: priceId, quantity: 1 },
  });
  expect(response.status).toBe(200);
  const transactions = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(transactions.status).toBe(200);
  expect(transactions.body.transactions.length).toBeGreaterThan(0);
  const transaction = transactions.body.transactions[0];
  return { transactionId: transaction.id, userId };
}

export async function createLiveModeOneTimePurchaseTransaction(options: { quantity?: number } = {}) {
  const config = await setupProjectWithPaymentsConfig({ testMode: false });
  const { userId } = await Auth.fastSignUp();
  const quantity = options.quantity ?? 1;

  const accountInfo = await niceBackendFetch("/api/latest/internal/payments/stripe/account-info", {
    accessType: "admin",
  });
  expect(accountInfo.status).toBe(200);
  const accountId: string = accountInfo.body.account_id;

  const code = await createPurchaseCode({ userId, productId: "otp-product" });
  const stackTestTenancyId = code.split("_")[0];
  const product = config.payments.products["otp-product"];

  const idSuffix = randomUUID().replace(/-/g, "");
  const eventId = `evt_otp_refund_${idSuffix}`;
  const paymentIntentId = `pi_otp_refund_${idSuffix}`;
  const paymentIntentPayload = {
    id: eventId,
    type: "payment_intent.succeeded",
    account: accountId,
    data: {
      object: {
        id: paymentIntentId,
        customer: userId,
        stack_stripe_mock_data: {
          "accounts.retrieve": { metadata: { tenancyId: stackTestTenancyId } },
          "customers.retrieve": { metadata: { customerId: userId, customerType: "USER" } },
          "subscriptions.list": { data: [] },
        },
        metadata: {
          productId: "otp-product",
          product: JSON.stringify(product),
          customerId: userId,
          customerType: "user",
          purchaseQuantity: String(quantity),
          purchaseKind: "ONE_TIME",
          priceId: "single",
        },
      },
    },
  };

  const webhookSecret = process.env.STACK_STRIPE_WEBHOOK_SECRET ?? "mock_stripe_webhook_secret";
  const webhookRes = await Payments.sendStripeWebhook(paymentIntentPayload, { secret: webhookSecret });
  expect(webhookRes.status).toBe(200);
  expect(webhookRes.body).toEqual({ received: true });

  const transactionsRes = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(transactionsRes.status).toBe(200);

  const purchaseTransaction = transactionsRes.body.transactions.find((tx: any) => tx.type === "purchase");
  expect(purchaseTransaction).toBeDefined();

  return { userId, transactionsRes, purchaseTransaction };
}

/**
 * Sets up a live-mode subscription by injecting an invoice.paid webhook with
 * billing_reason=subscription_create. After this, the tenancy DB has a
 * Subscription row and a SubscriptionInvoice row marked as the creation
 * invoice, which is what the refund endpoint's subscription path expects.
 */
export async function createLiveModeSubscriptionTransaction() {
  const config = await setupProjectWithPaymentsConfig({ testMode: false });
  const { userId } = await Auth.fastSignUp();

  const accountInfo = await niceBackendFetch("/api/latest/internal/payments/stripe/account-info", {
    accessType: "admin",
  });
  expect(accountInfo.status).toBe(200);
  const accountId: string = accountInfo.body.account_id;

  const code = await createPurchaseCode({ userId, productId: "sub-product" });
  const stackTestTenancyId = code.split("_")[0];
  const product = config.payments.products["sub-product"];

  const idSuffix = randomUUID().replace(/-/g, "");
  const stripeSubscriptionId = `sub_live_refund_${idSuffix}`;
  const stripeInvoiceId = `in_live_refund_${idSuffix}`;
  const stripeCustomerId = `cus_live_refund_${idSuffix}`;
  const nowSec = Math.floor(Date.now() / 1000);

  const subscription = {
    id: stripeSubscriptionId,
    status: "active",
    items: {
      data: [
        {
          id: `si_live_refund_${idSuffix}`,
          quantity: 1,
          current_period_start: nowSec - 60,
          current_period_end: nowSec + 60 * 60 * 24 * 30,
        },
      ],
    },
    metadata: {
      productId: "sub-product",
      product: JSON.stringify(product),
      priceId: "monthly",
    },
    cancel_at_period_end: false,
  };

  const invoice = {
    id: stripeInvoiceId,
    customer: stripeCustomerId,
    billing_reason: "subscription_create",
    status: "paid",
    total: 100000,
    hosted_invoice_url: `https://example.test/invoice/${stripeInvoiceId}`,
    lines: {
      data: [
        {
          parent: {
            subscription_item_details: {
              subscription: stripeSubscriptionId,
            },
          },
        },
      ],
    },
    stack_stripe_mock_data: {
      "accounts.retrieve": { metadata: { tenancyId: stackTestTenancyId } },
      "customers.retrieve": { metadata: { customerId: userId, customerType: "USER" } },
      "subscriptions.list": { data: [subscription] },
    },
  };

  const webhookPayload = {
    id: `evt_live_refund_${idSuffix}`,
    type: "invoice.paid",
    account: accountId,
    data: { object: invoice },
  };

  const webhookSecret = process.env.STACK_STRIPE_WEBHOOK_SECRET ?? "mock_stripe_webhook_secret";
  const webhookRes = await Payments.sendStripeWebhook(webhookPayload, { secret: webhookSecret });
  expect(webhookRes.status).toBe(200);
  expect(webhookRes.body).toEqual({ received: true });

  const transactionsRes = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(transactionsRes.status).toBe(200);

  const subscriptionTransaction = transactionsRes.body.transactions.find(
    (tx: any) => tx.type === "purchase" || tx.type === "subscription-start"
  );
  expect(subscriptionTransaction).toBeDefined();

  return {
    userId,
    stripeSubscriptionId,
    stripeInvoiceId,
    subscriptionTransaction,
    transactionsRes,
  };
}
