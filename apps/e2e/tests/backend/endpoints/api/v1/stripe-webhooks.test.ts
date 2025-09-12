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

it("accepts signed payment_intent.succeeded webhook", async ({ expect }) => {
  const payload = {
    id: "evt_test_1",
    type: "payment_intent.succeeded",
    account: "acct_test123",
    data: { object: { customer: "cus_test123", metadata: {} } },
  };
  const res = await sendStripeWebhook(payload);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });
});

it("accepts signed invoice.paid webhook", async ({ expect }) => {
  const payload = {
    id: "evt_test_2",
    type: "invoice.paid",
    account: "acct_test123",
    data: { object: { customer: "cus_test456" } },
  };
  const res = await sendStripeWebhook(payload);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });
});

it("returns 200 on invalid signature (graceful error handling)", async ({ expect }) => {
  const payload = {
    id: "evt_test_bad_sig",
    type: "invoice.paid",
    account: "acct_test123",
    data: { object: { customer: "cus_test456" } },
  };
  const res = await sendStripeWebhook(payload, { invalidSignature: true });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });
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

it("returns 200 for account.updated even if account id missing (graceful)", async ({ expect }) => {
  const payload = {
    id: "evt_test_acc",
    type: "account.updated",
  };
  const res = await sendStripeWebhook(payload);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });
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
  const payloadObj = {
    id: "evt_retry_test",
    type: "payment_intent.succeeded",
    account: accountId,
    data: {
      object: {
        id: paymentIntentId,
        metadata: {
          offerId,
          offer: JSON.stringify(offer),
          customerId: userId,
          customerType: "user",
          purchaseQuantity: "1",
          purchaseKind: "ONE_TIME",
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

