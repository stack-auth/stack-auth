import { createHmac } from "node:crypto";
import { it } from "../../../../helpers";
import { niceBackendFetch } from "../../../backend-helpers";

it("accepts signed payment_intent.succeeded webhook", async ({ expect }) => {
  const payload = JSON.stringify({
    id: "evt_test_1",
    type: "payment_intent.succeeded",
    account: "acct_test123",
    data: { object: { customer: "cus_test123", metadata: {} } },
  });
  // Use a fallback secret for local test if not provided via env
  const secret = process.env.STACK_STRIPE_WEBHOOK_SECRET || "test_secret";
  const timestamp = Math.floor(Date.now() / 1000);
  const hmac = createHmac("sha256", secret);
  hmac.update(`${timestamp}.${payload}`);
  const signature = hmac.digest("hex");
  const header = `t=${timestamp},v1=${signature}`;
  const res = await niceBackendFetch("/api/latest/integrations/stripe/webhooks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": header,
    },
    body: payload,
  });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });
});

it("accepts signed invoice.paid webhook", async ({ expect }) => {
  const payload = JSON.stringify({
    id: "evt_test_2",
    type: "invoice.paid",
    account: "acct_test123",
    data: { object: { customer: "cus_test456" } },
  });
  const secret = process.env.STACK_STRIPE_WEBHOOK_SECRET || "test_secret";
  const timestamp = Math.floor(Date.now() / 1000);
  const hmac = createHmac("sha256", secret);
  hmac.update(`${timestamp}.${payload}`);
  const signature = hmac.digest("hex");
  const header = `t=${timestamp},v1=${signature}`;
  const res = await niceBackendFetch("/api/latest/integrations/stripe/webhooks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": header,
    },
    body: payload,
  });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });
});

it("returns 200 on invalid signature (graceful error handling)", async ({ expect }) => {
  const payload = JSON.stringify({
    id: "evt_test_bad_sig",
    type: "invoice.paid",
    account: "acct_test123",
    data: { object: { customer: "cus_test456" } },
  });
  const header = `t=${Math.floor(Date.now() / 1000)},v1=deadbeef`;
  const res = await niceBackendFetch("/api/latest/integrations/stripe/webhooks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": header,
    },
    body: payload,
  });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });
});

it("returns 400 when signature header is missing (schema validation)", async ({ expect }) => {
  const payload = JSON.stringify({
    id: "evt_test_no_sig",
    type: "payment_intent.succeeded",
    account: "acct_test123",
    data: { object: { customer: "cus_test123", metadata: {} } },
  });
  const res = await niceBackendFetch("/api/latest/integrations/stripe/webhooks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: payload,
  });
  expect(res.status).toBe(400);
});

it("returns 200 for account.updated even if account id missing (graceful)", async ({ expect }) => {
  const payload = JSON.stringify({
    id: "evt_test_acc",
    type: "account.updated",
  });
  const secret = process.env.STACK_STRIPE_WEBHOOK_SECRET || "test_secret";
  const timestamp = Math.floor(Date.now() / 1000);
  const hmac = createHmac("sha256", secret);
  hmac.update(`${timestamp}.${payload}`);
  const signature = hmac.digest("hex");
  const header = `t=${timestamp},v1=${signature}`;
  const res = await niceBackendFetch("/api/latest/integrations/stripe/webhooks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": header,
    },
    body: payload,
  });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });
});


