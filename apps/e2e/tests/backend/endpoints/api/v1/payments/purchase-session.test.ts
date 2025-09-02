import { it } from "../../../../../helpers";
import { Auth, Payments, Project, User, niceBackendFetch } from "../../../../backend-helpers";

it("should error on invalid code", async ({ expect }) => {
  await Project.createAndSwitch();
  const response = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
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
  const response = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
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
      "body": "Price not found on offer associated with this purchase code",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should properly create subscription", async ({ expect }) => {
  const { code } = await Payments.createPurchaseUrlAndGetCode();
  const response = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: code,
      price_id: "monthly",
      quantity: 1,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "client_secret": "" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should create purchase URL, validate code, and create purchase session", async ({ expect }) => {
  const { code } = await Payments.createPurchaseUrlAndGetCode();
  const response = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
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
      "body": "This offer is not stackable; quantity must be 1",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should create purchase URL with inline offer, validate code, and create purchase session", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Payments.setup();

  const { userId } = await Auth.Otp.signIn();
  const response = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
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
  expect(body.url).toMatch(/^https?:\/\/localhost:8101\/purchase\/[a-z0-9-_]+$/);
  const codeMatch = body.url.match(/\/purchase\/([a-z0-9-_]+)/);
  const code = codeMatch ? codeMatch[1] : undefined;
  expect(code).toBeDefined();

  const purchaseSessionResponse = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
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

it("should error when admin tenancy differs from code tenancy", async ({ expect }) => {
  const { code } = await Payments.createPurchaseUrlAndGetCode();
  await Project.createAndSwitch();

  const response = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: {
      full_code: code,
      price_id: "monthly",
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Tenancy id does not match value from code data",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("creates subscription in test mode and increases included item quantity", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      items: {
        "test-item": {
          displayName: "Test Item",
          customerType: "user",
        },
      },
      offers: {
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
  const createUrlResponse = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
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

  const getBefore = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/test-item`, {
    accessType: "client",
  });
  expect(getBefore.status).toBe(200);
  expect(getBefore.body.quantity).toBe(0);

  const purchaseSessionResponse = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: {
      full_code: code,
      price_id: "monthly",
    },
  });
  expect(purchaseSessionResponse.status).toBe(200);
  expect(purchaseSessionResponse.body).toEqual({ success: true });

  const getAfter = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/test-item`, {
    accessType: "client",
  });
  expect(getAfter.status).toBe(200);
  expect(getAfter.body.quantity).toBe(2);
});

it("test-mode should error when access type is not admin", async ({ expect }) => {
  const { code } = await Payments.createPurchaseUrlAndGetCode();
  const response = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: code,
      price_id: "monthly",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "INSUFFICIENT_ACCESS_TYPE",
        "details": {
          "actual_access_type": "client",
          "allowed_access_types": ["admin"],
        },
        "error": "The x-stack-access-type header must be 'admin', but was 'client'.",
      },
      "headers": Headers {
        "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("test-mode should error on invalid code", async ({ expect }) => {
  await Project.createAndSwitch();
  const response = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
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
  const response = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
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
      "body": "Price not found on offer associated with this purchase code",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("allows stackable quantity in test mode and multiplies included items", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      items: {
        "test-item": {
          displayName: "Test Item",
          customerType: "user",
        },
      },
      offers: {
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
  const createUrlResponse = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
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

  const getBefore = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/test-item`, {
    accessType: "client",
  });
  expect(getBefore.status).toBe(200);
  expect(getBefore.body.quantity).toBe(0);

  const purchaseSessionResponse = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
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

  const getAfter = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/test-item`, {
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
      groups: {
        grp: { displayName: "Test Group" },
      },
      offers: {
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
  const createUrlA = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
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

  const purchaseA = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
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
  const createUrlB = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
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

  const purchaseB = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
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
      groups: {
        grp: { displayName: "Test Group" },
      },
      offers: {
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
  const resUrlA = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
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

  const testModeRes = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
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
  const resUrlB = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
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

  const purchaseB = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
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
