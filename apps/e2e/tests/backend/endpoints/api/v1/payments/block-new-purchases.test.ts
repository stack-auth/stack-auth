import { it } from "../../../../../helpers";
import { Auth, Payments, Project, User, niceBackendFetch } from "../../../../backend-helpers";

it("should block create-purchase-url when blockNewPurchases is enabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      blockNewPurchases: true,
      products: {
        "test-product": {
          displayName: "Test Product",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            "monthly": {
              USD: "1000",
              interval: [1, "month"],
            },
          },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await Auth.fastSignUp();
  const response = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "test-product",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": {
        "code": "NEW_PURCHASES_BLOCKED",
        "error": "New purchases are currently blocked for this project. Please contact support for more information.",
      },
      "headers": Headers {
        "x-stack-known-error": "NEW_PURCHASES_BLOCKED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should block purchase-session when blockNewPurchases is enabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      products: {
        "test-product": {
          displayName: "Test Product",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            "monthly": {
              USD: "1000",
              interval: [1, "month"],
            },
          },
          includedItems: {},
        },
      },
    },
  });

  // Create purchase URL before enabling blockNewPurchases
  const { userId } = await Auth.fastSignUp();
  const createUrlResponse = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "test-product",
    },
  });
  expect(createUrlResponse.status).toBe(200);
  const url = (createUrlResponse.body as { url: string }).url;
  const code = url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
  expect(code).toBeDefined();

  // Now enable blockNewPurchases
  await Project.updateConfig({
    "payments.blockNewPurchases": true,
  });

  // Try to use the purchase session
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
      "status": 403,
      "body": {
        "code": "NEW_PURCHASES_BLOCKED",
        "error": "New purchases are currently blocked for this project. Please contact support for more information.",
      },
      "headers": Headers {
        "x-stack-known-error": "NEW_PURCHASES_BLOCKED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should block test-mode-purchase-session when blockNewPurchases is enabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
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
            "monthly": {
              USD: "1000",
              interval: [1, "month"],
            },
          },
          includedItems: {},
        },
      },
    },
  });

  // Create purchase URL before enabling blockNewPurchases
  const { userId } = await Auth.fastSignUp();
  const createUrlResponse = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "test-product",
    },
  });
  expect(createUrlResponse.status).toBe(200);
  const url = (createUrlResponse.body as { url: string }).url;
  const code = url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1];
  expect(code).toBeDefined();

  // Now enable blockNewPurchases
  await Project.updateConfig({
    "payments.blockNewPurchases": true,
  });

  // Try to use the test-mode purchase session
  const response = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: {
      full_code: code,
      price_id: "monthly",
      quantity: 1,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": {
        "code": "NEW_PURCHASES_BLOCKED",
        "error": "New purchases are currently blocked for this project. Please contact support for more information.",
      },
      "headers": Headers {
        "x-stack-known-error": "NEW_PURCHASES_BLOCKED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should block switch endpoint when blockNewPurchases is enabled", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      blockNewPurchases: true,
      catalogs: {
        catalog: { displayName: "Plans" },
      },
      products: {
        planA: {
          displayName: "Plan A",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          catalogId: "catalog",
          prices: "include-by-default",
          includedItems: {},
        },
        planB: {
          displayName: "Plan B",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          catalogId: "catalog",
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

  const { userId } = await Auth.fastSignUp();

  const switchResponse = await niceBackendFetch(`/api/latest/payments/products/user/${userId}/switch`, {
    method: "POST",
    accessType: "client",
    body: {
      from_product_id: "planA",
      to_product_id: "planB",
    },
  });
  expect(switchResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": {
        "code": "NEW_PURCHASES_BLOCKED",
        "error": "New purchases are currently blocked for this project. Please contact support for more information.",
      },
      "headers": Headers {
        "x-stack-known-error": "NEW_PURCHASES_BLOCKED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should allow purchases when blockNewPurchases is false (default)", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      blockNewPurchases: false,
      products: {
        "test-product": {
          displayName: "Test Product",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            "monthly": {
              USD: "1000",
              interval: [1, "month"],
            },
          },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await Auth.fastSignUp();
  const response = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "test-product",
    },
  });
  expect(response.status).toBe(200);
  expect((response.body as { url: string }).url).toMatch(/\/purchase\/[a-z0-9-_]+/);
});

it("should allow purchases when blockNewPurchases is not set (defaults to false)", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      products: {
        "test-product": {
          displayName: "Test Product",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            "monthly": {
              USD: "1000",
              interval: [1, "month"],
            },
          },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await Auth.fastSignUp();
  const response = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "test-product",
    },
  });
  expect(response.status).toBe(200);
  expect((response.body as { url: string }).url).toMatch(/\/purchase\/[a-z0-9-_]+/);
});

it("should allow disabling blockNewPurchases to resume purchases", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      blockNewPurchases: true,
      products: {
        "test-product": {
          displayName: "Test Product",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            "monthly": {
              USD: "1000",
              interval: [1, "month"],
            },
          },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await Auth.fastSignUp();

  // First, verify purchases are blocked
  const blockedResponse = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "test-product",
    },
  });
  expect(blockedResponse.status).toBe(403);
  expect((blockedResponse.body as { code: string }).code).toBe("NEW_PURCHASES_BLOCKED");

  // Now disable blockNewPurchases (keeping the products config)
  await Project.updateConfig({
    "payments.blockNewPurchases": false,
  });

  // Verify purchases work again (same user since they never actually purchased)
  const allowedResponse = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "test-product",
    },
  });
  expect(allowedResponse.status).toBe(200);
  expect((allowedResponse.body as { url: string }).url).toMatch(/\/purchase\/[a-z0-9-_]+/);
});
