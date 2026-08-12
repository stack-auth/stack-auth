import { describe, expect, it } from "vitest";
import {
  evaluateTvEmailDelivery,
  evaluateTvUserMilestone,
  TV_EMAIL_RECOVERY_TITLE,
  type TvEmailEvaluationSample,
  type TvEmailEvaluatorState,
  type TvUserMilestoneEvaluatorState,
} from "./event-evaluators";

const initialEmailState: TvEmailEvaluatorState = {
  activeClass: null,
  incidentBreachCount: 0,
  criticalBreachCount: 0,
  recoveryCount: 0,
};

function evaluateRepeatedly(
  count: number,
  sample: TvEmailEvaluationSample,
  initial = initialEmailState,
) {
  let state = initial;
  let action = evaluateTvEmailDelivery(state, sample).action;
  for (let index = 0; index < count; index += 1) {
    const result = evaluateTvEmailDelivery(state, sample);
    state = result.state;
    action = result.action;
  }
  return { state, action };
}

describe("email delivery TV event evaluator", () => {
  it("uses recovery-specific presentation copy for resolved occurrences", () => {
    expect(TV_EMAIL_RECOVERY_TITLE).toBe("Email Delivery Restored");
  });

  it("requires three qualifying incident evaluations", () => {
    const sample = {
      currentFinishedSends: 100,
      currentDeliveredSends: 90,
      comparisonFinishedSends: 100,
      comparisonDeliveredSends: 98,
    };
    expect(evaluateRepeatedly(2, sample).action).toEqual({ type: "none" });
    expect(evaluateRepeatedly(3, sample).action).toEqual({
      type: "activate",
      presentationClass: "incident",
    });
  });

  it("honors the incident rate, comparison-delta, and sample boundaries", () => {
    const atRateBoundary = {
      currentFinishedSends: 100,
      currentDeliveredSends: 95,
      comparisonFinishedSends: 100,
      comparisonDeliveredSends: 100,
    };
    expect(evaluateRepeatedly(3, atRateBoundary).action).toEqual({ type: "none" });

    const atDeltaBoundary = {
      currentFinishedSends: 100,
      currentDeliveredSends: 94,
      comparisonFinishedSends: 100,
      comparisonDeliveredSends: 99,
    };
    expect(evaluateRepeatedly(3, atDeltaBoundary).action).toEqual({
      type: "activate",
      presentationClass: "incident",
    });

    expect(evaluateRepeatedly(3, {
      ...atDeltaBoundary,
      comparisonFinishedSends: 49,
      comparisonDeliveredSends: 49,
    }).action).toEqual({ type: "none" });
  });

  it("requires two critical evaluations and escalates the same lifecycle", () => {
    const sample = {
      currentFinishedSends: 100,
      currentDeliveredSends: 75,
      comparisonFinishedSends: 100,
      comparisonDeliveredSends: 98,
    };
    const incidentState: TvEmailEvaluatorState = {
      ...initialEmailState,
      activeClass: "incident",
    };
    expect(evaluateRepeatedly(2, sample, incidentState).action).toEqual({
      type: "escalate",
      presentationClass: "critical-incident",
    });
  });

  it("does not classify the exact 80% critical boundary as Critical", () => {
    expect(evaluateRepeatedly(2, {
      currentFinishedSends: 50,
      currentDeliveredSends: 40,
      comparisonFinishedSends: 50,
      comparisonDeliveredSends: 49,
    }).action).toEqual({ type: "none" });
  });

  it("does not resolve from failed or insufficient samples", () => {
    const active: TvEmailEvaluatorState = {
      ...initialEmailState,
      activeClass: "critical-incident",
      recoveryCount: 4,
    };
    expect(evaluateTvEmailDelivery(active, null)).toEqual({
      state: active,
      action: { type: "none" },
    });
    expect(evaluateTvEmailDelivery(active, {
      currentFinishedSends: 49,
      currentDeliveredSends: 49,
      comparisonFinishedSends: 100,
      comparisonDeliveredSends: 98,
    })).toEqual({
      state: active,
      action: { type: "none" },
    });
  });

  it("resolves only after five qualifying recovery evaluations", () => {
    const active: TvEmailEvaluatorState = {
      ...initialEmailState,
      activeClass: "critical-incident",
    };
    const recovery = {
      currentFinishedSends: 100,
      currentDeliveredSends: 98,
      comparisonFinishedSends: 100,
      comparisonDeliveredSends: 90,
    };
    expect(evaluateRepeatedly(4, recovery, active).action).toEqual({ type: "none" });
    expect(evaluateRepeatedly(5, recovery, active).action).toEqual({ type: "resolve" });
  });

  it("resets recovery validation on relapse and never visibly downgrades Critical", () => {
    const recovering: TvEmailEvaluatorState = {
      ...initialEmailState,
      activeClass: "critical-incident",
      recoveryCount: 4,
    };
    const relapse = evaluateTvEmailDelivery(recovering, {
      currentFinishedSends: 100,
      currentDeliveredSends: 92,
      comparisonFinishedSends: 100,
      comparisonDeliveredSends: 98,
    });
    expect(relapse.state).toMatchObject({
      activeClass: "critical-incident",
      recoveryCount: 0,
    });
    expect(relapse.action).toEqual({ type: "none" });
  });
});

describe("user milestone TV event evaluator", () => {
  const initial: TvUserMilestoneEvaluatorState = {
    baselineEstablished: false,
    highestConsumedThreshold: 0,
    lastObservedTotal: 0,
  };

  it("establishes a baseline without replaying historical milestones", () => {
    expect(evaluateTvUserMilestone(initial, 12_000)).toEqual({
      state: {
        baselineEstablished: true,
        highestConsumedThreshold: 10_000,
        lastObservedTotal: 12_000,
      },
      crossedThreshold: null,
    });
  });

  it("emits only the highest threshold crossed together and never re-enables it after a decrease", () => {
    const established = evaluateTvUserMilestone(initial, 90).state;
    const crossed = evaluateTvUserMilestone(established, 5_400);
    expect(crossed.crossedThreshold).toBe(5_000);
    const decreased = evaluateTvUserMilestone(crossed.state, 400);
    expect(decreased.crossedThreshold).toBeNull();
    expect(evaluateTvUserMilestone(decreased.state, 4_900).crossedThreshold).toBeNull();
  });
});
