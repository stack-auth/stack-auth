import { getClientSecretFromStripeSubscription, validatePurchaseSession } from "@/lib/payments";
import { getStripeForAccount } from "@/lib/stripe";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { SubscriptionStatus } from "@prisma/client";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
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
    const stripe = await getStripeForAccount({ accountId: data.stripeAccountId });
    const prisma = await getPrismaClientForTenancy(tenancy);
    const { selectedPrice, conflictingGroupSubscriptions } = await validatePurchaseSession({
      prisma,
      tenancy,
      codeData: data,
      priceId: price_id,
      quantity,
    });
    if (!selectedPrice) {
      throw new StackAssertionError("Price not resolved for purchase session");
    }

    if (conflictingGroupSubscriptions.length > 0) {
      const conflicting = conflictingGroupSubscriptions[0];
      if (conflicting.stripeSubscriptionId) {
        const existingStripeSub = await stripe.subscriptions.retrieve(conflicting.stripeSubscriptionId);
        const existingItem = existingStripeSub.items.data[0];
        const product = await stripe.products.create({ name: data.offer.displayName ?? "Subscription" });
        if (selectedPrice.interval) {
          const updated = await stripe.subscriptions.update(conflicting.stripeSubscriptionId, {
            payment_behavior: 'default_incomplete',
            payment_settings: { save_default_payment_method: 'on_subscription' },
            expand: ['latest_invoice.confirmation_secret'],
            items: [{
              id: existingItem.id,
              price_data: {
                currency: "usd",
                unit_amount: Number(selectedPrice.USD) * 100,
                product: product.id,
                recurring: {
                  interval_count: selectedPrice.interval![0],
                  interval: selectedPrice.interval![1],
                },
              },
              quantity,
            }],
            metadata: {
              offerId: data.offerId ?? null,
              offer: JSON.stringify(data.offer),
              priceId: price_id,
            },
          });
          const clientSecretUpdated = getClientSecretFromStripeSubscription(updated);
          await purchaseUrlVerificationCodeHandler.revokeCode({ tenancy, id: codeId });
          if (typeof clientSecretUpdated !== "string") {
            throwErr(500, "No client secret returned from Stripe for subscription");
          }
          return { statusCode: 200, bodyType: "json", body: { client_secret: clientSecretUpdated } };
        } else {
          await stripe.subscriptions.cancel(conflicting.stripeSubscriptionId);
        }
      } else if (conflicting.id) {
        await prisma.subscription.update({
          where: {
            tenancyId_id: {
              tenancyId: tenancy.id,
              id: conflicting.id,
            },
          },
          data: {
            status: SubscriptionStatus.canceled,
          },
        });
      }
    }
    // One-time payment path after conflicts handled
    if (!selectedPrice.interval) {
      const amountCents = Number(selectedPrice.USD) * 100 * Math.max(1, quantity);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        customer: data.stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        metadata: {
          offerId: data.offerId || "",
          offer: JSON.stringify(data.offer),
          customerId: data.customerId,
          customerType: data.offer.customerType,
          purchaseQuantity: String(quantity),
          purchaseKind: "ONE_TIME",
          tenancyId: data.tenancyId,
          priceId: price_id,
        },
      });
      const clientSecret = paymentIntent.client_secret;
      if (typeof clientSecret !== "string") {
        throwErr(500, "No client secret returned from Stripe for payment intent");
      }
      await purchaseUrlVerificationCodeHandler.revokeCode({ tenancy, id: codeId });
      return { statusCode: 200, bodyType: "json", body: { client_secret: clientSecret } };
    }

    const product = await stripe.products.create({
      name: data.offer.displayName ?? "Subscription",
    });
    const created = await stripe.subscriptions.create({
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
            interval_count: selectedPrice.interval![0],
            interval: selectedPrice.interval![1],
          },
        },
        quantity,
      }],
      metadata: {
        offerId: data.offerId ?? null,
        offer: JSON.stringify(data.offer),
        priceId: price_id,
      },
    });
    const clientSecret = getClientSecretFromStripeSubscription(created);
    if (typeof clientSecret !== "string") {
      throwErr(500, "No client secret returned from Stripe for subscription");
    }

    await purchaseUrlVerificationCodeHandler.revokeCode({
      tenancy,
      id: codeId,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { client_secret: clientSecret },
    };
  }
});
