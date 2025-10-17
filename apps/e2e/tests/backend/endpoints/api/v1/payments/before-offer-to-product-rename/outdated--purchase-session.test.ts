import { it } from "../../../../../../helpers";
import { Auth, Payments, Project, User, niceBackendFetch } from "../../../../../backend-helpers";
import { withPortPrefix } from "../../../helpers/ports";

it("should error on invalid code", async ({ expect }) => {
  await Project.createAndSwitch();
  const response = await niceBackendFetch("/api/v1/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: "invalid-code",
      price_id: "monthly",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": {
        "code": "VERIFICATION_CODE_NOT_FOUND",
        "error": "The verification code does not exist for this project.",
      },
      "headers": Headers {
        "x-stack-known-error": "VERIFICATION_CODE_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should error on invalid price_id", async ({ expect }) => {
  const { code } = await Payments.createPurchaseUrlAndGetCode();
  const response = await niceBackendFetch("/api/v1/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: code,
      price_id: "invalid-price-id",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Price not found on product associated with this purchase code",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should properly create subscription", async ({ expect }) => {
  const { code } = await Payments.createPurchaseUrlAndGetCode();
  const response = await niceBackendFetch("/api/v1/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: code,
      price_id: "monthly",
      quantity: 1,
    },
  });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ client_secret: expect.any(String) });
});

it("should return client secret for one-time price (no interval)", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      products: {
        "ot-offer": {
          displayName: "One Time Offer",
          customerType: "user",
          serverOnly: false,
          stackable: true,
          prices: {
            one: {
              USD: "1500",
            },
          },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await User.create();
  const urlRes = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      offer_id: "ot-offer",
    },
  });
  expect(urlRes.status).toBe(200);
  const code = (urlRes.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1]!;

  const res = await niceBackendFetch("/api/v1/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: code,
      price_id: "one",
      quantity: 2,
    },
  });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ client_secret: expect.any(String) });
});

