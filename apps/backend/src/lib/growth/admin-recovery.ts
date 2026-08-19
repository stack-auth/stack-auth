import { GrowthRunStatus, WorkflowRunState } from "@/generated/prisma/enums";
import type { Tenancy } from "@/lib/tenancies";
import { enqueueWorkflowEvent } from "@/lib/workflows/events";
import { globalPrismaClient } from "@/prisma-client";
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

export async function repairGrowthProject(tenancy: Tenancy): Promise<{ didWork: boolean }> {
  let didWork = false;
  const workflowResults = await ensureGrowthWorkflows(tenancy);
  didWork = [...workflowResults.values()].some((result) => result.created) || didWork;

  const run = await findActiveGrowthRun(tenancy);
  if (run == null) return { didWork };

  const leg = run.status === GrowthRunStatus.PENDING || run.status === GrowthRunStatus.RUNNING
    ? "activation"
    : run.status === GrowthRunStatus.AWAITING_INTERVIEW && (run.interview?.status === "completed" || run.interview?.status === "skipped")
      ? "interview"
      : run.status === GrowthRunStatus.COMPOSING_REPORT
        ? "interview"
        : null;
  if (leg == null) {
    const tick = await runGrowthProjectAnalysisStep(tenancy);
    return { didWork: tick.didWork || didWork };
  }

  const activeLeg = await globalPrismaClient.workflowRun.findFirst({
    where: {
      tenancyId: tenancy.id,
      workflowId: GROWTH_ANALYSIS_WORKFLOW_ID,
      runKey: { in: getGrowthAnalysisLegRunKeys(run.id) },
      state: { in: [WorkflowRunState.QUEUED, WorkflowRunState.RUNNING, WorkflowRunState.SLEEPING] },
    },
    select: { id: true },
  });
  if (activeLeg != null) {
    const tick = await runGrowthProjectAnalysisStep(tenancy);
    return { didWork: tick.didWork || didWork };
  }

  const eventType = leg === "activation" ? GROWTH_EVENT_TYPES.analysisRunActivated : GROWTH_EVENT_TYPES.interviewFinished;
  // A boundary event is durable before its WorkflowRun is materialized. Treat that pending event
  // as an active leg: enqueueing a second event here can leave it behind the original until after
  // the first leg completes, at which point runKey's active-only conflict check no longer dedupes it.
  if (await hasPendingGrowthBoundaryEvent({ tenancyId: tenancy.id, growthRunId: run.id, type: eventType })) {
    const tick = await runGrowthProjectAnalysisStep(tenancy);
    return { didWork: tick.didWork || didWork };
  }

  const enqueued = await enqueueWorkflowEvent(globalPrismaClient, {
    tenancy,
    type: eventType,
    payload: leg === "activation" ? { growth_run_id: run.id, trigger: run.trigger } : { growth_run_id: run.id },
  });
  const tick = await runGrowthProjectAnalysisStep(tenancy);
  return { didWork: tick.didWork || enqueued != null || didWork };
}
