import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";

// 0.9% of every Stripe money movement on a non-internal project is collected
// as a platform fee, ridden along via Stripe's native application_fee_*
// params on the PaymentIntent / Subscription. Refunds keep our charge-leg
// fee with the platform via `refund_application_fee: false` at the refund
// site — there is no separate refund-leg collection.
//
// Stored as basis points (1 bps = 1/10000 = 0.01%) instead of a decimal
// percentage so all fee math is integer arithmetic — `0.9 * 5000 / 100` is
// `45.000000000000004` in IEEE-754, but `90 * 5000 / 10000` is exactly `45`.
export const APPLICATION_FEE_BPS = 90;

export function getApplicationFeeBps(projectId: string): number {
  if (projectId === "internal") return 0;
  return APPLICATION_FEE_BPS;
}

/**
 * Half-to-nearest rounding. Stripe's `application_fee_amount` is an integer
 * in stripe-units, so we can't represent 0.9% exactly when the charge isn't
 * a multiple of $10. Round-nearest is unbiased on average — over many
 * charges the over- and under-rounding cancel — at the cost of producing a
 * 0 fee on charges in Stripe's min-charge band ($0.50–$0.55) where 0.9%
 * falls below half a cent. That clip-to-zero band is small enough to be
 * acceptable lost revenue; the alternative (ceil) over-collects on every
 * non-multiple-of-$10 charge, and a fractional-cents ledger is more
 * complexity than the precision is worth here.
 */
export function computeApplicationFeeAmount(options: { amountStripeUnits: number, projectId: string }): number {
  if (options.amountStripeUnits < 0) {
    throwErr("computeApplicationFeeAmount received negative amount", { amountStripeUnits: options.amountStripeUnits });
  }
  const bps = getApplicationFeeBps(options.projectId);
  if (bps === 0) return 0;
  return Math.round(options.amountStripeUnits * bps / 10000);
}

/**
 * Returns the fee as a decimal percent for Stripe's `application_fee_percent`
 * (subscription) parameter, or `undefined` for projects that aren't billed.
 *
 * `bps / 100` is intentional float division — the rest of the module uses
 * integer arithmetic to avoid IEEE-754 noise on charge-amount math, but the
 * subscription path requires a decimal because that's the shape Stripe's API
 * accepts. This is safe for the current 90 bps (→ 0.9, which serialises
 * cleanly), and any future bps value must produce a number with at most 4
 * decimal places after IEEE-754 rounding — that's the maximum precision
 * Stripe documents for `application_fee_percent`.
 */
export function getApplicationFeePercentOrUndefined(projectId: string): number | undefined {
  const bps = getApplicationFeeBps(projectId);
  if (bps === 0) return undefined;
  return bps / 100;
}

import.meta.vitest?.describe("platform fee helpers", (test) => {
  test("getApplicationFeeBps returns 0 for internal project", ({ expect }) => {
    expect(getApplicationFeeBps("internal")).toBe(0);
  });
  test("getApplicationFeeBps returns APPLICATION_FEE_BPS for any other project", ({ expect }) => {
    expect(getApplicationFeeBps("proj_abc123")).toBe(APPLICATION_FEE_BPS);
    expect(getApplicationFeeBps("some-uuid")).toBe(APPLICATION_FEE_BPS);
  });
  test("computeApplicationFeeAmount is 0.9% of the charge, rounded half-to-nearest", ({ expect }) => {
    expect(computeApplicationFeeAmount({ amountStripeUnits: 10000, projectId: "p" })).toBe(90);
    expect(computeApplicationFeeAmount({ amountStripeUnits: 12345, projectId: "p" })).toBe(111);
    expect(computeApplicationFeeAmount({ amountStripeUnits: 500000, projectId: "p" })).toBe(4500);
  });
  test("computeApplicationFeeAmount clips to 0 below the half-cent threshold (~$0.56)", ({ expect }) => {
    // Documented tradeoff: charges in Stripe's min-charge band whose 0.9%
    // is under half a cent round to a 0 fee. Pinned here so a future reader
    // doesn't accidentally "fix" the clipping without weighing the
    // alternatives (see the JSDoc on computeApplicationFeeAmount).
    expect(computeApplicationFeeAmount({ amountStripeUnits: 50, projectId: "p" })).toBe(0);
    expect(computeApplicationFeeAmount({ amountStripeUnits: 55, projectId: "p" })).toBe(0);
    expect(computeApplicationFeeAmount({ amountStripeUnits: 56, projectId: "p" })).toBe(1);
  });
  test("computeApplicationFeeAmount is 0 for internal project even on large charges", ({ expect }) => {
    expect(computeApplicationFeeAmount({ amountStripeUnits: 10000, projectId: "internal" })).toBe(0);
  });
  test("computeApplicationFeeAmount throws on negative amounts", ({ expect }) => {
    expect(() => computeApplicationFeeAmount({ amountStripeUnits: -1, projectId: "p" })).toThrow(/negative amount/);
  });
  test("getApplicationFeePercentOrUndefined returns 0.9 for non-internal", ({ expect }) => {
    expect(getApplicationFeePercentOrUndefined("proj_abc")).toBe(0.9);
  });
  test("getApplicationFeePercentOrUndefined returns undefined for internal", ({ expect }) => {
    expect(getApplicationFeePercentOrUndefined("internal")).toBeUndefined();
  });
});
