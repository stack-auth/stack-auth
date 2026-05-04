// 0.9% of every Stripe money movement on a non-internal project is collected
// as a platform fee, ridden along via Stripe's native application_fee_*
// params on the PaymentIntent / Subscription. Refunds keep our charge-leg
// fee with the platform via `refund_application_fee: false` at the refund
// site — there is no separate refund-leg collection.
export const APPLICATION_FEE_BPS = 90;

const INTERNAL_PROJECT_ID = "internal";

export function getApplicationFeeBps(projectId: string): number {
  if (projectId === INTERNAL_PROJECT_ID) return 0;
  return APPLICATION_FEE_BPS;
}

export function computeApplicationFeeAmount(options: { amountStripeUnits: number, projectId: string }): number {
  const bps = getApplicationFeeBps(options.projectId);
  if (bps === 0) return 0;
  return Math.round(options.amountStripeUnits * bps / 10000);
}

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
  test("computeApplicationFeeAmount is 0.9% of the charge, rounded", ({ expect }) => {
    expect(computeApplicationFeeAmount({ amountStripeUnits: 10000, projectId: "p" })).toBe(90);
    expect(computeApplicationFeeAmount({ amountStripeUnits: 12345, projectId: "p" })).toBe(111);
    expect(computeApplicationFeeAmount({ amountStripeUnits: 500000, projectId: "p" })).toBe(4500);
  });
  test("computeApplicationFeeAmount is 0 for internal project", ({ expect }) => {
    expect(computeApplicationFeeAmount({ amountStripeUnits: 10000, projectId: "internal" })).toBe(0);
  });
  test("getApplicationFeePercentOrUndefined returns 0.9 for non-internal", ({ expect }) => {
    expect(getApplicationFeePercentOrUndefined("proj_abc")).toBe(0.9);
  });
  test("getApplicationFeePercentOrUndefined returns undefined for internal", ({ expect }) => {
    expect(getApplicationFeePercentOrUndefined("internal")).toBeUndefined();
  });
});
