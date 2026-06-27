import { SubscriptionStatus } from "@/generated/prisma/client";
import { getClientSecretFromStripeSubscription, getSetupIntentClientSecretFromStripeSubscription, validatePurchaseSession } from "@/lib/payments";
import { bulldozerWriteSubscription } from "@/lib/payments/bulldozer-dual-write";
import { computeApplicationFeeAmount, getApplicationFeePercentOrUndefined } from "@/lib/payments/platform-fees";
import { attachStripePaymentIntentToPromoRedemption, attachStripeSubscriptionToPromoRedemption, createStripeCouponParamsForPromoCode, promoRedemptionMetadata, reservePromoCodeRedemption, voidExpiredOrFailedPromoCodeRedemption, type ReservedPromoCodeRedemption } from "@/lib/payments/promo-codes";
import { upsertProductVersion } from "@/lib/product-versions";
import { getStripeForAccount } from "@/lib/stripe";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { getStripeOneTimeMinAmount } from "@hexclave/shared/dist/payments/stripe-limits";
import { yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { captureError, HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { Result } from "@hexclave/shared/dist/utils/results";
import Stripe from "stripe";
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
      promo_code: yupString().optional().meta({
        openapiField: {
          description: "Optional promo code to apply to the purchase. Discounts are validated and computed on the server.",
          exampleValue: "PROMO-SUMMER",
        },
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
      client_secret_type: yupString().oneOf(["payment", "setup"]).optional().meta({
        openapiField: {
          description: "The Stripe confirmation flow to use for client_secret. Defaults to payment when omitted for backwards compatibility.",
          exampleValue: "payment",
        },
      }),
    }),
  }),
  async handler({ body }) {
    const { full_code, price_id, quantity, promo_code } = body;
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
    const stripeCustomerId = data.stripeCustomerId;
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
    const promoRedemption = promo_code ? await reservePromoCodeRedemption({
      prisma,
      tenancyId: tenancy.id,
      customerType: data.product.customerType,
      customerId: data.customerId,
      product: data.product,
      productId: data.productId,
      priceId: price_id,
      selectedPrice,
      quantity,
      productVersionId,
      promoCode: promo_code,
    }) : null;
    const originalAmountCents = Number(selectedPrice.USD) * 100 * Math.max(1, quantity);
    const effectiveAmountCents = promoRedemption?.finalAmountUsdCents ?? originalAmountCents;
    const isForeverFreeAfterPromo = promoRedemption?.finalAmountUsdCents === 0 && promoRedemption.subscriptionDuration === "forever";
    const requiresSetupAfterFirstInvoicePromo = promoRedemption?.finalAmountUsdCents === 0 && promoRedemption.subscriptionDuration === "first_invoice";

    const createPromoCoupon = async (redemption: ReservedPromoCodeRedemption) => {
      const coupon = await stripe.coupons.create(createStripeCouponParamsForPromoCode({
        quote: redemption,
        promoCode: promo_code ?? "",
      }));
      return coupon.id;
    };

    const voidPromoRedemptionAfterSubscriptionFailure = async (redemption: ReservedPromoCodeRedemption | null, reason: string) => {
      if (!redemption) {
        return;
      }
      const voidResult = await Result.fromPromise(voidExpiredOrFailedPromoCodeRedemption({
        prisma,
        tenancyId: tenancy.id,
        redemptionId: redemption.redemptionId,
        reason,
      }));
      if (voidResult.status === "error") {
        captureError("promo-redemption-subscription-failure-void-failed", voidResult.error);
      }
    };

    const runSubscriptionWithPromoCouponCleanup = async <T extends Stripe.Subscription>(options: {
      redemption: ReservedPromoCodeRedemption | null,
      failureReason: string,
      run: (couponId: string | null) => Promise<T>,
    }): Promise<T> => {
      let couponId: string | null = null;
      if (options.redemption) {
        const couponResult = await Result.fromPromise(createPromoCoupon(options.redemption));
        if (couponResult.status === "error") {
          await voidPromoRedemptionAfterSubscriptionFailure(options.redemption, options.failureReason);
          throw couponResult.error;
        }
        couponId = couponResult.data;
      }
      const result = await Result.fromPromise(options.run(couponId));
      if (result.status === "ok") {
        return result.data;
      }
      if (couponId) {
        const deleteResult = await Result.fromPromise(stripe.coupons.del(couponId));
        if (deleteResult.status === "error") {
          captureError("promo-stripe-coupon-cleanup-failed", deleteResult.error);
        }
      }
      await voidPromoRedemptionAfterSubscriptionFailure(options.redemption, options.failureReason);
      throw result.error;
    };

    const finishSubscriptionResponse = async (subscription: Stripe.Subscription) => {
      if (isFreePrice || isForeverFreeAfterPromo) {
        // Stripe activates permanently $0 subs synchronously and produces no
        // confirmation secret. FIRST_INVOICE $0 promos are different: renewals
        // will charge later, so the caller still needs a setup intent now.
        await purchaseUrlVerificationCodeHandler.revokeCode({ tenancy, id: codeId });
        return { statusCode: 200, bodyType: "json" as const, body: {} };
      }
      const clientSecret = requiresSetupAfterFirstInvoicePromo
        ? getSetupIntentClientSecretFromStripeSubscription(subscription)
        : getClientSecretFromStripeSubscription(subscription);
      await purchaseUrlVerificationCodeHandler.revokeCode({ tenancy, id: codeId });
      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: {
          client_secret: clientSecret,
          client_secret_type: requiresSetupAfterFirstInvoicePromo ? "setup" as const : "payment" as const,
        },
      };
    };

    if (conflictingSubscriptions.length > 0) {
      const conflicting = conflictingSubscriptions[0];
      const conflictingStripeSubscriptionId = conflicting.stripeSubscriptionId;
      if (conflictingStripeSubscriptionId) {
        const existingStripeSub = await stripe.subscriptions.retrieve(conflictingStripeSubscriptionId);
        const existingItem = existingStripeSub.items.data[0];
        const product = await stripe.products.create({ name: data.product.displayName ?? "Subscription" });
        const selectedInterval = selectedPrice.interval;
        if (selectedInterval) {
          const applicationFeePercent = getApplicationFeePercentOrUndefined(tenancy.project.id);
          // TODO(default-plans): $0 subs currently piggyback on the Stripe
          // subscription lifecycle. Once default plans land, free subs should be
          // granted directly (Prisma insert + bulldozer write, mirroring
          // ensureFreePlanForBillingTeam) and skip Stripe entirely.
          //
          const updated = await runSubscriptionWithPromoCouponCleanup({
            redemption: promoRedemption,
            failureReason: "stripe_subscription_update_failed",
            run: async (couponId) => await stripe.subscriptions.update(conflictingStripeSubscriptionId, {
              payment_behavior: 'default_incomplete',
              payment_settings: { save_default_payment_method: 'on_subscription' },
              expand: ['latest_invoice.confirmation_secret', 'pending_setup_intent'],
              items: [{
                id: existingItem.id,
                price_data: {
                  currency: "usd",
                  unit_amount: Number(selectedPrice.USD) * 100,
                  product: product.id,
                  recurring: {
                    interval_count: selectedInterval[0],
                    interval: selectedInterval[1],
                  },
                },
                quantity,
              }],
              metadata: {
                productId: data.productId ?? null,
                productVersionId,
                priceId: price_id,
                ...(promoRedemption ? promoRedemptionMetadata(promoRedemption) : {}),
              },
              ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
              ...(applicationFeePercent !== undefined ? { application_fee_percent: applicationFeePercent } : {}),
            }),
          });
          if (promoRedemption) {
            await attachStripeSubscriptionToPromoRedemption({
              prisma,
              tenancyId: tenancy.id,
              redemptionId: promoRedemption.redemptionId,
              stripeSubscriptionId: updated.id,
            });
          }
          return await finishSubscriptionResponse(updated);
        } else {
          await stripe.subscriptions.cancel(conflictingStripeSubscriptionId);
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
      const amountCents = effectiveAmountCents;
      if (promoRedemption && amountCents <= 0) {
        await voidExpiredOrFailedPromoCodeRedemption({
          prisma,
          tenancyId: tenancy.id,
          redemptionId: promoRedemption.redemptionId,
          reason: "discounted_one_time_total_zero",
        });
        throw new StatusError(400, "Promo code discounts this one-time purchase below the minimum charge amount.");
      }
      if (promoRedemption && amountCents < stripeOneTimeMin * 100) {
        await voidExpiredOrFailedPromoCodeRedemption({
          prisma,
          tenancyId: tenancy.id,
          redemptionId: promoRedemption.redemptionId,
          reason: "discounted_one_time_total_below_stripe_minimum",
        });
        throw new StatusError(400, `Discounted one-time total must be at least $${stripeOneTimeMin.toFixed(2)} (Stripe minimum).`);
      }
      const applicationFeeAmount = computeApplicationFeeAmount({
        amountStripeUnits: amountCents,
        projectId: tenancy.project.id,
      });
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        customer: stripeCustomerId,
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
          ...(promoRedemption ? promoRedemptionMetadata(promoRedemption) : {}),
        },
        ...(applicationFeeAmount > 0 ? { application_fee_amount: applicationFeeAmount } : {}),
      });
      if (promoRedemption) {
        await attachStripePaymentIntentToPromoRedemption({
          prisma,
          tenancyId: tenancy.id,
          redemptionId: promoRedemption.redemptionId,
          stripePaymentIntentId: paymentIntent.id,
        });
      }
      const clientSecret = paymentIntent.client_secret;
      if (typeof clientSecret !== "string") {
        throwErr(500, "No client secret returned from Stripe for payment intent");
      }
      await purchaseUrlVerificationCodeHandler.revokeCode({ tenancy, id: codeId });
      return { statusCode: 200, bodyType: "json", body: { client_secret: clientSecret, client_secret_type: "payment" as const } };
    }
    const subscriptionInterval = selectedPrice.interval;

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
    const created = await runSubscriptionWithPromoCouponCleanup({
      redemption: promoRedemption,
      failureReason: "stripe_subscription_create_failed",
      run: async (couponId) => await stripe.subscriptions.create({
        customer: stripeCustomerId,
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.confirmation_secret', 'pending_setup_intent'],
        items: [{
          price_data: {
            currency: "usd",
            unit_amount: Number(selectedPrice.USD) * 100,
            product: product.id,
            recurring: {
              interval_count: subscriptionInterval[0],
              interval: subscriptionInterval[1],
            },
          },
          quantity,
        }],
        metadata: {
          productId: data.productId ?? null,
          productVersionId,
          priceId: price_id,
          ...(promoRedemption ? promoRedemptionMetadata(promoRedemption) : {}),
        },
        ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
        ...(applicationFeePercent !== undefined ? { application_fee_percent: applicationFeePercent } : {}),
      }),
    });
    if (promoRedemption) {
      await attachStripeSubscriptionToPromoRedemption({
        prisma,
        tenancyId: tenancy.id,
        redemptionId: promoRedemption.redemptionId,
        stripeSubscriptionId: created.id,
      });
    }
    return await finishSubscriptionResponse(created);
  }
});
