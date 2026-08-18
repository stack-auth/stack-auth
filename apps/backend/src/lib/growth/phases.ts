import { GrowthRunStatus } from "@/generated/prisma/enums";
import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { GROWTH_ANALYSIS_TOPICS } from "./analysis-topics";

/**
 * Phase keys are the unit of dispatch, retry, and resume for an analysis run. The backend creates one
 * GrowthAnalysisPhase row per key at run creation, so the DB — not the agent runtime — is the source of
 * truth for what must complete. Analysis-topic phases are derived from the analysis-topic registry as
 * `analysis:<id>`.
 *
 * The run-status vocabulary below lives here rather than in orchestration.ts so that both the
 * orchestration and the run-token auth path (run-token.ts) can share one definition of "this run is
 * still live" without importing each other — orchestration.ts already depends on run-token.ts to
 * mint, so the reverse edge would be a cycle.
 */

/**
 * The statuses in which an analysis run is still live: the orchestration may still advance it, and a
 * session dispatched for one of its phases may still act on its behalf. Anything else (COMPLETED,
 * FAILED, CANCELLED) is terminal.
 */
/**
 * What started a run. Lives here with the other run vocabulary rather than in dashboard.ts, for the
 * same reason GROWTH_ACTIVE_RUN_STATUSES does: dashboard.ts, interview.ts and report-release.ts all
 * need to validate a stored trigger, and report-release.ts is imported BY dashboard.ts — so keeping
 * the definition there would have made that edge a cycle.
 */
export const GROWTH_RUN_TRIGGERS = ["initial", "milestone", "manual"] as const;
export type GrowthRunTrigger = typeof GROWTH_RUN_TRIGGERS[number];

export function assertTriggerIsValid(trigger: string): GrowthRunTrigger {
  const match = GROWTH_RUN_TRIGGERS.find((candidate) => candidate === trigger);
  return match ?? throwErr(new HexclaveAssertionError(`GrowthAnalysisRun.trigger contained an unknown value "${trigger}" — runs are only ever created with a validated trigger, so this should be impossible.`));
}

export const GROWTH_ACTIVE_RUN_STATUSES: readonly GrowthRunStatus[] = [
  GrowthRunStatus.PENDING,
  GrowthRunStatus.RUNNING,
  GrowthRunStatus.AWAITING_INTERVIEW,
  GrowthRunStatus.COMPOSING_REPORT,
];

/**
 * The compute-metrics phase is executed by the backend itself (see orchestration.ts's
 * claimAndDispatchPhase), never dispatched to Eve. It runs before every other phase so the
 * ClickHouse growth metric store is fresh before data-analysis reads it.
 */
export const GROWTH_COMPUTE_METRICS_PHASE_KEY = "compute-metrics";
/**
 * The integrations phase is the optional "connect external services?" step between computing metrics
 * and the deep-analysis phases. It is never dispatched to Eve OR executed by the backend — for now
 * the orchestration tick auto-skips it after metrics settle. The phase and admin route remain in
 * place so the connection flow can be restored without changing the persisted run shape.
 */
export const GROWTH_INTEGRATIONS_PHASE_KEY = "integrations";
export const GROWTH_FIXED_PRE_INTERVIEW_PHASE_KEYS = ["website-research", "data-analysis"] as const;
export const GROWTH_INTERVIEW_QUESTIONS_PHASE_KEY = "interview-questions";
export const GROWTH_REPORT_PHASE_KEY = "report";

const FIXED_PHASE_LABELS = new Map<string, string>([
  [GROWTH_COMPUTE_METRICS_PHASE_KEY, "Computing metrics"],
  [GROWTH_INTEGRATIONS_PHASE_KEY, "Integrations"],
  ["website-research", "Website & competitor research"],
  ["data-analysis", "Data analysis"],
  [GROWTH_INTERVIEW_QUESTIONS_PHASE_KEY, "Interview preparation"],
  [GROWTH_REPORT_PHASE_KEY, "Report composition"],
]);

/**
 * Customer-facing "what does this step actually do" copy, shown on hover in the analysis checklist. Same
 * totality contract as FIXED_PHASE_LABELS: every key getInitialPhaseKeysForRun can produce must appear here
 * (pinned by phases.test.ts), and analysis-topic descriptions come from the topic registry instead.
 *
 * Two-to-three sentences, written in the reader's terms. These are the only explanation of the pipeline the
 * product offers, so they describe what each step PRODUCES, not merely what it looks at — that is what the
 * reader is deciding whether to wait for.
 */
