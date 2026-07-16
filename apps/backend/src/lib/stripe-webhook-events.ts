import { randomUUID } from "node:crypto";
import { StripeWebhookEventStatus } from "@/generated/prisma/client";
import { globalPrismaClient } from "@/prisma-client";
import { errorToNiceString } from "@hexclave/shared/dist/utils/errors";
import type Stripe from "stripe";

/**
 * Idempotency + recovery layer for incoming Stripe webhook events.
 *
 * Each event is persisted (keyed on the Stripe `event.id`) synchronously before
 * we ack 200 to Stripe. Processing then runs in the background. Because Stripe
 * delivers at-least-once, this is what guarantees the receipt fan-out happens at
 * most once per event. The full `payload` is stored so PENDING/FAILED rows can
 * be replayed manually if the background work is dropped (e.g. instance recycle).
 */

/**
 * Atomically claims an event for processing, guaranteeing single-flight: at most
 * one worker processes a given event at a time. Returns `shouldProcess: true`
 * only to the caller that won the claim.
 *
 * A new event is inserted as PENDING. On a redelivery, the claim is only handed
 * out again if the previous attempt FAILED (the `WHERE status = 'FAILED'` makes
 * the takeover conditional and atomic, so concurrent redeliveries can't both
 * win). PENDING (in-flight) and PROCESSED (done) rows yield no row and are
 * skipped. A PENDING row whose worker died is recovered manually from `payload`.
 */
export async function claimStripeEvent(event: Stripe.Event): Promise<{ shouldProcess: boolean }> {
  const claimed = await globalPrismaClient.$queryRaw<{ id: string }[]>`
    INSERT INTO "StripeWebhookEvent" ("id", "stripeEventId", "eventType", "stripeAccountId", "payload", "status", "updatedAt")
    VALUES (${randomUUID()}::uuid, ${event.id}, ${event.type}, ${event.account ?? null}, ${JSON.stringify(event)}::jsonb, 'PENDING', now())
    ON CONFLICT ("stripeEventId") DO UPDATE
      SET "status" = 'PENDING', "lastError" = NULL, "processedAt" = NULL, "updatedAt" = now()
      WHERE "StripeWebhookEvent"."status" = 'FAILED'
    RETURNING "id"
  `;
  return { shouldProcess: claimed.length === 1 };
}

export async function markStripeEventProcessed(stripeEventId: string): Promise<void> {
  await globalPrismaClient.stripeWebhookEvent.update({
    where: { stripeEventId },
    data: {
      status: StripeWebhookEventStatus.PROCESSED,
      processedAt: new Date(),
      lastError: null,
    },
  });
}

export async function markStripeEventFailed(stripeEventId: string, error: unknown): Promise<void> {
  await globalPrismaClient.stripeWebhookEvent.update({
    where: { stripeEventId },
    data: {
      status: StripeWebhookEventStatus.FAILED,
      lastError: errorToNiceString(error),
      processedAt: null,
    },
  });
}
