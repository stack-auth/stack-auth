import { SubscriptionStatus } from "@/generated/prisma/client";
import { getClientSecretFromStripeSubscription, validatePurchaseSession } from "@/lib/payments";
import { bulldozerWriteSubscription } from "@/lib/payments/bulldozer-dual-write";
import { computeApplicationFeeAmount, getApplicationFeePercentOrUndefined } from "@/lib/payments/platform-fees";
import { upsertProductVersion } from "@/lib/product-versions";
import { getStripeForAccount } from "@/lib/stripe";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { purchaseUrlVerificationCodeHandler } from "../verification-code-handler";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: false,
    summary: "Create Purchase Session",
    description: "Creates a purchase session for completing a purchase.",
    tags: ["Payments"],
  },
  request: yupObject({
    body: yupObject({
      full_code: yupString().defined().meta({
        openapiField: {
          description: "The verification code, given as a query parameter in the purchase URL",
          exampleValue: "proj_abc123_def456ghi789"
        }
      }),
      price_id: yupString().defined().meta({
        openapiField: {
          description: "The Stack auth price ID to purchase",
          exampleValue: "price_1234567890abcdef"
        }
      }),
      quantity: yupNumber().integer().min(1).default(1).meta({
        openapiField: {
          description: "The quantity to purchase",
          exampleValue: 1
        }
      }),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      client_secret: yupString().defined().meta({
        openapiField: {
          description: "The Stripe client secret for completing the payment",
          exampleValue: "1234567890abcdef_secret_xyz123"
        }
      }),
    }),
  }),
  async handler({ body }) {
    const { full_code, price_id, quantity } = body;
    const { data, id: codeId } = await purchaseUrlVerificationCodeHandler.validateCode(full_code);
    const tenancy = await getTenancy(data.tenancyId);
    if (!tenancy) {
      throw new StackAssertionError("No tenancy found from purchase code data tenancy id. This should never happen.");
    }
    if (tenancy.config.payments.blockNewPurchases) {
      throw new KnownErrors.NewPurchasesBlocked();
    }
    const stripe = await getStripeForAccount({ accountId: data.stripeAccountId });
    const prisma = await getPrismaClientForTenancy(tenancy);
    const { selectedPrice, conflictingSubscriptions } = await validatePurchaseSession({
      prisma,
      tenancyId: tenancy.id,
      customerType: data.product.customerType,
      customerId: data.customerId,
      product: data.product,
      productId: data.productId,
      priceId: price_id,
      quantity,
    });
    if (!selectedPrice) {
      throw new StackAssertionError("Price not resolved for purchase session");
    }

    const productVersionId = await upsertProductVersion({
      prisma,
      tenancyId: tenancy.id,
      productId: data.productId ?? null,
      productJson: data.product,
    });

    if (conflictingSubscriptions.length > 0) {
      const conflicting = conflictingSubscriptions[0];
      if (conflicting.stripeSubscriptionId) {
        const existingStripeSub = await stripe.subscriptions.retrieve(conflicting.stripeSubscriptionId);
        const existingItem = existingStripeSub.items.data[0];
        const product = await stripe.products.create({ name: data.product.displayName ?? "Subscription" });
        if (selectedPrice.interval) {
          // TODO (platform-fees): this is a plan-switch mid-cycle that returns
          // `latest_invoice.confirmation_secret`, so an upgrade/proration invoice
          // is created synchronously. `application_fee_percent` is applied to
          // invoices generated from the subscription's normal billing cycle, but
          // per Stripe's subscription/proration docs the immediately-generated
          // upgrade invoice may not inherit the newly-set fee percent. Our
          // charge-leg guarantee for this specific invoice is therefore
          // best-effort until we either (a) observe the behaviour against a real
          // onboarded Connect account, or (b) listen for the resulting
          // `invoice.created` webhook and stamp `application_fee_amount` on the
          // invoice before it finalises. Refund-leg collection (via
          // `collectInverseFee`) is unaffected and still works on the full
          // refund amount regardless.
          // Refs: https://docs.stripe.com/connect/subscriptions
          //       https://docs.stripe.com/billing/subscriptions/prorations
          const applicationFeePercent = getApplicationFeePercentOrUndefined(tenancy.project.id);
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
              productId: data.productId ?? null,
              productVersionId,
              priceId: price_id,
            },
            ...(applicationFeePercent !== undefined ? { application_fee_percent: applicationFeePercent } : {}),
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
        const updatedConflicting = await prisma.subscription.update({
          where: {
            tenancyId_id: {
              tenancyId: tenancy.id,
              id: conflicting.id,
            },
          },
          data: {
            status: SubscriptionStatus.canceled,
            cancelAtPeriodEnd: true,
            canceledAt: new Date(),
            endedAt: new Date(),
          },
        });
        await bulldozerWriteSubscription(prisma, updatedConflicting);
      }
    }
    // One-time payment path after conflicts handled
    if (!selectedPrice.interval) {
      const amountCents = Number(selectedPrice.USD) * 100 * Math.max(1, quantity);
      const applicationFeeAmount = computeApplicationFeeAmount({
        amountStripeUnits: amountCents,
        projectId: tenancy.project.id,
      });
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        customer: data.stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        metadata: {
          productId: data.productId || "",
          productVersionId,
          customerId: data.customerId,
          customerType: data.product.customerType,
          purchaseQuantity: String(quantity),
          purchaseKind: "ONE_TIME",
          tenancyId: data.tenancyId,
          priceId: price_id,
        },
        ...(applicationFeeAmount > 0 ? { application_fee_amount: applicationFeeAmount } : {}),
      });
      const clientSecret = paymentIntent.client_secret;
      if (typeof clientSecret !== "string") {
        throwErr(500, "No client secret returned from Stripe for payment intent");
      }
      await purchaseUrlVerificationCodeHandler.revokeCode({ tenancy, id: codeId });
      return { statusCode: 200, bodyType: "json", body: { client_secret: clientSecret } };
    }

    const product = await stripe.products.create({
      name: data.product.displayName ?? "Subscription",
    });
    const applicationFeePercent = getApplicationFeePercentOrUndefined(tenancy.project.id);
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
        productId: data.productId ?? null,
        productVersionId,
        priceId: price_id,
      },
      ...(applicationFeePercent !== undefined ? { application_fee_percent: applicationFeePercent } : {}),
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
