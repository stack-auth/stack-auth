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

  it("allows reprocessing while the prior delivery is still PENDING", async ({ expect }) => {
    const event = makeEvent();

    const first = await claimStripeEvent(event);
    expect(first.shouldProcess).toBe(true);

    // Redelivery before the background work finished: we must NOT skip, otherwise
    // a crash between claim and processing would silently drop the event forever.
    const second = await claimStripeEvent(event);
    expect(second.shouldProcess).toBe(true);
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
  });
});
