import { Prisma } from "@/generated/prisma/client";
import { GrowthPhaseStatus, GrowthRunStatus, WorkflowRunState } from "@/generated/prisma/enums";
import type { Tenancy } from "@/lib/tenancies";
import { enqueueWorkflowEvent } from "@/lib/workflows/events";
import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import { captureError, HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { GROWTH_METRIC_CATALOG } from "./metric-catalog";
import { seedDefaultGrowthMilestones } from "./milestones";
import { isGrowthInterviewReleased } from "./interview-release";
import { growthPhaseStatusToStepState } from "./phase-step-state";
import { getGrowthReleaseState } from "./report-release";
import {
  assertTriggerIsValid,
  getGrowthPhaseDescription,
  getGrowthPhaseDisplayIndex,
  getGrowthPhaseLabel,
  getInitialPhaseKeysForRun,
  GROWTH_COMPUTE_METRICS_PHASE_KEY,
  GROWTH_INTEGRATIONS_PHASE_KEY,
  GROWTH_REPORT_PHASE_KEY,
  type GrowthRunTrigger,
} from "./phases";
import { GROWTH_ANALYSIS_WORKFLOW_ID } from "./workflow-sources";
import { ensureGrowthWorkflows, getGrowthAnalysisLegRunKeys, getGrowthWorkflowStates, GROWTH_EVENT_TYPES } from "./workflows";

// Shown while the question plan hasn't been generated yet; the copy around it always says "about".
const DEFAULT_ESTIMATED_INTERVIEW_QUESTIONS = 8;

export function requireGrowthAppEnabled(tenancy: Tenancy): void {
  if (tenancy.config.apps.installed["gtm"]?.enabled !== true) {
    throw new StatusError(400, "The Growth app is not enabled for this project.");
  }
}

function runStatusToWire(status: GrowthRunStatus): string {
  return status.toLowerCase();
}

/**
 * The metric labels the dashboard shows under the "Computing metrics" block while the phase runs.
 * Derived from the catalog (never hardcoded) so the sub-list always reflects what the rollup
 * actually computes: the stored (materialized) entries, minus ads — ad metrics live in the separate
 * ad-metrics writer, not the compute-metrics rollup, so listing them here would be a lie.
 */
const COMPUTE_METRICS_DISPLAY_LABELS = GROWTH_METRIC_CATALOG
  .filter((metric) => metric.availability === "stored" && metric.category !== "ads")
  .map((metric) => metric.label);

export async function getGrowthStatusBody(tenancy: Tenancy) {
  const projectId = tenancy.project.id;
  const branchId = tenancy.branchId;

  const [onboarding, latestRun, latestReport, latestBrief, proposedActionCount, activeActionCount] = await Promise.all([
    globalPrismaClient.growthOnboarding.findUnique({ where: { projectId_branchId: { projectId, branchId } } }),
    globalPrismaClient.growthAnalysisRun.findFirst({
      where: { projectId, branchId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        phases: { orderBy: { createdAt: "asc" } },
        interview: { include: { questions: { select: { answeredAt: true } } } },
      },
    }),
    // Published only: a GrowthReport row exists from the moment the report phase finishes, but the
    // customer must not learn of it until staff release it. This one filter is what holds the whole
    // workspace back — page-client.tsx swaps the setup timeline for the workspace on `latestReport
    // != null`, and the report page reads the same signal.
    globalPrismaClient.growthReport.findFirst({
      where: { projectId, branchId, publishedAt: { not: null } },
      // Ordered by createdAt, NOT publishedAt, so this agrees with getGrowthReportBody's "latest".
      // The two would only diverge if staff published an older report after a newer one, but they
      // feed the same screen — the timeline reads this, the report page reads that — and a
      // disagreement there means a "Read the report" link opening a different report than the one
      // it just described. createdAt is also the date the UI puts on the report.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { run: { select: { trigger: true } } },
    }),
    // Only "ready" briefs count: a just-claimed "generating" row must not flip the dashboard into its
    // steady state before there is anything to read.
    globalPrismaClient.growthBrief.findFirst({
      where: { projectId, branchId, status: "ready" },
      orderBy: [{ date: "desc" }],
    }),
    globalPrismaClient.growthActionItem.count({ where: { projectId, branchId, status: "proposed" } }),
    globalPrismaClient.growthActionItem.count({ where: { projectId, branchId, status: "active" } }),
  ]);

  // A cancelled run is treated like no run at all: the user (or an operator) abandoned it, so the
  // dashboard should offer a fresh start instead of a stuck lifecycle.
  const run = latestRun == null || latestRun.status === GrowthRunStatus.CANCELLED ? null : latestRun;

  const analysisState = run == null
    ? "none"
    : run.status === GrowthRunStatus.FAILED
      ? "failed"
      : run.status === GrowthRunStatus.PENDING || run.status === GrowthRunStatus.RUNNING
        ? "running"
        : "completed";

  // The report phase runs after the interview, so it would only confuse the pre-interview checklist.
  // The compute-metrics phase is excluded too: it renders as its own standalone block above the
  // checklist (see `compute_metrics` below), not as a checklist row. Same for the integrations
  // phase — it renders as its own human-gated block (see `integrations` below).
  const steps = run == null ? null : run.phases
    .filter((phase) => phase.phaseKey !== GROWTH_REPORT_PHASE_KEY && phase.phaseKey !== GROWTH_COMPUTE_METRICS_PHASE_KEY && phase.phaseKey !== GROWTH_INTEGRATIONS_PHASE_KEY)
    // The query's `orderBy: createdAt` cannot order these: every phase row of a run shares one
    // transaction timestamp, so it is a total tie and the rows come back in whatever order the heap
    // holds them — which changes on every status update. See getGrowthPhaseDisplayIndex. Sorting
    // the FILTERED array rather than `run.phases` keeps this from mutating the Prisma result that
    // the compute-metrics/integrations lookups below still read.
    .sort((a, b) => getGrowthPhaseDisplayIndex(a.phaseKey) - getGrowthPhaseDisplayIndex(b.phaseKey))
    .map((phase) => ({
      id: phase.phaseKey,
      label: getGrowthPhaseLabel(phase.phaseKey),
      // Served alongside the label rather than mapped in the dashboard, for the same reason the label is:
      // analysis-topic rows are dynamic (`analysis:<id>`), and their copy lives in the topic registry here.
      // A dashboard-side map keyed on phase ids would silently render nothing for a topic added later.
      description: getGrowthPhaseDescription(phase.phaseKey),
      state: growthPhaseStatusToStepState(phase.status),
    }));

  // Back-compat contract: runs created before the compute-metrics phase existed have no such phase
  // row, and for those this stays null — the dashboard then renders exactly what it rendered before
  // (no metrics block). Additive wire key; older dashboards' z.object schemas strip it.
  const computeMetricsPhase = run?.phases.find((phase) => phase.phaseKey === GROWTH_COMPUTE_METRICS_PHASE_KEY) ?? null;
  const computeMetrics = computeMetricsPhase == null ? null : {
    state: growthPhaseStatusToStepState(computeMetricsPhase.status),
    metric_labels: COMPUTE_METRICS_DISPLAY_LABELS,
  };

  // Same back-compat contract as compute_metrics above: null when the run predates the integrations
  // phase, and an additive wire key otherwise. `connection_ready` is always false here: this build
  // has no ad platform integration, so the backend has no connection to detect — the ad-accounts
  // page's "connection" is browser-local and never reaches the server. The wire key is kept (rather
  // than dropped and re-added) so it starts reporting real state the moment the integration lands;
  // until then the dashboard deliberately does not read it, because a client that branches on an
  // always-false flag strands users who did connect (see GrowthIntegrations in growth-types.ts).
  const integrationsPhase = run?.phases.find((phase) => phase.phaseKey === GROWTH_INTEGRATIONS_PHASE_KEY) ?? null;
  let integrations = null;
  if (integrationsPhase != null) {
    const computeMetricsSettled = computeMetricsPhase != null
      && (computeMetricsPhase.status === GrowthPhaseStatus.COMPLETED || computeMetricsPhase.status === GrowthPhaseStatus.SKIPPED);
    // "pending" = upcoming (metrics not settled yet), "waiting" = actively awaiting the human.
    const state = integrationsPhase.status === GrowthPhaseStatus.COMPLETED
      ? "connected"
      : integrationsPhase.status === GrowthPhaseStatus.SKIPPED
        ? "skipped"
        : integrationsPhase.status === GrowthPhaseStatus.PENDING
          ? (computeMetricsSettled ? "waiting" : "pending")
          : throwErr(new HexclaveAssertionError(`Growth integrations phase of run ${run?.id} is in status ${integrationsPhase.status} — the phase is never dispatched, so only PENDING/COMPLETED/SKIPPED should be possible.`, { runId: run?.id, status: integrationsPhase.status }));
    integrations = { state, connection_ready: false };
  }

  const interview = run?.interview ?? null;
  const answeredCount = interview == null ? 0 : interview.questions.filter((question) => question.answeredAt != null).length;
  const interviewState = run == null || analysisState === "running" || analysisState === "failed" || interview == null
    ? "not_ready"
    : interview.status === "completed" || interview.status === "skipped"
      ? "completed"
      : !isGrowthInterviewReleased(interview)
        ? "preparing"
        : answeredCount > 0
          ? "in_progress"
          : "ready";

  // `latestReport` is already filtered to published rows, so its presence is exactly "this branch
  // has had a report released" — no second query needed for the release state.
  const releaseState = getGrowthReleaseState({
    released: latestReport != null,
    // The hold starts with the first real deep-analysis phase, not with run creation: computing
    // metrics and the optional integrations gate still have their own explicit setup states.
    deepAnalysisStarted: steps?.some((step) => step.state === "running" || step.state === "done") ?? false,
    analysisFailed: analysisState === "failed",
  });

  // The orchestration block reports the canonical growth workflows' health so
  // the dashboard can surface "your growth workflow was deleted/edited/failed"
  // states. Additive key: the dashboard's current statusSchema is a plain
  // z.object (strips unknown keys), so older dashboards simply ignore it.
  const workflowStates = await getGrowthWorkflowStates(tenancy);
  const orchestrationWorkflows = [];
  for (const workflowState of workflowStates) {
    // "Active" is only meaningful for the analysis workflow, and only relative
    // to the CURRENT analysis run's two legs; the daily-brief workflow's runs
    // are short-lived and per-day, so we keep its field null.
    const activeWorkflowRun = workflowState.workflowId === GROWTH_ANALYSIS_WORKFLOW_ID && run != null
      ? await globalPrismaClient.workflowRun.findFirst({
        where: {
          tenancyId: tenancy.id,
          workflowId: workflowState.workflowId,
          runKey: { in: getGrowthAnalysisLegRunKeys(run.id) },
          state: { in: [WorkflowRunState.QUEUED, WorkflowRunState.RUNNING, WorkflowRunState.SLEEPING] },
        },
        select: { state: true },
      })
      : null;
    const lastFailedRun = await globalPrismaClient.workflowRun.findFirst({
      where: { tenancyId: tenancy.id, workflowId: workflowState.workflowId, state: WorkflowRunState.FAILED },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { errorSummary: true },
    });
    orchestrationWorkflows.push({
      workflow_id: workflowState.workflowId,
      exists: workflowState.exists,
      edited: workflowState.edited,
      active_workflow_run_state: activeWorkflowRun == null ? null : activeWorkflowRun.state.toLowerCase(),
      // errorSummary is nullable on the row itself (platform failures may have
      // no user-visible summary); both nulls mean "nothing to show" here.
      last_failed_run_summary: lastFailedRun == null ? null : lastFailedRun.errorSummary,
    });
  }

  return {
    onboarding: {
      completed: onboarding != null,
      completed_at_millis: onboarding == null ? null : onboarding.completedAt.getTime(),
      website_url: onboarding == null ? null : onboarding.websiteUrl,
    },
    analysis: {
      state: analysisState,
      run_id: run == null ? null : run.id,
      trigger: run == null ? null : assertTriggerIsValid(run.trigger),
      started_at_millis: run == null ? null : run.createdAt.getTime(),
      completed_at_millis: run?.completedAt == null ? null : run.completedAt.getTime(),
      steps,
      compute_metrics: computeMetrics,
      integrations,
      error_message: run == null ? null : run.errorMessage,
    },
    interview: {
      state: interviewState,
      answered_count: answeredCount,
      estimated_total: interview == null || interview.questions.length === 0 ? DEFAULT_ESTIMATED_INTERVIEW_QUESTIONS : interview.questions.length,
    },
    latest_report: latestReport == null ? null : {
      id: latestReport.id,
      created_at_millis: latestReport.createdAt.getTime(),
      read_at_millis: latestReport.readAt == null ? null : latestReport.readAt.getTime(),
      trigger: assertTriggerIsValid(latestReport.run.trigger),
      // Populated once milestones land (the milestone's metric/threshold render as the label); until then
      // milestone-triggered reports simply show a generic badge in the dashboard.
      milestone_label: null,
    },
    // Withheld until release, matching the locked briefs routes: a brief summarizes movement in
    // findings the customer has not been shown yet, and the timeline would otherwise offer a "Latest
    // brief" card whose link 409s. In practice a held workspace is hours old and has no brief at
    // all — this closes the gap for a re-run that is awaiting review with briefs already flowing.
    latest_brief: latestBrief == null || releaseState !== "released" ? null : {
      id: latestBrief.id,
      date: latestBrief.date.toISOString().slice(0, 10),
      created_at_millis: latestBrief.createdAt.getTime(),
    },
    counts: {
      suggested_actions: proposedActionCount,
      active_actions: activeActionCount,
      // Scheduled tasks migrated to customer workflows; the Automations count will come from the
      // workflow listing (growth-prefixed WorkflowDefinitions) in a later wave. The field stays on
      // the frozen status wire as 0 so the dashboard's schema keeps parsing mid-migration.
      enabled_tasks: 0,
    },
    orchestration: {
      workflows: orchestrationWorkflows,
    },
    // The one signal the dashboard branches on for the hold. See getGrowthReleaseState for why
    // "composing" and "awaiting review" deliberately collapse into a single `preparing`.
    release: {
      state: releaseState,
    },
  };
}

/**
 * Creates a run plus its phase rows and enqueues the activation boundary event that starts the
 * growth-analysis workflow leg. Throws 409 when another run is still active — enforced by the
 * `isActive` generated-column unique, so the check is race-free even across concurrent requests.
 * The event rides in the same transaction as the run insert, so a run can never exist without its
 * activation event (the watchdog's orphaned-run resurrection is a backstop, not the normal path).
 */
export async function createGrowthAnalysisRun(options: {
  tenancyId: string,
  projectId: string,
  branchId: string,
  trigger: GrowthRunTrigger,
  milestoneEventId?: string,
}): Promise<{ runId: string }> {
  try {
    return await retryTransaction(globalPrismaClient, async (tx) => {
      const run = await tx.growthAnalysisRun.create({
        data: {
          projectId: options.projectId,
          branchId: options.branchId,
          trigger: options.trigger,
          milestoneEventId: options.milestoneEventId,
          phases: {
            create: getInitialPhaseKeysForRun().map((phaseKey) => ({ phaseKey })),
          },
        },
        select: { id: true },
      });
      await enqueueWorkflowEvent(tx, {
        tenancy: { id: options.tenancyId },
        type: GROWTH_EVENT_TYPES.analysisRunActivated,
        payload: { growth_run_id: run.id, trigger: options.trigger },
      });
      return { runId: run.id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new StatusError(409, "An analysis run is already in progress for this project.");
    }
    throw error;
  }
}

export async function completeGrowthOnboardingAndStartRun(options: {
  tenancy: Tenancy,
  websiteUrl: string,
  companySummary: string | null,
}): Promise<{ runId: string }> {
  // Seed the canonical growth workflows BEFORE anything else: the run
  // creation below enqueues the activation event in its own transaction, and
  // the definition must already exist when that event is processed (an event
  // matching no definition is consumed and gone). Seeding is deliberately
  // best-effort — a transient compile-sandbox outage must not block
  // onboarding, because the watchdog re-seeds AND re-fires the activation
  // event for orphaned runs, so the analysis still starts (just later).
  try {
    await ensureGrowthWorkflows(options.tenancy);
  } catch (error) {
    captureError("growth-workflow-seeding", new HexclaveAssertionError(`Failed to seed growth workflows during onboarding for project ${options.tenancy.project.id} branch ${options.tenancy.branchId}`, { cause: error, projectId: options.tenancy.project.id, branchId: options.tenancy.branchId }));
  }
  try {
    // Onboarding row + default milestone seeding are one transaction: a retried onboarding gets a
    // 400 from the P2002 below, so a crash between the two writes would otherwise leave the branch
    // permanently without its default milestones. The run creation stays outside (it has its own
    // race handling via the isActive unique, and a crash before it is recoverable — the user just
    // sees onboarding "already completed" and support can start a manual run).
    await retryTransaction(globalPrismaClient, async (tx) => {
      await tx.growthOnboarding.create({
        data: {
          projectId: options.tenancy.project.id,
          branchId: options.tenancy.branchId,
          websiteUrl: options.websiteUrl,
          companySummary: options.companySummary,
        },
      });
      await seedDefaultGrowthMilestones(tx, { projectId: options.tenancy.project.id, branchId: options.tenancy.branchId });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new StatusError(400, "Growth onboarding has already been completed for this project.");
    }
    throw error;
  }
  return await createGrowthAnalysisRun({ tenancyId: options.tenancy.id, projectId: options.tenancy.project.id, branchId: options.tenancy.branchId, trigger: "initial" });
}

export async function startGrowthManualRun(options: { tenancy: Tenancy }): Promise<{ runId: string }> {
  const onboarding = await globalPrismaClient.growthOnboarding.findUnique({
    where: { projectId_branchId: { projectId: options.tenancy.project.id, branchId: options.tenancy.branchId } },
    select: { id: true },
  });
  if (onboarding == null) {
    throw new StatusError(400, "Complete growth onboarding before starting an analysis run.");
  }
  return await createGrowthAnalysisRun({ tenancyId: options.tenancy.id, projectId: options.tenancy.project.id, branchId: options.tenancy.branchId, trigger: "manual" });
}

export async function retryGrowthAnalysis(options: { tenancy: Tenancy }): Promise<{ runId: string }> {
  const latestRun = await globalPrismaClient.growthAnalysisRun.findFirst({
    where: { projectId: options.tenancy.project.id, branchId: options.tenancy.branchId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, status: true, trigger: true },
  });
  if (latestRun == null || latestRun.status !== GrowthRunStatus.FAILED) {
    throw new StatusError(400, "There is no failed analysis run to retry.");
  }
  try {
    await retryTransaction(globalPrismaClient, async (tx) => {
      // Claim the retry before replacing any phases. Two concurrent retry requests may both have
      // observed FAILED above, but only one may revive the run and enqueue its activation event.
      const revived = await tx.growthAnalysisRun.updateMany({
        where: { id: latestRun.id, status: GrowthRunStatus.FAILED },
        data: { status: GrowthRunStatus.PENDING, errorMessage: null },
      });
      if (revived.count !== 1) {
        throw new StatusError(409, "This analysis run is already being retried.");
      }

      const failedPhases = await tx.growthAnalysisPhase.findMany({
        where: { runId: latestRun.id, status: GrowthPhaseStatus.FAILED },
        select: { id: true, phaseKey: true },
      });
      if (failedPhases.length > 0) {
        // Fresh rows are necessary rather than `attempt: 0`: run tokens are fenced by phase id +
        // attempt, so reusing attempt numbers on the same row could make a zombie session's old
        // token valid again. Replacing the row resets all execution timestamps and permanently
        // invalidates every token anchored to the failed phase id.
        await tx.growthAnalysisPhase.deleteMany({
          where: { id: { in: failedPhases.map((phase) => phase.id) }, status: GrowthPhaseStatus.FAILED },
        });
        await tx.growthAnalysisPhase.createMany({
          data: failedPhases.map((phase) => ({ runId: latestRun.id, phaseKey: phase.phaseKey })),
        });
      }
      // Reviving the run needs a fresh activation event: the original leg
      // exited when the run failed (resting), and onConflict "skip" only
      // dedupes against ACTIVE legs, so this reliably starts a new one.
      await enqueueWorkflowEvent(tx, {
        tenancy: { id: options.tenancy.id },
        type: GROWTH_EVENT_TYPES.analysisRunActivated,
        payload: { growth_run_id: latestRun.id, trigger: assertTriggerIsValid(latestRun.trigger) },
      });
    });
  } catch (error) {
    // Reviving this run makes it active again, so the isActive unique can collide with a run that was
    // started (e.g. by a milestone) after this one failed.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new StatusError(409, "Another analysis run is already in progress for this project.");
    }
    throw error;
  }
  return { runId: latestRun.id };
}

/**
 * The human's answer to the integrations step: "continue" (use the connected ad platform) or
 * "skip" (run on product data only). CAS-settles the run's PENDING integrations phase and — in the
 * same transaction — re-fires the activation boundary event: the run rested awaiting this answer,
 * which ended its workflow leg and released the leg's runKey (see workflow-sources.ts's leg
 * contract), so a fresh `growth.analysis-run-activated` event reliably starts a new leg that
 * dispatches the now-unblocked phases. If a leg happens to still be active (the answer raced the
 * tick that had just settled compute-metrics), the workflow's onConflict "skip" dedupes the event
 * harmlessly. Riding in the settle transaction means the phase can never settle without its resume
 * event (the watchdog's orphaned-run resurrection is only the lost-event backstop).
 */
export async function resolveGrowthRunIntegrations(options: {
  tenancy: Tenancy,
  runId: string,
  action: "skip" | "continue",
}) {
  const projectId = options.tenancy.project.id;
  const branchId = options.tenancy.branchId;
  const run = await globalPrismaClient.growthAnalysisRun.findFirst({
    where: { id: options.runId, projectId, branchId },
    include: { phases: { where: { phaseKey: GROWTH_INTEGRATIONS_PHASE_KEY }, select: { id: true, status: true } } },
  });
  if (run == null) {
    throw new StatusError(404, "Analysis run not found.");
  }
  const integrationsPhase = run.phases.at(0) ?? null;
  if (integrationsPhase == null) {
    // Runs created before the integrations phase existed never ask the question.
    throw new StatusError(400, "This analysis run has no integrations step.");
  }
  // "continue" is taken purely as the human's answer: with no ad platform integration in this build
  // there is no connection to verify it against. The connection precondition returns with the
  // integration, alongside the tick's matching auto-settle rule.
  await retryTransaction(globalPrismaClient, async (tx) => {
    const settled = await tx.growthAnalysisPhase.updateMany({
      where: { id: integrationsPhase.id, status: GrowthPhaseStatus.PENDING },
      data: {
        status: options.action === "skip" ? GrowthPhaseStatus.SKIPPED : GrowthPhaseStatus.COMPLETED,
        finishedAt: new Date(),
      },
    });
    if (settled.count === 0) {
      // Already settled (by the auto-settle, or a concurrent answer) — 409 so a stale panel
      // refreshes instead of believing its action took effect.
      throw new StatusError(409, "The integrations step has already been answered.");
    }
    await enqueueWorkflowEvent(tx, {
      tenancy: { id: options.tenancy.id },
      type: GROWTH_EVENT_TYPES.analysisRunActivated,
      payload: { growth_run_id: run.id, trigger: assertTriggerIsValid(run.trigger) },
    });
  });
  return await getGrowthRunBody({ projectId, branchId, runId: options.runId });
}

export async function getGrowthRunBody(options: { projectId: string, branchId: string, runId: string }) {
  const run = await globalPrismaClient.growthAnalysisRun.findFirst({
    where: { id: options.runId, projectId: options.projectId, branchId: options.branchId },
    include: { phases: { orderBy: { createdAt: "asc" } } },
  });
  if (run == null) {
    throw new StatusError(404, "Analysis run not found.");
  }
  return {
    id: run.id,
    status: runStatusToWire(run.status),
    trigger: assertTriggerIsValid(run.trigger),
    created_at_millis: run.createdAt.getTime(),
    completed_at_millis: run.completedAt == null ? null : run.completedAt.getTime(),
    error_message: run.errorMessage,
    phases: run.phases.map((phase) => ({
      phase_key: phase.phaseKey,
      status: phase.status.toLowerCase(),
      attempt: phase.attempt,
      started_at_millis: phase.startedAt == null ? null : phase.startedAt.getTime(),
      finished_at_millis: phase.finishedAt == null ? null : phase.finishedAt.getTime(),
      error_message: phase.errorMessage,
    })),
  };
}
