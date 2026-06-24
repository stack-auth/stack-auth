import { Prisma, StripeWebhookEventStatus } from "@/generated/prisma/client";
import { globalPrismaClient } from "@/prisma-client";
import { errorToNiceString, HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
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
 * Records the event (or detects a prior one) and decides whether processing
 * should run. Returns `shouldProcess: false` only when the event has already
 * been fully PROCESSED — PENDING/FAILED rows are allowed to reprocess so that a
 * manual Stripe "Resend" can recover a dropped/failed event.
 */
export async function claimStripeEvent(event: Stripe.Event): Promise<{ shouldProcess: boolean }> {
  try {
    await globalPrismaClient.stripeWebhookEvent.create({
      data: {
        stripeEventId: event.id,
        eventType: event.type,
        stripeAccountId: event.account ?? null,
        payload: JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue,
        status: StripeWebhookEventStatus.PENDING,
      },
    });
    return { shouldProcess: true };
  } catch (error) {
    // Unique violation on stripeEventId => we've seen this event before.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await globalPrismaClient.stripeWebhookEvent.findUnique({
        where: { stripeEventId: event.id },
      });
      return { shouldProcess: existing?.status !== StripeWebhookEventStatus.PROCESSED };
    }

    throw new HexclaveAssertionError(
      `Failed to claim Stripe webhook event for idempotency: ${event.id}`,
      { cause: error, stripeEventId: event.id, eventType: event.type },
    );
  }
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
    },
  });
}
