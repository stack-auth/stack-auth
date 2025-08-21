import { getStripeForAccount } from "@/lib/stripe";
import { getTenancy } from "@/lib/tenancies";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import Stripe from "stripe";
import { purchaseUrlVerificationCodeHandler } from "../verification-code-handler";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    body: yupObject({
      full_code: yupString().defined(),
      price_id: yupString().defined(),
      quantity: yupNumber().integer().min(1).default(1),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      client_secret: yupString().defined(),
    }),
  }),
  async handler({ body }) {
    const { full_code, price_id, quantity } = body;
    const { data, id: codeId } = await purchaseUrlVerificationCodeHandler.validateCode(full_code);
    const tenancy = await getTenancy(data.tenancyId);
    if (!tenancy) {
      throw new StackAssertionError("No tenancy found from purchase code data tenancy id. This should never happen.");
    }
    const stripe = getStripeForAccount({ accountId: data.stripeAccountId });
    const pricesMap = new Map(Object.entries(data.offer.prices));
    const selectedPrice = pricesMap.get(price_id);
    if (!selectedPrice) {
      throw new StatusError(400, "Price not found on offer associated with this purchase code");
    }
    // TODO: prices with no interval should be allowed and work without a subscription
    if (!selectedPrice.interval) {
      throw new StackAssertionError("unimplemented; prices without an interval are currently not supported");
    }
    if (quantity !== 1 && data.offer.stackable !== true) {
      throw new StatusError(400, "This offer is not stackable; quantity must be 1");
    }

    const product = await stripe.products.create({
      name: data.offer.displayName ?? "Subscription",
    });
    const subscription = await stripe.subscriptions.create({
      customer: data.stripeCustomerId,
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.confirmation_secret'],
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
        quantity,
      }],
      metadata: {
        offer: JSON.stringify(data.offer),
      },
    });
    await purchaseUrlVerificationCodeHandler.revokeCode({
      tenancy,
      id: codeId,
    });

    const clientSecret = (subscription.latest_invoice as Stripe.Invoice).confirmation_secret?.client_secret;
    // stripe-mock returns an empty string here
    if (typeof clientSecret !== "string") {
      throwErr(500, "No client secret returned from Stripe for subscription");
    }
    return {
      statusCode: 200,
      bodyType: "json",
      body: { client_secret: clientSecret },
    };
  }
});
