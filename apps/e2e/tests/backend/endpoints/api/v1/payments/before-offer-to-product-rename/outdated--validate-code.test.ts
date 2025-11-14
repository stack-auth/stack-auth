import { it } from "../../../../../../helpers";
import { Payments, Project, User, niceBackendFetch } from "../../../../../backend-helpers";


it("should error on invalid code", async ({ expect }) => {
  await Project.createAndSwitch();
  const response = await niceBackendFetch("/api/v1/payments/purchases/validate-code", {
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

it("should allow valid code and return offer data", async ({ expect }) => {
  const { code } = await Payments.createPurchaseUrlAndGetCode();
  const validateResponse = await niceBackendFetch("/api/v1/payments/purchases/validate-code", {
    method: "POST",
    accessType: "client",
    body: { full_code: code },
  });
  expect(validateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "already_bought_non_stackable": false,
        "charges_enabled": false,
        "conflicting_products": [],
        "product": {
          "client_metadata": null,
          "client_read_only_metadata": null,
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
          "server_metadata": null,
          "server_only": false,
          "stackable": false,
        },
        "project_id": "<stripped UUID>",
        "project_logo_url": null,
        "stripe_account_id": <stripped field 'stripe_account_id'>,
        "test_mode": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should set already_bought_non_stackable when user already owns non-stackable offer", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
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
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await User.create();
  // Create a code for test-offer and purchase it in test mode (creates DB subscription)
  const createUrlRes1 = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      offer_id: "test-offer",
    },
  });
  expect(createUrlRes1.status).toBe(200);
  const code1 = (createUrlRes1.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
  expect(code1).toBeDefined();

  const testModeRes = await niceBackendFetch("/api/v1/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: {
      full_code: code1,
      price_id: "monthly",
      quantity: 1,
    },
  });
  expect(testModeRes.status).toBe(200);

  // Create a second code for the same offer and validate; should report already_bought_non_stackable
  const createUrlRes2 = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      offer_id: "test-offer",
    },
  });
  expect(createUrlRes2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "PRODUCT_ALREADY_GRANTED",
        "details": {
          "customer_id": "<stripped UUID>",
          "product_id": "test-offer",
        },
        "error": "Customer with ID \\"<stripped UUID>\\" already owns product \\"test-offer\\".",
      },
      "headers": Headers {
        "x-stack-known-error": "PRODUCT_ALREADY_GRANTED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should include conflicting_group_offers when switching within the same group", async ({ expect }) => {
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
          stackable: false,
          prices: { monthly: { USD: "1000", interval: [1, "month"] } },
          includedItems: {},
        },
        offerB: {
          displayName: "Offer B",
          customerType: "user",
          serverOnly: false,
          groupId: "grp",
          stackable: false,
          prices: { monthly: { USD: "2000", interval: [1, "month"] } },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await User.create();

  // Subscribe to offerA in test mode
  const resUrlA = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: { customer_type: "user", customer_id: userId, offer_id: "offerA" },
  });
  expect(resUrlA.status).toBe(200);
  const codeA = (resUrlA.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
  expect(codeA).toBeDefined();

  const testModeRes = await niceBackendFetch("/api/v1/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: { full_code: codeA, price_id: "monthly", quantity: 1 },
  });
  expect(testModeRes.status).toBe(200);

  // Now validate code for offerB; should report conflict with offerA
  const resUrlB = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: { customer_type: "user", customer_id: userId, offer_id: "offerB" },
  });
  expect(resUrlB.status).toBe(200);
  const codeB = (resUrlB.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
  expect(codeB).toBeDefined();

  const validateResponse = await niceBackendFetch("/api/v1/payments/purchases/validate-code", {
    method: "POST",
    accessType: "client",
    body: { full_code: codeB },
  });
  expect(validateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "already_bought_non_stackable": false,
        "charges_enabled": false,
        "conflicting_products": [
          {
            "display_name": "Offer A",
            "product_id": "offerA",
          },
        ],
        "product": {
          "client_metadata": null,
          "client_read_only_metadata": null,
          "customer_type": "user",
          "display_name": "Offer B",
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
          "server_metadata": null,
          "server_only": false,
          "stackable": false,
        },
        "project_id": "<stripped UUID>",
        "project_logo_url": null,
        "stripe_account_id": <stripped field 'stripe_account_id'>,
        "test_mode": true,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
