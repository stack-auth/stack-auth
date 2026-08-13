export const TV_EVENT_EVALUATION_INTERVAL_MS = 60_000;
export const TV_EMAIL_CURRENT_WINDOW_MINUTES = 15;
export const TV_EMAIL_LOW_VOLUME_WINDOW_MINUTES = 6 * 60;
export const TV_EMAIL_MATURITY_DELAY_MINUTES = 5;
export const TV_EMAIL_BASELINE_DAYS = 28;
export const TV_EMAIL_BASELINE_REFRESH_MS = 6 * 60 * 60 * 1000;
export const TV_EMAIL_BASELINE_STALE_MS = 12 * 60 * 60 * 1000;
export const TV_EMAIL_RECOVERY_TITLE = "Email Delivery Restored";
export const TV_EMAIL_RULE_VERSION = 2;
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

export type TvEmailPresentationClass = "incident" | "critical-incident";
export type TvEmailRulePath = "standard" | "low-volume" | "strict-standard" | "strict-low-volume" | "critical" | "high-impact";
export type TvEmailObservationStatus = "fresh" | "insufficient" | "stale" | "error";

export type TvEmailEvidenceWindow = {
  startsAt: string,
  endsAt: string,
  finishedSends: number,
  deliveredSends: number,
  bouncedSends: number,
  serverErrorSends: number,
  neutralOrUnknownSends: number,
  assessableSends: number,
  explicitFailures: number,
  deliveryRatePercent: number | null,
  explicitFailureRatePercent: number | null,
};

export type TvEmailBaseline = {
  startsAt: string,
  endsAt: string,
  computedAt: string,
  assessableSends: number,
  qualifiedDays: number,
  days: Array<{
    day: string,
    deliveredSends: number,
    explicitFailures: number,
    assessableSends: number,
    deliveryRatePercent: number,
  }>,
  medianDeliveryRatePercent: number | null,
};

export type TvEmailEvaluationSample = {
  status: TvEmailObservationStatus,
  evaluatedAt: string,
  observedAt: string | null,
  current: TvEmailEvidenceWindow | null,
  lowVolume: TvEmailEvidenceWindow | null,
  baseline: TvEmailBaseline | null,
};

type TvEmailCandidate = {
  rulePath: TvEmailRulePath,
  presentationClass: TvEmailPresentationClass,
  accumulatedMs: number,
  borderlineEvaluations: number,
};

type TvEmailRecoveryCandidate = {
  window: "current" | "low-volume",
  accumulatedMs: number,
};

export type TvEmailEvaluatorState = {
  ruleVersion: typeof TV_EMAIL_RULE_VERSION,
  activeClass: TvEmailPresentationClass | null,
  candidate: TvEmailCandidate | null,
  recovery: TvEmailRecoveryCandidate | null,
  lastFreshEvaluatedAt: string | null,
  baseline: TvEmailBaseline | null,
};

export type TvEmailEvaluationAction =
  | { type: "none" }
  | { type: "activate", presentationClass: TvEmailPresentationClass }
  | { type: "escalate", presentationClass: "critical-incident" }
  | { type: "resolve" };

export type TvEmailEvaluationResult = {
  state: TvEmailEvaluatorState,
  action: TvEmailEvaluationAction,
  qualification: TvEmailRulePath | "recovery" | null,
};

export function createTvEmailEvaluatorState(options?: {
  activeClass?: TvEmailPresentationClass | null,
  baseline?: TvEmailBaseline | null,
}): TvEmailEvaluatorState {
  return {
    ruleVersion: TV_EMAIL_RULE_VERSION,
    activeClass: options?.activeClass ?? null,
    candidate: null,
    recovery: null,
    lastFreshEvaluatedAt: null,
    baseline: options?.baseline ?? null,
  };
}

function percent(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator * 100;
}

function baselineIsQualified(baseline: TvEmailBaseline | null, evaluatedAt: Date): baseline is TvEmailBaseline & { medianDeliveryRatePercent: number } {
  return baseline?.medianDeliveryRatePercent != null
    && baseline.assessableSends >= 100
    && baseline.qualifiedDays >= 7
    && evaluatedAt.getTime() - new Date(baseline.computedAt).getTime() <= TV_EMAIL_BASELINE_STALE_MS;
}

type Breach = {
  rulePath: TvEmailRulePath,
  presentationClass: TvEmailPresentationClass,
  requiredMs: number,
};

