import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { it } from "../../../../../helpers";
import { Payments as PaymentsHelper, Project, User, niceBackendFetch } from "../../../../backend-helpers";

function createDefaultPaymentsConfig() {
  return {
    payments: {
      testMode: true,
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

async function setupProjectWithPaymentsConfig() {
  await Project.createAndSwitch();
  await PaymentsHelper.setup();
  const config = createDefaultPaymentsConfig();
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

it("refunds test mode subscription purchases and updates product list", async () => {
  await setupProjectWithPaymentsConfig();
  const { transactionId, userId } = await createTestModeTransaction("sub-product", "monthly");
  const productsRes = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(productsRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": true,
        "items": [
          {
            "id": "sub-product",
            "product": {
              "client_metadata": null,
              "client_read_only_metadata": null,
              "customer_type": "user",
              "display_name": "Sub Product",
              "included_items": {},
              "prices": {
                "monthly": {
                  "USD": "1000",
                  "interval": [
                    1,
                    "month",
                  ],
                },
              },
              "server_metadata": null,
              "server_only": false,
              "stackable": false,
            },
            "quantity": 1,
          },
        ],
        "pagination": { "next_cursor": null },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: { type: "subscription", id: transactionId },
  });
  expect(refundRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const response = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": true,
        "items": [],
        "pagination": { "next_cursor": null },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("refunds test mode one-time purchases and updates product list", async () => {
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
  expect(refundRes.status).toBe(200);
  expect(refundRes.body).toEqual({ success: true });

  const productResAfterRefund = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(productResAfterRefund.status).toBe(200);
  expect(productResAfterRefund.body.items).toHaveLength(0);
});


it("returns SubscriptionNotFound when id does not exist", async () => {
  await setupProjectWithPaymentsConfig();

  const missingId = randomUUID();
  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: { type: "subscription", id: missingId },
  });
  expect(refundRes.status).toBe(404);
  expect(refundRes.body.code).toBe("SUBSCRIPTION_NOT_FOUND");
});
