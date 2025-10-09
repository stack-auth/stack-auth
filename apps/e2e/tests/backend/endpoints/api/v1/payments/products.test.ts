import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { it } from "../../../../../helpers";
import { Auth, niceBackendFetch, Payments, Project, User } from "../../../../backend-helpers";

async function configureProduct(config: any) {
  await Project.updateConfig({
    payments: config,
  });
}

it("should reject client requests to grant product", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await configureProduct({
    products: {
      "pro-plan": {
        displayName: "Pro Plan",
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
  });
  const { userId } = await User.create();
  const response = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "client",
    body: {
      product_id: "pro-plan",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "INSUFFICIENT_ACCESS_TYPE",
        "details": {
          "actual_access_type": "client",
          "allowed_access_types": [
            "server",
            "admin",
          ],
        },
        "error": "The x-stack-access-type header must be 'server' or 'admin', but was 'client'.",
      },
      "headers": Headers {
        "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should grant configured subscription product and expose it via listing", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await configureProduct({
    products: {
      "pro-plan": {
        displayName: "Pro Plan",
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
  });

  const { userId } = await User.create();
  const grantResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "pro-plan",
    },
  });

  expect(grantResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const listResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": true,
        "items": [
          {
            "id": "pro-plan",
            "product": {
              "customer_type": "user",
              "display_name": "Pro Plan",
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
            "quantity": 1,
          },
        ],
        "pagination": { "next_cursor": null },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should hide server-only products from clients while exposing them to servers", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await configureProduct({
    products: {
      "server-plan": {
        displayName: "Server Plan",
        customerType: "user",
        serverOnly: true,
        stackable: false,
        prices: {
          monthly: {
            USD: "1500",
            interval: [1, "month"],
          },
        },
        includedItems: {},
      },
    },
  });

  const { userId } = await User.create();
  const grantResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "server-plan",
    },
  });

  expect(grantResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const clientListResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });

  expect(clientListResponse).toMatchInlineSnapshot(`
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

  const serverListResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "server",
  });

  expect(serverListResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": true,
        "items": [
          {
            "id": "server-plan",
            "product": {
              "customer_type": "user",
              "display_name": "Server Plan",
              "included_items": {},
              "prices": {
                "monthly": {
                  "USD": "1500",
                  "interval": [
                    1,
                    "month",
                  ],
                },
              },
              "server_only": true,
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
});

it("should prevent granting an already owned non-stackable product", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await configureProduct({
    products: {
      "single-plan": {
        displayName: "Single Plan",
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
  });

  const { userId } = await User.create();
  const firstGrant = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "single-plan",
    },
  });
  expect(firstGrant.status).toBe(200);

  const secondGrant = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "single-plan",
    },
  });

  expect(secondGrant).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "PRODUCT_ALREADY_GRANTED",
        "details": {
          "customer_id": "<stripped UUID>",
          "product_id": "single-plan",
        },
        "error": "Customer with ID \\"<stripped UUID>\\" already owns product \\"single-plan\\".",
      },
      "headers": Headers {
        "x-stack-known-error": "PRODUCT_ALREADY_GRANTED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should allow granting stackable product with custom quantity", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await configureProduct({
    products: {
      "stackable-plan": {
        displayName: "Stackable Plan",
        customerType: "user",
        serverOnly: false,
        stackable: true,
        prices: {
          monthly: {
            USD: "1000",
            interval: [1, "month"],
          },
        },
        includedItems: {},
      },
    },
  });

  const { userId } = await User.create();
  const grantResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "stackable-plan",
      quantity: 3,
    },
  });
  expect(grantResponse.status).toBe(200);

  const listResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": true,
        "items": [
          {
            "id": "stackable-plan",
            "product": {
              "customer_type": "user",
              "display_name": "Stackable Plan",
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
              "stackable": true,
            },
            "quantity": 3,
          },
        ],
        "pagination": { "next_cursor": null },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should grant inline product without needing configuration", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Payments.setup();
  const { userId } = await Auth.Otp.signIn();

  const grantResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_inline: {
        display_name: "Inline Access",
        customer_type: "user",
        server_only: true,
        prices: {
          quarterly: {
            USD: "2400",
            interval: [3, "month"],
          },
        },
        included_items: {},
      },
    },
  });
  expect(grantResponse.status).toBe(200);

  const listResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "server",
  });
  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": true,
        "items": [
          {
            "id": null,
            "product": {
              "customer_type": "user",
              "display_name": "Inline Access",
              "included_items": {},
              "prices": {
                "quarterly": {
                  "USD": "2400",
                  "interval": [
                    3,
                    "month",
                  ],
                },
              },
              "server_only": true,
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
});

it("should reject requests missing product details", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  const { userId } = await User.create();

  const response = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
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

it("should reject quantity > 1 for non-stackable product", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await configureProduct({
    products: {
      "limited-plan": {
        displayName: "Limited Plan",
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
  });

  const { userId } = await User.create();
  const response = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "limited-plan",
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

it("should reject product/customer type mismatch", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await configureProduct({
    products: {
      "team-plan": {
        displayName: "Team Plan",
        customerType: "team",
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
  });

  const { userId } = await User.create();
  const response = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "team-plan",
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "PRODUCT_CUSTOMER_TYPE_DOES_NOT_MATCH",
        "details": {
          "actual_customer_type": "user",
          "customer_id": "<stripped UUID>",
          "product_customer_type": "team",
          "product_id": "team-plan",
        },
        "error": "The user with ID \\"<stripped UUID>\\" is not a valid customer for the inline product that has been passed in. The product is configured to only be available for team customers, but the customer is a user.",
      },
      "headers": Headers {
        "x-stack-known-error": "PRODUCT_CUSTOMER_TYPE_DOES_NOT_MATCH",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should return user not found when granting to missing user", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await configureProduct({
    products: {
      "solo-plan": {
        displayName: "Solo Plan",
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
  });

  const response = await niceBackendFetch(`/api/v1/payments/products/user/${generateUuid()}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "solo-plan",
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": {
        "code": "USER_NOT_FOUND",
        "error": "User not found.",
      },
      "headers": Headers {
        "x-stack-known-error": "USER_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("listing owned products should require authentication", async ({ expect }) => {
  await Project.createAndSwitch();
  const { userId } = await User.create();

  const response = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`);
  expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "ACCESS_TYPE_REQUIRED",
          "error": deindent\`
            You must specify an access level for this Stack project. Make sure project API keys are provided (eg. x-stack-publishable-client-key) and you set the x-stack-access-type header to 'client', 'server', or 'admin'.
            
            For more information, see the docs on REST API authentication: https://docs.stack-auth.com/rest-api/overview#authentication
          \`,
        },
        "headers": Headers {
          "x-stack-known-error": "ACCESS_TYPE_REQUIRED",
          <some fields may have been hidden>,
        },
      }
    `);
});

