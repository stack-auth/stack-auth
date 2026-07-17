import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { getCanceledAtForSync, getEndedAtForSync } from "./stripe";

// Minimal cast: the helpers only read status / cancel_at_period_end /
// ended_at / canceled_at, and a newly-relied-on field would surface as a
// failing assertion here rather than a silent wrong value.
function stripeSub(fields: {
  status: Stripe.Subscription.Status,
  cancelAtPeriodEnd?: boolean,
  endedAtSeconds?: number | null,
  canceledAtSeconds?: number | null,
}): Stripe.Subscription {
  return {
    status: fields.status,
    cancel_at_period_end: fields.cancelAtPeriodEnd ?? false,
    ended_at: fields.endedAtSeconds ?? null,
    canceled_at: fields.canceledAtSeconds ?? null,
  } as unknown as Stripe.Subscription;
}

describe("getEndedAtForSync", () => {
  const periodEnd = new Date("2026-08-16T00:00:00Z");

  it("clears endedAt for a non-terminal sub without a pending cancel (reactivation path)", () => {
    expect(getEndedAtForSync(stripeSub({ status: "active" }), periodEnd)).toEqual({ endedAt: null });
  });

  it("schedules endedAt at Stripe's period end while a cancel is pending", () => {
    expect(getEndedAtForSync(stripeSub({ status: "active", cancelAtPeriodEnd: true }), periodEnd)).toEqual({ endedAt: periodEnd });
  });

  it("uses Stripe's ended_at for terminal subs", () => {
    const endedAtSeconds = 1_800_000_000;
    expect(getEndedAtForSync(stripeSub({ status: "canceled", endedAtSeconds }), periodEnd)).toEqual({ endedAt: new Date(endedAtSeconds * 1000) });
  });

  it("falls back to the past period boundary for terminal subs without ended_at", () => {
    const pastEnd = new Date(Date.now() - 86400000);
    expect(getEndedAtForSync(stripeSub({ status: "incomplete_expired" }), pastEnd)).toEqual({ endedAt: pastEnd });
  });

  it("falls back to now for terminal subs whose period end is still in the future", () => {
    const futureEnd = new Date(Date.now() + 86400000);
    const before = Date.now();
    const result = getEndedAtForSync(stripeSub({ status: "unpaid" }), futureEnd);
    expect(result.endedAt).not.toBeNull();
    expect(result.endedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.endedAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("getCanceledAtForSync", () => {
  it("mirrors Stripe's canceled_at", () => {
    const canceledAtSeconds = 1_800_000_000;
    expect(getCanceledAtForSync(stripeSub({ status: "active", canceledAtSeconds }))).toEqual({ canceledAt: new Date(canceledAtSeconds * 1000) });
  });

  it("clears canceledAt when Stripe's is null (reactivation path)", () => {
    expect(getCanceledAtForSync(stripeSub({ status: "active" }))).toEqual({ canceledAt: null });
  });
});
