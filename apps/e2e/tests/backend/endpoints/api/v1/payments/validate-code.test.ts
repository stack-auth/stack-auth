import { it } from "../../../../../helpers";
import { Payments, Project, User, niceBackendFetch } from "../../../../backend-helpers";


it("should error on invalid code", async ({ expect }) => {
  await Project.createAndSwitch();
  const response = await niceBackendFetch("/api/latest/payments/purchases/validate-code", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: "invalid-code",
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

it("should allow valid code and return product data", async ({ expect }) => {
  const { code } = await Payments.createPurchaseUrlAndGetCode();
  const validateResponse = await niceBackendFetch("/api/latest/payments/purchases/validate-code", {
    method: "POST",
    accessType: "client",
    body: { full_code: code },
  });
  expect(validateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "already_bought_non_stackable": false,
        "conflicting_products": [],
        "product": {
          "customer_type": "user",
          "display_name": "Test Product",
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
          "server_only": false,
          "stackable": false,
        },
        "project_id": "<stripped UUID>",
        "stripe_account_id": <stripped field 'stripe_account_id'>,
        "test_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should set already_bought_non_stackable when user already owns non-stackable product", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      products: {
        "test-product": {
          displayName: "Test Product",
          customerType: "user",
          serverOnly: false,
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
  // Create a code for test-product and purchase it in test mode (creates DB subscription)
  const createUrlRes1 = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "test-product",
    },
  });
  expect(createUrlRes1.status).toBe(200);
  const code1 = (createUrlRes1.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
  expect(code1).toBeDefined();

  const testModeRes = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: {
      full_code: code1,
      price_id: "monthly",
      quantity: 1,
    },
  });
  expect(testModeRes.status).toBe(200);

  // Create a second code for the same product and validate; should report already_bought_non_stackable
  const createUrlRes2 = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "test-product",
    },
  });
  expect(createUrlRes2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "PRODUCT_ALREADY_GRANTED",
        "details": {
          "customer_id": "<stripped UUID>",
          "product_id": "test-product",
        },
        "error": "Customer with ID \\"<stripped UUID>\\" already owns product \\"test-product\\".",
      },
      "headers": Headers {
        "x-stack-known-error": "PRODUCT_ALREADY_GRANTED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should include conflicting_products when switching within the same group", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      catalogs: { grp: { displayName: "Group" } },
      products: {
        productA: {
          displayName: "Product A",
          customerType: "user",
          serverOnly: false,
          catalogId: "grp",
          stackable: false,
          prices: { monthly: { USD: "1000", interval: [1, "month"] } },
          includedItems: {},
        },
        productB: {
          displayName: "Product B",
          customerType: "user",
          serverOnly: false,
          catalogId: "grp",
          stackable: false,
          prices: { monthly: { USD: "2000", interval: [1, "month"] } },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await User.create();

  // Subscribe to productA in test mode
  const resUrlA = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: { customer_type: "user", customer_id: userId, product_id: "productA" },
  });
  expect(resUrlA.status).toBe(200);
  const codeA = (resUrlA.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
  expect(codeA).toBeDefined();

  const testModeRes = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: { full_code: codeA, price_id: "monthly", quantity: 1 },
  });
  expect(testModeRes.status).toBe(200);

  // Now validate code for productB; should report conflict with productA
  const resUrlB = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: { customer_type: "user", customer_id: userId, product_id: "productB" },
  });
  expect(resUrlB.status).toBe(200);
  const codeB = (resUrlB.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
  expect(codeB).toBeDefined();

  const validateResponse = await niceBackendFetch("/api/latest/payments/purchases/validate-code", {
    method: "POST",
    accessType: "client",
    body: { full_code: codeB },
  });
  expect(validateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "already_bought_non_stackable": false,
        "conflicting_products": [
          {
            "display_name": "Product A",
            "product_id": "productA",
          },
        ],
        "product": {
          "customer_type": "user",
          "display_name": "Product B",
          "included_items": {},
          "prices": {
            "monthly": {
              "USD": "2000",
              "interval": [
                1,
                "month",
              ],
            },
          },
          "server_only": false,
          "stackable": false,
        },
        "project_id": "<stripped UUID>",
        "stripe_account_id": <stripped field 'stripe_account_id'>,
        "test_mode": true,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should reject untrusted return_url and accept trusted return_url", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      products: {
        "test-product": {
          displayName: "Test Product",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: { monthly: { USD: "1000", interval: [1, "month"] } },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await User.create();
  await Project.updateConfig({
    domains: {
      allowLocalhost: false,
      trustedDomains: {
        '1': { baseUrl: 'https://stack-test.com', handlerPath: '/handler' },
      },
    },
  });
  const createUrlRes = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: { customer_type: "user", customer_id: userId, product_id: "test-product" },
  });
  expect(createUrlRes.status).toBe(200);
  const code = (createUrlRes.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
  expect(code).toBeDefined();

  const badRes = await niceBackendFetch("/api/latest/payments/purchases/validate-code", {
    method: "POST",
    accessType: "client",
    body: { full_code: code, return_url: "https://malicious.com/callback" },
  });
  expect(badRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "REDIRECT_URL_NOT_WHITELISTED",
        "error": "Redirect URL not whitelisted. Did you forget to add this domain to the trusted domains list on the Stack Auth dashboard?",
      },
      "headers": Headers {
        "x-stack-known-error": "REDIRECT_URL_NOT_WHITELISTED",
        <some fields may have been hidden>,
      },
    }
  `);

  const goodRes = await niceBackendFetch("/api/latest/payments/purchases/validate-code", {
    method: "POST",
    accessType: "client",
    body: { full_code: code, return_url: "https://stack-test.com/handler" },
  });
  expect(goodRes).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "already_bought_non_stackable": false,
        "conflicting_products": [],
        "product": {
          "customer_type": "user",
          "display_name": "Test Product",
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
          "server_only": false,
          "stackable": false,
        },
        "project_id": "<stripped UUID>",
        "stripe_account_id": <stripped field 'stripe_account_id'>,
        "test_mode": true,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