it("listing products should return empty list when customer owns no products", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  const { userId } = await User.create();

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

it("listing products should list both subscription and one-time products", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      products: {
        "subscription-plan": {
          displayName: "Subscription Plan",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            monthly: {
              USD: "1200",
              interval: [1, "month"],
            },
          },
          includedItems: {},
        },
        "lifetime-addon": {
          displayName: "Lifetime Add-on",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            lifetime: {
              USD: "5000",
            },
          },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await User.create();

  const grantSubscription = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "subscription-plan",
    },
  });
  expect(grantSubscription.status).toBe(200);

  const grantOneTime = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "lifetime-addon",
    },
  });
  expect(grantOneTime.status).toBe(200);

  const response = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    accessType: "client",
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": true,
        "items": [
          {
            "id": "subscription-plan",
            "product": {
              "customer_type": "user",
              "display_name": "Subscription Plan",
              "included_items": {},
              "prices": {
                "monthly": {
                  "USD": "1200",
                  "interval": [
                    1,
                    "month",
                  ],
                },
              },
              "server_only": false,
              "stackable": false,
            },
            "quantity": 1,
          },
          {
            "id": "lifetime-addon",
            "product": {
              "customer_type": "user",
              "display_name": "Lifetime Add-on",
              "included_items": {},
              "prices": { "lifetime": { "USD": "5000" } },
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
});

it("listing products should support cursor pagination", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      products: {
        "subscription-plan": {
          displayName: "Subscription Plan",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            monthly: {
              USD: "1200",
              interval: [1, "month"],
            },
          },
          includedItems: {},
        },
        "lifetime-addon": {
          displayName: "Lifetime Add-on",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            lifetime: {
              USD: "5000",
            },
          },
          includedItems: {},
        },
        "pro-addon": {
          displayName: "Pro Add-on",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: {
            standard: {
              USD: "7000",
            },
          },
          includedItems: {},
        },
      },
    },
  });

  const { userId } = await User.create();

  await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "subscription-plan",
    },
  });

  await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "lifetime-addon",
    },
  });

  await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "pro-addon",
    },
  });

  const basePath = `/api/v1/payments/products/user/${userId}`;
  const allResponse = await niceBackendFetch(basePath, {
    accessType: "client",
  });


  const firstPage = await niceBackendFetch(`${basePath}?limit=1`, {
    accessType: "client",
  });
  expect(firstPage).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": true,
        "items": [
          {
            "id": "subscription-plan",
            "product": {
              "customer_type": "user",
              "display_name": "Subscription Plan",
              "included_items": {},
              "prices": {
                "monthly": {
                  "USD": "1200",
                  "interval": [
                    1,
                    "month",
                  ],
                },
              },
              "server_only": false,
              "stackable": false,
            },
            "quantity": 1,
          },
        ],
        "pagination": { "next_cursor": "<stripped UUID>" },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const cursor = firstPage.body.pagination.next_cursor;
  const secondPage = await niceBackendFetch(`${basePath}?limit=5&cursor=${encodeURIComponent(cursor)}`, {
    accessType: "client",
  });
  expect(secondPage).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": true,
        "items": [
          {
            "id": "lifetime-addon",
            "product": {
              "customer_type": "user",
              "display_name": "Lifetime Add-on",
              "included_items": {},
              "prices": { "lifetime": { "USD": "5000" } },
              "server_only": false,
              "stackable": false,
            },
            "quantity": 1,
          },
          {
            "id": "pro-addon",
            "product": {
              "customer_type": "user",
              "display_name": "Pro Add-on",
              "included_items": {},
              "prices": { "standard": { "USD": "7000" } },
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

  const combinedItems = [...firstPage.body.items, ...secondPage.body.items];
  expect(combinedItems).toEqual(allResponse.body.items);
});
