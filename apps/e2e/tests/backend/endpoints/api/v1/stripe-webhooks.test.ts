import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { it } from "../../../../helpers";
import { Auth, bumpEmailAddress, niceBackendFetch, Payments, Project } from "../../../backend-helpers";
import { getOutboxEmails } from "./emails/email-helpers";

async function waitForOutboxEmail(subject: string) {
  for (let i = 0; i < 30; i++) {
    const emails = await getOutboxEmails({ subject });
    if (emails.length > 0) {
      return emails[0];
    }
    await wait(500);
  }
  throw new Error(`Email with subject "${subject}" not found in outbox`);
}

async function waitForNoOutboxEmail(subject: string) {
  for (let i = 0; i < 6; i++) {
    const emails = await getOutboxEmails({ subject });
    if (emails.length > 0) {
      throw new Error(`Unexpected email with subject "${subject}" found in outbox`);
    }
    await wait(500);
  }
}


it("rejects signed mock_event.succeeded webhook", async ({ expect }) => {
  const payload = {
    id: "evt_test_1",
    type: "mock_event.succeeded",
    account: "acct_test123",
    data: { object: { customer: "cus_test123", metadata: {} } },
  };
  await expect(Payments.sendStripeWebhook(payload)).rejects.toThrow(/Unknown stripe webhook type received/);
});

it("returns 400 on invalid signature", async ({ expect }) => {
  const payload = {
    id: "evt_test_bad_sig",
    type: "invoice.paid",
    account: "acct_test123",
    data: { object: { customer: "cus_test456" } },
  };
  const res = await Payments.sendStripeWebhook(payload, { invalidSignature: true });
  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Invalid stripe-signature header",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("returns 500 on unknown webhook type", async ({ expect }) => {
  const payload = {
    id: "evt_test_unknown",
    type: "unknown.event",
    account: "acct_test123",
    data: { object: {} },
  };

  await expect(Payments.sendStripeWebhook(payload)).rejects.toThrow(/Unknown stripe webhook type received/);
});

it("returns 400 when signature header is missing (schema validation)", async ({ expect }) => {
  const payload = {
    id: "evt_test_no_sig",
    type: "payment_intent.succeeded",
    account: "acct_test123",
    data: { object: { customer: "cus_test123", metadata: {} } },
  };
  const res = await Payments.sendStripeWebhook(payload, { omitSignature: true });
  expect(res.status).toBe(400);
});

it("accepts chargeback webhooks", async ({ expect }) => {
  const { code } = await Payments.createPurchaseUrlAndGetCode();
  const stackTestTenancyId = (code ?? throwErr("Missing purchase code for chargeback test.")).split("_")[0];

  const accountInfo = await niceBackendFetch("/api/latest/internal/payments/stripe/account-info", {
    accessType: "admin",
  });
  expect(accountInfo.status).toBe(200);
  const accountId: string = accountInfo.body.account_id;

  const payload = {
    id: "evt_chargeback_test",
    type: "charge.dispute.created",
    account: accountId,
    data: {
      object: {
        id: "dp_test_123",
        amount: 1500,
        currency: "usd",
        reason: "fraudulent",
        status: "needs_response",
        charge: "ch_test_123",
        created: 1730000000,
        livemode: false,
        stack_stripe_mock_data: {
          "accounts.retrieve": { metadata: { tenancyId: stackTestTenancyId } },
        },
      },
    },
  };

  const res = await Payments.sendStripeWebhook(payload);
  expect(res.status).toBe(200);
  expect(res.body).toMatchInlineSnapshot(`{ "received": true }`);
});


