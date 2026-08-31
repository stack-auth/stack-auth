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

const REPAIR_ENGINE_BUDGET_MS = 60_000;

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

async function driveGrowthLegUntilActive(tenancy: Tenancy, growthRunId: string): Promise<boolean> {
  const startedAt = performance.now();
  const engineDeadlineMs = Date.now() + REPAIR_ENGINE_BUDGET_MS;
  while (true) {
    const step = await runWorkflowEngineStep({ deadlineMs: engineDeadlineMs });
    if (await findActiveGrowthLeg(tenancy, growthRunId) != null) return true;
    if (performance.now() - startedAt >= REPAIR_ENGINE_BUDGET_MS) return false;
    if (!step.didWork) await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export type GrowthRepairResult = {
  readonly didWork: boolean,
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
  if (!await hasPendingGrowthBoundaryEvent({ tenancyId: tenancy.id, growthRunId: run.id, type: eventType })) {
    await enqueueWorkflowEvent(globalPrismaClient, {
      tenancy,
      type: eventType,
      payload: leg === "activation" ? { growth_run_id: run.id, trigger: run.trigger } : { growth_run_id: run.id },
    });
  }

  const legStarted = await driveGrowthLegUntilActive(tenancy, run.id);
  const tick = await runGrowthProjectAnalysisStep(tenancy);
  return { didWork: legStarted || tick.didWork || didWork, legStarted };
}
