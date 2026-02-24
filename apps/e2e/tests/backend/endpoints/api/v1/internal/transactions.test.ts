import { createHmac } from "node:crypto";
import { expect } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, Payments as PaymentsHelper, Project, Team, User, niceBackendFetch } from "../../../../backend-helpers";

type PaymentsConfigOptions = {
  extraProducts?: Record<string, any>,
  extraItems?: Record<string, any>,
};

async function setupProjectWithPaymentsConfig(options: PaymentsConfigOptions = {}) {
  await Project.createAndSwitch();
  await PaymentsHelper.setup();
  const baseProducts = {
    "sub-product": {
      displayName: "Sub Product",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      prices: {
        monthly: { USD: "1000", interval: [1, "month"] },
      },
      includedItems: {},
    },
    "otp-product": {
      displayName: "One-Time Product",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      prices: {
        single: { USD: "5000" },
      },
      includedItems: {},
    },
  };
  const baseItems = {
    credits: { displayName: "Credits", customerType: "user" },
  };
  await Project.updateConfig({
    payments: {
      testMode: true,
      products: {
        ...baseProducts,
        ...(options.extraProducts ?? {}),
      },
      items: {
        ...baseItems,
        ...(options.extraItems ?? {}),
      },
    },
  });
  return {
    products: baseProducts,
    items: baseItems,
  };
}

async function createPurchaseCodeForCustomer(options: { customerType: "user" | "team" | "custom", customerId: string, productId: string }) {
  const res = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: options.customerType,
      customer_id: options.customerId,
      product_id: options.productId,
    },
  });
  expect(res.status).toBe(200);
  const codeMatch = (res.body.url as string).match(/\/purchase\/([a-z0-9-_]+)/);
  const code = codeMatch ? codeMatch[1] : undefined;
  expect(code).toBeDefined();
  return code as string;
}

const stripeWebhookSecret = process.env.STACK_STRIPE_WEBHOOK_SECRET ?? "mock_stripe_webhook_secret";

async function sendStripeWebhook(payload: unknown) {
  const timestamp = Math.floor(Date.now() / 1000);
  const hmac = createHmac("sha256", stripeWebhookSecret);
  hmac.update(`${timestamp}.${JSON.stringify(payload)}`);
  const signature = hmac.digest("hex");
  return await niceBackendFetch("/api/latest/integrations/stripe/webhooks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature}`,
    },
    body: payload,
  });
}
async function createPurchaseCode(options: { userId: string, productId: string }) {
  return await createPurchaseCodeForCustomer({
    customerType: "user",
    customerId: options.userId,
    productId: options.productId,
  });
}

it("returns empty list for fresh project", async () => {
  await Project.createAndSwitch();
  await PaymentsHelper.setup();

  const response = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "next_cursor": null,
          "transactions": [],
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
});

it("includes TEST_MODE subscription", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await Auth.fastSignUp();
  const code = await createPurchaseCode({ userId, productId: "sub-product" });

  const testModeRes = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "monthly", quantity: 1 },
  });
  expect(testModeRes.status).toBe(200);

  const response = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(response.status).toBe(200);
  const txs = response.body.transactions.filter((tx: any) => tx.type !== "default-products-change");
  expect(txs).toHaveLength(1);
  expect(txs[0].type).toBe("subscription-start");
  expect(txs[0].test_mode).toBe(true);
  const grant = txs[0].entries.find((e: any) => e.type === "product-grant");
  expect(grant).toBeDefined();
  expect(grant.product_id).toBe("sub-product");
  expect(grant.subscription_id).toBeDefined();
});

it("includes TEST_MODE one-time purchase", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await Auth.fastSignUp();
  const code = await createPurchaseCode({ userId, productId: "otp-product" });

  const testModeRes = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "single", quantity: 1 },
  });
  expect(testModeRes.status).toBe(200);

  const response = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(response.status).toBe(200);
  const txs = response.body.transactions.filter((tx: any) => tx.type !== "default-products-change");
  expect(txs).toHaveLength(1);
  expect(txs[0].type).toBe("one-time-purchase");
  expect(txs[0].test_mode).toBe(true);
  const grant = txs[0].entries.find((e: any) => e.type === "product-grant");
  expect(grant).toBeDefined();
  expect(grant.product_id).toBe("otp-product");
  expect(grant.one_time_purchase_id).toBeDefined();
});

