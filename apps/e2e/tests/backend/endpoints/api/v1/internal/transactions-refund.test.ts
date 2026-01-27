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

async function createLiveModeOneTimePurchaseTransaction(options: { quantity?: number } = {}) {
  const config = await setupProjectWithPaymentsConfig({ testMode: false });
  const { userId } = await User.create();
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
    body: {
      type: "one-time-purchase",
      id: transactionId,
      amount_usd: "5000",
      refund_entries: [{ entry_index: 0, quantity: 1 }],
    },
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
    body: {
      type: "subscription",
      id: missingId,
      amount_usd: "1000",
      refund_entries: [{ entry_index: 0, quantity: 1 }],
    },
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
  const { userId, transactionsRes, purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();
  const productsRes = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(productsRes.status).toBe(200);
  expect(productsRes.body.items).toHaveLength(1);
  expect(productsRes.body.items[0].id).toBe("otp-product");

  expect(transactionsRes.body).toMatchInlineSnapshot(`
    {
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
            {
              "adjusted_entry_index": null,
              "adjusted_transaction_id": null,
              "charged_amount": { "USD": "5000" },
              "customer_id": "<stripped UUID>",
              "customer_type": "user",
              "net_amount": { "USD": "5000" },
              "type": "money_transfer",
            },
          ],
          "id": "<stripped UUID>",
          "test_mode": false,
          "type": "purchase",
        },
      ],
    }
  `);

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "5000",
      refund_entries: [{ entry_index: 0, quantity: 1 }],
    },
  });
  expect(refundRes.status).toBe(200);
  expect(refundRes.body).toEqual({ success: true });

  const transactionsAfterRefund = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  const refundedTransaction = transactionsAfterRefund.body.transactions.find((tx: any) => tx.id === purchaseTransaction.id);
  expect(refundedTransaction?.adjusted_by).toEqual([
    {
      entry_index: 0,
      transaction_id: expect.stringContaining(`${purchaseTransaction.id}:refund`),
    },
  ]);

  const secondRefundAttempt = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "5000",
      refund_entries: [{ entry_index: 0, quantity: 1 }],
    },
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

it("refunds partial amounts for non-test mode one-time purchases", async () => {
  const { userId, purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "1250",
      refund_entries: [{ entry_index: 0, quantity: 1 }],
    },
  });
  expect(refundRes.status).toBe(200);
  expect(refundRes.body).toEqual({ success: true });

  const transactionsAfterRefund = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  const refundedTransaction = transactionsAfterRefund.body.transactions.find((tx: any) => tx.id === purchaseTransaction.id);
  expect(refundedTransaction?.adjusted_by).toEqual([
    {
      entry_index: 0,
      transaction_id: expect.stringContaining(`${purchaseTransaction.id}:refund`),
    },
  ]);

  const productsAfterRes = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(productsAfterRes.body.items).toHaveLength(0);

  const secondRefundAttempt = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "1250",
      refund_entries: [{ entry_index: 0, quantity: 1 }],
    },
  });
  expect(secondRefundAttempt.body.code).toBe("ONE_TIME_PURCHASE_ALREADY_REFUNDED");
});

it("refunds selected quantities for non-test mode one-time purchases", async () => {
  const { userId, purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction({ quantity: 3 });

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "10000",
      refund_entries: [{ entry_index: 0, quantity: 2 }],
    },
  });
  expect(refundRes.status).toBe(200);
  expect(refundRes.body).toEqual({ success: true });

  const transactionsAfterRefund = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  const refundedTransaction = transactionsAfterRefund.body.transactions.find((tx: any) => tx.id === purchaseTransaction.id);
  expect(refundedTransaction?.adjusted_by).toEqual([
    {
      entry_index: 0,
      transaction_id: expect.stringContaining(`${purchaseTransaction.id}:refund`),
    },
  ]);

  const productsAfterRes = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(productsAfterRes.body.items).toHaveLength(0);
});

