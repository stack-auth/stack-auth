import { describe, expect, it } from "vitest";
import {
  createTvPaymentEvaluatorState,
  evaluateTvSubscriptionCollection,
  selectTvSubscriptionInvoiceOutcome,
  type TvPaymentSample,
} from "./event-evaluators";

const now = new Date("2026-08-14T12:00:00.000Z");

function sample(options: { outcomes: number, failures: number, baseline?: number | null }): TvPaymentSample {
  const window = (hours: number) => ({
    startsAt: new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString(),
    endsAt: now.toISOString(),
    outcomes: options.outcomes,
    successes: options.outcomes - options.failures,
    failures: options.failures,
    successRatePercent: options.outcomes === 0 ? null : (options.outcomes - options.failures) / options.outcomes * 100,
  });
  return {
    status: "fresh",
    evaluatedAt: now.toISOString(),
    observedAt: now.toISOString(),
    current: window(24),
    lowVolume: window(14 * 24),
    baseline: options.baseline === undefined ? null : {
      computedAt: now.toISOString(),
      qualifiedWeeks: 4,
      assessableOutcomes: 40,
      medianSuccessRatePercent: options.baseline,
    },
  };
}

describe("subscription collection evaluator", () => {
  it("selects only the latest authoritative outcome with deterministic ties", () => {
    const failure = new Date("2026-08-13T10:00:00.000Z");
    const paid = new Date("2026-08-13T11:00:00.000Z");
    expect(selectTvSubscriptionInvoiceOutcome({ paidAt: paid, markedUncollectibleAt: failure, voidedAt: null })).toEqual({ type: "success", at: paid });
    expect(selectTvSubscriptionInvoiceOutcome({ paidAt: null, markedUncollectibleAt: failure, voidedAt: new Date("2026-08-13T12:00:00.000Z") })).toBeNull();
    expect(selectTvSubscriptionInvoiceOutcome({ paidAt: paid, markedUncollectibleAt: paid, voidedAt: paid })).toEqual({ type: "success", at: paid });
  });
  it("does not activate from one failed collection", () => {
    expect(evaluateTvSubscriptionCollection(createTvPaymentEvaluatorState(), sample({ outcomes: 1, failures: 1 })).action).toEqual({ type: "none" });
  });

  it("uses the strict fallback without qualified history", () => {
    const result = evaluateTvSubscriptionCollection(createTvPaymentEvaluatorState(), sample({ outcomes: 10, failures: 5 }));
    expect(result.qualification).toBe("strict");
    expect(result.action).toEqual({ type: "none" });
  });

  it("qualifies critical degradation relative to project history", () => {
    const result = evaluateTvSubscriptionCollection(createTvPaymentEvaluatorState(), sample({ outcomes: 10, failures: 5, baseline: 99 }));
    expect(result.qualification).toBe("critical");
    expect(result.state.candidate?.presentationClass).toBe("critical-incident");
  });

  it("freezes candidate accumulation for unavailable evidence", () => {
    const state = createTvPaymentEvaluatorState();
    state.candidate = { rulePath: "standard", presentationClass: "incident", accumulatedMs: 60_000 };
    const unavailable = { ...sample({ outcomes: 10, failures: 3, baseline: 99 }), status: "error" as const, current: null, lowVolume: null };
    expect(evaluateTvSubscriptionCollection(state, unavailable).state.candidate).toEqual(state.candidate);
  });

  it("freezes candidate accumulation for borderline fresh evidence", () => {
    const state = createTvPaymentEvaluatorState();
    state.candidate = { rulePath: "standard", presentationClass: "incident", accumulatedMs: 60_000 };
    expect(evaluateTvSubscriptionCollection(state, sample({ outcomes: 10, failures: 1, baseline: 99 })).state.candidate).toEqual(state.candidate);
  });
});
