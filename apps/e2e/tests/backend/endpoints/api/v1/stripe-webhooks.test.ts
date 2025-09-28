import { createHmac } from "node:crypto";
import { it } from "../../../../helpers";
import { niceBackendFetch, Payments, Project, User } from "../../../backend-helpers";

const stripeWebhookSecret = "mock_stripe_webhook_secret";

async function sendStripeWebhook(payload: unknown, options?: {
  invalidSignature?: boolean,
  omitSignature?: boolean,
  secret?: string,
}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!options?.omitSignature) {
    let header: string;
    if (options?.invalidSignature) {
      header = `t=${timestamp},v1=dead`;
    } else {
      const hmac = createHmac("sha256", options?.secret ?? stripeWebhookSecret);
      hmac.update(`${timestamp}.${JSON.stringify(payload)}`);
      const signature = hmac.digest("hex");
      header = `t=${timestamp},v1=${signature}`;
    }
    headers["stripe-signature"] = header;
  }
  return await niceBackendFetch("/api/latest/integrations/stripe/webhooks", {
    method: "POST",
    headers,
    body: payload,
  });
}

it("accepts signed mock_event.succeeded webhook", async ({ expect }) => {
  const payload = {
    id: "evt_test_1",
    type: "mock_event.succeeded",
    account: "acct_test123",
    data: { object: { customer: "cus_test123", metadata: {} } },
  };
  const res = await sendStripeWebhook(payload);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });
});

it("returns 400 on invalid signature", async ({ expect }) => {
  const payload = {
    id: "evt_test_bad_sig",
    type: "invoice.paid",
    account: "acct_test123",
    data: { object: { customer: "cus_test456" } },
  };
  const res = await sendStripeWebhook(payload, { invalidSignature: true });
  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Invalid stripe-signature header",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("returns 400 when signature header is missing (schema validation)", async ({ expect }) => {
  const payload = {
    id: "evt_test_no_sig",
    type: "payment_intent.succeeded",
    account: "acct_test123",
    data: { object: { customer: "cus_test123", metadata: {} } },
  };
  const res = await sendStripeWebhook(payload, { omitSignature: true });
  expect(res.status).toBe(400);
});


it("deduplicates one-time purchase on payment_intent.succeeded retry", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();

  // Configure an offer that grants 1 unit of an item via one-time purchase
  const itemId = "one-time-credits";
  const offerId = "ot";
  const offer = {
    displayName: "One-time Credits Pack",
    customerType: "user",
    serverOnly: false,
    stackable: true,
    prices: { one: { USD: "500" } },
    includedItems: { [itemId]: { quantity: 1 } },
  };

  await Project.updateConfig({
    payments: {
      items: {
        [itemId]: { displayName: "Credits", customerType: "user" },
      },
      offers: {
        [offerId]: offer,
      },
    },
  });

  const { userId } = await User.create();

  // Before webhook: quantity should be 0
  const getBefore = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/${itemId}`, {
    accessType: "client",
  });
  expect(getBefore.status).toBe(200);
  expect(getBefore.body.quantity).toBe(0);

  // Get Stripe account id for current project (created by Payments.setup)
  const accountInfo = await niceBackendFetch("/api/latest/internal/payments/stripe/account-info", {
    accessType: "admin",
  });
  expect(accountInfo.status).toBe(200);
  const accountId: string = accountInfo.body.account_id;

  // Prepare a payment_intent.succeeded webhook payload with ONE_TIME metadata
  const paymentIntentId = "pi_test_same";
  // Derive current tenancy id from purchase URL full_code (tenancyId_code)
  const createUrlResponse = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      offer_id: offerId,
    },
  });
  expect(createUrlResponse.status).toBe(200);
  const purchaseUrl = (createUrlResponse.body as { url: string }).url;
  const fullCode = purchaseUrl.split("/purchase/")[1];
  const stackTestTenancyId = fullCode.split("_")[0];
  const payloadObj = {
    id: "evt_retry_test",
    type: "payment_intent.succeeded",
    account: accountId,
    data: {
      object: {
        id: paymentIntentId,
        customer: userId,
        stack_stripe_mock_data: {
          "accounts.retrieve": { metadata: { tenancyId: stackTestTenancyId } },
          "customers.retrieve": { metadata: { customerId: userId, customerType: "USER" } },
          "subscriptions.list": { data: [] },
        },
        metadata: {
          offerId,
          offer: JSON.stringify(offer),
          customerId: userId,
          customerType: "user",
          purchaseQuantity: "1",
          purchaseKind: "ONE_TIME",
          priceId: "one",
        },
      },
    },
  };
  const res = await sendStripeWebhook(payloadObj);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });

  const res2 = await sendStripeWebhook(payloadObj);
  expect(res2.status).toBe(200);
  expect(res2.body).toEqual({ received: true });

  // After duplicate deliveries, quantity should reflect a single OneTimePurchase grant
  const getAfter = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/${itemId}`, {
    accessType: "client",
  });
  expect(getAfter.status).toBe(200);
  expect(getAfter.body.quantity).toBe(1);
});


