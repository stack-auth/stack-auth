import { GrowthRunStatus, WorkflowRunState } from "@/generated/prisma/enums";
import type { Tenancy } from "@/lib/tenancies";
import { runWorkflowEngineStep } from "@/lib/workflows/engine";
import { enqueueWorkflowEvent } from "@/lib/workflows/events";
import { globalPrismaClient } from "@/prisma-client";
import { getGrowthAnalysisSnapshot, tickGrowthAnalysisRun } from "./orchestration";
import { GROWTH_ANALYSIS_WORKFLOW_ID } from "./workflow-sources";
import { ensureGrowthWorkflows, getGrowthAnalysisLegRunKeys, GROWTH_EVENT_TYPES } from "./workflows";

const GROWTH_RECOVERY_ENGINE_BUDGET_MS = 60_000;

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
  let enqueued = false;
  if (leg != null) {
    const activeLeg = await globalPrismaClient.workflowRun.findFirst({
      where: {
        tenancyId: tenancy.id,
        workflowId: GROWTH_ANALYSIS_WORKFLOW_ID,
        runKey: { in: getGrowthAnalysisLegRunKeys(run.id) },
        state: { in: [WorkflowRunState.QUEUED, WorkflowRunState.RUNNING, WorkflowRunState.SLEEPING] },
      },
      select: { id: true },
    });
    const eventType = leg === "activation" ? GROWTH_EVENT_TYPES.analysisRunActivated : GROWTH_EVENT_TYPES.interviewFinished;
    // A boundary event is durable before its WorkflowRun is materialized. Treat that pending event
    // as an active leg: enqueueing a second event here can leave it behind the original until after
    // the first leg completes, at which point runKey's active-only conflict check no longer dedupes it.
    const pendingEvent = activeLeg == null && await hasPendingGrowthBoundaryEvent({
      tenancyId: tenancy.id,
      growthRunId: run.id,
      type: eventType,
    });
    if (activeLeg == null && !pendingEvent) {
      const result = await enqueueWorkflowEvent(globalPrismaClient, {
        tenancy,
        type: eventType,
        payload: leg === "activation" ? { growth_run_id: run.id, trigger: run.trigger } : { growth_run_id: run.id },
      });
      enqueued = result != null;
    }
  }

  // The route's maxDuration is 300s, and deadlineMs is a latest-START budget.
  // A claimed invocation may outlive the request; this is safe because workflow
  // state is durable and leases make runs re-claimable, matching the cron route.
  const engine = await runWorkflowEngineStep({
    deadlineMs: Date.now() + GROWTH_RECOVERY_ENGINE_BUDGET_MS,
    scope: { tenancyId: tenancy.id },
  });
  const tick = await runGrowthProjectAnalysisStep(tenancy);
  return { didWork: engine.didWork || tick.didWork || enqueued || didWork };
}
