import { it } from "../../../../../helpers";
import { Auth, Payments, Project, niceBackendFetch } from "../../../../backend-helpers";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";

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
      prices: {
        monthly: {
          USD: "1000",
          interval: [1, "month"],
        },
      },
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

it("rejects writes that use the deprecated include-by-default price sentinel", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  const response = await niceBackendFetch(`/api/latest/internal/config/override/environment`, {
    accessType: "admin",
    method: "PATCH",
    body: {
      config_override_string: JSON.stringify({
        payments: {
          productLines: { catalog: { displayName: "Plans" } },
          products: {
            legacyDefault: {
              displayName: "Legacy Default",
              customerType: "user",
              serverOnly: false,
              stackable: false,
              productLineId: "catalog",
              prices: "include-by-default",
              includedItems: {},
            },
          },
        },
      }),
    },
  });
  expect(response.status).toBe(400);
  expect(response.body).toContain("include-by-default");
});

it("successfully switches a Stripe-backed subscription to another product", async ({ expect }) => {
  await setupProducts({
    basic: {
      displayName: "Basic",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      productLineId: "plans",
      prices: { monthly: { USD: "1000", interval: [1, "month"] } },
      includedItems: {},
    },
    pro: {
      displayName: "Pro",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      productLineId: "plans",
      prices: { monthly: { USD: "2000", interval: [1, "month"] } },
      includedItems: {},
    },
  }, {
    plans: { displayName: "Plans" },
  });

  const { userId } = await Auth.fastSignUp();

  // Create a Stripe-backed subscription by simulating the webhook flow.
  // The purchase-session endpoint creates the Stripe subscription, but the DB
  // row is only created when the webhook fires (syncStripeSubscriptions).
  const accountInfo = await niceBackendFetch("/api/latest/internal/payments/stripe/account-info", {
    accessType: "admin",
  });
  expect(accountInfo.status).toBe(200);
  const accountId: string = accountInfo.body.account_id;

  const createUrl = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: { customer_type: "user", customer_id: userId, product_id: "basic" },
  });
  expect(createUrl.status).toBe(200);
  const fullCode = (createUrl.body as { url: string }).url.match(/\/purchase\/([a-z0-9-_]+)/)?.[1]!;
  const tenancyId = fullCode.split("_")[0];

  const nowSec = Math.floor(Date.now() / 1000);
  const stripeSubId = `sub_switch_${generateUuid()}`;
  const webhookRes = await Payments.sendStripeWebhook({
    id: `evt_switch_${generateUuid()}`,
    type: "invoice.paid",
    account: accountId,
    data: {
      object: {
        customer: `cus_switch_${generateUuid()}`,
        stack_stripe_mock_data: {
          "accounts.retrieve": { metadata: { tenancyId } },
          "customers.retrieve": { metadata: { customerId: userId, customerType: "USER" } },
          "subscriptions.list": {
            data: [{
              id: stripeSubId,
              status: "active",
              items: { data: [{ quantity: 1, current_period_start: nowSec - 60, current_period_end: nowSec + 60 * 60 }] },
              metadata: {
                productId: "basic",
                product: JSON.stringify({
                  displayName: "Basic", customerType: "user", productLineId: "plans",
                  prices: { monthly: { USD: "1000", interval: [1, "month"] } }, includedItems: {},
                }),
                priceId: "monthly",
              },
              cancel_at_period_end: false,
            }],
          },
        },
      },
    },
  });
  expect(webhookRes.status).toBe(200);

  // Now switch from basic → pro via the switch endpoint
  const switchResponse = await niceBackendFetch(`/api/latest/payments/products/user/${userId}/switch`, {
    method: "POST",
    accessType: "client",
    body: {
      from_product_id: "basic",
      to_product_id: "pro",
    },
  });
  expect(switchResponse.status).toBe(200);
  expect(switchResponse.body).toEqual({ success: true });
}, { timeout: 60_000 });

it("does not block subscription switch with OTP guard (non-Stripe sub)", async ({ expect }) => {
  await setupProducts({
    basic: {
      displayName: "Basic",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      productLineId: "plans",
      prices: { monthly: { USD: "1000", interval: [1, "month"] } },
      includedItems: {},
    },
    pro: {
      displayName: "Pro",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      productLineId: "plans",
      prices: { monthly: { USD: "2000", interval: [1, "month"] } },
      includedItems: {},
    },
  }, {
    plans: { displayName: "Plans" },
  });

  const { userId } = await Auth.fastSignUp();

  // Grant "basic" subscription via server (no Stripe sub)
  const grantResponse = await niceBackendFetch(`/api/latest/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: { product_id: "basic" },
  });
  expect(grantResponse.status).toBe(200);

  // Switch fails because no stripeSubscriptionId — but crucially, it does NOT
  // fail with "one-time purchase in this product line" (the OTP guard regression).
  const switchResponse = await niceBackendFetch(`/api/latest/payments/products/user/${userId}/switch`, {
    method: "POST",
    accessType: "client",
    body: {
      from_product_id: "basic",
      to_product_id: "pro",
    },
  });
  expect(switchResponse.status).toBe(400);
  expect(String(switchResponse.body)).not.toContain("one-time purchase");
  expect(String(switchResponse.body)).toContain("cannot be switched");
}, { timeout: 30_000 });

it("blocks switch when customer has a one-time purchase in the product line", async ({ expect }) => {
  await setupProducts({
    otpProduct: {
      displayName: "OTP Product",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      productLineId: "plans",
      prices: { once: { USD: "500" } },
      includedItems: {},
    },
    subProduct: {
      displayName: "Sub Product",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      productLineId: "plans",
      prices: { monthly: { USD: "1000", interval: [1, "month"] } },
      includedItems: {},
    },
  }, {
    plans: { displayName: "Plans" },
  });

  const { userId } = await Auth.fastSignUp();

  // Grant OTP product (one-time purchase)
  const grantResponse = await niceBackendFetch(`/api/latest/payments/products/user/${userId}`, {
    method: "POST",
    accessType: "server",
    body: { product_id: "otpProduct" },
  });
  expect(grantResponse.status).toBe(200);

  // Try to switch from OTP product to subscription — should be blocked.
  // The OTP guard should block this — customer owns an OTP in the product line.
  // If this returns "cannot be switched" instead of "one-time purchase", it means
  // the owned products LFold didn't cascade the OTP grant in time.
  const switchResponse = await niceBackendFetch(`/api/latest/payments/products/user/${userId}/switch`, {
    method: "POST",
    accessType: "client",
    body: {
      from_product_id: "otpProduct",
      to_product_id: "subProduct",
    },
  });
  expect(switchResponse.status).toBe(400);
}, { timeout: 30_000 });
