import { GrowthRunStatus, WorkflowRunState } from "@/generated/prisma/enums";
import { getSoleTenancyFromProjectBranch, type Tenancy } from "@/lib/tenancies";
import { deterministicWorkflowUuid, enqueueWorkflowEvent } from "@/lib/workflows/events";
import { globalPrismaClient } from "@/prisma-client";
import { captureError, HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { syncGrowthActionWorkflows } from "./action-workflow-sync";
import { isGrowthRunAwaitingIntegrations } from "./orchestration";
import { GROWTH_ANALYSIS_WORKFLOW_ID } from "./workflow-sources";
import { ensureGrowthWorkflows, getGrowthAnalysisLegRunKeys, GROWTH_EVENT_TYPES } from "./workflows";

/**
 * The Growth watchdog: a low-frequency cron sweep that keeps the event-driven
 * growth orchestration self-healing. Steady state it does NOTHING — the two
 * canonical workflows (lib/growth/workflow-sources.ts) drive every lifecycle
 * from boundary events. The watchdog only repairs the failure modes an
 * event-driven system cannot repair itself:
 *   1. missing workflow definitions (seeding failed, or the customer deleted
 *      one) — recreate them,
 *   2. active analysis runs with no live workflow leg (the event fired while
 *      the definition was missing, or the leg's run failed) — re-fire the
 *      boundary event,
 *   3. days whose brief never materialized (schedule missed while the
 *      workflow was deleted/broken) — fire the catch-up event,
 *   4. briefs wedged in "generating" — skip them,
 *   5. action-item ↔ workflow completion reconciliation (action-workflow-sync.ts).
 *
 * NOTHING MAY IMPORT THIS MODULE except the cron route that runs the sweep. The ad platform
 * integration adds a sub-step here that reaches into the spend-capable write seam, and that seam has
 * to stay unreachable from the machine-secret-authenticated route trees — an import edge from
 * anything those trees can reach into this file would make it reachable. Keeping the rule now means
 * that sub-step can be added without re-deriving it. (It is also why `getGrowthAnalysisLegRunKeys`
 * lives in workflows.ts rather than here.)
 */

export const GROWTH_WATCHDOG_RUN_GRACE_MS = 5 * 60_000;
/** Resurrection events self-rate-limit via a 10-minute deterministic-id bucket. */
export const GROWTH_WATCHDOG_EVENT_BUCKET_MS = 10 * 60_000;
/** Missed-brief catch-up only fires after 02:00 UTC, well clear of the 00:10 UTC schedule. */
export const GROWTH_BRIEF_CATCHUP_UTC_HOUR = 2;
export const GROWTH_BRIEF_STALE_GENERATING_MS = 3 * 60 * 60_000;

const ACTIVE_WORKFLOW_RUN_STATES = [WorkflowRunState.QUEUED, WorkflowRunState.RUNNING, WorkflowRunState.SLEEPING] as const;

// ── Pure helpers (unit-tested with explicit `now`) ───────────────────────────

/** The rollup target day: the last fully-elapsed UTC day, as "YYYY-MM-DD". */
export function yesterdayUtcDateString(now: Date): string {
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return yesterday.toISOString().slice(0, 10);
}

export type GrowthWatchdogLeg = "activation" | "interview";

type RunForLegSelection = {
  status: GrowthRunStatus,
  createdAt: Date,
  interviewStatus: string | null,
  interviewCompletedAt: Date | null,
  /**
   * Whether the run is blocked on the integrations phase — computed by the caller via
   * orchestration.ts's isGrowthRunAwaitingIntegrations over the run's phase rows. The current
   * orchestration policy auto-skips that phase, so this is retained for compatibility with the
   * snapshot/legacy flow but does not suppress watchdog recovery.
   */
  awaitingIntegrations: boolean,
};

/**
 * Which workflow leg SHOULD be driving this analysis run right now, or null
 * when the run is legitimately at rest (or too young to judge — the boundary
 * event may still be in the outbox, so a 5-minute grace period applies from
 * the moment the leg became necessary).
 */
export function selectGrowthWatchdogLeg(run: RunForLegSelection, now: Date): GrowthWatchdogLeg | null {
  const graceCutoffMs = now.getTime() - GROWTH_WATCHDOG_RUN_GRACE_MS;
  const interviewFinished = run.interviewStatus === "completed" || run.interviewStatus === "skipped";
  switch (run.status) {
    case GrowthRunStatus.PENDING:
    case GrowthRunStatus.RUNNING: {
      // Integrations is currently auto-skipped by the orchestration tick. An older run may still
      // have a pending row from before that policy, so let it fall through to the normal grace
      // period and re-fire its activation event; the next tick settles the row and continues the
      // run. The explicit integrations answer route remains available for the future flow.
      return run.createdAt.getTime() < graceCutoffMs ? "activation" : null;
    }
    case GrowthRunStatus.AWAITING_INTERVIEW: {
      if (!interviewFinished) return null; // resting on purpose: waiting for the user
      const finishedAtMs = (run.interviewCompletedAt ?? run.createdAt).getTime();
      return finishedAtMs < graceCutoffMs ? "interview" : null;
    }
    case GrowthRunStatus.COMPOSING_REPORT: {
      // The report side is driven by the interview-finished leg. A run can
      // only reach COMPOSING_REPORT after the interview finished, so the
      // completedAt fallback is defensive only.
      const finishedAtMs = (run.interviewCompletedAt ?? run.createdAt).getTime();
      return finishedAtMs < graceCutoffMs ? "interview" : null;
    }
    case GrowthRunStatus.COMPLETED:
    case GrowthRunStatus.FAILED:
    case GrowthRunStatus.CANCELLED: {
      return null;
    }
  }
}

/**
 * Deterministic event id for one (run, leg) resurrection attempt within a
 * 10-minute bucket: repeated sweeps inside the bucket re-insert the same id
 * (skipDuplicates makes them no-ops), so a broken leg is re-fired at most
 * every 10 minutes, and the workflow's onConflict "skip" makes even a genuine
 * over-fire harmless.
 */
export function getGrowthWatchdogResurrectionEventId(tenancyId: string, growthRunId: string, leg: GrowthWatchdogLeg, now: Date): string {
  const bucket = Math.floor(now.getTime() / GROWTH_WATCHDOG_EVENT_BUCKET_MS);
  return deterministicWorkflowUuid(`growth-watchdog:${tenancyId}:${growthRunId}:${leg}:${bucket}`);
}

/** Whether the missed-brief catch-up window for yesterday is open. */
export function isPastGrowthBriefCatchupHour(now: Date): boolean {
  return now.getUTCHours() >= GROWTH_BRIEF_CATCHUP_UTC_HOUR;
}

// ── Sweep ────────────────────────────────────────────────────────────────────

/**
 * Resolves the tenancy of a growth-active branch, with the growth-app gate
 * applied. Returns null (after a captured error for the gone-tenancy case)
 * when the branch should be skipped.
 */
async function findGrowthTenancy(cache: Map<string, Tenancy | null>, projectId: string, branchId: string): Promise<Tenancy | null> {
  const cacheKey = `${projectId}:${branchId}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  const tenancy = await getSoleTenancyFromProjectBranch(projectId, branchId, true);
  if (tenancy == null) {
    // Growth rows cascade on project deletion, so a missing tenancy means the
    // branch (or tenancy bookkeeping) disappeared out from under us — loud,
    // but it must not block other projects.
    captureError("growth-watchdog", new HexclaveAssertionError(`Growth data exists for project ${projectId} branch ${branchId} but its tenancy is gone`, { projectId, branchId }));
    cache.set(cacheKey, null);
    return null;
  }
  // Disabled app: nothing growth-related should run for the branch anymore.
  const result = tenancy.config.apps.installed["gtm"]?.enabled === true ? tenancy : null;
  cache.set(cacheKey, result);
  return result;
}

export async function runGrowthWatchdogSweep(options: { deadlineMs: number }): Promise<{ didWork: boolean }> {
  let didWork = false;
  const tenancyCache = new Map<string, Tenancy | null>();

  const subSteps: [name: string, subStep: () => Promise<boolean>][] = [
    ["ensureWorkflows", async () => await ensureWorkflowsForAllBranches(tenancyCache, options.deadlineMs)],
    ["resurrectOrphanedRuns", async () => await resurrectOrphanedRuns(tenancyCache, new Date(), options.deadlineMs)],
    ["catchUpMissedBriefs", async () => await catchUpMissedBriefs(tenancyCache, new Date(), options.deadlineMs)],
    ["skipStaleGeneratingBriefs", async () => await skipStaleGeneratingBriefs(new Date())],
    // The sweep borrows the watchdog's tenancy resolver so growth-app gating and the per-sweep
    // cache apply to it like every other sub-step.
    ["syncActionWorkflows", async () => (await syncGrowthActionWorkflows({ now: new Date(), deadlineMs: options.deadlineMs, findTenancy: async (projectId, branchId) => await findGrowthTenancy(tenancyCache, projectId, branchId) })).transitioned > 0],
  ];
  for (const [name, subStep] of subSteps) {
    if (Date.now() >= options.deadlineMs) break;
    try {
      didWork = (await subStep()) || didWork;
    } catch (error) {
      // One broken sub-step must not wedge the others: the watchdog is the
      // last line of self-healing, so log loudly and keep sweeping.
      captureError("growth-watchdog", new HexclaveAssertionError(`Growth watchdog sub-step ${name} failed`, { cause: error }));
    }
  }
  return { didWork };
}

/** Sub-step 1: recreate missing canonical workflow definitions per growth-active branch. */
async function ensureWorkflowsForAllBranches(tenancyCache: Map<string, Tenancy | null>, deadlineMs: number): Promise<boolean> {
  // The onboarding table is the growth-active set: exactly one row per branch
  // that ever completed growth onboarding, so iterating it is bounded by the
  // number of growth customers.
  const onboardings = await globalPrismaClient.growthOnboarding.findMany({
    select: { projectId: true, branchId: true },
  });
  let didWork = false;
  for (const { projectId, branchId } of onboardings) {
    if (Date.now() >= deadlineMs) break;
    try {
      const tenancy = await findGrowthTenancy(tenancyCache, projectId, branchId);
      if (tenancy == null) continue;
      const results = await ensureGrowthWorkflows(tenancy);
      didWork = [...results.values()].some((result) => result.created) || didWork;
    } catch (error) {
      captureError("growth-watchdog", new HexclaveAssertionError(`Growth watchdog failed to ensure workflows for project ${projectId} branch ${branchId}`, { cause: error, projectId, branchId }));
    }
  }
  return didWork;
}

/** Sub-step 2: re-fire the boundary event of active analysis runs that lost their workflow leg. */
async function resurrectOrphanedRuns(tenancyCache: Map<string, Tenancy | null>, now: Date, deadlineMs: number): Promise<boolean> {
  const activeRuns = await globalPrismaClient.growthAnalysisRun.findMany({
    where: {
      status: { in: [GrowthRunStatus.PENDING, GrowthRunStatus.RUNNING, GrowthRunStatus.AWAITING_INTERVIEW, GrowthRunStatus.COMPOSING_REPORT] },
    },
    select: {
      id: true,
      projectId: true,
      branchId: true,
      status: true,
      trigger: true,
      createdAt: true,
      interview: { select: { status: true, completedAt: true } },
      phases: { select: { phaseKey: true, status: true } },
    },
  });
  let didWork = false;
  for (const run of activeRuns) {
    if (Date.now() >= deadlineMs) break;
    try {
      const leg = selectGrowthWatchdogLeg({
        status: run.status,
        createdAt: run.createdAt,
        interviewStatus: run.interview?.status ?? null,
        interviewCompletedAt: run.interview?.completedAt ?? null,
        awaitingIntegrations: isGrowthRunAwaitingIntegrations(run.status, run.phases),
      }, now);
      if (leg == null) continue;
      const tenancy = await findGrowthTenancy(tenancyCache, run.projectId, run.branchId);
      if (tenancy == null) continue;
      // EITHER leg being active covers the run: the activation leg keeps
      // ticking until the run rests, so it advances the post-interview side
      // just as well as the interview leg would.
      const activeLeg = await globalPrismaClient.workflowRun.findFirst({
        where: {
          tenancyId: tenancy.id,
          workflowId: GROWTH_ANALYSIS_WORKFLOW_ID,
          runKey: { in: getGrowthAnalysisLegRunKeys(run.id) },
          state: { in: [...ACTIVE_WORKFLOW_RUN_STATES] },
        },
        select: { id: true },
      });
      if (activeLeg != null) continue;
      const enqueued = await enqueueWorkflowEvent(globalPrismaClient, {
        tenancy,
        type: leg === "activation" ? GROWTH_EVENT_TYPES.analysisRunActivated : GROWTH_EVENT_TYPES.interviewFinished,
        payload: leg === "activation" ? { growth_run_id: run.id, trigger: run.trigger } : { growth_run_id: run.id },
        eventId: getGrowthWatchdogResurrectionEventId(tenancy.id, run.id, leg, now),
      });
      didWork = enqueued != null || didWork;
    } catch (error) {
      captureError("growth-watchdog", new HexclaveAssertionError(`Growth watchdog failed to resurrect run ${run.id}`, { cause: error, runId: run.id }));
    }
  }
  return didWork;
}

/** Sub-step 3: fire the daily-brief catch-up event for branches whose yesterday brief never materialized. */
async function catchUpMissedBriefs(tenancyCache: Map<string, Tenancy | null>, now: Date, deadlineMs: number): Promise<boolean> {
  if (!isPastGrowthBriefCatchupHour(now)) return false;
  const dateString = yesterdayUtcDateString(now);
  // GrowthBrief.date is a @db.Date column; midnight-UTC Dates are its canonical Prisma representation.
  const date = new Date(`${dateString}T00:00:00.000Z`);
  const onboardings = await globalPrismaClient.growthOnboarding.findMany({
    select: { projectId: true, branchId: true },
  });
  let didWork = false;
  for (const { projectId, branchId } of onboardings) {
    if (Date.now() >= deadlineMs) break;
    try {
      const existingBrief = await globalPrismaClient.growthBrief.findUnique({
        where: { projectId_branchId_date: { projectId, branchId, date } },
        select: { id: true },
      });
      if (existingBrief != null) continue;
      const tenancy = await findGrowthTenancy(tenancyCache, projectId, branchId);
      if (tenancy == null) continue;
      // Deterministic per (tenancy, day): re-sweeps re-insert the same id
      // (no-op), and the workflow's "brief:<date>" runKey dedupes against a
      // schedule occurrence that raced us.
      const enqueued = await enqueueWorkflowEvent(globalPrismaClient, {
        tenancy,
        type: GROWTH_EVENT_TYPES.dailyBriefDue,
        payload: { date: dateString },
        eventId: deterministicWorkflowUuid(`growth-watchdog:brief:${tenancy.id}:${dateString}`),
      });
      didWork = enqueued != null || didWork;
    } catch (error) {
      captureError("growth-watchdog", new HexclaveAssertionError(`Growth watchdog missed-brief catch-up failed for project ${projectId} branch ${branchId}`, { cause: error, projectId, branchId }));
    }
  }
  return didWork;
}

/** Sub-step 4: skip briefs wedged in "generating" (agent died and the workflow leg failed too). */
async function skipStaleGeneratingBriefs(now: Date): Promise<boolean> {
  const skipped = await globalPrismaClient.growthBrief.updateMany({
    where: {
      status: "generating",
      createdAt: { lt: new Date(now.getTime() - GROWTH_BRIEF_STALE_GENERATING_MS) },
    },
    data: { status: "skipped" },
  });
  return skipped.count > 0;
}
