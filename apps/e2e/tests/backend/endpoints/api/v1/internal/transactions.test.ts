import { expect, it } from "vitest";
import { niceBackendFetch, Payments as PaymentsHelper, Project, User } from "../../../../backend-helpers";

async function setupProjectWithPaymentsConfig() {
  await Project.createAndSwitch();
  await PaymentsHelper.setup();
  await Project.updateConfig({
    payments: {
      offers: {
        "sub-offer": {
          displayName: "Sub Offer",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            monthly: { USD: "1000", interval: [1, "month"] },
          },
          includedItems: {},
        },
        "otp-offer": {
          displayName: "One-Time Offer",
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

async function createPurchaseCode(options: { userId: string, offerId: string }) {
  const res = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: options.userId,
      offer_id: options.offerId,
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
          "purchases": [],
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
});

it("includes TEST_MODE subscription", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();
  const code = await createPurchaseCode({ userId, offerId: "sub-offer" });

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
  expect(response.body.purchases.find((p: any) => p.kind === "subscription")).toMatchInlineSnapshot(`
      {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "customer_id": "<stripped UUID>",
        "customer_type": "user",
        "id": "<stripped UUID>",
        "kind": "subscription",
        "offer_display_name": "Sub Offer",
        "offer_id": "sub-offer",
        "price": {
          "currency": "usd",
          "interval": [
            1,
            "month",
          ],
          "unit_amount": 1000,
        },
        "quantity": 1,
        "status": "active",
        "test_mode": true,
      }
    `);
});

it("includes TEST_MODE one-time purchase", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();
  const code = await createPurchaseCode({ userId, offerId: "otp-offer" });

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
  expect(response.body.purchases.find((p: any) => p.kind === "one_time")).toMatchInlineSnapshot(`
      {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "customer_id": "<stripped UUID>",
        "customer_type": "user",
        "id": "<stripped UUID>",
        "kind": "one_time",
        "offer_display_name": "One-Time Offer",
        "offer_id": "otp-offer",
        "price": {
          "currency": "usd",
          "interval": null,
          "unit_amount": 5000,
        },
        "quantity": 1,
        "status": null,
        "test_mode": true,
      }
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
  expect(response.body.purchases.find((p: any) => p.kind === "item_quantity_change")).toMatchInlineSnapshot(`
      {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "customer_id": "<stripped UUID>",
        "customer_type": "user",
        "description": "test",
        "expires_at_millis": <stripped field 'expires_at_millis'>,
        "id": "<stripped UUID>",
        "item_id": "credits",
        "kind": "item_quantity_change",
        "offer_display_name": null,
        "offer_id": null,
        "price": null,
        "quantity": 5,
        "status": null,
        "test_mode": false,
      }
    `);
});

it("supports concatenated cursor pagination", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await User.create();

  // Make a few entries across tables
  {
    const code = await createPurchaseCode({ userId, offerId: "sub-offer" });
    await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
      accessType: "admin",
      method: "POST",
      body: { full_code: code, price_id: "monthly", quantity: 1 },
    });
  }
  {
    const code = await createPurchaseCode({ userId, offerId: "otp-offer" });
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
  expect(page2.body).toMatchObject({ purchases: expect.any(Array) });
});


