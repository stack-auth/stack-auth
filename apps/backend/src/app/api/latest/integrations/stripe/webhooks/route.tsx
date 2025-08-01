import { stackStripe, syncStripeDataToDB } from "@/lib/stripe";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const allowedEvents = [
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

const isAllowedEvent = (event: Stripe.Event): event is Stripe.Event & { type: (typeof allowedEvents)[number] } => {
  return allowedEvents.includes(event.type as any);
};

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }
  let event;
  try {
    event = stackStripe.webhooks.constructEvent(body, signature, getEnvVariable("STACK_STRIPE_WEBHOOK_SECRET"));
  } catch (err) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }
  if (!isAllowedEvent(event)) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const accountId = event.account;
  const customerId = event.data.object.customer;
  if (!accountId) {
    captureError('stripe-webhook-account-id-missing', { event });
    return NextResponse.json({ received: true }, { status: 200 });
  }
  if (typeof customerId !== 'string') {
    captureError('stripe-webhook-bad-customer-id', { event });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  try {
    await syncStripeDataToDB(accountId, customerId);
  } catch (e) {
    captureError('stripe-webhook-sync-failed', { accountId, customerId, event, error: e });
    return NextResponse.json({ received: true }, { status: 200 });
  }
  return NextResponse.json({ received: true }, { status: 200 });
}