it("includes item quantity change entries", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await Auth.fastSignUp();

  const changeRes = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    query: { allow_negative: "false" },
    body: { delta: 5, description: "test" },
  });
  expect(changeRes.status).toBe(200);

  const response = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(response.status).toBe(200);
  const txs = response.body.transactions.filter((tx: any) => tx.type !== "default-products-change");
  expect(txs).toHaveLength(1);
  expect(txs[0].type).toBe("manual-item-quantity-change");
  expect(txs[0].test_mode).toBe(false);
  const entry = txs[0].entries[0];
  expect(entry.type).toBe("item-quantity-change");
  expect(entry.item_id).toBe("credits");
  expect(entry.quantity).toBe(5);
});

it("supports concatenated cursor pagination", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await Auth.fastSignUp();

  // Make a few entries across tables
  {
    const code = await createPurchaseCode({ userId, productId: "sub-product" });
    await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
      accessType: "admin",
      method: "POST",
      body: { full_code: code, price_id: "monthly", quantity: 1 },
    });
  }
  {
    const code = await createPurchaseCode({ userId, productId: "otp-product" });
    await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
      accessType: "admin",
      method: "POST",
      body: { full_code: code, price_id: "single", quantity: 1 },
    });
  }
  await niceBackendFetch(`/api/latest/payments/items/user/${userId}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    query: { allow_negative: "false" },
    body: { delta: 2 },
  });

  const page1 = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
    query: { limit: "2" },
  });
  expect(page1.status).toBe(200);
  expect(page1.body).toMatchObject({ next_cursor: expect.any(String) });

  const page2 = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
    query: { limit: "2", cursor: page1.body.next_cursor },
  });
  expect(page2.status).toBe(200);
  expect(page2.body).toMatchObject({ transactions: expect.any(Array) });
});

it("omits subscription-renewal entries for subscription creation invoices", async () => {
  const config = await setupProjectWithPaymentsConfig();
  const subProduct = config.products["sub-product"];
  const { userId } = await Auth.fastSignUp();

  const accountInfo = await niceBackendFetch("/api/latest/internal/payments/stripe/account-info", {
    accessType: "admin",
  });
  expect(accountInfo.status).toBe(200);
  const accountId: string = accountInfo.body.account_id;

  const code = await createPurchaseCode({ userId, productId: "sub-product" });
  const tenancyId = code.split("_")[0];

  const nowSec = Math.floor(Date.now() / 1000);
  const stripeSubscription = {
    id: "sub_tx_filter",
    status: "active",
    items: {
      data: [
        {
          quantity: 1,
          current_period_start: nowSec - 60,
          current_period_end: nowSec + 60 * 60,
        },
      ],
    },
    metadata: {
      productId: "sub-product",
      product: JSON.stringify(subProduct),
      priceId: "monthly",
    },
    cancel_at_period_end: false,
  };

  const stackStripeMockData = {
    "accounts.retrieve": { metadata: { tenancyId } },
    "customers.retrieve": { metadata: { customerId: userId, customerType: "USER" } },
    "subscriptions.list": { data: [stripeSubscription] },
  };

  const baseInvoiceObject = {
    customer: "cus_tx_filter",
    stack_stripe_mock_data: stackStripeMockData,
    lines: {
      data: [
        {
          parent: {
            subscription_item_details: {
              subscription: stripeSubscription.id,
            },
          },
        },
      ],
    },
  };

  const creationInvoiceEvent = {
    id: "evt_sub_invoice_creation",
    type: "invoice.payment_succeeded",
    account: accountId,
    data: {
      object: {
        ...baseInvoiceObject,
        id: "in_creation_tx",
        billing_reason: "subscription_create",
      },
    },
  };

  const renewalInvoiceEvent = {
    id: "evt_sub_invoice_cycle",
    type: "invoice.payment_succeeded",
    account: accountId,
    data: {
      object: {
        ...baseInvoiceObject,
        id: "in_cycle_tx",
        billing_reason: "subscription_cycle",
      },
    },
  };

  const creationRes = await sendStripeWebhook(creationInvoiceEvent);
  expect(creationRes.status).toBe(200);
  expect(creationRes.body).toEqual({ received: true });

  const renewalRes = await sendStripeWebhook(renewalInvoiceEvent);
  expect(renewalRes.status).toBe(200);
  expect(renewalRes.body).toEqual({ received: true });

  const response = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(response.status).toBe(200);

  const renewalTransactions = response.body.transactions.filter((tx: any) => tx.type === "subscription-renewal");
  expect(renewalTransactions.length).toBe(1);
  expect(renewalTransactions[0]?.entries?.[0]?.type).toBe("money-transfer");

  const purchaseTransaction = response.body.transactions.find((tx: any) => tx.type === "subscription-start");
  expect(purchaseTransaction).toBeDefined();
});

it("filters results by transaction type", async () => {
  await setupProjectWithPaymentsConfig();
  const { userId } = await Auth.fastSignUp();

  const subCode = await createPurchaseCode({ userId, productId: "sub-product" });
  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: subCode, price_id: "monthly", quantity: 1 },
  });

  await niceBackendFetch(`/api/latest/payments/items/user/${userId}/credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    query: { allow_negative: "false" },
    body: { delta: 3 },
  });

  const manualOnly = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
    query: { type: "manual-item-quantity-change" },
  });
  expect(manualOnly.status).toBe(200);
  expect(manualOnly.body.transactions).toHaveLength(1);
  expect(manualOnly.body.transactions[0].type).toBe("manual-item-quantity-change");

  const purchaseOnly = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
    query: { type: "subscription-start" },
  });
  expect(purchaseOnly.status).toBe(200);
  expect(purchaseOnly.body.transactions).toHaveLength(1);
  expect(purchaseOnly.body.transactions[0].type).toBe("subscription-start");
});

