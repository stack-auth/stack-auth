import { GrowthRunStatus, WorkflowRunState } from "@/generated/prisma/enums";
import type { Tenancy } from "@/lib/tenancies";
import { enqueueWorkflowEvent } from "@/lib/workflows/events";
import { globalPrismaClient } from "@/prisma-client";
import { runWorkflowEngineStep } from "@/lib/workflows/engine";
import { getGrowthAnalysisSnapshot, tickGrowthAnalysisRun } from "./orchestration";
import { GROWTH_ANALYSIS_WORKFLOW_ID } from "./workflow-sources";
import { ensureGrowthWorkflows, getGrowthAnalysisLegRunKeys, GROWTH_EVENT_TYPES } from "./workflows";

async function findActiveGrowthRun(tenancy: Tenancy) {
  return await globalPrismaClient.growthAnalysisRun.findFirst({
    where: {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      status: { in: [GrowthRunStatus.PENDING, GrowthRunStatus.RUNNING, GrowthRunStatus.AWAITING_INTERVIEW, GrowthRunStatus.COMPOSING_REPORT] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      status: true,
      trigger: true,
      interview: { select: { status: true } },
    },
  });
}

export async function hasPendingGrowthBoundaryEvent(options: {
  tenancyId: string,
  growthRunId: string,
  type: typeof GROWTH_EVENT_TYPES.analysisRunActivated | typeof GROWTH_EVENT_TYPES.interviewFinished,
}): Promise<boolean> {
  const event = await globalPrismaClient.workflowEvent.findFirst({
    where: {
      tenancyId: options.tenancyId,
      type: options.type,
      processedAt: null,
      payload: { path: ["growth_run_id"], equals: options.growthRunId },
    },
    select: { id: true },
  });
  return event != null;
}

/** Advances the selected project's active Growth run without touching the shared workflow engine. */
export async function runGrowthProjectAnalysisStep(tenancy: Tenancy): Promise<{ didWork: boolean }> {
  const run = await findActiveGrowthRun(tenancy);
  if (run == null) return { didWork: false };
  const scope = { projectId: tenancy.project.id, branchId: tenancy.branchId, runId: run.id };
  const before = await getGrowthAnalysisSnapshot(scope);
  const after = await tickGrowthAnalysisRun(scope);
  return { didWork: before?.fingerprint !== after?.fingerprint };
}

/**
 * How long the repair will keep driving the engine while waiting for the leg it just queued to
 * become a real workflow run. Sized against the route's `maxDuration = 300` with room to spare: one
 * step is normally enough (processWorkflowEvents materializes the event, and a QUEUED run already
 * counts as active), so this is a ceiling for a slow sandbox invocation, not an expected wait.
 */
const REPAIR_ENGINE_BUDGET_MS = 60_000;

/** The workflow run backing either leg of a growth analysis run, if one is currently live. */
async function findActiveGrowthLeg(tenancy: Tenancy, growthRunId: string) {
  return await globalPrismaClient.workflowRun.findFirst({
    where: {
      tenancyId: tenancy.id,
      workflowId: GROWTH_ANALYSIS_WORKFLOW_ID,
      runKey: { in: getGrowthAnalysisLegRunKeys(growthRunId) },
      state: { in: [WorkflowRunState.QUEUED, WorkflowRunState.RUNNING, WorkflowRunState.SLEEPING] },
    },
    select: { id: true },
  });
}

/**
 * Turns a queued boundary event into a running leg, which is the step the repair used to leave
 * undone.
 *
 * Enqueueing alone repairs nothing: only the workflow engine materializes an event into a
 * WorkflowRun, and the environments this endpoint exists for are precisely the ones with no cron
 * driving that engine — so the event could sit queued indefinitely while the UI reported success.
 *
 * Scoped to this tenancy on purpose. The unscoped engine step advances every project on the
 * deployment and blocks on their work; a repair button must not do that on someone else's behalf.
 *
 * Returns whether the leg was observed live before the budget ran out. A false here is not proof
 * the repair failed — the event stays durably queued — but it does mean we must not claim success.
 */
async function driveGrowthLegUntilActive(tenancy: Tenancy, growthRunId: string): Promise<boolean> {
  const startedAt = performance.now();
  // The engine takes an absolute wall-clock deadline (its own convention), while the loop below
  // measures elapsed time — hence both clocks appearing here.
  const engineDeadlineMs = Date.now() + REPAIR_ENGINE_BUDGET_MS;
  while (true) {
    // The shared cron worker, not scoped to this project: it also advances other tenancies' queued
    // events and due runs. Its `didWork` therefore says nothing about this project, which is why the
    // leg lookup below decides the outcome instead.
    const step = await runWorkflowEngineStep({ deadlineMs: engineDeadlineMs });
    if (await findActiveGrowthLeg(tenancy, growthRunId) != null) return true;
    if (performance.now() - startedAt >= REPAIR_ENGINE_BUDGET_MS) return false;
    // A step that moved nothing and produced no leg means we are waiting on something outside this
    // tenancy's queue (a retryAt backoff, a slow sandbox); spin slowly rather than hammering.
    if (!step.didWork) await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export type GrowthRepairResult = {
  readonly didWork: boolean,
  /**
   * Whether the analysis leg is live now. `null` when the repair had no leg to start — nothing was
   * missing, or the run is in a status with no leg of its own. Callers must not report a repair as
   * successful when this is `false`.
   */
  readonly legStarted: boolean | null,
};

export async function repairGrowthProject(tenancy: Tenancy): Promise<GrowthRepairResult> {
  let didWork = false;
  const workflowResults = await ensureGrowthWorkflows(tenancy);
  didWork = [...workflowResults.values()].some((result) => result.created) || didWork;

  const run = await findActiveGrowthRun(tenancy);
  if (run == null) return { didWork, legStarted: null };

  const leg = run.status === GrowthRunStatus.PENDING || run.status === GrowthRunStatus.RUNNING
    ? "activation"
    : run.status === GrowthRunStatus.AWAITING_INTERVIEW && (run.interview?.status === "completed" || run.interview?.status === "skipped")
      ? "interview"
      : run.status === GrowthRunStatus.COMPOSING_REPORT
        ? "interview"
        : null;
  if (leg == null) {
    const tick = await runGrowthProjectAnalysisStep(tenancy);
    return { didWork: tick.didWork || didWork, legStarted: null };
  }

  if (await findActiveGrowthLeg(tenancy, run.id) != null) {
    const tick = await runGrowthProjectAnalysisStep(tenancy);
    return { didWork: tick.didWork || didWork, legStarted: true };
  }

  const eventType = leg === "activation" ? GROWTH_EVENT_TYPES.analysisRunActivated : GROWTH_EVENT_TYPES.interviewFinished;
  // A boundary event is durable before its WorkflowRun is materialized, so a pending one means the
  // leg is already requested and only needs driving. Enqueueing a second event here can leave it
  // behind the original until after the first leg completes, at which point runKey's active-only
  // conflict check no longer dedupes it.
  if (!await hasPendingGrowthBoundaryEvent({ tenancyId: tenancy.id, growthRunId: run.id, type: eventType })) {
    await enqueueWorkflowEvent(globalPrismaClient, {
      tenancy,
      type: eventType,
      payload: leg === "activation" ? { growth_run_id: run.id, trigger: run.trigger } : { growth_run_id: run.id },
    });
  }

  // Both paths above leave an unprocessed boundary event, and an unprocessed event is not a repair.
  const legStarted = await driveGrowthLegUntilActive(tenancy, run.id);
  const tick = await runGrowthProjectAnalysisStep(tenancy);
  // Enqueueing deliberately does NOT count as work: it is the thing that used to make this endpoint
  // claim success while the run stayed exactly as broken as it was.
  return { didWork: legStarted || tick.didWork || didWork, legStarted };
}
