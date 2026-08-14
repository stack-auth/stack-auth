import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { getGrowthPhase, type GrowthPhase } from "./growth-status";
import type { GrowthStatus } from "./growth-types";

// The overview's vertical lifecycle timeline, top to bottom. The steps are a UI-level regrouping of
// the six lifecycle phases — "analyzing" and "analysis-failed" are both the analysis step (one
// current, one failed), and everything from the first daily brief onwards lives in the final
// "ongoing" step, which stays current forever (steady state has no "done").
//
// "compute-metrics" and "integrations" are first-class timeline points (user decision 2026-08-06:
// they must be their own steps before deep analysis, not blocks nested inside it). They are backed
// by real run phases, so their states come from `analysis.computeMetrics`/`analysis.integrations`
// rather than the positional phase index — with two fallbacks: before onboarding they render as
// upcoming previews (the wire blocks don't exist yet), and for runs predating the phases (null
// blocks on an onboarded workspace) they are "hidden" so old runs keep their original timeline.
export const GROWTH_TIMELINE_STEP_IDS = ["set-up", "compute-metrics", "integrations", "analysis", "interview", "report", "ongoing"] as const;
export type GrowthTimelineStepId = typeof GROWTH_TIMELINE_STEP_IDS[number];

export type GrowthTimelineStepState = "done" | "current" | "failed" | "upcoming" | "hidden";

/** The step the given phase renders as expanded (current or failed) on the timeline. */
const PHASE_STEP_INDEX = new Map<GrowthPhase, number>([
  ["not-onboarded", 0],
  ["analyzing", 3],
  ["analysis-failed", 3],
  ["interview", 4],
  ["report-ready", 5],
  ["steady-state", 6],
]);

const COMPUTE_METRICS_STEP_STATES = new Map<NonNullable<GrowthStatus["analysis"]["computeMetrics"]>["state"], GrowthTimelineStepState>([
  // "pending" still renders as the current step: the run exists and metrics are the very next thing
  // to happen, so an expanded "queued" card reads better than no current step at all.
  ["pending", "current"],
  ["running", "current"],
  ["done", "done"],
  ["failed", "failed"],
]);

const INTEGRATIONS_STEP_STATES = new Map<NonNullable<GrowthStatus["analysis"]["integrations"]>["state"], GrowthTimelineStepState>([
  ["pending", "upcoming"],
  ["waiting", "current"],
  ["connected", "done"],
  ["skipped", "done"],
]);

/**
 * Derives each timeline step's visual state from the status snapshot. At most one step is ever
 * `current`; done steps sit above it and upcoming steps below it. Keeping this a pure function of
 * GrowthStatus means the timeline can never disagree with `getGrowthPhase` about where in the
 * lifecycle the workspace is.
 */
export function getGrowthTimelineStepStates(status: GrowthStatus): Map<GrowthTimelineStepId, GrowthTimelineStepState> {
  const phase = getGrowthPhase(status);
  const currentIndex = PHASE_STEP_INDEX.get(phase) ?? throwErr(`PHASE_STEP_INDEX is missing an entry for growth phase ${phase}; it must cover every GROWTH_PHASES member`);
  const states = new Map<GrowthTimelineStepId, GrowthTimelineStepState>(GROWTH_TIMELINE_STEP_IDS.map((stepId, index) => {
    if (index < currentIndex) return [stepId, "done"];
    if (index > currentIndex) return [stepId, "upcoming"];
    return [stepId, phase === "analysis-failed" ? "failed" : "current"];
  }));

  // The two phase-backed steps override their positional guesses whenever the run reports them.
  // Before onboarding the positional "upcoming" is already right, so only onboarded workspaces need
  // refinement.
  if (status.onboarding.completed) {
    const computeMetrics = status.analysis.computeMetrics;
    const integrations = status.analysis.integrations;
    const computeMetricsState: GrowthTimelineStepState = computeMetrics == null
      ? "hidden"
      : (COMPUTE_METRICS_STEP_STATES.get(computeMetrics.state) ?? throwErr(`COMPUTE_METRICS_STEP_STATES is missing an entry for state ${computeMetrics.state}`));
    const integrationsState: GrowthTimelineStepState = integrations == null
      ? "hidden"
      : (INTEGRATIONS_STEP_STATES.get(integrations.state) ?? throwErr(`INTEGRATIONS_STEP_STATES is missing an entry for state ${integrations.state}`));
    states.set("compute-metrics", computeMetricsState);
    states.set("integrations", integrationsState);
    // While either early step is still in play, the deep analysis hasn't actually started — demote
    // it to upcoming so the timeline has one clear current step. Only the "analyzing" phase needs
    // this: in "analysis-failed" the analysis step keeps the failed state (it owns the retry
    // affordance), and in later phases both early steps are settled by construction.
    const isSettled = (state: GrowthTimelineStepState) => state === "done" || state === "hidden";
    if (phase === "analyzing" && (!isSettled(computeMetricsState) || !isSettled(integrationsState))) {
      states.set("analysis", "upcoming");
    }
  }
  return states;
}
