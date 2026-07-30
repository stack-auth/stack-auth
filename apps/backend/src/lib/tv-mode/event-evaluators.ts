export const TV_EVENT_EVALUATION_INTERVAL_MS = 60_000;
export const TV_EMAIL_CURRENT_WINDOW_MINUTES = 15;
export const TV_EMAIL_MATURITY_DELAY_MINUTES = 5;
export const TV_EMAIL_MINIMUM_FINISHED_SENDS = 50;
export const TV_USER_MILESTONES = [
  100,
  500,
  1_000,
  5_000,
  10_000,
  50_000,
  100_000,
  500_000,
  1_000_000,
] as const;

export type TvEmailEvaluatorState = {
  activeClass: "incident" | "critical-incident" | null,
  incidentBreachCount: number,
  criticalBreachCount: number,
  recoveryCount: number,
};

export type TvEmailEvaluationSample = {
  currentFinishedSends: number,
  currentDeliveredSends: number,
  comparisonFinishedSends: number,
  comparisonDeliveredSends: number,
};

export type TvEmailEvaluationAction =
  | { type: "none" }
  | { type: "activate", presentationClass: "incident" | "critical-incident" }
  | { type: "escalate", presentationClass: "critical-incident" }
  | { type: "resolve" };

export type TvEmailEvaluationResult = {
  state: TvEmailEvaluatorState,
  action: TvEmailEvaluationAction,
};

function deliveryRate(delivered: number, finished: number): number | null {
  return finished < TV_EMAIL_MINIMUM_FINISHED_SENDS ? null : delivered / finished * 100;
}

export function evaluateTvEmailDelivery(
  previous: TvEmailEvaluatorState,
  sample: TvEmailEvaluationSample | null,
): TvEmailEvaluationResult {
  if (sample == null) {
    return { state: previous, action: { type: "none" } };
  }
  const currentRate = deliveryRate(sample.currentDeliveredSends, sample.currentFinishedSends);
  const comparisonRate = deliveryRate(sample.comparisonDeliveredSends, sample.comparisonFinishedSends);
  if (currentRate == null) {
    return { state: previous, action: { type: "none" } };
  }

  const nonDelivered = sample.currentFinishedSends - sample.currentDeliveredSends;
  const incidentBreach = comparisonRate != null
    && currentRate < 95
    && comparisonRate - currentRate >= 5;
  const criticalBreach = currentRate < 80 && nonDelivered >= 10;
  const recovery = currentRate >= 97;
  const state: TvEmailEvaluatorState = {
    activeClass: previous.activeClass,
    incidentBreachCount: incidentBreach ? previous.incidentBreachCount + 1 : 0,
    criticalBreachCount: criticalBreach ? previous.criticalBreachCount + 1 : 0,
    recoveryCount: recovery ? previous.recoveryCount + 1 : 0,
  };

  if (previous.activeClass === "critical-incident") {
    if (state.recoveryCount >= 5) {
      return {
        state: { ...state, activeClass: null, recoveryCount: 0 },
        action: { type: "resolve" },
      };
    }
    return { state: { ...state, activeClass: "critical-incident" }, action: { type: "none" } };
  }
  if (state.criticalBreachCount >= 2) {
    return {
      state: { ...state, activeClass: "critical-incident", criticalBreachCount: 0, recoveryCount: 0 },
      action: previous.activeClass === "incident"
        ? { type: "escalate", presentationClass: "critical-incident" }
        : { type: "activate", presentationClass: "critical-incident" },
    };
  }
  if (previous.activeClass === "incident") {
    if (state.recoveryCount >= 5) {
      return {
        state: { ...state, activeClass: null, recoveryCount: 0 },
        action: { type: "resolve" },
      };
    }
    return { state: { ...state, activeClass: "incident" }, action: { type: "none" } };
  }
  if (state.incidentBreachCount >= 3) {
    return {
      state: { ...state, activeClass: "incident", incidentBreachCount: 0, recoveryCount: 0 },
      action: { type: "activate", presentationClass: "incident" },
    };
  }
  return { state, action: { type: "none" } };
}

export type TvUserMilestoneEvaluatorState = {
  baselineEstablished: boolean,
  highestConsumedThreshold: number,
  lastObservedTotal: number,
};

export type TvUserMilestoneEvaluationResult = {
  state: TvUserMilestoneEvaluatorState,
  crossedThreshold: number | null,
};

export function evaluateTvUserMilestone(
  previous: TvUserMilestoneEvaluatorState,
  totalUsers: number,
): TvUserMilestoneEvaluationResult {
  if (!previous.baselineEstablished) {
    const consumed = [...TV_USER_MILESTONES].reverse().find((threshold) => threshold <= totalUsers) ?? 0;
    return {
      state: {
        baselineEstablished: true,
        highestConsumedThreshold: consumed,
        lastObservedTotal: totalUsers,
      },
      crossedThreshold: null,
    };
  }
  const crossedThreshold = [...TV_USER_MILESTONES].reverse().find((threshold) => (
    threshold > previous.highestConsumedThreshold
    && threshold > previous.lastObservedTotal
    && threshold <= totalUsers
  )) ?? null;
  return {
    state: {
      baselineEstablished: true,
      highestConsumedThreshold: crossedThreshold ?? previous.highestConsumedThreshold,
      lastObservedTotal: totalUsers,
    },
    crossedThreshold,
  };
}
