import { SubscriptionStatus } from "@/generated/prisma/client";
import { getClientSecretFromStripeSubscription, validatePurchaseSession } from "@/lib/payments";
import { bulldozerWriteSubscription } from "@/lib/payments/bulldozer-dual-write";
import { computeApplicationFeeAmount, getApplicationFeePercentOrUndefined } from "@/lib/payments/platform-fees";
import { upsertProductVersion } from "@/lib/product-versions";
import { getStripeForAccount } from "@/lib/stripe";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { getStripeOneTimeMinAmount } from "@hexclave/shared/dist/payments/stripe-limits";
import { yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
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
      client_secret: yupString().optional().meta({
        openapiField: {
          description: "Stripe client secret used by the browser to confirm payment via Stripe Elements. Omitted when no payment step is required from the customer; in that case the purchase is being settled without a confirmation step and the caller should skip mounting Stripe Elements.",
          exampleValue: "1234567890abcdef_secret_xyz123",
        },
      }),
    }),
  }),
  async handler({ body }) {
    const { full_code, price_id, quantity } = body;
    const { data, id: codeId } = await purchaseUrlVerificationCodeHandler.validateCode(full_code);
    const tenancy = await getTenancy(data.tenancyId);
    if (!tenancy) {
      throw new HexclaveAssertionError("No tenancy found from purchase code data tenancy id. This should never happen.");
    }
    if (tenancy.config.payments.blockNewPurchases) {
      throw new KnownErrors.NewPurchasesBlocked();
    }
    if (data.stripeAccountId == null || data.stripeCustomerId == null) {
      throw new StatusError(400, "This purchase link is no longer valid. Please request a new one and try again.");
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
      throw new HexclaveAssertionError("Price not resolved for purchase session");
    }

    // Validate the price amount up-front so a malformed config can't slip past
    // the Stripe-minimum guards below and produce a raw Stripe error at
    // PaymentIntent/Subscription.create time.
    const priceAmount = Number(selectedPrice.USD);
    if (!Number.isFinite(priceAmount) || priceAmount < 0) {
      throw new StatusError(400, `Price amount must be a finite, non-negative number (got ${JSON.stringify(selectedPrice.USD)})`);
    }
    // TODO(default-plans): when default/free plans become first-class, route
    // these directly via an ensureDefaultPlan-style grant instead of forcing
    // callers to configure an interval just to make Stripe happy.
    const isFreePrice = priceAmount === 0;
    if (isFreePrice && !selectedPrice.interval) {
      throw new StatusError(400, "Free products must have a billing interval");
    }
    // Mirror Stripe's per-currency one-time minimum (shared with the dashboard
    // UI via stack-shared/payments/stripe-limits so the two can't drift apart)
    // and return a clean 400 instead of a raw Stripe error at
    // PaymentIntent.create time. Recurring sub items don't have this minimum
    // (handled above for the $0 case).
    const stripeOneTimeMin = getStripeOneTimeMinAmount('USD');
    if (!selectedPrice.interval && priceAmount > 0 && priceAmount < stripeOneTimeMin) {
      throw new StatusError(400, `One-time prices must be at least $${stripeOneTimeMin.toFixed(2)} (Stripe minimum)`);
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
          const applicationFeePercent = getApplicationFeePercentOrUndefined(tenancy.project.id);
          // TODO(default-plans): $0 subs currently piggyback on the Stripe
          // subscription lifecycle. Once default plans land, free subs should be
          // granted directly (Prisma insert + bulldozer write, mirroring
          // ensureFreePlanForBillingTeam) and skip Stripe entirely.
          //
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
          if (isFreePrice) {
            // Stripe activates $0 subs synchronously (status=active, invoice=paid)
            // and produces no PaymentIntent / confirmation_secret, so we have
            // nothing to hand to Stripe Elements. The DB row is written when
            // the `invoice.paid` webhook lands, exactly like paid purchases
            // after card confirmation.
            await purchaseUrlVerificationCodeHandler.revokeCode({ tenancy, id: codeId });
            return { statusCode: 200, bodyType: "json", body: {} };
          }
          // Extract the client secret BEFORE revoking the code: if Stripe
          // returns a malformed sub (no secret), we throw 500 here and the
          // customer can retry with the same code. Revoking first would burn
          // the code on every transient Stripe anomaly.
          const clientSecretUpdated = getClientSecretFromStripeSubscription(updated);
          if (typeof clientSecretUpdated !== "string") {
            throwErr(500, "No client secret returned from Stripe for subscription");
          }
          await purchaseUrlVerificationCodeHandler.revokeCode({ tenancy, id: codeId });
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
    // TODO(default-plans): $0 subs currently piggyback on the Stripe
    // subscription lifecycle. Once default plans land, free subs should be
    // granted directly (Prisma insert + bulldozer write, mirroring
    // ensureFreePlanForBillingTeam) and skip Stripe entirely.
    //
    // Note on $0 subs: Stripe auto-activates them on create (status="active",
    // invoice="paid") regardless of `default_incomplete` so we keep the same
    // call shape and only diverge in how we read the response below.
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
    if (isFreePrice) {
      // Stripe activates $0 subs synchronously (status=active, invoice=paid)
      // and produces no PaymentIntent / confirmation_secret, so we have
      // nothing to hand to Stripe Elements. The DB row is written when the
      // `invoice.paid` webhook lands, exactly like paid purchases after card
      // confirmation.
      await purchaseUrlVerificationCodeHandler.revokeCode({ tenancy, id: codeId });
      return {
        statusCode: 200,
        bodyType: "json",
        body: {},
      };
    }
    // Extract the client secret BEFORE revoking the code: if Stripe returns a
    // malformed sub (no secret), we throw 500 here and the customer can retry
    // with the same code. Revoking first would burn the code on every
    // transient Stripe anomaly.
    const clientSecret = getClientSecretFromStripeSubscription(created);
    if (typeof clientSecret !== "string") {
      throwErr(500, "No client secret returned from Stripe for subscription");
    }
    await purchaseUrlVerificationCodeHandler.revokeCode({ tenancy, id: codeId });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { client_secret: clientSecret },
    };
  }
});
