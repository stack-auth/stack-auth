import { describe, expect, it } from "vitest";
import { calculateOriginalAmountUsdCents, createStripeCouponParamsForPromoCode, hashPromoCode, normalizePromoCode, type ReservedPromoCodeRedemption } from "./promo-codes";

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
      discountAmountUsdCents: 1000,
      finalAmountUsdCents: 1500,
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
});
