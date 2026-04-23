import { expect } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, Payments, Project, niceBackendFetch } from "../../../../backend-helpers";
import {
  createLiveModeOneTimePurchaseTransaction,
  createLiveModeSubscriptionTransaction,
  createPurchaseCode,
} from "../../../../helpers/payments";

// `amount_usd: "5000"` in refund_entries is parsed as 5000 stripe-units (= $50),
// so 0.9% = 45. Partial refund "1250" = 1250 stripe-units, 0.9% = round(11.25) = 11.
const EXPECTED_REFUND_FEE_STRIPE_UNITS = 45;
const EXPECTED_PARTIAL_REFUND_FEE_STRIPE_UNITS = 11;

/**
 * `collectInverseFee` is intentionally backgrounded via `runAsynchronouslyAndWaitUntil`
 * in the refund route, so the refund response can return before the ledger row
 * reaches a terminal status. Tests must poll instead of asserting immediately
 * after the refund response.
 */
async function waitForPlatformFeeEvent(options: { terminal?: boolean } = {}) {
  const { terminal = true } = options;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const res = await niceBackendFetch("/api/latest/internal/payments/platform-fees", {
      accessType: "admin",
    });
    expect(res.status).toBe(200);
    const events = res.body.events as Array<{ status: string }>;
    if (events.length > 0) {
      if (!terminal) return res;
      if (events.every((e) => e.status === "COLLECTED" || e.status === "FAILED")) {
        return res;
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Timed out waiting for PlatformFeeEvent to reach a terminal status");
}

it("records a COLLECTED PlatformFeeEvent when a live-mode OTP is refunded", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const beforeRes = await niceBackendFetch("/api/latest/internal/payments/platform-fees", {
    accessType: "admin",
  });
  expect(beforeRes.status).toBe(200);
  expect(beforeRes.body.events).toHaveLength(0);
  expect(beforeRes.body.total_due_usd).toBe(0);

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      refund_entries: [{ entry_index: 0, quantity: 1, amount_usd: "5000" }],
    },
  });
  expect(refundRes.status).toBe(200);

  const afterRes = await waitForPlatformFeeEvent();
  expect(afterRes.body.events).toHaveLength(1);
  const event = afterRes.body.events[0];
  expect(event.source_type).toBe("REFUND");
  expect(event.amount).toBe(EXPECTED_REFUND_FEE_STRIPE_UNITS);
  expect(event.currency).toBe("usd");
  expect(event.status).toBe("COLLECTED");
  expect(event.stripe_transfer_id).not.toBeNull();
  // total_due_usd excludes COLLECTED rows.
  expect(afterRes.body.total_due_usd).toBe(0);
});

it("collects proportional fee on a partial refund", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      refund_entries: [{ entry_index: 0, quantity: 1, amount_usd: "1250" }],
    },
  });
  expect(refundRes.status).toBe(200);

  const feesRes = await waitForPlatformFeeEvent();
  expect(feesRes.body.events).toHaveLength(1);
  expect(feesRes.body.events[0].amount).toBe(EXPECTED_PARTIAL_REFUND_FEE_STRIPE_UNITS);
  expect(feesRes.body.events[0].status).toBe("COLLECTED");
});

