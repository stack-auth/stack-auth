import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { it } from "../../../../../helpers";
import { Auth, niceBackendFetch, Payments, Project, User } from "../../../../backend-helpers";

it("should not be able to create purchase URL without product_id or product_inline", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  const response = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: generateUuid(),
    },
  });
  expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "Must specify either product_id or product_inline!",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
});

it("should error for non-existent product_id", async ({ expect }) => {
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

  const response = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: generateUuid(),
      product_id: "non-existent-product",
    },
  });
  expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "PRODUCT_DOES_NOT_EXIST",
          "details": {
            "access_type": "client",
            "product_id": "non-existent-product",
          },
          "error": "Product with ID \\"non-existent-product\\" does not exist or you don't have permissions to access it.",
        },
        "headers": Headers {
          "x-stack-known-error": "PRODUCT_DOES_NOT_EXIST",
          <some fields may have been hidden>,
        },
      }
    `);
});

it("should error for invalid customer_id", async ({ expect }) => {
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

  await Auth.Otp.signIn();
  const response = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "team",
      customer_id: generateUuid(),
      product_id: "test-product",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "PRODUCT_CUSTOMER_TYPE_DOES_NOT_MATCH",
        "details": {
          "actual_customer_type": "team",
          "customer_id": "<stripped UUID>",
          "product_customer_type": "user",
          "product_id": "test-product",
        },
        "error": "The team with ID \\"<stripped UUID>\\" is not a valid customer for the inline product that has been passed in. The product is configured to only be available for user customers, but the customer is a team.",
      },
      "headers": Headers {
        "x-stack-known-error": "PRODUCT_CUSTOMER_TYPE_DOES_NOT_MATCH",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should error for no connected stripe account", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
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

  const user = await User.create();
  const response = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: user.userId,
      product_id: "test-product",
    },
  });
  expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "Payments are not set up in this Stack Auth project. Please go to the Stack Auth dashboard and complete the Payments onboarding.",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
});


it("should not allow product_inline when calling from client", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Payments.setup();

  const { userId } = await Auth.Otp.signIn();
  const response = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_inline: {
        display_name: "Inline Test Product",
        customer_type: "user",
        server_only: true,
        prices: {
          "monthly": {
            USD: "1000",
            interval: [1, "month"],
          },
        },
        included_items: {},
      },
    },
  });
  expect(response.body).toMatchInlineSnapshot(`"Cannot specify product_inline when calling from client! Please call with a server API key, or use the product_id parameter."`);
});

it("should error for server-only product when calling from client", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      products: {
        "test-product": {
          displayName: "Test Product",
          customerType: "user",
          serverOnly: true,
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

  const { userId } = await User.create();
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
      "status": 400,
      "body": {
        "code": "PRODUCT_DOES_NOT_EXIST",
        "details": {
          "access_type": "client",
          "product_id": "test-product",
        },
        "error": "Product with ID \\"test-product\\" does not exist or you don't have permissions to access it.",
      },
      "headers": Headers {
        "x-stack-known-error": "PRODUCT_DOES_NOT_EXIST",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should allow product_inline when calling from server", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Payments.setup();

  const { userId } = await Auth.Otp.signIn();
  const response = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "server",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_inline: {
        display_name: "Inline Test Product",
        customer_type: "user",
        server_only: true,
        prices: {
          "monthly": {
            USD: "1000",
            interval: [1, "month"],
          },
        },
        included_items: {},
      },
    },
  });
  expect(response.status).toBe(200);
  expect(response.body.url).toMatch(/^https?:\/\/localhost:8101\/purchase\/[a-z0-9-_]+$/);
});

it("should allow valid product_id", async ({ expect }) => {
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

  const { userId } = await User.create();
  const response = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "test-product",
      return_url: "http://stack-test.localhost/after-purchase",
    },
  });
  expect(response.status).toBe(200);
  const body = response.body as { url: string };
  expect(body.url).toMatch(/^https?:\/\/localhost:8101\/purchase\/[a-z0-9-_]+\?return_url=/);
  const urlObj = new URL(body.url);
  const returnUrl = urlObj.searchParams.get("return_url");
  expect(returnUrl).toBe("http://stack-test.localhost/after-purchase");
});

it("should error for untrusted return_url", async ({ expect }) => {
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

  const { userId } = await User.create();
  const response = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "test-product",
      return_url: "https://malicious.com/callback",
    },
  });
  expect(response).toMatchInlineSnapshot(`
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
});