function findBreach(sample: TvEmailEvaluationSample): Breach | null {
  if (sample.current == null || sample.lowVolume == null) return null;
  const evaluatedAt = new Date(sample.evaluatedAt);
  const baselineRate = baselineIsQualified(sample.baseline, evaluatedAt)
    ? sample.baseline.medianDeliveryRatePercent
    : null;
  const currentRate = sample.current.deliveryRatePercent;
  const lowVolumeRate = sample.lowVolume.deliveryRatePercent;

  if (
    sample.current.explicitFailures >= 50
    && (sample.current.explicitFailureRatePercent ?? 0) >= 10
  ) {
    return { rulePath: "high-impact", presentationClass: "critical-incident", requiredMs: 0 };
  }
  if (
    sample.current.assessableSends >= 20
    && sample.current.explicitFailures >= 10
    && currentRate != null
    && currentRate < 80
  ) {
    return { rulePath: "critical", presentationClass: "critical-incident", requiredMs: 60_000 };
  }
  if (baselineRate != null) {
    if (
      sample.current.assessableSends >= 50
      && sample.current.explicitFailures >= 5
      && currentRate != null
      && currentRate < 95
      && baselineRate - currentRate >= 5
    ) {
      return { rulePath: "standard", presentationClass: "incident", requiredMs: 3 * 60_000 };
    }
    if (
      sample.lowVolume.assessableSends >= 20
      && sample.lowVolume.explicitFailures >= 3
      && lowVolumeRate != null
      && lowVolumeRate < 85
      && baselineRate - lowVolumeRate >= 10
    ) {
      return { rulePath: "low-volume", presentationClass: "incident", requiredMs: 10 * 60_000 };
    }
    return null;
  }
  if (
    sample.current.assessableSends >= 50
    && sample.current.explicitFailures >= 10
    && currentRate != null
    && currentRate < 85
  ) {
    return { rulePath: "strict-standard", presentationClass: "incident", requiredMs: 5 * 60_000 };
  }
  if (
    sample.lowVolume.assessableSends >= 20
    && sample.lowVolume.explicitFailures >= 5
    && lowVolumeRate != null
    && lowVolumeRate < 75
  ) {
    return { rulePath: "strict-low-volume", presentationClass: "incident", requiredMs: 15 * 60_000 };
  }
  return null;
}

function recoveryWindow(sample: TvEmailEvaluationSample): "current" | "low-volume" | null {
  const baselineRate = baselineIsQualified(sample.baseline, new Date(sample.evaluatedAt))
    ? sample.baseline.medianDeliveryRatePercent
    : null;
  const qualifies = (window: TvEmailEvidenceWindow, minimum: number) => {
    if (window.assessableSends < minimum || window.deliveryRatePercent == null) return false;
    if (baselineRate == null) {
      return window.deliveryRatePercent >= 97 && (window.explicitFailureRatePercent ?? 100) <= 3;
    }
    const acceptableRate = Math.max(90, baselineRate - 2);
    const maximumFailures = Math.max(1, Math.floor(window.assessableSends * (100 - acceptableRate) / 100));
    return window.deliveryRatePercent >= acceptableRate && window.explicitFailures <= maximumFailures;
  };
  if (sample.current != null && sample.current.assessableSends >= 50) {
    return qualifies(sample.current, 50) ? "current" : null;
  }
  if (sample.lowVolume != null && qualifies(sample.lowVolume, 20)) return "low-volume";
  return null;
}

function clearlyHealthy(sample: TvEmailEvaluationSample): boolean {
  return recoveryWindow(sample) != null;
}

function freshIncrement(previous: TvEmailEvaluatorState, sample: TvEmailEvaluationSample): number {
  if (previous.lastFreshEvaluatedAt == null) return 0;
  const elapsed = new Date(sample.evaluatedAt).getTime() - new Date(previous.lastFreshEvaluatedAt).getTime();
  return Math.max(0, Math.min(elapsed, TV_EVENT_EVALUATION_INTERVAL_MS));
}

