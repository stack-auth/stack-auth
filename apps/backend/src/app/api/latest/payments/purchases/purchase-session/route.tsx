import { SubscriptionStatus } from "@/generated/prisma/client";
import { assertFreeTrialAllowedForPurchase, getClientSecretFromStripeSubscription, getEffectiveFreeTrial, getStripeTrialPeriodDays, validatePurchaseSession } from "@/lib/payments";
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
import { moneyAmountSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { SUPPORTED_CURRENCIES, type MoneyAmount } from "@hexclave/shared/dist/utils/currency-constants";
import { moneyAmountToStripeUnits } from "@hexclave/shared/dist/utils/currencies";
import { captureError, HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { Result } from "@hexclave/shared/dist/utils/results";
import Stripe from "stripe";
import { purchaseUrlVerificationCodeHandler } from "../verification-code-handler";

const USD_CURRENCY = SUPPORTED_CURRENCIES.find((currency) => currency.code === "USD")
  ?? throwErr("USD currency configuration missing in SUPPORTED_CURRENCIES");

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
          description: "The Hexclave price ID to purchase",
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
          description: "Stripe client secret used by the browser to confirm payment or setup via Stripe Elements. Omitted when no confirmation step is required from the customer.",
          exampleValue: "1234567890abcdef_secret_xyz123",
        },
      }),
      stripe_intent_type: yupString().oneOf(["payment", "setup"]).optional().meta({
        openapiField: {
          description: "Whether client_secret is a PaymentIntent (immediate charge) or SetupIntent (e.g. free trial card collection). Omitted when client_secret is omitted.",
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

    // Validate up-front so a malformed config returns 400 instead of letting
    // moneyAmountToStripeUnits throw a yup ValidationError that becomes a 500.
    // Also never use `Number(USD) * 100` — e.g. 79.99 → 7998.999999999999 and
    // Stripe rejects with parameter_invalid_integer.
    if (selectedPrice.USD == null || !moneyAmountSchema(USD_CURRENCY).defined().isValidSync(selectedPrice.USD)) {
      throw new StatusError(400, `Price amount must be a finite, non-negative number (got ${JSON.stringify(selectedPrice.USD)})`);
    }
    const unitAmountStripeUnits = moneyAmountToStripeUnits(selectedPrice.USD as MoneyAmount, USD_CURRENCY);
    // TODO(default-plans): when default/free plans become first-class, route
    // these directly via an ensureDefaultPlan-style grant instead of forcing
    // callers to configure an interval just to make Stripe happy.
    const isFreePrice = unitAmountStripeUnits === 0;
    if (isFreePrice && !selectedPrice.interval) {
      throw new StatusError(400, "Free products must have a billing interval");
    }
    // Mirror Stripe's per-currency one-time minimum (shared with the dashboard
    // UI via stack-shared/payments/stripe-limits so the two can't drift apart)
    // and return a clean 400 instead of a raw Stripe error at
    // PaymentIntent.create time. Recurring sub items don't have this minimum
    // (handled above for the $0 case).
    const stripeOneTimeMin = getStripeOneTimeMinAmount('USD');
    const minOneTimeStripeUnits = moneyAmountToStripeUnits(
      stripeOneTimeMin.toFixed(USD_CURRENCY.decimals) as MoneyAmount,
      USD_CURRENCY,
    );
    if (!selectedPrice.interval && unitAmountStripeUnits > 0 && unitAmountStripeUnits < minOneTimeStripeUnits) {
      throw new StatusError(400, `One-time prices must be at least $${stripeOneTimeMin.toFixed(2)} (Stripe minimum)`);
    }

    // Validate free-trial configuration before reserving a promo redemption so
    // an invalid purchase cannot consume redemption capacity.
    const effectiveFreeTrial = getEffectiveFreeTrial(data.product, selectedPrice);
    assertFreeTrialAllowedForPurchase(selectedPrice, effectiveFreeTrial);
    const trialPeriodDays = effectiveFreeTrial != null ? getStripeTrialPeriodDays(effectiveFreeTrial) : undefined;
    const shouldExpectSetupIntent = effectiveFreeTrial != null;

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
    const originalAmountStripeUnits = unitAmountStripeUnits * quantity;
    const effectiveAmountStripeUnits = promoRedemption?.finalAmountUsdCents ?? originalAmountStripeUnits;
    const isForeverFreeAfterPromo = promoRedemption?.finalAmountUsdCents === 0 && promoRedemption.subscriptionDuration === "forever";
    const requiresSetupAfterFirstInvoicePromo = promoRedemption?.finalAmountUsdCents === 0 && promoRedemption.subscriptionDuration === "first_invoice";

    const promoStripeIdempotencyKey = (operation: string, redemption: ReservedPromoCodeRedemption) =>
      `promo:${tenancy.id}:${codeId}:${redemption.redemptionId}:${operation}`;

    const isAmbiguousStripeFailure = (error: unknown) =>
      error instanceof Stripe.errors.StripeConnectionError
      || error instanceof Stripe.errors.StripeAPIError
      || error instanceof Stripe.errors.StripeRateLimitError
      || error instanceof Stripe.errors.StripeIdempotencyError;

    const captureAmbiguousStripePromoFailure = (location: string, error: unknown, redemption: ReservedPromoCodeRedemption, couponId: string | null) => {
      captureError(location, new HexclaveAssertionError("Ambiguous Stripe failure while processing promo subscription checkout; preserving local promo state for reconciliation.", {
        tenancyId: tenancy.id,
        redemptionId: redemption.redemptionId,
        promoCodeId: redemption.promoCodeId,
        couponId,
        cause: error,
      }));
    };

    const createPromoCoupon = async (redemption: ReservedPromoCodeRedemption) => {
      const coupon = await stripe.coupons.create(createStripeCouponParamsForPromoCode({
        quote: redemption,
        promoCode: promo_code ?? "",
      }), { idempotencyKey: promoStripeIdempotencyKey("coupon-create", redemption) });
      return coupon.id;
    };

    const voidPromoRedemptionAfterSubscriptionFailure = async (redemption: ReservedPromoCodeRedemption | null, reason: string) => {
      if (!redemption) return;
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
      operation: "subscription-create" | "subscription-update",
      run: (couponId: string | null, idempotencyKey: string | undefined) => Promise<T>,
    }): Promise<T> => {
      let couponId: string | null = null;
      if (options.redemption) {
        const couponResult = await Result.fromPromise(createPromoCoupon(options.redemption));
        if (couponResult.status === "error") {
          if (isAmbiguousStripeFailure(couponResult.error)) {
            captureAmbiguousStripePromoFailure("promo-stripe-coupon-create-ambiguous", couponResult.error, options.redemption, null);
          } else {
            await voidPromoRedemptionAfterSubscriptionFailure(options.redemption, options.failureReason);
          }
          throw couponResult.error;
        }
        couponId = couponResult.data;
      }
      const result = await Result.fromPromise(options.run(
        couponId,
        options.redemption ? promoStripeIdempotencyKey(options.operation, options.redemption) : undefined,
      ));
      if (result.status === "ok") return result.data;
      if (options.redemption && isAmbiguousStripeFailure(result.error)) {
        captureAmbiguousStripePromoFailure("promo-stripe-subscription-ambiguous", result.error, options.redemption, couponId);
        throw result.error;
      }
      if (couponId) {
        const deleteResult = await Result.fromPromise(stripe.coupons.del(couponId));
        if (deleteResult.status === "error") captureError("promo-stripe-coupon-cleanup-failed", deleteResult.error);
      }
      await voidPromoRedemptionAfterSubscriptionFailure(options.redemption, options.failureReason);
      throw result.error;
    };

    const finishSubscriptionResponse = async (subscription: Stripe.Subscription, expectsSetupIntent: boolean) => {
      if (isFreePrice || isForeverFreeAfterPromo) {
        await purchaseUrlVerificationCodeHandler.revokeCode({ tenancy, id: codeId });
        return { statusCode: 200, bodyType: "json" as const, body: {} };
      }
      const clientSecretResult = getClientSecretFromStripeSubscription(subscription, expectsSetupIntent);
      await purchaseUrlVerificationCodeHandler.revokeCode({ tenancy, id: codeId });
      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: {
          client_secret: clientSecretResult.clientSecret,
          stripe_intent_type: clientSecretResult.type,
        },
      };
    };

    if (conflictingSubscriptions.length > 0) {
      const conflicting = conflictingSubscriptions[0];
      if (conflicting.stripeSubscriptionId) {
        const existingStripeSub = await stripe.subscriptions.retrieve(conflicting.stripeSubscriptionId);
        const existingItem = existingStripeSub.items.data[0];
        const product = await stripe.products.create({ name: data.product.displayName ?? "Subscription" });
        if (selectedPrice.interval) {
          const selectedInterval = selectedPrice.interval;
          const applicationFeePercent = getApplicationFeePercentOrUndefined(tenancy.project.id);
          // TODO(default-plans): $0 subs currently piggyback on the Stripe
          // subscription lifecycle. Once default plans land, free subs should be
          // granted directly (Prisma insert + bulldozer write, mirroring
          // ensureFreePlanForBillingTeam) and skip Stripe entirely.
          //
          // Do not attach trial_period_days on in-place subscription updates
          // (plan switch / conflict replace): re-trialing an existing customer
          // is usually wrong. Trials only apply when creating a new Stripe sub.
          const updated = await runSubscriptionWithPromoCouponCleanup({
            redemption: promoRedemption,
            failureReason: "stripe_subscription_update_failed",
            operation: "subscription-update",
            run: async (couponId, idempotencyKey) => await stripe.subscriptions.update(conflicting.stripeSubscriptionId ?? throwErr("Expected conflicting Stripe subscription id"), {
              payment_behavior: 'default_incomplete',
              payment_settings: { save_default_payment_method: 'on_subscription' },
              // Expand nested objects so we get client_secret fields (otherwise
              // Stripe returns id strings for pending_setup_intent / latest_invoice).
              expand: ['latest_invoice.confirmation_secret', 'pending_setup_intent'],
              items: [{
                id: existingItem.id,
                price_data: {
                  currency: "usd",
                  unit_amount: unitAmountStripeUnits,
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
            }, idempotencyKey ? { idempotencyKey } : undefined),
          });
          if (promoRedemption) {
            await attachStripeSubscriptionToPromoRedemption({
              prisma,
              tenancyId: tenancy.id,
              redemptionId: promoRedemption.redemptionId,
              stripeSubscriptionId: updated.id,
            });
          }
          // Conflict updates never start a configured free trial, but a 100%
          // first-invoice promo still needs a SetupIntent for future renewals.
          return await finishSubscriptionResponse(updated, requiresSetupAfterFirstInvoicePromo);
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
        await bulldozerWriteSubscription(updatedConflicting);
      }
    }
    // One-time payment path after conflicts handled
    if (!selectedPrice.interval) {
      const amountCents = effectiveAmountStripeUnits;
      if (promoRedemption && amountCents <= 0) {
        await voidExpiredOrFailedPromoCodeRedemption({
          prisma,
          tenancyId: tenancy.id,
          redemptionId: promoRedemption.redemptionId,
          reason: "discounted_one_time_total_zero",
        });
        throw new StatusError(400, "Promo code discounts this one-time purchase below the minimum charge amount.");
      }
      if (promoRedemption && amountCents < minOneTimeStripeUnits) {
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
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          client_secret: clientSecret,
          stripe_intent_type: "payment" as const,
        },
      };
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
    //
    // Free trials: pass trial_period_days so the first invoice is $0 and
    // Stripe attaches pending_setup_intent for card collection instead of a
    // PaymentIntent. Charge happens automatically when the trial ends.
    const created = await runSubscriptionWithPromoCouponCleanup({
      redemption: promoRedemption,
      failureReason: "stripe_subscription_create_failed",
      operation: "subscription-create",
      run: async (couponId, idempotencyKey) => await stripe.subscriptions.create({
        customer: stripeCustomerId,
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        // Expand nested objects so we get client_secret fields (otherwise
        // Stripe returns id strings for pending_setup_intent / latest_invoice).
        expand: ['latest_invoice.confirmation_secret', 'pending_setup_intent'],
        items: [{
          price_data: {
            currency: "usd",
            unit_amount: unitAmountStripeUnits,
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
        ...(trialPeriodDays !== undefined ? { trial_period_days: trialPeriodDays } : {}),
        ...(applicationFeePercent !== undefined ? { application_fee_percent: applicationFeePercent } : {}),
      }, idempotencyKey ? { idempotencyKey } : undefined),
    });
    if (promoRedemption) {
      await attachStripeSubscriptionToPromoRedemption({
        prisma,
        tenancyId: tenancy.id,
        redemptionId: promoRedemption.redemptionId,
        stripeSubscriptionId: created.id,
      });
    }
    return await finishSubscriptionResponse(created, shouldExpectSetupIntent || requiresSetupAfterFirstInvoicePromo);
  }
});
