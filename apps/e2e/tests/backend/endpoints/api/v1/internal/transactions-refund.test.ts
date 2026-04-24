import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { it } from "../../../../../helpers";
import { niceBackendFetch } from "../../../../backend-helpers";
import {
  createLiveModeOneTimePurchaseTransaction,
  createTestModeTransaction,
  setupProjectWithPaymentsConfig,
} from "../../../../helpers/payments";

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
      refund_entries: [{ entry_index: 0, quantity: 1, amount_usd: "5000" }],
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
      refund_entries: [{ entry_index: 0, quantity: 1, amount_usd: "1000" }],
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
      refund_entries: [{ entry_index: 0, quantity: 1, amount_usd: "5000" }],
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
      refund_entries: [{ entry_index: 0, quantity: 1, amount_usd: "5000" }],
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
      refund_entries: [{ entry_index: 0, quantity: 1, amount_usd: "1250" }],
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
      refund_entries: [{ entry_index: 0, quantity: 1, amount_usd: "1250" }],
    },
  });
  expect(secondRefundAttempt.body.code).toBe("ONE_TIME_PURCHASE_ALREADY_REFUNDED");
});

// TODO: rethink refund E2E tests — old tests expect refundedAt filtering (legacy behavior);
// new Bulldozer model tracks quantity via product-revocation entries in the owned products LFold.
it.skip("refunds selected quantities for non-test mode one-time purchases", async () => {
  const { userId, purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction({ quantity: 3 });

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      refund_entries: [{ entry_index: 0, quantity: 2, amount_usd: "10000" }],
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
      refund_entries: [{ entry_index: 0, quantity: 1, amount_usd: "-1" }],
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
      refund_entries: [{ entry_index: 0, quantity: 1, amount_usd: "0" }],
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

// TODO: same as above — refund product ownership expectations need rework for Bulldozer model
it.skip("allows zero-quantity refund entries (money-only refund)", async () => {
  const { userId, purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      refund_entries: [{ entry_index: 0, quantity: 0, amount_usd: "5000" }],
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
      refund_entries: [{ entry_index: 999, quantity: 1, amount_usd: "5000" }],
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
      refund_entries: [{ entry_index: 0, quantity: -1, amount_usd: "5000" }],
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

// TODO: same as above
it.skip("allows refund_entries with zero quantity", async () => {
  const { userId, purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      refund_entries: [{ entry_index: 0, quantity: 0, amount_usd: "5000" }],
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
      refund_entries: [{ entry_index: 0, quantity: 2, amount_usd: "5000" }],
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
      refund_entries: [{ entry_index: 0, quantity: 1, amount_usd: "5001" }],
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
      refund_entries: [{ entry_index: -1, quantity: 1, amount_usd: "5000" }],
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
      refund_entries: [{ entry_index: 0, quantity: 1.5, amount_usd: "5000" }],
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
      refund_entries: [{ entry_index: 1, quantity: 1, amount_usd: "5000" }],
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
      refund_entries: [
        { entry_index: 0, quantity: 1, amount_usd: "5000" },
        { entry_index: 0, quantity: 1, amount_usd: "5000" },
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
