import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { it } from "../../../../../helpers";
import { Payments, Project, User, niceBackendFetch } from "../../../../backend-helpers";

function createDefaultPaymentsConfig(testMode: boolean | undefined) {
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

async function setupProjectWithPaymentsConfig(options: { testMode?: boolean } = {}) {
  await Project.createAndSwitch();
  await Payments.setup();
  const config = createDefaultPaymentsConfig(options.testMode);
  await Project.updateConfig(config);
  return config;
}

async function createPurchaseCode(options: { userId: string, productId: string }) {
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

async function createTestModeTransaction(productId: string, priceId: string) {
  const { userId } = await User.create();
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

it("returns TestModePurchaseNonRefundable when refunding test mode one-time purchases", async () => {
  await setupProjectWithPaymentsConfig();
  const { transactionId, userId } = await createTestModeTransaction("otp-product", "single");

  const productsRes = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(productsRes.status).toBe(200);
  expect(productsRes.body.items).toHaveLength(1);
  expect(productsRes.body.items[0].id).toBe("otp-product");

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: { type: "one-time-purchase", id: transactionId },
  });
  expect(refundRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "TEST_MODE_PURCHASE_NON_REFUNDABLE",
        "error": "Test mode purchases are not refundable.",
      },
      "headers": Headers {
        "x-stack-known-error": "TEST_MODE_PURCHASE_NON_REFUNDABLE",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("returns SubscriptionInvoiceNotFound when id does not exist", async () => {
  await setupProjectWithPaymentsConfig();

  const missingId = randomUUID();
  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: { type: "subscription", id: missingId },
  });
  expect(refundRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": {
        "code": "SUBSCRIPTION_INVOICE_NOT_FOUND",
        "details": { "subscription_invoice_id": "<stripped UUID>" },
        "error": "Subscription invoice with ID \\"<stripped UUID>\\" does not exist.",
      },
      "headers": Headers {
        "x-stack-known-error": "SUBSCRIPTION_INVOICE_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("refunds non-test mode one-time purchases created via Stripe webhooks", async () => {
  const config = await setupProjectWithPaymentsConfig({ testMode: false });
  const { userId } = await User.create();

  const accountInfo = await niceBackendFetch("/api/latest/internal/payments/stripe/account-info", {
    accessType: "admin",
  });
  expect(accountInfo.status).toBe(200);
  const accountId: string = accountInfo.body.account_id;

  const code = await createPurchaseCode({ userId, productId: "otp-product" });
  const stackTestTenancyId = code.split("_")[0];
  const product = config.payments.products["otp-product"];

  const paymentIntentPayload = {
    id: "evt_otp_refund_success",
    type: "payment_intent.succeeded",
    account: accountId,
    data: {
      object: {
        id: "pi_otp_refund_success",
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
          purchaseQuantity: "1",
          purchaseKind: "ONE_TIME",
          priceId: "single",
        },
      },
    },
  };

  const webhookRes = await Payments.sendStripeWebhook(paymentIntentPayload);
  expect(webhookRes.status).toBe(200);
  expect(webhookRes.body).toEqual({ received: true });

  const productsRes = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(productsRes.status).toBe(200);
  expect(productsRes.body.items).toHaveLength(1);
  expect(productsRes.body.items[0].id).toBe("otp-product");

  const transactionsRes = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(transactionsRes.body).toMatchInlineSnapshot(`
    {
      "has_more": false,
      "next_cursor": null,
      "transactions": [
        {
          "adjusted_by": [],
          "created_at_millis": <stripped field 'created_at_millis'>,
          "effective_at_millis": <stripped field 'effective_at_millis'>,
          "entries": [
            {
              "adjusted_entry_index": null,
              "adjusted_transaction_id": null,
              "charged_amount": { "USD": "5000" },
              "customer_id": "<stripped UUID>",
              "customer_type": "user",
              "net_amount": { "USD": "5000" },
              "type": "money_transfer",
            },
            {
              "adjusted_entry_index": null,
              "adjusted_transaction_id": null,
              "customer_id": "<stripped UUID>",
              "customer_type": "user",
              "one_time_purchase_id": "<stripped UUID>",
              "price_id": "single",
              "product": {
                "client_metadata": null,
                "client_read_only_metadata": null,
                "customer_type": "user",
                "display_name": "One-Time Product",
                "included_items": {},
                "prices": { "single": { "USD": "5000" } },
                "server_metadata": null,
                "server_only": false,
                "stackable": false,
              },
              "product_id": "otp-product",
              "quantity": 1,
              "type": "product_grant",
            },
          ],
          "id": "<stripped UUID>",
          "test_mode": false,
          "type": "stripe-one-time",
        },
      ],
    }
  `);

  const purchaseTransaction = transactionsRes.body.transactions.find((tx: any) => tx.type === "stripe-one-time");
  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: { type: "one-time-purchase", id: purchaseTransaction.id },
  });
  expect(refundRes.status).toBe(200);
  expect(refundRes.body).toEqual({ success: true });

  const transactionsAfterRefund = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(transactionsAfterRefund.body.transactions.find((tx: any) => tx.id === purchaseTransaction.id)).toBeDefined();

  const secondRefundAttempt = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: { type: "one-time-purchase", id: purchaseTransaction.id },
  });
  expect(secondRefundAttempt).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ONE_TIME_PURCHASE_ALREADY_REFUNDED",
        "details": { "one_time_purchase_id": "<stripped UUID>" },
        "error": "One-time purchase with ID \\"<stripped UUID>\\" was already refunded.",
      },
      "headers": Headers {
        "x-stack-known-error": "ONE_TIME_PURCHASE_ALREADY_REFUNDED",
        <some fields may have been hidden>,
      },
    }
  `);

  const productsAfterRes = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(productsAfterRes.body).toMatchInlineSnapshot(`
    {
      "is_paginated": true,
      "items": [],
      "pagination": { "next_cursor": null },
    }
  `);
});
