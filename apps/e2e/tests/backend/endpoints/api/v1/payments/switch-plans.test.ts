import { it } from "../../../../../helpers";
import { Auth, Payments, Project, Team, niceBackendFetch } from "../../../../backend-helpers";

async function setupProducts(products: Record<string, any>, productLines?: Record<string, any>) {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      productLines,
      products,
    },
  });
}


it("rejects switches across different product lines", async ({ expect }) => {
  await setupProducts({
    planA: {
      displayName: "Plan A",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      productLineId: "catalogA",
      prices: "include-by-default",
      includedItems: {},
    },
    planB: {
      displayName: "Plan B",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      productLineId: "catalogB",
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
      "body": "Products must be in the same product line to switch.",
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
      productLineId: "catalog",
      prices: "include-by-default",
      includedItems: {},
    },
    planB: {
      displayName: "Plan B",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      productLineId: "catalog",
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
