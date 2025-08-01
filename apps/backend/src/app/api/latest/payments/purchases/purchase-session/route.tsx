import { getStripeForAccount } from "@/lib/stripe";
import { NextRequest } from "next/server";
import { purchaseUrlVerificationCodeHandler } from "../verification-code-handler";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import Stripe from "stripe";

export async function POST(request: NextRequest) {
  const { code, price_id } = await request.json();
  const { data } = await purchaseUrlVerificationCodeHandler.validateCode(code);
  const stripe = getStripeForAccount({ accountId: data.stripeAccountId });
  const pricesMap = new Map(Object.entries(data.offer.prices));
  const selectedPrice = pricesMap.get(price_id);
  if (!selectedPrice) {
    throwErr(400, "Price not found");
  }
  // TODO: prices with no interval should be allowed and work without a subscription
  if (!selectedPrice.interval) {
    throwErr(500, "Price does not have an interval");
  }
  const product = await stripe.products.create({
    name: data.offer.displayName ?? "Subscription",
  });
  const subscription = await stripe.subscriptions.create({
    customer: data.stripeCustomerId,
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.confirmation_secret', 'pending_setup_intent'],
    items: [{
      price_data: {
        currency: "usd",
        unit_amount: Number(selectedPrice.USD) * 100,
        product: product.id,
        recurring: {
          interval_count: selectedPrice.interval[0],
          interval: selectedPrice.interval[1],
        },
      },
      quantity: 1,
    }],
  });
  const clientSecret = (subscription.latest_invoice as Stripe.Invoice).confirmation_secret?.client_secret;
  return Response.json({ client_secret: clientSecret });

}
