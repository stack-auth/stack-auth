import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { StripeWebhookEventStatus } from "@/generated/prisma/client";
import { globalPrismaClient } from "@/prisma-client";
import { claimStripeEvent, markStripeEventFailed, markStripeEventProcessed } from "./stripe-webhook-events";

// Test fixtures only need the fields the helper reads (id/type/account) plus a
// JSON-serializable body. Building a full Stripe.Event is impractical, so we
// cast a minimal object — any drift in the fields we actually use is still
// caught because the helper reads them directly.
function makeEvent(): Stripe.Event {
  return {
    id: `evt_${randomUUID()}`,
    type: "invoice.payment_succeeded",
    account: "acct_test_123",
    data: { object: { id: "in_test", note: "fixture" } },
  } as unknown as Stripe.Event;
}

describe("stripe webhook event idempotency (real DB)", () => {
  it("claims a brand new event and persists it as PENDING", async ({ expect }) => {
    const event = makeEvent();

    const { shouldProcess } = await claimStripeEvent(event);
    expect(shouldProcess).toBe(true);

    const row = await globalPrismaClient.stripeWebhookEvent.findUnique({
      where: { stripeEventId: event.id },
    });
    expect(row).not.toBeNull();
    expect(row?.status).toBe(StripeWebhookEventStatus.PENDING);
    expect(row?.eventType).toBe(event.type);
    expect(row?.stripeAccountId).toBe(event.account);
    expect(row?.processedAt).toBeNull();
    expect(row?.lastError).toBeNull();
    // The full event payload is stored so dropped/failed events can be replayed.
    expect(row?.payload).toMatchObject({ id: event.id, type: event.type });
  });

  it("skips a redelivery while the prior delivery is still in-flight (PENDING)", async ({ expect }) => {
    const event = makeEvent();

    const first = await claimStripeEvent(event);
    expect(first.shouldProcess).toBe(true);

    // Single-flight: a redelivery that arrives while the first attempt is still
    // PENDING must not spin up a second processor (that would double the fan-out).
    const second = await claimStripeEvent(event);
    expect(second.shouldProcess).toBe(false);
  });

  it("deduplicates once the event has been fully PROCESSED", async ({ expect }) => {
    const event = makeEvent();

    await claimStripeEvent(event);
    await markStripeEventProcessed(event.id);

    const processedRow = await globalPrismaClient.stripeWebhookEvent.findUnique({
      where: { stripeEventId: event.id },
    });
    expect(processedRow?.status).toBe(StripeWebhookEventStatus.PROCESSED);
    expect(processedRow?.processedAt).not.toBeNull();
    expect(processedRow?.lastError).toBeNull();

    // A Stripe redelivery of an already-processed event must be a no-op.
    const redelivery = await claimStripeEvent(event);
    expect(redelivery.shouldProcess).toBe(false);
  });

  it("records the error on failure and allows recovery via redelivery", async ({ expect }) => {
    const event = makeEvent();

    await claimStripeEvent(event);
    await markStripeEventFailed(event.id, new Error("boom while processing"));

    const failedRow = await globalPrismaClient.stripeWebhookEvent.findUnique({
      where: { stripeEventId: event.id },
    });
    expect(failedRow?.status).toBe(StripeWebhookEventStatus.FAILED);
    expect(failedRow?.lastError).toContain("boom while processing");

    // FAILED rows must reprocess so a manual Stripe "Resend" can recover them.
    const recovery = await claimStripeEvent(event);
    expect(recovery.shouldProcess).toBe(true);

    // ...but reclaiming a FAILED row flips it back to in-flight (PENDING), so a
    // further redelivery during that retry is once again skipped (single-flight).
    const concurrentRetry = await claimStripeEvent(event);
    expect(concurrentRetry.shouldProcess).toBe(false);
  });

  it("scrubs a stale processedAt when a row leaves the PROCESSED state", async ({ expect }) => {
    const event = makeEvent();

    await claimStripeEvent(event);
    await markStripeEventProcessed(event.id);

    // markStripeEventFailed must clear processedAt so a recovered/re-failed row is
    // never readable as "completed at <time>".
    await markStripeEventFailed(event.id, new Error("late failure after success"));
    const failedRow = await globalPrismaClient.stripeWebhookEvent.findUnique({
      where: { stripeEventId: event.id },
    });
    expect(failedRow?.status).toBe(StripeWebhookEventStatus.FAILED);
    expect(failedRow?.processedAt).toBeNull();

    // Force a stale processedAt on a FAILED row, then prove the FAILED -> PENDING
    // recovery transition scrubs it too.
    await globalPrismaClient.stripeWebhookEvent.update({
      where: { stripeEventId: event.id },
      data: { processedAt: new Date() },
    });
    const recovery = await claimStripeEvent(event);
    expect(recovery.shouldProcess).toBe(true);
    const recoveredRow = await globalPrismaClient.stripeWebhookEvent.findUnique({
      where: { stripeEventId: event.id },
    });
    expect(recoveredRow?.status).toBe(StripeWebhookEventStatus.PENDING);
    expect(recoveredRow?.processedAt).toBeNull();
  });
});