it("filters results by customer_type across sources", async () => {
  await setupProjectWithPaymentsConfig({
    extraProducts: {
      "team-product": {
        displayName: "Team Product",
        customerType: "team",
        serverOnly: false,
        stackable: false,
        prices: {
          team_monthly: { USD: "2500", interval: [1, "month"] },
        },
        includedItems: {},
      },
    },
    extraItems: {
      "team-credits": { displayName: "Team Credits", customerType: "team" },
    },
  });
  const { userId } = await Auth.fastSignUp();
  const { teamId } = await Team.create({ accessType: "server", creatorUserId: userId });

  const userCode = await createPurchaseCode({ userId, productId: "sub-product" });
  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: userCode, price_id: "monthly", quantity: 1 },
  });

  const teamCode = await createPurchaseCodeForCustomer({
    customerType: "team",
    customerId: teamId,
    productId: "team-product",
  });
  await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: teamCode, price_id: "team_monthly", quantity: 1 },
  });

  await niceBackendFetch(`/api/latest/payments/items/team/${teamId}/team-credits/update-quantity`, {
    accessType: "server",
    method: "POST",
    query: { allow_negative: "false" },
    body: { delta: 4 },
  });

  const teamResponse = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
    query: { customer_type: "team" },
  });
  expect(teamResponse.status).toBe(200);
  const teamTxs = teamResponse.body.transactions.filter((tx: any) => tx.type !== "default-products-change");
  expect(teamTxs).toHaveLength(2);
  expect(teamTxs.every((tx: any) =>
    tx.entries.every((entry: any) => entry.customer_type === "team")
  )).toBe(true);

  const userResponse = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
    query: { customer_type: "user" },
  });
  expect(userResponse.status).toBe(200);
  const userTxs = userResponse.body.transactions.filter((tx: any) => tx.type !== "default-products-change");
  expect(userTxs).toHaveLength(1);
  expect(userTxs[0].entries.every((entry: any) => entry.customer_type === "user")).toBe(true);
});

it("returns server-granted subscriptions in transactions", async () => {
  await setupProjectWithPaymentsConfig({
    extraProducts: {
      "subscription-a": {
        displayName: "Subscription A",
        customerType: "user",
        serverOnly: false,
        stackable: true,
        prices: {
          monthly: { USD: "12.34",  interval: [1, "month"] },
        },
        includedItems: {},
      },
    },
  });
  const { userId } = await Auth.fastSignUp();

  const grantResponse = await niceBackendFetch(`/api/latest/payments/products/user/${userId}`, {
    accessType: "server",
    method: "POST",
    body: { product_id: "subscription-a", quantity: 3 },
  });
  expect(grantResponse.status).toBe(200);

  const response = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  expect(response.status).toBe(200);
  const txs = response.body.transactions.filter((tx: any) => tx.type !== "default-products-change");
  expect(txs).toHaveLength(1);
  expect(txs[0].type).toBe("subscription-start");
  expect(txs[0].test_mode).toBe(false);
  const grant = txs[0].entries.find((e: any) => e.type === "product-grant");
  expect(grant).toBeDefined();
  expect(grant.product_id).toBe("subscription-a");
  expect(grant.quantity).toBe(3);
  expect(grant.subscription_id).toBeDefined();
  const subStart = txs[0].entries.find((e: any) => e.type === "active-subscription-start");
  expect(subStart).toBeDefined();
  expect(subStart.product_id).toBe("subscription-a");

});
