import { it } from "../../../../../helpers";
import { Auth, Payments, Project, Team, niceBackendFetch } from "../../../../backend-helpers";

async function setupProducts(products: Record<string, any>, catalogs?: Record<string, any>) {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      catalogs,
      products,
    },
  });
}


it("requires a payment method before switching plans", async ({ expect }) => {
  await setupProducts({
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
  }, {
    catalog: { displayName: "Plans" },
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
      "status": 400,
      "body": {
        "code": "DEFAULT_PAYMENT_METHOD_REQUIRED",
        "details": {
          "customer_id": "<stripped UUID>",
          "customer_type": "user",
        },
        "error": "No default payment method is set for this customer.",
      },
      "headers": Headers {
        "x-stack-known-error": "DEFAULT_PAYMENT_METHOD_REQUIRED",
        <some fields may have been hidden>,
      },
    }
  `);

  const listResponse = await niceBackendFetch(`/api/latest/payments/products/user/${userId}`, {
    accessType: "client",
  });
  expect(listResponse.status).toBe(200);
  expect(listResponse.body.items).toEqual([
    expect.objectContaining({
      id: "planA",
      type: "subscription",
    }),
  ]);
});

it("returns a known error when no payment method is attached", async ({ expect }) => {
  await setupProducts({
    planA: {
      displayName: "Plan A",
      customerType: "team",
      serverOnly: false,
      stackable: false,
      catalogId: "catalog",
      prices: "include-by-default",
      includedItems: {},
    },
    planB: {
      displayName: "Plan B",
      customerType: "team",
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
  }, {
    catalog: { displayName: "Plans" },
  });

  const { userId } = await Auth.fastSignUp();
  const { teamId } = await Team.create({ accessType: "server", creatorUserId: userId });
  await Team.addPermission(teamId, userId, "team_admin");
  // const clearCustomer = await niceBackendFetch(`/api/latest/internal/payments/stripe/clear-customer`, {
  //   method: "POST",
  //   accessType: "admin",
  //   body: {
  //     customer_type: "team",
  //     customer_id: teamId,
  //   },
  // });
  // expect(clearCustomer.status).toBe(200);

  const switchResponse = await niceBackendFetch(`/api/latest/payments/products/team/${teamId}/switch`, {
    method: "POST",
    accessType: "client",
    body: {
      from_product_id: "planA",
      to_product_id: "planB",
    },
  });
  expect(switchResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "DEFAULT_PAYMENT_METHOD_REQUIRED",
        "details": {
          "customer_id": "<stripped UUID>",
          "customer_type": "team",
        },
        "error": "No default payment method is set for this customer.",
      },
      "headers": Headers {
        "x-stack-known-error": "DEFAULT_PAYMENT_METHOD_REQUIRED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("rejects switches across different catalogs", async ({ expect }) => {
  await setupProducts({
    planA: {
      displayName: "Plan A",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      catalogId: "catalogA",
      prices: "include-by-default",
      includedItems: {},
    },
    planB: {
      displayName: "Plan B",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      catalogId: "catalogB",
      prices: {
        monthly: {
          USD: "2000",
          interval: [1, "month"],
        },
      },
      includedItems: {},
    },
  }, {
    catalogA: { displayName: "A" },
    catalogB: { displayName: "B" },
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
      "status": 400,
      "body": "Products must be in the same catalog to switch.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("rejects switching to include-by-default plans", async ({ expect }) => {
  await setupProducts({
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
      prices: "include-by-default",
      includedItems: {},
    },
  }, {
    catalog: { displayName: "Plans" },
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
      "status": 400,
      "body": "Include-by-default products cannot be selected for plan switching.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