it("should error on one-time price quantity > 1 when offer is not stackable", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      products: {
        "ot-non-stack": {
          displayName: "One Time Non-Stackable",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            one: { USD: "1200" },
          },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await User.create();
  const urlRes = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      offer_id: "ot-non-stack",
    },
  });
  expect(urlRes.status).toBe(200);
  const code = (urlRes.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1]!;

  const res = await niceBackendFetch("/api/v1/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: code,
      price_id: "one",
      quantity: 2,
    },
  });
  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "This product is not stackable; quantity must be 1",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return client secret for one-time price even if a conflicting group subscription exists (DB-only)", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      catalogs: { grp: { displayName: "Test Group" } },
      products: {
        subOffer: {
          displayName: "Sub Offer",
          customerType: "user",
          serverOnly: false,
          groupId: "grp",
          stackable: false,
          prices: { monthly: { USD: "1000", interval: [1, "month"] } },
          includedItems: {},
        },
        oneTime: {
          displayName: "One Time",
          customerType: "user",
          serverOnly: false,
          groupId: "grp",
          stackable: true,
          prices: { one: { USD: "500" } },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await User.create();

  // Create test-mode DB-only subscription for subOffer
  const createUrlRespA = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      offer_id: "subOffer",
    },
  });
  expect(createUrlRespA.status).toBe(200);
  const codeA = (createUrlRespA.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1]!;
  const testModeRes = await niceBackendFetch("/api/v1/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: { full_code: codeA, price_id: "monthly", quantity: 1 },
  });
  expect(testModeRes.status).toBe(200);

  // Now purchase one-time offer in same group; should succeed and return client secret
  const createUrlRespB = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      offer_id: "oneTime",
    },
  });
  expect(createUrlRespB.status).toBe(200);
  const codeB = (createUrlRespB.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1]!;

  const res = await niceBackendFetch("/api/v1/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: { full_code: codeB, price_id: "one", quantity: 1 },
  });
  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "client_secret": "pi_1PgafyB7WZ01zgkWSjxsAJo3_secret_Dm43xiq1k0ywrRRjDoi8y1gkM" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("test-mode should error on one-time price quantity > 1 when offer is not stackable", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      products: {
        tmOneTime: {
          displayName: "TM One Time",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: { one: { USD: "800" } },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await User.create();
  const urlRes = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: { customer_type: "user", customer_id: userId, offer_id: "tmOneTime" },
  });
  expect(urlRes.status).toBe(200);
  const code = (urlRes.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1]!;

  const res = await niceBackendFetch("/api/v1/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: { full_code: code, price_id: "one", quantity: 2 },
  });
  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "This product is not stackable; quantity must be 1",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should create purchase URL, validate code, and create purchase session", async ({ expect }) => {
  const { code } = await Payments.createPurchaseUrlAndGetCode();
  const response = await niceBackendFetch("/api/v1/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: code,
      price_id: "monthly",
      quantity: 2,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "This product is not stackable; quantity must be 1",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should create purchase URL with inline offer, validate code, and create purchase session", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Payments.setup();

  const { userId } = await Auth.Otp.signIn();
  const response = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "server",
    body: {
      customer_type: "user",
      customer_id: userId,
      offer_inline: {
        display_name: "Inline Test Offer",
        customer_type: "user",
        server_only: true,
        prices: {
          "monthly-test": {
            USD: "1000",
            interval: [1, "month"],
          },
        },
        included_items: {},
      },
    },
  });
  expect(response.status).toBe(200);
  const body = response.body as { url: string };
  expect(body.url).toMatch(new RegExp(`^https?:\\/\\/localhost:${withPortPrefix("01")}\/purchase\/[a-z0-9-_]+$`));
  const codeMatch = body.url.match(/\/purchase\/([a-z0-9-_]+)/);
  const code = codeMatch ? codeMatch[1] : undefined;
  expect(code).toBeDefined();

  const purchaseSessionResponse = await niceBackendFetch("/api/v1/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: code,
      price_id: "monthly-test",
    },
  });
  expect(purchaseSessionResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "client_secret": "" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("creates subscription in test mode and increases included item quantity", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      items: {
        "test-item": {
          displayName: "Test Item",
          customerType: "user",
        },
      },
      products: {
        "test-offer": {
          displayName: "Test Offer",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            monthly: {
              USD: "1000",
              interval: [1, "month"],
            },
          },
          includedItems: {
            "test-item": { quantity: 2 },
          },
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
      offer_id: "test-offer",
    },
  });
  expect(createUrlResponse.status).toBe(200);
  const body = createUrlResponse.body as { url: string };
  const codeMatch = body.url.match(/\/purchase\/([a-z0-9-_]+)/);
  const code = codeMatch ? codeMatch[1] : undefined;
  expect(code).toBeDefined();

  const getBefore = await niceBackendFetch(`/api/v1/payments/items/user/${userId}/test-item`, {
    accessType: "client",
  });
  expect(getBefore.status).toBe(200);
  expect(getBefore.body.quantity).toBe(0);

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

  const getAfter = await niceBackendFetch(`/api/v1/payments/items/user/${userId}/test-item`, {
    accessType: "client",
  });
  expect(getAfter.status).toBe(200);
  expect(getAfter.body.quantity).toBe(2);
});

it("test-mode should error on invalid code", async ({ expect }) => {
  await Project.createAndSwitch();
  const response = await niceBackendFetch("/api/v1/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: {
      full_code: "invalid-code",
      price_id: "monthly",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": {
        "code": "VERIFICATION_CODE_NOT_FOUND",
        "error": "The verification code does not exist for this project.",
      },
      "headers": Headers {
        "x-stack-known-error": "VERIFICATION_CODE_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("test-mode should error on invalid price_id", async ({ expect }) => {
  const { code } = await Payments.createPurchaseUrlAndGetCode();
  await Project.updateConfig({
    payments: {
      testMode: true,
    },
  });
  const response = await niceBackendFetch("/api/v1/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: {
      full_code: code,
      price_id: "invalid-price-id",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Price not found on product associated with this purchase code",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("allows stackable quantity in test mode and multiplies included items", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      items: {
        "test-item": {
          displayName: "Test Item",
          customerType: "user",
        },
      },
      products: {
        "test-offer": {
          displayName: "Test Offer",
          customerType: "user",
          serverOnly: false,
          stackable: true,
          prices: {
            monthly: {
              USD: "1000",
              interval: [1, "month"],
            },
          },
          includedItems: {
            "test-item": { quantity: 2 },
          },
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
      offer_id: "test-offer",
    },
  });
  expect(createUrlResponse.status).toBe(200);
  const body = createUrlResponse.body as { url: string };
  const codeMatch = body.url.match(/\/purchase\/([a-z0-9-_]+)/);
  const code = codeMatch ? codeMatch[1] : undefined;
  expect(code).toBeDefined();

  const getBefore = await niceBackendFetch(`/api/v1/payments/items/user/${userId}/test-item`, {
    accessType: "client",
  });
  expect(getBefore.status).toBe(200);
  expect(getBefore.body.quantity).toBe(0);

  const purchaseSessionResponse = await niceBackendFetch("/api/v1/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: {
      full_code: code,
      price_id: "monthly",
      quantity: 3,
    },
  });
  expect(purchaseSessionResponse.status).toBe(200);
  expect(purchaseSessionResponse.body).toEqual({ success: true });

  const getAfter = await niceBackendFetch(`/api/v1/payments/items/user/${userId}/test-item`, {
    accessType: "client",
  });
  expect(getAfter.status).toBe(200);
  expect(getAfter.body.quantity).toBe(6);
});

