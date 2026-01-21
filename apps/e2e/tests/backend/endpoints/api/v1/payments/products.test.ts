import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { it } from "../../../../../helpers";
import { Auth, niceBackendFetch, Payments, Project, Team, User } from "../../../../backend-helpers";

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
              "client_metadata": null,
              "client_read_only_metadata": null,
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
              "server_metadata": null,
              "server_only": false,
              "stackable": false,
            },
            "quantity": 1,
            "subscription": {
              "cancel_at_period_end": false,
              "current_period_end": <stripped field 'current_period_end'>,
              "is_cancelable": true,
            },
            "type": "subscription",
          },
        ],
        "pagination": { "next_cursor": null },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should allow a signed-in user to cancel their own subscription product", async ({ expect }) => {
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

  const { userId } = await Auth.fastSignUp();
  await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "pro-plan",
    },
  });

  const cancelResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}/pro-plan`, {
    method: "DELETE",
    accessType: "client",
  });
  expect(cancelResponse).toMatchInlineSnapshot(`
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
        "items": [],
        "pagination": { "next_cursor": null },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should reject a client canceling someone else's subscription product", async ({ expect }) => {
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

  const { userId: userId1 } = await Auth.fastSignUp();
  await niceBackendFetch(`/api/v1/payments/products/user/${userId1}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "pro-plan",
    },
  });

  const { userId: userId2 } = await Auth.fastSignUp();
  expect(userId2).not.toEqual(userId1);

  const cancelResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId1}/pro-plan`, {
    method: "DELETE",
    accessType: "client",
  });
  expect(cancelResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": "Clients can only cancel their own subscriptions.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should allow a server to cancel someone else's subscription product", async ({ expect }) => {
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

  const { userId } = await Auth.fastSignUp();
  await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "pro-plan",
    },
  });

  const cancelResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}/pro-plan`, {
    method: "DELETE",
    accessType: "server",
  });
  expect(cancelResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should cancel all stackable subscription quantities", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await configureProduct({
    products: {
      "seats-plan": {
        displayName: "Seats Plan",
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

  const { userId } = await Auth.fastSignUp();
  await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "seats-plan",
    },
  });
  await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "seats-plan",
    },
  });

  const cancelResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}/seats-plan`, {
    method: "DELETE",
    accessType: "client",
  });
  expect(cancelResponse).toMatchInlineSnapshot(`
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
        "items": [],
        "pagination": { "next_cursor": null },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should reject canceling a one-time purchase product", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await configureProduct({
    products: {
      "one-time": {
        displayName: "One Time",
        customerType: "user",
        serverOnly: false,
        stackable: false,
        prices: {
          once: {
            USD: "1000",
          },
        },
        includedItems: {},
      },
    },
  });

  const { userId } = await Auth.fastSignUp();
  await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "one-time",
    },
  });

  const cancelResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}/one-time`, {
    method: "DELETE",
    accessType: "client",
  });
  expect(cancelResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "This product is a one time purchase and cannot be canceled.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should allow a team admin to cancel a team's subscription product", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await configureProduct({
    products: {
      "team-pro-plan": {
        displayName: "Team Pro Plan",
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

  const { userId } = await Auth.fastSignUp();
  const { teamId } = await Team.create({ accessType: "server", creatorUserId: userId });

  await niceBackendFetch(`/api/v1/payments/products/team/${teamId}`, {
    method: "POST",
    accessType: "server",
    body: {
      product_id: "team-pro-plan",
    },
  });

  const cancelResponse = await niceBackendFetch(`/api/v1/payments/products/team/${teamId}/team-pro-plan`, {
    method: "DELETE",
    accessType: "client",
  });
  expect(cancelResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
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
              "client_metadata": null,
              "client_read_only_metadata": null,
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
              "server_metadata": null,
              "server_only": true,
              "stackable": false,
            },
            "quantity": 1,
            "subscription": {
              "cancel_at_period_end": false,
              "current_period_end": <stripped field 'current_period_end'>,
              "is_cancelable": true,
            },
            "type": "subscription",
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
              "client_metadata": null,
              "client_read_only_metadata": null,
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
              "server_metadata": null,
              "server_only": false,
              "stackable": true,
            },
            "quantity": 3,
            "subscription": {
              "cancel_at_period_end": false,
              "current_period_end": <stripped field 'current_period_end'>,
              "is_cancelable": true,
            },
            "type": "subscription",
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
  const { userId } = await Auth.fastSignUp();

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
        server_metadata: {
          cohort: "beta",
          flags: ["inline-grant"],
        },
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
              "client_metadata": null,
              "client_read_only_metadata": null,
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
              "server_metadata": {
                "cohort": "beta",
                "flags": ["inline-grant"],
              },
              "server_only": true,
              "stackable": false,
            },
            "quantity": 1,
            "subscription": {
              "cancel_at_period_end": false,
              "current_period_end": <stripped field 'current_period_end'>,
              "is_cancelable": false,
            },
            "type": "subscription",
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
              "client_metadata": null,
              "client_read_only_metadata": null,
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
              "server_metadata": null,
              "server_only": false,
              "stackable": false,
            },
            "quantity": 1,
            "subscription": {
              "cancel_at_period_end": false,
              "current_period_end": <stripped field 'current_period_end'>,
              "is_cancelable": true,
            },
            "type": "subscription",
          },
          {
            "id": "lifetime-addon",
            "product": {
              "client_metadata": null,
              "client_read_only_metadata": null,
              "customer_type": "user",
              "display_name": "Lifetime Add-on",
              "included_items": {},
              "prices": { "lifetime": { "USD": "5000" } },
              "server_metadata": null,
              "server_only": false,
              "stackable": false,
            },
            "quantity": 1,
            "subscription": null,
            "type": "one_time",
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
              "client_metadata": null,
              "client_read_only_metadata": null,
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
              "server_metadata": null,
              "server_only": false,
              "stackable": false,
            },
            "quantity": 1,
            "subscription": {
              "cancel_at_period_end": false,
              "current_period_end": <stripped field 'current_period_end'>,
              "is_cancelable": true,
            },
            "type": "subscription",
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
              "client_metadata": null,
              "client_read_only_metadata": null,
              "customer_type": "user",
              "display_name": "Lifetime Add-on",
              "included_items": {},
              "prices": { "lifetime": { "USD": "5000" } },
              "server_metadata": null,
              "server_only": false,
              "stackable": false,
            },
            "quantity": 1,
            "subscription": null,
            "type": "one_time",
          },
          {
            "id": "pro-addon",
            "product": {
              "client_metadata": null,
              "client_read_only_metadata": null,
              "customer_type": "user",
              "display_name": "Pro Add-on",
              "included_items": {},
              "prices": { "standard": { "USD": "7000" } },
              "server_metadata": null,
              "server_only": false,
              "stackable": false,
            },
            "quantity": 1,
            "subscription": null,
            "type": "one_time",
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

it("should immediately cancel existing subscriptions when granting a product of same catalog", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await configureProduct({
    testMode: true,
    items: {
      i1: {
        displayName: "Item 1",
      },
    },
    productLines: {
      grp: {
        displayName: "Product Line",
      },
    },
    products: {
      base: {
        displayName: "Base Plan",
        customerType: "user",
        serverOnly: false,
        stackable: false,
        productLineId: "grp",
        prices: {
          monthly: {
            USD: "1000",
            interval: [1, "month"],
          },
        },
        includedItems: {
          i1: {
            quantity: 2,
            repeat: "never",
            expires: "when-purchase-expires",
          },
        },
      },
      premium: {
        displayName: "Premium Plan",
        customerType: "user",
        serverOnly: false,
        stackable: false,
        productLineId: "grp",
        prices: {
          monthly: {
            USD: "2000",
            interval: [1, "month"],
          },
        },
        includedItems: {
          i1: {
            quantity: 3,
            repeat: "never",
            expires: "when-purchase-expires",
          },
        },
      },
    },
  });

  const { userId } = await User.create();
  const grantBaseResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: { product_id: "base" },
  });
  expect(grantBaseResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const grantPremiumResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: { product_id: "premium" },
  });
  expect(grantPremiumResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const itemQuantities = await niceBackendFetch(`/api/v1/payments/items/user/${userId}/i1`, {
    accessType: "client",
  });
  expect(itemQuantities).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "display_name": "Item 1",
        "id": "i1",
        "quantity": 3,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
