import { getStackStripe, syncStripeSubscriptions } from "@/lib/stripe";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
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
  if (event.type === "payment_intent.succeeded") {
    const object = event.data.object as any;
    const metadata = object?.metadata ?? {};
    if (metadata.purchaseKind === "ONE_TIME") {
      const accountId = event.account;
      if (!accountId) {
        throw new StackAssertionError("Stripe webhook account id missing", { event });
      }
      const stripe = getStackStripe();
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
      const customerIdMeta: string | undefined = metadata.customerId;
      const customerTypeMeta: string | undefined = metadata.customerType;
      const qty = Math.max(1, Number(metadata.purchaseQuantity || 1));
      if (!customerIdMeta || !customerTypeMeta) {
        throw new StackAssertionError("Missing customer metadata for one-time purchase", { event });
      }
      const includedItems = offer?.includedItems || {};
      for (const [itemId, inc] of Object.entries(includedItems as Record<string, { quantity: number }>)) {
        const grant = Math.max(0, Number((inc as any).quantity || 0)) * qty;
        if (!grant) continue;
        await prisma.itemQuantityChange.create({
          data: {
            tenancyId: tenancy.id,
            customerId: customerIdMeta,
            itemId,
            quantity: grant,
            description: `ONE_TIME_PURCHASE payment_intent=${object.id}`,
          },
        });
      }

      await prisma.oneTimePurchase.create({
        data: {
          tenancyId: tenancy.id,
          customerId: customerIdMeta,
          customerType: (String(customerTypeMeta).toUpperCase() as any),
          offerId: metadata.offerId || null,
          offer,
          quantity: qty,
        },
      });
      return;
    }
  }

  if (isSubscriptionChangedEvent(event)) {
    const accountId = event.account;
    const customerId = (event.data.object as any).customer;
    if (!accountId) {
      throw new StackAssertionError("Stripe webhook account id missing", { event });
    }
    if (typeof customerId !== 'string') {
      throw new StackAssertionError("Stripe webhook bad customer id", { event });
    }
    await syncStripeSubscriptions(accountId, customerId);
    return;
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
    try {
      const stripe = getStackStripe();
      const signature = req.headers["stripe-signature"][0];
      if (!signature) {
        throw new StackAssertionError("Missing stripe-signature header");
      }

      const textBody = new TextDecoder().decode(fullReq.bodyBuffer);
      const event = stripe.webhooks.constructEvent(
        textBody,
        signature,
        getEnvVariable("STACK_STRIPE_WEBHOOK_SECRET"),
      );
      await processStripeWebhookEvent(event);
    } catch (error) {
      captureError("stripe-webhook-receiver", error);
    }
    return {
      statusCode: 200,
      bodyType: "json",
      body: { received: true }
    };
  },
});