it("deduplicates one-time purchase on payment_intent.succeeded retry", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();

  // Configure an product that grants 1 unit of an item via one-time purchase
  const itemId = "one-time-credits";
  const productId = "ot";
  const product = {
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
      products: {
        [productId]: product,
      },
    },
  });

  const { userId } = await Auth.fastSignUp();

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
      product_id: productId,
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
          productId,
          product: JSON.stringify(product),
          customerId: userId,
          customerType: "user",
          purchaseQuantity: "1",
          purchaseKind: "ONE_TIME",
          priceId: "one",
        },
      },
    },
  };
  const res = await Payments.sendStripeWebhook(payloadObj);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });

  const res2 = await Payments.sendStripeWebhook(payloadObj);
  expect(res2.status).toBe(200);
  expect(res2.body).toEqual({ received: true });

  // After duplicate deliveries, quantity should reflect a single OneTimePurchase grant
  const getAfter = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/${itemId}`, {
    accessType: "client",
  });
  expect(getAfter.status).toBe(200);
  expect(getAfter.body.quantity).toBe(1);
});

it("sends a payment receipt email for one-time purchases", async ({ expect }) => {
  const projectDisplayName = "Payments Receipt Email Test";
  await Project.createAndSwitch({ display_name: projectDisplayName });
  await Payments.setup();

  const itemId = "receipt-credits";
  const productId = "receipt-ot";
  const product = {
    displayName: "Receipt Credits Pack",
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
      products: {
        [productId]: product,
      },
    },
  });

  const mailbox = await bumpEmailAddress();
  const { userId } = await Auth.fastSignUp({
    primary_email: mailbox.emailAddress,
    primary_email_verified: true,
  });

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
      product_id: productId,
    },
  });
  expect(createUrlResponse.status).toBe(200);
  const purchaseUrl = (createUrlResponse.body as { url: string }).url;
  const fullCode = purchaseUrl.split("/purchase/")[1];
  const stackTestTenancyId = fullCode.split("_")[0];

  const receiptLink = "https://example.com/receipt/pi_test_receipt_1";
  const paymentIntentId = "pi_test_receipt_1";
  const payloadObj = {
    id: "evt_receipt_test_1",
    type: "payment_intent.succeeded",
    account: accountId,
    data: {
      object: {
        id: paymentIntentId,
        customer: userId,
        amount_received: 500,
        currency: "usd",
        charges: {
          data: [{ receipt_url: receiptLink }],
        },
        stack_stripe_mock_data: {
          "accounts.retrieve": { metadata: { tenancyId: stackTestTenancyId } },
          "customers.retrieve": { metadata: { customerId: userId, customerType: "USER" } },
          "subscriptions.list": { data: [] },
        },
        metadata: {
          productId,
          product: JSON.stringify(product),
          customerId: userId,
          customerType: "user",
          purchaseQuantity: "2",
          purchaseKind: "ONE_TIME",
          priceId: "one",
        },
      },
    },
  };

  const res = await Payments.sendStripeWebhook(payloadObj);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });

  const email = await waitForOutboxEmail(`Your receipt from ${projectDisplayName}`);
  expect(email.variables).toMatchInlineSnapshot(`
    {
      "amount": "USD 5.00",
      "productName": "Receipt Credits Pack",
      "quantity": 2,
      "receiptLink": "https://example.com/receipt/pi_test_receipt_1",
    }
  `);
});

it("sends a payment failed email for invoice.payment_failed", async ({ expect }) => {
  const projectDisplayName = "Payments Failed Email Test";
  await Project.createAndSwitch({ display_name: projectDisplayName });
  await Payments.setup();

  const productId = "sub-failed";
  const product = {
    displayName: "Pro Plan",
    customerType: "user",
    serverOnly: false,
    stackable: false,
    prices: { monthly: { USD: "1500", interval: [1, "month"] } },
    includedItems: {},
  };

  await Project.updateConfig({
    payments: {
      products: {
        [productId]: product,
      },
    },
  });

  const mailbox = await bumpEmailAddress();
  const { userId } = await Auth.fastSignUp({
    primary_email: mailbox.emailAddress,
    primary_email_verified: true,
  });

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
      product_id: productId,
    },
  });
  expect(createUrlResponse.status).toBe(200);
  const purchaseUrl = (createUrlResponse.body as { url: string }).url;
  const fullCode = purchaseUrl.split("/purchase/")[1];
  const stackTestTenancyId = fullCode.split("_")[0];

  const invoiceId = "in_test_failed_1";
  const invoiceUrl = "https://example.com/billing/update";
  const payloadObj = {
    id: "evt_invoice_failed_1",
    type: "invoice.payment_failed",
    account: accountId,
    data: {
      object: {
        id: invoiceId,
        customer: "cus_failed_1",
        amount_due: 1500,
        currency: "usd",
        status: "uncollectible",
        hosted_invoice_url: invoiceUrl,
        lines: {
          data: [
            {
              description: "Pro Plan",
            },
          ],
        },
        stack_stripe_mock_data: {
          "accounts.retrieve": { metadata: { tenancyId: stackTestTenancyId } },
          "customers.retrieve": { metadata: { customerId: userId, customerType: "USER" } },
          "subscriptions.list": { data: [] },
        },
      },
    },
  };

  const res = await Payments.sendStripeWebhook(payloadObj);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });

  const email = await waitForOutboxEmail(`Payment failed for ${projectDisplayName}`);
  expect(email.variables).toMatchInlineSnapshot(`
    {
      "amount": "USD 15.00",
      "invoiceUrl": "https://example.com/billing/update",
      "productName": "Pro Plan",
    }
  `);
});

it("skips payment failed email when invoice is not uncollectible", async ({ expect }) => {
  const projectDisplayName = "Payments Failed Email Open Invoice Test";
  await Project.createAndSwitch({ display_name: projectDisplayName });
  await Payments.setup();

  const productId = "sub-failed-open";
  const product = {
    displayName: "Starter Plan",
    customerType: "user",
    serverOnly: false,
    stackable: false,
    prices: { monthly: { USD: "900", interval: [1, "month"] } },
    includedItems: {},
  };

  await Project.updateConfig({
    payments: {
      products: {
        [productId]: product,
      },
    },
  });

  const mailbox = await bumpEmailAddress();
  const { userId } = await Auth.fastSignUp({
    primary_email: mailbox.emailAddress,
    primary_email_verified: true,
  });

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
      product_id: productId,
    },
  });
  expect(createUrlResponse.status).toBe(200);
  const purchaseUrl = (createUrlResponse.body as { url: string }).url;
  const fullCode = purchaseUrl.split("/purchase/")[1];
  const stackTestTenancyId = fullCode.split("_")[0];

  const invoiceId = "in_test_failed_open_1";
  const invoiceUrl = "https://example.com/billing/open";
  const payloadObj = {
    id: "evt_invoice_failed_open_1",
    type: "invoice.payment_failed",
    account: accountId,
    data: {
      object: {
        id: invoiceId,
        customer: "cus_failed_open_1",
        amount_due: 900,
        currency: "usd",
        status: "open",
        hosted_invoice_url: invoiceUrl,
        lines: {
          data: [
            {
              description: "Starter Plan",
            },
          ],
        },
        stack_stripe_mock_data: {
          "accounts.retrieve": { metadata: { tenancyId: stackTestTenancyId } },
          "customers.retrieve": { metadata: { customerId: userId, customerType: "USER" } },
          "subscriptions.list": { data: [] },
        },
      },
    },
  };

  const res = await Payments.sendStripeWebhook(payloadObj);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });

  await waitForNoOutboxEmail(`Payment failed for ${projectDisplayName}`);
});


it("syncs subscriptions from webhook and is idempotent", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();

  const itemId = "subscription-credits";
  const productId = "sub-monthly";
  const product = {
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
      products: {
        [productId]: product,
      },
    },
  });

  const { userId } = await Auth.fastSignUp();

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
      product_id: productId,
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
      productId,
      product: JSON.stringify(product),
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

  const res = await Payments.sendStripeWebhook(payloadObj);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });

  const getAfter1 = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/${itemId}`, {
    accessType: "client",
  });
  expect(getAfter1.status).toBe(200);
  expect(getAfter1.body.quantity).toBe(1);

  const res2 = await Payments.sendStripeWebhook(payloadObj);
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
  const productId = "pro-monthly";
  const product = {
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
      products: {
        [productId]: product,
      },
    },
  });

  const { userId } = await Auth.fastSignUp();

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
      product_id: productId,
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
      productId,
      product: JSON.stringify(product),
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

  const resAdd = await Payments.sendStripeWebhook(payloadAdd);
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

  const resRemove = await Payments.sendStripeWebhook(payloadRemove);
  expect(resRemove.status).toBe(200);
  expect(resRemove.body).toEqual({ received: true });

  const afterRemove = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/${itemId}`, {
    accessType: "client",
  });
  expect(afterRemove.status).toBe(200);
  expect(afterRemove.body.quantity).toBe(0);
});