it("syncs subscriptions from webhook and is idempotent", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();

  const itemId = "subscription-credits";
  const offerId = "sub-monthly";
  const offer = {
    displayName: "Monthly Subscription",
    customerType: "user",
    serverOnly: false,
    stackable: false,
    prices: { monthly: { USD: "1000", interval: [1, "month"] } },
    includedItems: { [itemId]: { quantity: 1 } },
  };

  await Project.updateConfig({
    payments: {
      items: {
        [itemId]: { displayName: "Credits", customerType: "user" },
      },
      offers: {
        [offerId]: offer,
      },
    },
  });

  const { userId } = await User.create();

  const getBefore = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/${itemId}`, {
    accessType: "client",
  });
  expect(getBefore.status).toBe(200);
  expect(getBefore.body.quantity).toBe(0);

  const accountInfo = await niceBackendFetch("/api/latest/internal/payments/stripe/account-info", {
    accessType: "admin",
  });
  expect(accountInfo.status).toBe(200);
  const accountId: string = accountInfo.body.account_id;

  const createUrlResponse = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      offer_id: offerId,
    },
  });
  expect(createUrlResponse.status).toBe(200);
  const purchaseUrl = (createUrlResponse.body as { url: string }).url;
  const fullCode = purchaseUrl.split("/purchase/")[1];
  const stackTestTenancyId = fullCode.split("_")[0];

  const nowSec = Math.floor(Date.now() / 1000);
  const subscription = {
    id: "sub_test_1",
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
      offerId,
      offer: JSON.stringify(offer),
      priceId: "monthly",
    },
    cancel_at_period_end: false,
  };

  const payloadObj = {
    id: "evt_sub_sync_1",
    type: "invoice.paid",
    account: accountId,
    data: {
      object: {
        customer: "cus_sub_sync_1",
        stack_stripe_mock_data: {
          "accounts.retrieve": { metadata: { tenancyId: stackTestTenancyId } },
          "customers.retrieve": { metadata: { customerId: userId, customerType: "USER" } },
          "subscriptions.list": { data: [subscription] },
        },
      },
    },
  };

  const res = await sendStripeWebhook(payloadObj);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });

  const getAfter1 = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/${itemId}`, {
    accessType: "client",
  });
  expect(getAfter1.status).toBe(200);
  expect(getAfter1.body.quantity).toBe(1);

  const res2 = await sendStripeWebhook(payloadObj);
  expect(res2.status).toBe(200);
  expect(res2.body).toEqual({ received: true });

  const getAfter2 = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/${itemId}`, {
    accessType: "client",
  });
  expect(getAfter2.status).toBe(200);
  expect(getAfter2.body.quantity).toBe(1);
});


it("updates a user's subscriptions via webhook (add then remove)", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();

  const itemId = "subscription-seat";
  const offerId = "pro-monthly";
  const offer = {
    displayName: "Pro Monthly",
    customerType: "user",
    serverOnly: false,
    stackable: false,
    prices: { monthly: { USD: "1500", interval: [1, "month"] } },
    includedItems: { [itemId]: { quantity: 1, expires: "when-purchase-expires" } },
  };

  await Project.updateConfig({
    payments: {
      items: {
        [itemId]: { displayName: "Seat", customerType: "user" },
      },
      offers: {
        [offerId]: offer,
      },
    },
  });

  const { userId } = await User.create();

  const before = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/${itemId}`, {
    accessType: "client",
  });
  expect(before.status).toBe(200);
  expect(before.body.quantity).toBe(0);

  const accountInfo = await niceBackendFetch("/api/latest/internal/payments/stripe/account-info", {
    accessType: "admin",
  });
  expect(accountInfo.status).toBe(200);
  const accountId: string = accountInfo.body.account_id;

  const createUrlResponse = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "client",
    body: {
      customer_type: "user",
      customer_id: userId,
      offer_id: offerId,
    },
  });
  expect(createUrlResponse.status).toBe(200);
  const purchaseUrl = (createUrlResponse.body as { url: string }).url;
  const fullCode = purchaseUrl.split("/purchase/")[1];
  const stackTestTenancyId = fullCode.split("_")[0];

  const nowSec = Math.floor(Date.now() / 1000);
  const activeSubscription = {
    id: "sub_update_1",
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
      offerId,
      offer: JSON.stringify(offer),
      priceId: "monthly",
    },
    cancel_at_period_end: false,
  };

  const payloadAdd = {
    id: "evt_sub_add",
    type: "invoice.paid",
    account: accountId,
    data: {
      object: {
        customer: "cus_update_1",
        stack_stripe_mock_data: {
          "accounts.retrieve": { metadata: { tenancyId: stackTestTenancyId } },
          "customers.retrieve": { metadata: { customerId: userId, customerType: "USER" } },
          "subscriptions.list": { data: [activeSubscription] },
        },
      },
    },
  };

  const resAdd = await sendStripeWebhook(payloadAdd);
  expect(resAdd.status).toBe(200);
  expect(resAdd.body).toEqual({ received: true });

  const afterAdd = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/${itemId}`, {
    accessType: "client",
  });
  expect(afterAdd.status).toBe(200);
  expect(afterAdd.body.quantity).toBe(1);

  const canceledSubscription = {
    ...activeSubscription,
    status: "canceled",
    items: {
      data: [
        {
          quantity: 1,
          current_period_start: nowSec - 2 * 60,
          current_period_end: nowSec - 60,
        },
      ],
    },
  };

  const payloadRemove = {
    id: "evt_sub_remove",
    type: "customer.subscription.updated",
    account: accountId,
    data: {
      object: {
        customer: "cus_update_1",
        stack_stripe_mock_data: {
          "accounts.retrieve": { metadata: { tenancyId: stackTestTenancyId } },
          "customers.retrieve": { metadata: { customerId: userId, customerType: "USER" } },
          "subscriptions.list": { data: [canceledSubscription] },
        },
      },
    },
  };

  const resRemove = await sendStripeWebhook(payloadRemove);
  expect(resRemove.status).toBe(200);
  expect(resRemove.body).toEqual({ received: true });

  const afterRemove = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/${itemId}`, {
    accessType: "client",
  });
  expect(afterRemove.status).toBe(200);
  expect(afterRemove.body.quantity).toBe(0);
});

