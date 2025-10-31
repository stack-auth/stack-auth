import { expect } from "vitest";
import { it } from "../../../../../helpers";
import { Payments as PaymentsHelper, Project, User, niceBackendFetch } from "../../../../backend-helpers";

async function setupProjectWithPaymentsConfig() {
  await Project.createAndSwitch();
  await PaymentsHelper.setup();
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
      items: {
        credits: { displayName: "Credits", customerType: "user" },
      },
    },
  });
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

it("returns empty list for fresh project", async () => {
  await Project.createAndSwitch();
  await PaymentsHelper.setup();

  const response = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "next_cursor": null,
          "transactions": [],
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
});

it("includes TEST_MODE subscription", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();
  const code = await createPurchaseCode({ userId, productId: "sub-product" });

  const testModeRes = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "monthly", quantity: 1 },
  });
  expect(testModeRes.status).toBe(200);

  const response = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(response.status).toBe(200);
  expect(response.body.transactions).toMatchInlineSnapshot(`
    [
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
            "price_id": "monthly",
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
            "product_id": "sub-product",
            "quantity": 1,
            "subscription_id": "<stripped UUID>",
            "type": "product_grant",
          },
        ],
        "id": "<stripped UUID>",
        "test_mode": true,
        "type": "purchase",
      },
    ]
  `);
});

it("includes TEST_MODE one-time purchase", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();
  const code = await createPurchaseCode({ userId, productId: "otp-product" });

  const testModeRes = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "single", quantity: 1 },
  });
  expect(testModeRes.status).toBe(200);

  const response = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(response.status).toBe(200);
  expect(response.body.transactions).toMatchInlineSnapshot(`
    [
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
        ],
        "id": "<stripped UUID>",
        "test_mode": true,
        "type": "purchase",
      },
    ]
  `);
});

it("includes item quantity change entries", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  const changeRes = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    query: { allow_negative: "false" },
    body: { delta: 5, description: "test" },
  });
  expect(changeRes.status).toBe(200);

  const response = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(response.status).toBe(200);
  expect(response.body.transactions).toMatchInlineSnapshot(`
    [
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
            "item_id": "credits",
            "quantity": 5,
            "type": "item_quantity_change",
          },
        ],
        "id": "<stripped UUID>",
        "test_mode": false,
        "type": "manual-item-quantity-change",
      },
    ]
  `);
});

it("supports concatenated cursor pagination", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  // Make a few entries across tables
  {
    const code = await createPurchaseCode({ userId, productId: "sub-product" });
    await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
      accessType: "admin",
      method: "POST",
      body: { full_code: code, price_id: "monthly", quantity: 1 },
    });
  }
  {
    const code = await createPurchaseCode({ userId, productId: "otp-product" });
    await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
      accessType: "admin",
      method: "POST",
      body: { full_code: code, price_id: "single", quantity: 1 },
    });
  }
  await niceBackendFetch(`/api/latest/payments/items/user/${userId}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    query: { allow_negative: "false" },
    body: { delta: 2 },
  });

  const page1 = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
    query: { limit: "2" },
  });
  expect(page1.status).toBe(200);
  expect(page1.body).toMatchObject({ next_cursor: expect.any(String) });

  const page2 = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
    query: { limit: "2", cursor: page1.body.next_cursor },
  });
  expect(page2.status).toBe(200);
  expect(page2.body).toMatchObject({ transactions: expect.any(Array) });
});