it("returns SCHEMA_ERROR when amount_usd is negative", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "-1",
      refund_entries: [{ entry_index: 0, quantity: 1 }],
    },
  });
  expect(refundRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/latest/internal/payments/transactions/refund:
              - Money amount must be in the format of <number> or <number>.<number>
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/latest/internal/payments/transactions/refund:
            - Money amount must be in the format of <number> or <number>.<number>
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("allows amount_usd of zero", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "0",
      refund_entries: [{ entry_index: 0, quantity: 1 }],
    },
  });
  expect(refundRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("allows empty refund_entries (money-only refund)", async () => {
  const { userId, purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "5000",
      refund_entries: [],
    },
  });
  expect(refundRes.status).toBe(200);
  expect(refundRes.body).toEqual({ success: true });

  const transactionsAfterRefund = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  const refundedTransaction = transactionsAfterRefund.body.transactions.find((tx: any) => tx.id === purchaseTransaction.id);
  expect(refundedTransaction?.adjusted_by).toEqual([
    {
      entry_index: 0,
      transaction_id: expect.stringContaining(`${purchaseTransaction.id}:refund`),
    },
  ]);

  const productsAfterRes = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(productsAfterRes.body.items).toHaveLength(0);
});

it("returns SCHEMA_ERROR when refund_entries contains bad entry_index", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "5000",
      refund_entries: [{ entry_index: 999, quantity: 1 }],
    },
  });
  expect(refundRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": { "message": "Refund entry index is invalid." },
        "error": "Refund entry index is invalid.",
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("returns SCHEMA_ERROR when refund_entries contains negative quantity", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "5000",
      refund_entries: [{ entry_index: 0, quantity: -1 }],
    },
  });
  expect(refundRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": { "message": "Refund quantity cannot be negative." },
        "error": "Refund quantity cannot be negative.",
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("allows refund_entries with zero quantity", async () => {
  const { userId, purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "5000",
      refund_entries: [{ entry_index: 0, quantity: 0 }],
    },
  });
  expect(refundRes.status).toBe(200);
  expect(refundRes.body).toEqual({ success: true });

  const transactionsAfterRefund = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  const refundedTransaction = transactionsAfterRefund.body.transactions.find((tx: any) => tx.id === purchaseTransaction.id);
  expect(refundedTransaction?.adjusted_by).toEqual([
    {
      entry_index: 0,
      transaction_id: expect.stringContaining(`${purchaseTransaction.id}:refund`),
    },
  ]);

  const productsAfterRes = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(productsAfterRes.body.items).toHaveLength(0);
});

it("returns SCHEMA_ERROR when refund_entries contains quantity past limit", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction({ quantity: 1 });

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "5000",
      refund_entries: [{ entry_index: 0, quantity: 2 }],
    },
  });
  expect(refundRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": { "message": "Refund quantity cannot exceed purchased quantity." },
        "error": "Refund quantity cannot exceed purchased quantity.",
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("returns SCHEMA_ERROR when amount_usd exceeds charged amount", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "5001",
      refund_entries: [{ entry_index: 0, quantity: 1 }],
    },
  });
  expect(refundRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": { "message": "Refund amount cannot exceed the charged amount." },
        "error": "Refund amount cannot exceed the charged amount.",
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("returns SCHEMA_ERROR when refund_entries contains negative entry_index", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "5000",
      refund_entries: [{ entry_index: -1, quantity: 1 }],
    },
  });
  expect(refundRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": { "message": "Refund entry index is invalid." },
        "error": "Refund entry index is invalid.",
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("returns SCHEMA_ERROR when refund_entries quantity is not an integer", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "5000",
      refund_entries: [{ entry_index: 0, quantity: 1.5 }],
    },
  });
  expect(refundRes.body.code).toBe("SCHEMA_ERROR");
});

it("returns SCHEMA_ERROR when refund_entries references non-product_grant entries", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "5000",
      refund_entries: [{ entry_index: 1, quantity: 1 }],
    },
  });
  expect(refundRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": { "message": "Refund entries must reference product grant entries." },
        "error": "Refund entries must reference product grant entries.",
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("returns SCHEMA_ERROR when refund_entries contains duplicate entry indexes", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction({ quantity: 2 });

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      amount_usd: "5000",
      refund_entries: [
        { entry_index: 0, quantity: 1 },
        { entry_index: 0, quantity: 1 },
      ],
    },
  });
  expect(refundRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": { "message": "Refund entries cannot contain duplicate entry indexes." },
        "error": "Refund entries cannot contain duplicate entry indexes.",
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});
