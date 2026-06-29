import { describe, expect, it } from "vitest";
import { attachStripePaymentIntentToPromoRedemption, attachStripeSubscriptionToPromoRedemption, calculateOriginalAmountUsdCents, createStripeCouponParamsForPromoCode, hashPromoCode, normalizePromoCode, type ReservedPromoCodeRedemption } from "./promo-codes";

type PromoRedemptionAttachmentPrisma = Parameters<typeof attachStripePaymentIntentToPromoRedemption>[0]["prisma"];

function prismaWithExecuteRawResult(updatedCount: number): PromoRedemptionAttachmentPrisma {
  return {
    // The helper under test only needs `$executeRaw`; using the full Prisma type here
    // would make this unit test depend on an actual database connection.
    $executeRaw: async () => updatedCount,
  } as unknown as PromoRedemptionAttachmentPrisma;
}

describe("promo code helpers", () => {
  it("normalizes codes before hashing", () => {
    expect(normalizePromoCode(" summer  sale ")).toBe("SUMMERSALE");
    expect(hashPromoCode("summer sale")).toBe(hashPromoCode(" SUMMER   SALE "));
  });

  it("calculates original amount in integer cents", () => {
    expect(calculateOriginalAmountUsdCents({
      selectedPrice: { USD: "12.34" },
      quantity: 3,
    })).toBe(3702);
  });

  it("rejects invalid purchase quantities before calculating original amount", () => {
    for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => calculateOriginalAmountUsdCents({
        selectedPrice: { USD: "12.34" },
        quantity,
      })).toThrow("Quantity must be a positive integer.");
    }
  });

  it("creates percent-off Stripe coupons with once duration for first-invoice codes", () => {
    const quote: ReservedPromoCodeRedemption = {
      promoCodeId: "promo-id",
      redemptionId: "redemption-id",
      displayName: "Launch",
      discountType: "percent",
      percentOffBps: 2500,
      amountOffUsdCents: null,
      subscriptionDuration: "first_invoice",
      originalAmountUsdCents: 10000,
      discountAmountUsdCents: 2500,
      finalAmountUsdCents: 7500,
    };
    expect(createStripeCouponParamsForPromoCode({ quote, promoCode: " launch25 " })).toMatchInlineSnapshot(`
      {
        "duration": "once",
        "metadata": {
          "promoCodeId": "promo-id",
          "promoCodeRedemptionId": "redemption-id",
        },
        "name": "LAUNCH25",
        "percent_off": 25,
      }
    `);
  });

  it("creates amount-off Stripe coupons with forever duration", () => {
    const quote: ReservedPromoCodeRedemption = {
      promoCodeId: "promo-id",
      redemptionId: "redemption-id",
      displayName: null,
      discountType: "amount_off_usd",
      percentOffBps: null,
      amountOffUsdCents: 1000,
      subscriptionDuration: "forever",
      originalAmountUsdCents: 2500,
      discountAmountUsdCents: 250,
      finalAmountUsdCents: 2250,
    };
    expect(createStripeCouponParamsForPromoCode({ quote, promoCode: "save10" })).toMatchInlineSnapshot(`
      {
        "amount_off": 1000,
        "currency": "usd",
        "duration": "forever",
        "metadata": {
          "promoCodeId": "promo-id",
          "promoCodeRedemptionId": "redemption-id",
        },
        "name": "SAVE10",
      }
    `);
  });

  it("fails fast when attaching Stripe objects does not update exactly one redemption", async () => {
    await expect(attachStripePaymentIntentToPromoRedemption({
      prisma: prismaWithExecuteRawResult(0),
      tenancyId: "tenancy-id",
      redemptionId: "redemption-id",
      stripePaymentIntentId: "pi_test",
    })).rejects.toThrow("Expected to attach Stripe PaymentIntent to exactly one reserved promo redemption.");

    await expect(attachStripeSubscriptionToPromoRedemption({
      prisma: prismaWithExecuteRawResult(2),
      tenancyId: "tenancy-id",
      redemptionId: "redemption-id",
      stripeSubscriptionId: "sub_test",
    })).rejects.toThrow("Expected to attach Stripe subscription to exactly one reserved promo redemption.");
  });
});