it("should update existing stripe subscription when switching offers within a group (non test-mode)", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      catalogs: {
        grp: { displayName: "Test Group" },
      },
      products: {
        offerA: {
          displayName: "Offer A",
          customerType: "user",
          serverOnly: false,
          groupId: "grp",
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
          groupId: "grp",
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
      offer_id: "offerA",
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

  // Second purchase: Offer B in same group (should update existing Stripe subscription)
  const createUrlB = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      offer_id: "offerB",
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

it("should cancel DB-only subscription then create Stripe subscription when switching from test-mode (same group)", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      catalogs: {
        grp: { displayName: "Test Group" },
      },
      products: {
        offerA: {
          displayName: "Offer A",
          customerType: "user",
          serverOnly: false,
          groupId: "grp",
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
          groupId: "grp",
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

  // Create test-mode DB-only subscription for offerA
  const resUrlA = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      offer_id: "offerA",
    },
  });
  expect(resUrlA.status).toBe(200);
  const codeA = (resUrlA.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
  expect(codeA).toBeDefined();

  const testModeRes = await niceBackendFetch("/api/v1/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: {
      full_code: codeA,
      price_id: "monthly",
      quantity: 1,
    },
  });
  expect(testModeRes.status).toBe(200);

  // Now purchase offerB in non test-mode; should cancel DB-only sub and create Stripe subscription
  const resUrlB = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      offer_id: "offerB",
    },
  });
  expect(resUrlB.status).toBe(200);
  const codeB = (resUrlB.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
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

it("should block one-time purchase for same product after prior one-time purchase (test-mode persisted)", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      products: {
        ot: {
          displayName: "One Time Offer",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: { one: { USD: "500" } },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await User.create();
  // First: create code and complete in TEST_MODE (persists OneTimePurchase)
  const createUrl1 = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: { customer_type: "user", customer_id: userId, offer_id: "ot" },
  });
  expect(createUrl1.status).toBe(200);
  const code1 = (createUrl1.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
  expect(code1).toBeDefined();

  const testModeRes = await niceBackendFetch("/api/v1/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: { full_code: code1, price_id: "one", quantity: 1 },
  });
  expect(testModeRes.status).toBe(200);

  // Second: attempt another purchase for same offer (should be blocked by OneTimePurchase)
  const createUrl2 = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: { customer_type: "user", customer_id: userId, offer_id: "ot" },
  });
  expect(createUrl2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "PRODUCT_ALREADY_GRANTED",
        "details": {
          "customer_id": "<stripped UUID>",
          "product_id": "ot",
        },
        "error": "Customer with ID \\"<stripped UUID>\\" already owns product \\"ot\\".",
      },
      "headers": Headers {
        "x-stack-known-error": "PRODUCT_ALREADY_GRANTED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should block one-time purchase in same group after prior one-time purchase in that group (test-mode persisted)", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      catalogs: { grp: { displayName: "Group" } },
      products: {
        offerA: {
          displayName: "Offer A",
          customerType: "user",
          serverOnly: false,
          groupId: "grp",
          stackable: true,
          prices: { one: { USD: "500" } },
          includedItems: {},
        },
        offerB: {
          displayName: "Offer B",
          customerType: "user",
          serverOnly: false,
          groupId: "grp",
          stackable: true,
          prices: { one: { USD: "700" } },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await User.create();
  // Purchase offerA in TEST_MODE (persists OneTimePurchase)
  const urlA = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: { customer_type: "user", customer_id: userId, offer_id: "offerA" },
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
    body: { customer_type: "user", customer_id: userId, offer_id: "offerB" },
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
  expect(String(resB.body)).toContain("one-time purchase in this product catalog");
});
