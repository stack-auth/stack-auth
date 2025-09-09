import { getClientSecretFromStripeSubscription, validatePurchaseSession } from "@/lib/payments";
import { getStripeForAccount } from "@/lib/stripe";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { SubscriptionStatus } from "@prisma/client";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
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
    if (data.offer.prices === "include-by-default") {
      throw new StatusError(400, "This offer does not have any prices");
    }

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

    let clientSecret: string | undefined;

    // Handle upgrades/downgrades within a group
    if (conflictingGroupSubscriptions.length > 0) {
      const conflicting = conflictingGroupSubscriptions[0];
      if (conflicting.stripeSubscriptionId) {
        const existingStripeSub = await stripe.subscriptions.retrieve(conflicting.stripeSubscriptionId);
        const existingItem = existingStripeSub.items.data[0];
        const product = await stripe.products.create({ name: data.offer.displayName ?? "Subscription" });
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
          },
        });
        clientSecret = getClientSecretFromStripeSubscription(updated);
      } else if (conflicting.id) {
        // Cancel DB-only subscription and create a new Stripe subscription as normal
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

    if (!clientSecret) {
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
        },
      });
      clientSecret = getClientSecretFromStripeSubscription(created);
    }
    await purchaseUrlVerificationCodeHandler.revokeCode({
      tenancy,
      id: codeId,
    });

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
