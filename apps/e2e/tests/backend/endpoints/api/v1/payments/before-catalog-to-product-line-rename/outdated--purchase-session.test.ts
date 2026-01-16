/**
 * These tests verify that the old `catalogs` and `catalogId` config properties
 * still work correctly after the rename to `productLines` and `productLineId`.
 * The migration functions in schema.ts should handle the conversion automatically.
 */
import { it } from "../../../../../../helpers";
import { Payments, Project, User, niceBackendFetch } from "../../../../../backend-helpers";

it("should work with old catalogs config property", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      // Using the OLD property name "catalogs" instead of "productLines"
      catalogs: { grp: { displayName: "Test Group" } },
      products: {
        offerA: {
          displayName: "Offer A",
          customerType: "user",
          serverOnly: false,
          // Using the OLD property name "catalogId" instead of "productLineId"
          catalogId: "grp",
          stackable: false,
          prices: {
            monthly: {
              USD: "1000",
              interval: [1, "month"],
            },
          },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await User.create();
  const createUrlResponse = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "offerA",
    },
  });
  expect(createUrlResponse.status).toBe(200);
  const code = (createUrlResponse.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1]!;

  const purchaseSessionResponse = await niceBackendFetch("/api/v1/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: {
      full_code: code,
      price_id: "monthly",
    },
  });
  expect(purchaseSessionResponse.status).toBe(200);
  expect(purchaseSessionResponse.body).toEqual({ success: true });
});

it("should block one-time purchase in same group using old catalogs config", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      // Using the OLD property name "catalogs" instead of "productLines"
      catalogs: { grp: { displayName: "Group" } },
      products: {
        offerA: {
          displayName: "Offer A",
          customerType: "user",
          serverOnly: false,
          // Using the OLD property name "catalogId" instead of "productLineId"
          catalogId: "grp",
          stackable: true,
          prices: { one: { USD: "500" } },
          includedItems: {},
        },
        offerB: {
          displayName: "Offer B",
          customerType: "user",
          serverOnly: false,
          // Using the OLD property name "catalogId" instead of "productLineId"
          catalogId: "grp",
          stackable: true,
          prices: { one: { USD: "700" } },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await User.create();
  // Purchase offerA in TEST_MODE
  const urlA = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: { customer_type: "user", customer_id: userId, product_id: "offerA" },
  });
  expect(urlA.status).toBe(200);
  const codeA = (urlA.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
  expect(codeA).toBeDefined();

  const tmRes = await niceBackendFetch("/api/v1/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: { full_code: codeA, price_id: "one", quantity: 1 },
  });
  expect(tmRes.status).toBe(200);

  // Attempt to purchase offerB in same group (should be blocked)
  const urlB = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: { customer_type: "user", customer_id: userId, product_id: "offerB" },
  });
  expect(urlB.status).toBe(200);
  const codeB = (urlB.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
  expect(codeB).toBeDefined();

  const resB = await niceBackendFetch("/api/v1/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: { full_code: codeB, price_id: "one", quantity: 1 },
  });
  expect(resB.status).toBe(400);
  expect(String(resB.body)).toContain("one-time purchase in this product line");
});

it("should work with subscription switching using old catalogs config", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      // Using the OLD property name "catalogs"
      catalogs: {
        grp: { displayName: "Test Group" },
      },
      products: {
        offerA: {
          displayName: "Offer A",
          customerType: "user",
          serverOnly: false,
          // Using the OLD property name "catalogId"
          catalogId: "grp",
          stackable: false,
          prices: {
            monthly: {
              USD: "1000",
              interval: [1, "month"],
            },
          },
          includedItems: {},
        },
        offerB: {
          displayName: "Offer B",
          customerType: "user",
          serverOnly: false,
          // Using the OLD property name "catalogId"
          catalogId: "grp",
          stackable: false,
          prices: {
            monthly: {
              USD: "2000",
              interval: [1, "month"],
            },
          },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await User.create();

  // First purchase: Offer A
  const createUrlA = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "offerA",
    },
  });
  expect(createUrlA.status).toBe(200);
  const codeA = (createUrlA.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
  expect(codeA).toBeDefined();

  const purchaseA = await niceBackendFetch("/api/v1/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: codeA,
      price_id: "monthly",
      quantity: 1,
    },
  });
  expect(purchaseA).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "client_secret": "" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Second purchase: Offer B in same group (should update existing subscription)
  const createUrlB = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "offerB",
    },
  });
  expect(createUrlB.status).toBe(200);
  const codeB = (createUrlB.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
  expect(codeB).toBeDefined();

  const purchaseB = await niceBackendFetch("/api/v1/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: codeB,
      price_id: "monthly",
      quantity: 1,
    },
  });
  expect(purchaseB).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "client_secret": "" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