export function evaluateTvEmailDelivery(
  previous: TvEmailEvaluatorState,
  sample: TvEmailEvaluationSample,
): TvEmailEvaluationResult {
  const baseline = sample.baseline ?? previous.baseline;
  const stateWithBaseline = { ...previous, baseline };
  if (sample.status !== "fresh") {
    return previous.activeClass == null
      ? {
          state: { ...stateWithBaseline, candidate: null, lastFreshEvaluatedAt: null },
          action: { type: "none" },
          qualification: null,
        }
      : { state: stateWithBaseline, action: { type: "none" }, qualification: null };
  }

  const normalizedSample = { ...sample, baseline };
  const increment = freshIncrement(previous, normalizedSample);
  const breach = findBreach(normalizedSample);
  const nextFreshAt = sample.evaluatedAt;

  if (previous.activeClass === "critical-incident") {
    const recovery = recoveryWindow(normalizedSample);
    if (recovery == null) {
      return {
        state: {
          ...stateWithBaseline,
          activeClass: "critical-incident",
          recovery: breach == null ? previous.recovery : null,
          lastFreshEvaluatedAt: nextFreshAt,
        },
        action: { type: "none" },
        qualification: breach?.rulePath ?? null,
      };
    }
    const accumulatedMs = previous.recovery?.window === recovery
      ? previous.recovery.accumulatedMs + increment
      : 0;
    if (accumulatedMs >= (recovery === "current" ? 5 : 15) * 60_000) {
      return {
        state: { ...stateWithBaseline, activeClass: null, candidate: null, recovery: null, lastFreshEvaluatedAt: nextFreshAt },
        action: { type: "resolve" },
        qualification: "recovery",
      };
    }
    return {
      state: { ...stateWithBaseline, activeClass: "critical-incident", recovery: { window: recovery, accumulatedMs }, lastFreshEvaluatedAt: nextFreshAt },
      action: { type: "none" },
      qualification: "recovery",
    };
  }

  if (previous.activeClass === "incident") {
    if (breach?.presentationClass === "critical-incident") {
      const sameCandidate = previous.candidate?.rulePath === breach.rulePath;
      const accumulatedMs = sameCandidate && previous.candidate != null
        ? previous.candidate.accumulatedMs + increment
        : 0;
      if (accumulatedMs >= breach.requiredMs) {
        return {
          state: { ...stateWithBaseline, activeClass: "critical-incident", candidate: null, recovery: null, lastFreshEvaluatedAt: nextFreshAt },
          action: { type: "escalate", presentationClass: "critical-incident" },
          qualification: breach.rulePath,
        };
      }
      return {
        state: {
          ...stateWithBaseline,
          candidate: { ...breach, accumulatedMs, borderlineEvaluations: 0 },
          recovery: null,
          lastFreshEvaluatedAt: nextFreshAt,
        },
        action: { type: "none" },
        qualification: breach.rulePath,
      };
    }
    const recovery = recoveryWindow(normalizedSample);
    if (recovery == null) {
      const borderlineEvaluations = (previous.candidate?.borderlineEvaluations ?? 0) + 1;
      return {
        state: {
          ...stateWithBaseline,
          activeClass: "incident",
          candidate: breach == null && previous.candidate?.presentationClass === "critical-incident" && borderlineEvaluations <= 2
            ? { ...previous.candidate, borderlineEvaluations }
            : null,
          recovery: breach == null ? previous.recovery : null,
          lastFreshEvaluatedAt: nextFreshAt,
        },
        action: { type: "none" },
        qualification: breach?.rulePath ?? null,
      };
    }
    const accumulatedMs = previous.recovery?.window === recovery
      ? previous.recovery.accumulatedMs + increment
      : 0;
    if (accumulatedMs >= (recovery === "current" ? 5 : 15) * 60_000) {
      return {
        state: { ...stateWithBaseline, activeClass: null, candidate: null, recovery: null, lastFreshEvaluatedAt: nextFreshAt },
        action: { type: "resolve" },
        qualification: "recovery",
      };
    }
    return {
      state: { ...stateWithBaseline, activeClass: "incident", candidate: null, recovery: { window: recovery, accumulatedMs }, lastFreshEvaluatedAt: nextFreshAt },
      action: { type: "none" },
      qualification: "recovery",
    };
  }

  if (breach != null) {
    if (breach.requiredMs === 0) {
      return {
        state: { ...stateWithBaseline, activeClass: breach.presentationClass, candidate: null, recovery: null, lastFreshEvaluatedAt: nextFreshAt },
        action: { type: "activate", presentationClass: breach.presentationClass },
        qualification: breach.rulePath,
      };
    }
    const sameCandidate = previous.candidate?.rulePath === breach.rulePath;
    const accumulatedMs = sameCandidate && previous.candidate != null
      ? previous.candidate.accumulatedMs + increment
      : 0;
    if (accumulatedMs >= breach.requiredMs) {
      return {
        state: { ...stateWithBaseline, activeClass: breach.presentationClass, candidate: null, recovery: null, lastFreshEvaluatedAt: nextFreshAt },
        action: { type: "activate", presentationClass: breach.presentationClass },
        qualification: breach.rulePath,
      };
    }
    return {
      state: {
        ...stateWithBaseline,
        candidate: { ...breach, accumulatedMs, borderlineEvaluations: 0 },
        recovery: null,
        lastFreshEvaluatedAt: nextFreshAt,
      },
      action: { type: "none" },
      qualification: breach.rulePath,
    };
  }

  if (clearlyHealthy(normalizedSample)) {
    return {
      state: { ...stateWithBaseline, candidate: null, recovery: null, lastFreshEvaluatedAt: nextFreshAt },
      action: { type: "none" },
      qualification: null,
    };
  }
  const borderlineEvaluations = (previous.candidate?.borderlineEvaluations ?? 0) + 1;
  return {
    state: {
      ...stateWithBaseline,
      candidate: previous.candidate != null && borderlineEvaluations <= 2
        ? { ...previous.candidate, borderlineEvaluations }
        : null,
      recovery: null,
      lastFreshEvaluatedAt: nextFreshAt,
    },
    action: { type: "none" },
    qualification: null,
  };
}

export function calculateTvEmailEvidenceRate(delivered: number, failures: number): {
  assessableSends: number,
  deliveryRatePercent: number | null,
  explicitFailureRatePercent: number | null,
} {
  const assessableSends = delivered + failures;
  return {
    assessableSends,
    deliveryRatePercent: percent(delivered, assessableSends),
    explicitFailureRatePercent: percent(failures, assessableSends),
  };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
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