it("does not record a fee on a test-mode refund attempt", async () => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Project.updateConfig({
    payments: {
      testMode: true,
      products: {
        "otp-product": {
          displayName: "One-Time Product",
          customerType: "user",
          serverOnly: false,
          stackable: false,
          prices: { single: { USD: "5000" } },
          includedItems: {},
        },
      },
      items: {},
    },
  });

  const { userId } = await Auth.fastSignUp();
  const code = await createPurchaseCode({ userId, productId: "otp-product" });
  const sessionRes = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
    accessType: "admin",
    method: "POST",
    body: { full_code: code, price_id: "single", quantity: 1 },
  });
  expect(sessionRes.status).toBe(200);

  const transactions = await niceBackendFetch("/api/latest/internal/payments/transactions", {
    accessType: "admin",
  });
  const transactionId = transactions.body.transactions[0].id;

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: transactionId,
      refund_entries: [{ entry_index: 0, quantity: 1, amount_usd: "5000" }],
    },
  });
  // Test-mode OTP refunds are rejected upstream; no Stripe call, no fee row.
  expect(refundRes.body.code).toBe("TEST_MODE_PURCHASE_NON_REFUNDABLE");

  const feesRes = await niceBackendFetch("/api/latest/internal/payments/platform-fees", {
    accessType: "admin",
  });
  expect(feesRes.status).toBe(200);
  expect(feesRes.body.events).toHaveLength(0);
});

// TODO(platform-fees): this test covers only the *refund endpoint's* already-
// refunded rejection; it does NOT exercise the helper's sourceId idempotency
// path (calling collectInverseFee twice with the same sourceId and asserting
// one row + one Stripe transfer). That requires either a direct helper-level
// test with a shared-context stripe client (not wired in this repo) or an
// admin retry endpoint. Tracking separately.
it("refund endpoint rejects a second refund for the same purchase", async () => {
  const { purchaseTransaction } = await createLiveModeOneTimePurchaseTransaction();

  const firstRefund = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      refund_entries: [{ entry_index: 0, quantity: 1, amount_usd: "5000" }],
    },
  });
  expect(firstRefund.status).toBe(200);
  // Wait for the first fee row to land before firing the second refund so the
  // assertion below is unambiguous about "only one row exists".
  await waitForPlatformFeeEvent();

  const secondRefund = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "one-time-purchase",
      id: purchaseTransaction.id,
      refund_entries: [{ entry_index: 0, quantity: 1, amount_usd: "5000" }],
    },
  });
  expect(secondRefund.body.code).toBe("ONE_TIME_PURCHASE_ALREADY_REFUNDED");

  const feesRes = await niceBackendFetch("/api/latest/internal/payments/platform-fees", {
    accessType: "admin",
  });
  expect(feesRes.body.events).toHaveLength(1);
});

// Skipped against stripe-mock: the subscription refund path calls
// `stripe.invoices.retrieve(id, { expand: ["payments"] })` at refund time and
// expects `payments.data` with a paid payment carrying a `payment_intent`.
// stripe-mock returns its default invoice fixture which doesn't populate
// payments, and the mock-override plumbing (`stack_stripe_mock_data`) is
// webhook-time-only — it doesn't propagate to unrelated API calls made later.
//
// TODO(platform-fees): close this coverage gap via one of —
//   (a) patch stripe-mock to echo a paid payment on invoices.retrieve when a
//       sibling payment_intent.succeeded webhook was previously replayed for
//       the same invoice,
//   (b) thread `stack_stripe_mock_data` overrides through `getStripeForAccount`
//       on the refund path so tests can stub invoices.retrieve,
//   (c) run this under a real-Stripe CI job with an onboarded connected
//       account (matches the manual-QA path in this PR's description).
it.skip("records a PlatformFeeEvent when a live-mode subscription is refunded", async () => {
  const { subscriptionTransaction } = await createLiveModeSubscriptionTransaction();

  const refundRes = await niceBackendFetch("/api/latest/internal/payments/transactions/refund", {
    accessType: "admin",
    method: "POST",
    body: {
      type: "subscription",
      id: subscriptionTransaction.id,
      refund_entries: [{ entry_index: 0, quantity: 1, amount_usd: "1000" }],
    },
  });
  expect(refundRes.status).toBe(200);

  const feesRes = await waitForPlatformFeeEvent();
  expect(feesRes.body.events).toHaveLength(1);
  // 0.9% of 1000 stripe-units ($10) = 9 stripe-units.
  expect(feesRes.body.events[0].amount).toBe(9);
});