const FIXED_PHASE_DESCRIPTIONS = new Map<string, string>([
  [GROWTH_COMPUTE_METRICS_PHASE_KEY, "Rolls up your product's daily numbers — signups, activation, retention, traffic, email and revenue — into a store the rest of the analysis can query. Everything after this reads from it, so recommendations are grounded in your real figures instead of estimates."],
  [GROWTH_INTEGRATIONS_PHASE_KEY, "Connects outside accounts such as Meta ads so the analysis can see spend and campaign performance next to your product data. Entirely optional — skipping it just means the analysis works from product data alone."],
  ["website-research", "Reads your landing page and the sites of comparable products to work out how you position yourself and where competitors are stronger. What it finds becomes the outside-in view every later step builds on."],
  ["data-analysis", "Mines your product analytics for the patterns behind the headline numbers: where signups come from, who activates, and who quietly drops off. It records the baselines that later recommendations are measured against."],
  [GROWTH_INTERVIEW_QUESTIONS_PHASE_KEY, "Turns everything the research could not observe from the outside into a short set of questions for you. Each one is grounded in something the analysis actually found on your site or in your data, so none of them are generic."],
  [GROWTH_REPORT_PHASE_KEY, "Combines every step's findings with your interview answers into a single report with prioritized recommendations. Anything concrete enough to act on becomes an item you can review and activate."],
]);

export function isGrowthAnalysisTopicPhaseKey(phaseKey: string): boolean {
  return phaseKey.startsWith("analysis:");
}

export function getGrowthPhaseLabel(phaseKey: string): string {
  if (isGrowthAnalysisTopicPhaseKey(phaseKey)) {
    const topicId = phaseKey.slice("analysis:".length);
    const topic = GROWTH_ANALYSIS_TOPICS.get(topicId);
    return topic == null
      ? throwErr(`Unknown growth analysis topic phase key "${phaseKey}" — phase rows are only ever created from the registry, so this row predates an analysis topic removal that should have migrated it.`)
      : topic.title;
  }
  return FIXED_PHASE_LABELS.get(phaseKey)
    ?? throwErr(`Unknown growth phase key "${phaseKey}" — phase rows are only ever created from getInitialPhaseKeysForRun, so this should be impossible.`);
}

export function getGrowthPhaseDescription(phaseKey: string): string {
  if (isGrowthAnalysisTopicPhaseKey(phaseKey)) {
    const topicId = phaseKey.slice("analysis:".length);
    const topic = GROWTH_ANALYSIS_TOPICS.get(topicId);
    return topic == null
      ? throwErr(`Unknown growth analysis topic phase key "${phaseKey}" — phase rows are only ever created from the registry, so this row predates an analysis topic removal that should have migrated it.`)
      : topic.description;
  }
  return FIXED_PHASE_DESCRIPTIONS.get(phaseKey)
    ?? throwErr(`Unknown growth phase key "${phaseKey}" — phase rows are only ever created from getInitialPhaseKeysForRun, so this should be impossible.`);
}

/**
 * Every phase a new analysis run must complete, in display order. The interview-questions phase depends on
 * all phases before it; the report phase additionally waits for the user to complete the interview (the
 * engine encodes those dependencies, this list only declares membership).
 */
export function getInitialPhaseKeysForRun(): string[] {
  return [
    GROWTH_COMPUTE_METRICS_PHASE_KEY,
    GROWTH_INTEGRATIONS_PHASE_KEY,
    ...GROWTH_FIXED_PRE_INTERVIEW_PHASE_KEYS,
    ...[...GROWTH_ANALYSIS_TOPICS.keys()].map((topicId) => `analysis:${topicId}`),
    GROWTH_INTERVIEW_QUESTIONS_PHASE_KEY,
    GROWTH_REPORT_PHASE_KEY,
  ];
}

const PHASE_DISPLAY_ORDER: ReadonlyMap<string, number> = new Map(
  getInitialPhaseKeysForRun().map((phaseKey, index) => [phaseKey, index]),
);

/**
 * A phase key's position in getInitialPhaseKeysForRun()'s declared display order, for sorting
 * PERSISTED phase rows back into it.
 *
 * WHY THIS IS NEEDED AT ALL: a run's phase rows are all inserted by one createMany inside one
 * transaction, and `createdAt` defaults to CURRENT_TIMESTAMP — which in Postgres is the TRANSACTION
 * start time, not the statement or row time. So every phase row of a run carries a byte-identical
 * timestamp (verified on a live run: 10 rows, 1 distinct `createdAt`). That makes the natural
 * `ORDER BY "createdAt"` a total tie, leaving the row order entirely up to the planner — in
 * practice heap order, which SHIFTS whenever a row is updated, because a non-HOT update writes the
 * new tuple version at the end of the heap.
 *
 * Phase rows are updated constantly (dispatch, start, a heartbeat every 60s, completion), so the
 * dashboard's analysis checklist visibly reshuffled between polls, and the one row nothing had
 * updated yet — `interview-questions`, the LAST phase to run — sat pinned at the top of the list.
 * Sorting by this index instead is stable by construction and needs no schema change.
 */
export function getGrowthPhaseDisplayIndex(phaseKey: string): number {
  return PHASE_DISPLAY_ORDER.get(phaseKey)
    ?? throwErr(`Unknown growth phase key "${phaseKey}" — phase rows are only ever created from getInitialPhaseKeysForRun, so this row predates a registry change that should have migrated it.`);
}
