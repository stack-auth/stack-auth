import { getStackStripe, getStripeForAccount, syncStripeSubscriptions } from "@/lib/stripe";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { typedIncludes } from '@stackframe/stack-shared/dist/utils/arrays';
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, StatusError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import Stripe from "stripe";

const subscriptionChangedEvents = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.upcoming",
  "invoice.marked_uncollectible",
  "invoice.payment_succeeded",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
] as const satisfies Stripe.Event.Type[];

const isSubscriptionChangedEvent = (event: Stripe.Event): event is Stripe.Event & { type: (typeof subscriptionChangedEvents)[number] } => {
  return subscriptionChangedEvents.includes(event.type as any);
};

async function processStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  const mockData = (event.data.object as any).stack_stripe_mock_data;
  if (event.type === "payment_intent.succeeded" && event.data.object.metadata.purchaseKind === "ONE_TIME") {
    const metadata = event.data.object.metadata;
    const accountId = event.account;
    if (!accountId) {
      throw new StackAssertionError("Stripe webhook account id missing", { event });
    }
    const stripe = getStackStripe(mockData);
    const account = await stripe.accounts.retrieve(accountId);
    const tenancyId = account.metadata?.tenancyId;
    if (!tenancyId) {
      throw new StackAssertionError("Stripe account metadata missing tenancyId", { event });
    }
    const tenancy = await getTenancy(tenancyId);
    if (!tenancy) {
      throw new StackAssertionError("Tenancy not found", { event });
    }
    const prisma = await getPrismaClientForTenancy(tenancy);
    const offer = JSON.parse(metadata.offer || "{}");
    const qty = Math.max(1, Number(metadata.purchaseQuantity || 1));
    const stripePaymentIntentId = event.data.object.id;
    if (!metadata.customerId || !metadata.customerType) {
      throw new StackAssertionError("Missing customer metadata for one-time purchase", { event });
    }
    if (!typedIncludes(["user", "team", "custom"] as const, metadata.customerType)) {
      throw new StackAssertionError("Invalid customer type for one-time purchase", { event });
    }
    await prisma.oneTimePurchase.upsert({
      where: {
        tenancyId_stripePaymentIntentId: {
          tenancyId: tenancy.id,
          stripePaymentIntentId,
        },
      },
      create: {
        tenancyId: tenancy.id,
        customerId: metadata.customerId,
        customerType: typedToUppercase(metadata.customerType),
        offerId: metadata.offerId || null,
        priceId: metadata.priceId || null,
        stripePaymentIntentId,
        offer,
        quantity: qty,
        creationSource: "PURCHASE_PAGE",
      },
      update: {
        offerId: metadata.offerId || null,
        priceId: metadata.priceId || null,
        offer,
        quantity: qty,
      }
    });
  }

  if (isSubscriptionChangedEvent(event)) {
    const accountId = event.account;
    const customerId = event.data.object.customer;
    if (!accountId) {
      throw new StackAssertionError("Stripe webhook account id missing", { event });
    }
    if (typeof customerId !== 'string') {
      throw new StackAssertionError("Stripe webhook bad customer id", { event });
    }
    const stripe = await getStripeForAccount({ accountId }, mockData);
    await syncStripeSubscriptions(stripe, accountId, customerId);
  }
}

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    headers: yupObject({
      "stripe-signature": yupTuple([yupString().defined()]).defined(),
    }).defined(),
    body: yupMixed().optional(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async (req, fullReq) => {
    const stripe = getStackStripe();
    let event: Stripe.Event;
    try {
      const signature = req.headers["stripe-signature"][0];
      const textBody = new TextDecoder().decode(fullReq.bodyBuffer);
      event = stripe.webhooks.constructEvent(
        textBody,
        signature,
        getEnvVariable("STACK_STRIPE_WEBHOOK_SECRET"),
      );
    } catch {
      throw new StatusError(400, "Invalid stripe-signature header");
    }

    try {
      await processStripeWebhookEvent(event);
    } catch (error) {
      captureError("stripe-webhook-receiver", error);
      throw error;
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: { received: true }
    };
  },
});
