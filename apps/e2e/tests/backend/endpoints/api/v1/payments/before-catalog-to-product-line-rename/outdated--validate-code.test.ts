/**
 * These tests verify that the old `catalogs` and `catalogId` config properties
 * still work correctly for code validation after the rename to `productLines` and `productLineId`.
 */
import { it } from "../../../../../../helpers";
import { Auth, Payments, Project, User, niceBackendFetch } from "../../../../../backend-helpers";

it("should validate purchase code with old catalogs config", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      // Using the OLD property name "catalogs" instead of "productLines"
      catalogs: { grp: { displayName: "Test Group" } },
      products: {
        testProduct: {
          displayName: "Test Product",
          customerType: "user",
          serverOnly: false,
          // Using the OLD property name "catalogId" instead of "productLineId"
          catalogId: "grp",
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

  const { userId } = await Auth.fastSignUp();
  const createUrlResponse = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "testProduct",
    },
  });
  expect(createUrlResponse.status).toBe(200);
  const code = (createUrlResponse.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1]!;

  const validateResponse = await niceBackendFetch("/api/v1/payments/purchases/validate-code", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: code,
    },
  });
  expect(validateResponse.status).toBe(200);
  expect(validateResponse.body).toMatchObject({
    product: {
      display_name: "Test Product",
      customer_type: "user",
    },
  });
});

it("should detect conflicting products with old catalogs config", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      // Using the OLD property name "catalogs"
      catalogs: { grp: { displayName: "Test Group" } },
      products: {
        productA: {
          displayName: "Product A",
          customerType: "user",
          serverOnly: false,
          // Using the OLD property name "catalogId"
          catalogId: "grp",
          stackable: false,
          prices: {
            monthly: {
              USD: "1000",
              interval: [1, "month"],
            },
          },
          includedItems: {},
        },
        productB: {
          displayName: "Product B",
          customerType: "user",
          serverOnly: false,
          // Using the OLD property name "catalogId"
          catalogId: "grp",
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

  const { userId } = await Auth.fastSignUp();

  // First, purchase productA in test mode
  const createUrlA = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "productA",
    },
  });
  expect(createUrlA.status).toBe(200);
  const codeA = (createUrlA.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1]!;

  const purchaseA = await niceBackendFetch("/api/v1/internal/payments/test-mode-purchase-session", {
    method: "POST",
    accessType: "admin",
    body: {
      full_code: codeA,
      price_id: "monthly",
      quantity: 1,
    },
  });
  expect(purchaseA.status).toBe(200);

  // Now create a purchase URL for productB
  const createUrlB = await niceBackendFetch("/api/v1/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      product_id: "productB",
    },
  });
  expect(createUrlB.status).toBe(200);
  const codeB = (createUrlB.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1]!;

  // Validate code for productB - should show productA as conflicting
  const validateResponse = await niceBackendFetch("/api/v1/payments/purchases/validate-code", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: codeB,
    },
  });
  expect(validateResponse.status).toBe(200);
  expect(validateResponse.body).toMatchObject({
    product: {
      display_name: "Product B",
    },
    conflicting_products: [
      {
        product_id: "productA",
        display_name: "Product A",
      },
    ],
  });
});
