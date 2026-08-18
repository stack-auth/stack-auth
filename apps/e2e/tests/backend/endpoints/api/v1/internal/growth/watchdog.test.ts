import { describe, type ExpectStatic } from "vitest";
import { it } from "../../../../../../helpers";
import { niceBackendFetch } from "../../../../../backend-helpers";
import { listRuns, retireWorkflow, tickWorkflowEngine, updateWorkflowSource } from "../workflows-helpers";
import { GROWTH_AGENT_AUTH, createGrowthProject, requireRunId } from "./growth-helpers";

const ADMIN_BASE = "/api/latest/internal/growth";
const AGENT_BASE = "/api/latest/internal/growth-agent";
const SERVER_BASE = "/api/v1/internal/growth-server";
const CRON_AUTH = { "authorization": "Bearer mock_cron_secret" };

const GROWTH_ANALYSIS_WORKFLOW_ID = "growth-analysis";
const GROWTH_DAILY_BRIEF_WORKFLOW_ID = "growth-daily-brief";
const INTERVIEW_FINISHED_EVENT_TYPE = "custom.growth.interview-finished";

// E2E tests for the growth WATCHDOG (internal/growth-watchdog-step): the low-frequency repair
// sweep behind the event-driven growth orchestration. This file must NOT use mock-eve (its fixed
// port belongs to growth-workflows.test.ts exclusively) — nothing here needs successful Eve
// dispatches: the assertions are about workflow definitions and workflow-run existence, both of
// which the watchdog repairs regardless of whether the resulting phase dispatches reach an agent.
//
// NOTE ON WALL-CLOCK TIME: orphaned-run resurrection deliberately applies a 5-minute grace period
// (GROWTH_WATCHDOG_RUN_GRACE_MS — the boundary event may still be in the outbox for a young run),
// so the resurrection test below REALLY waits those 5 minutes. That is the honest price of
// e2e-covering the repair path; the pure leg-selection/bucketing arithmetic is additionally
// unit-covered in apps/backend/src/lib/growth/watchdog.test.ts.

async function tickGrowthWatchdog(expect: ExpectStatic) {
  const response = await niceBackendFetch("/api/v1/internal/growth-watchdog-step", {
    method: "GET",
    headers: CRON_AUTH,
    query: { only_one_step: "true" },
  });
  expect(response.status).toBe(200);
}

async function setUpOnboardedProject() {
  const projectKeys = await createGrowthProject();
  if (projectKeys === "no-project") {
    throw new Error("createGrowthProject should have switched the context to a fresh project.");
  }
  const onboarding = await niceBackendFetch(`${ADMIN_BASE}/onboarding`, {
    accessType: "admin",
    method: "POST",
    body: { website_url: "https://plannery.example.com", company_summary: "Project management for small teams." },
  });
  if (onboarding.status !== 200) {
    throw new Error(`Growth onboarding failed with status ${onboarding.status}: ${JSON.stringify(onboarding.body)}`);
  }
  return { projectId: projectKeys.projectId, branchId: "main", runId: requireRunId(onboarding.body) };
}

async function getWorkflowSummary(workflowId: string) {
  const response = await niceBackendFetch("/api/v1/internal/workflows", { method: "GET", accessType: "admin" });
  if (response.status !== 200) throw new Error(`Listing workflows failed: ${JSON.stringify(response.body)}`);
  return (response.body.workflows as { id: string, latest_version: number }[]).find((workflow) => workflow.id === workflowId) ?? null;
}

async function getOrchestrationWorkflowState(expect: ExpectStatic, workflowId: string) {
  const status = await niceBackendFetch(`${ADMIN_BASE}/status`, { accessType: "admin" });
  expect(status.status).toBe(200);
  const workflows = (status.body as { orchestration: { workflows: { workflow_id: string, exists: boolean, edited: boolean }[] } }).orchestration.workflows;
  const state = workflows.find((workflow) => workflow.workflow_id === workflowId);
  if (state == null) throw new Error(`Status orchestration block has no entry for ${workflowId}.`);
  return state;
}

// ── Run-driving helpers (small duplicates of interview.test.ts's, kept file-local on purpose) ──

type AgentScope = { project_id: string, branch_id: string };
type AdminRunBody = { id: string, status: string, phases: { phase_key: string, status: string, attempt: number }[] };

async function getRun(runId: string): Promise<AdminRunBody> {
  const response = await niceBackendFetch(`${ADMIN_BASE}/runs/${runId}`, { accessType: "admin" });
  if (response.status !== 200) {
    throw new Error(`Reading run ${runId} failed with status ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return response.body as AdminRunBody;
}

/** One per-run orchestration tick via the growth-server bridge (server auth, like the workflow). */
async function tickAnalysisRun(expect: ExpectStatic, runId: string) {
  const response = await niceBackendFetch(`${SERVER_BASE}/analysis/tick`, {
    method: "POST",
    accessType: "server",
    body: { run_id: runId },
  });
  expect(response.status).toBe(200);
}

/** Settles one phase via the machine routes, retrying on attempt-fence 409s (ticks bump attempts). */
async function settlePhase(scope: AgentScope, runId: string, phaseKey: string) {
  for (let i = 0; i < 20; i++) {
    const run = await getRun(runId);
    const phase = run.phases.find((candidate) => candidate.phase_key === phaseKey);
    if (phase == null) throw new Error(`Run ${runId} has no phase ${phaseKey}.`);
    if (phase.status === "completed" || phase.status === "failed") return;
    const start = await niceBackendFetch(`${AGENT_BASE}/runs/${runId}/phases/${phaseKey}/start`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, attempt: phase.attempt, eve_session_id: `eve-session-${phaseKey}` },
    });
    if (start.status === 409) continue;
    if (start.status !== 200) throw new Error(`Starting phase ${phaseKey} failed with status ${start.status}: ${JSON.stringify(start.body)}`);
    const complete = await niceBackendFetch(`${AGENT_BASE}/runs/${runId}/phases/${phaseKey}/complete`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, attempt: phase.attempt },
    });
    if (complete.status === 409) continue;
    if (complete.status !== 200) throw new Error(`Completing phase ${phaseKey} failed with status ${complete.status}: ${JSON.stringify(complete.body)}`);
    return;
  }
  throw new Error(`settlePhase(${phaseKey}) kept losing attempt races.`);
}

/**
 * Plays the agent through every pre-interview phase (with the question plan) until the run rests
 * at AWAITING_INTERVIEW. Eve dispatches fail in this file (or reach growth-workflows.test.ts's
 * mock), so failed runs (exhausted dispatch budgets) are revived via the admin retry route.
 */
async function driveRunToAwaitingInterview(expect: ExpectStatic, scope: AgentScope, runId: string) {
  const questionPlan = await niceBackendFetch(`${AGENT_BASE}/interview-questions`, {
    method: "POST",
    headers: GROWTH_AGENT_AUTH,
    body: {
      ...scope,
      run_id: runId,
      questions: [{
        question_key: "primary-goal",
        prompt: "What is your primary growth goal?",
        kind: "single",
        options: [{ id: "signups", label: "More signups" }],
      }],
    },
  });
  if (questionPlan.status !== 200) throw new Error(`Saving the question plan failed: ${JSON.stringify(questionPlan.body)}`);
  const deadline = Date.now() + 180_000;
  while (true) {
    await tickAnalysisRun(expect, runId);
    const run = await getRun(runId);
    if (run.status === "awaiting_interview") return;
    if (run.status === "failed") {
      const retry = await niceBackendFetch(`${ADMIN_BASE}/analysis/retry`, { accessType: "admin", method: "POST" });
      expect(retry.status).toBe(200);
    } else if (run.status !== "pending") {
      for (const phase of run.phases) {
        if (phase.phase_key === "report") continue;
        await settlePhase(scope, runId, phase.phase_key);
      }
    }
    if (Date.now() > deadline) throw new Error(`Run ${runId} did not reach awaiting_interview in time; last status: ${run.status}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

describe("growth watchdog", () => {
  it("recreates a deleted growth-analysis workflow and re-fires the boundary event of the orphaned run", { timeout: 600_000 }, async ({ expect }) => {
    const { projectId, branchId, runId } = await setUpOnboardedProject();
    const scope: AgentScope = { project_id: projectId, branch_id: branchId };

    // Rest the run at AWAITING_INTERVIEW first: from there the orchestration cannot fail the run
    // on its own (no phase is in flight), so the state below is frozen until a workflow leg acts —
    // which makes the watchdog's re-fire the only thing that can move it, deterministically even
    // with the dev cron runner ticking the engine in the background.
    await driveRunToAwaitingInterview(expect, scope, runId);

    // The customer deletes the canonical analysis workflow (this also deletes any leg runs), and
    // THEN finishes the interview: the interview-finished boundary event is enqueued while no
    // definition exists, so the engine consumes it with nothing to match — the exact orphaned-run
    // failure mode the watchdog exists for.
    await retireWorkflow(expect, GROWTH_ANALYSIS_WORKFLOW_ID);
    const interviewComplete = await niceBackendFetch(`${AGENT_BASE}/interview/complete`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, run_id: runId },
    });
    expect(interviewComplete).toMatchObject({ status: 200, body: { status: "completed" } });
    await tickWorkflowEngine(expect);
    await tickWorkflowEngine(expect);

    // Sub-step 1 (ensure) has no grace period: one sweep recreates the missing definition.
    await tickGrowthWatchdog(expect);
    expect(await getWorkflowSummary(GROWTH_ANALYSIS_WORKFLOW_ID)).toMatchObject({ latest_version: 1 });
    expect(await getOrchestrationWorkflowState(expect, GROWTH_ANALYSIS_WORKFLOW_ID)).toMatchObject({ exists: true, edited: false });

    // In dev the cron runner ticks the engine continuously, so the interview-finished event may
    // have raced the deletion/recreation and started a leg after all. Cancel anything that
    // survived: any leg observed AFTER this point can only come from the watchdog's re-fire.
    const cancelResponse = await niceBackendFetch(`/api/v1/internal/workflows/${GROWTH_ANALYSIS_WORKFLOW_ID}/runs/cancel`, {
      method: "POST",
      accessType: "admin",
      body: { run_key: `${runId}:${INTERVIEW_FINISHED_EVENT_TYPE}` },
    });
    expect(cancelResponse.status).toBe(200);

    // Sub-step 2 (resurrection) honors the 5-minute grace (here from the interview's completion),
    // so keep sweeping + ticking until the boundary event is re-fired and the engine starts a
    // fresh interview leg. The 10-minute deterministic event-id bucket means the many sweeps
    // inside one bucket re-insert the same event id (skipDuplicates no-ops) — asserted below via
    // the non-canceled leg count.
    const isLiveLeg = (run: { state: string }) => run.state !== "canceled";
    await (async () => {
      const deadline = Date.now() + 480_000;
      while (true) {
        await tickGrowthWatchdog(expect);
        await tickWorkflowEngine(expect);
        const { runs } = await listRuns(GROWTH_ANALYSIS_WORKFLOW_ID, { run_key: `${runId}:${INTERVIEW_FINISHED_EVENT_TYPE}` });
        if (runs.some(isLiveLeg)) return;
        if (Date.now() > deadline) throw new Error("The watchdog never resurrected the orphaned analysis run's workflow leg.");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    })();

    // Exactly one live leg despite the many sweeps: same-bucket re-fires are idempotent, and even
    // a genuine over-fire would be collapsed by the source's onConflict "skip".
    await tickGrowthWatchdog(expect);
    await tickWorkflowEngine(expect);
    const { runs: legs } = await listRuns(GROWTH_ANALYSIS_WORKFLOW_ID, { run_key: `${runId}:${INTERVIEW_FINISHED_EVENT_TYPE}` });
    expect(legs.filter(isLiveLeg)).toHaveLength(1);
  });

  it("never overwrites an edited canonical workflow, and the restore route resets or recreates it", { timeout: 180_000 }, async ({ expect }) => {
    await setUpOnboardedProject();

    // Edit the daily-brief workflow like a customer would (append a comment — a byte-level change
    // that still compiles to the same behavior).
    const versionsResponse = await niceBackendFetch(`/api/v1/internal/workflows/${GROWTH_DAILY_BRIEF_WORKFLOW_ID}/versions`, {
      method: "GET",
      accessType: "admin",
    });
    expect(versionsResponse.status).toBe(200);
    const canonicalSource = versionsResponse.body.versions[0].source as string;
    await updateWorkflowSource(expect, GROWTH_DAILY_BRIEF_WORKFLOW_ID, canonicalSource + "\n// edited by the customer\n", 2);
    const stateAfterEdit = await getOrchestrationWorkflowState(expect, GROWTH_DAILY_BRIEF_WORKFLOW_ID);
    expect(stateAfterEdit).toMatchObject({ exists: true, edited: true });

    // The watchdog's ensure pass only recreates MISSING definitions — the customer's edit must
    // survive any number of sweeps.
    await tickGrowthWatchdog(expect);
    await tickGrowthWatchdog(expect);
    expect(await getWorkflowSummary(GROWTH_DAILY_BRIEF_WORKFLOW_ID)).toMatchObject({ latest_version: 2 });
    expect(await getOrchestrationWorkflowState(expect, GROWTH_DAILY_BRIEF_WORKFLOW_ID)).toMatchObject({ exists: true, edited: true });

    // The explicit restore route is the ONLY path that overwrites the edit: it mints a new version
    // with the canonical source.
    const restore = await niceBackendFetch(`${ADMIN_BASE}/workflows/restore`, {
      accessType: "admin",
      method: "POST",
      body: { workflow_id: GROWTH_DAILY_BRIEF_WORKFLOW_ID },
    });
    expect(restore).toMatchObject({
      status: 200,
      body: { workflow_id: GROWTH_DAILY_BRIEF_WORKFLOW_ID, version: 3, created: true },
    });
    expect(await getOrchestrationWorkflowState(expect, GROWTH_DAILY_BRIEF_WORKFLOW_ID)).toMatchObject({ exists: true, edited: false });

    // Restore also recreates a DELETED canonical workflow (fresh definition, version 1).
    await retireWorkflow(expect, GROWTH_DAILY_BRIEF_WORKFLOW_ID);
    expect(await getOrchestrationWorkflowState(expect, GROWTH_DAILY_BRIEF_WORKFLOW_ID)).toMatchObject({ exists: false, edited: false });
    const restoreDeleted = await niceBackendFetch(`${ADMIN_BASE}/workflows/restore`, {
      accessType: "admin",
      method: "POST",
      body: { workflow_id: GROWTH_DAILY_BRIEF_WORKFLOW_ID },
    });
    expect(restoreDeleted).toMatchObject({
      status: 200,
      body: { workflow_id: GROWTH_DAILY_BRIEF_WORKFLOW_ID, version: 1, created: true },
    });
    expect(await getOrchestrationWorkflowState(expect, GROWTH_DAILY_BRIEF_WORKFLOW_ID)).toMatchObject({ exists: true, edited: false });

    // Only canonical growth workflow ids are restorable (schema-level oneOf).
    const badRestore = await niceBackendFetch(`${ADMIN_BASE}/workflows/restore`, {
      accessType: "admin",
      method: "POST",
      body: { workflow_id: "some-customer-workflow" },
    });
    expect(badRestore.status).toBe(400);
  });
});

// The growth-server bridge routes authenticate as ordinary server auth (workflow run tokens ARE
// plain server credentials), so their negatives are e2e-testable without any workflow running.
// Forged-run-id 404s on the analysis verbs live in growth-workflows.test.ts; this covers the
// remaining request-validation and gating negatives.
describe("growth-server bridge negatives", () => {
  it("rejects client access, growth-disabled projects, and invalid rollup dates", async ({ expect }) => {
    const { runId } = await setUpOnboardedProject();

    // Client credentials are never enough for the bridge.
    const clientTick = await niceBackendFetch(`${SERVER_BASE}/analysis/tick`, {
      method: "POST",
      accessType: "client",
      body: { run_id: runId },
    });
    expect(clientTick.status).toBe(401);

    // The rollup only accepts fully-elapsed recent UTC days: today, ancient history, and
    // calendar-invalid dates are all clean 400s.
    const today = new Date().toISOString().slice(0, 10);
    for (const date of [today, "2000-01-01", "2026-02-30"]) {
      const rollup = await niceBackendFetch(`${SERVER_BASE}/daily/rollup`, {
        method: "POST",
        accessType: "server",
        body: { date },
      });
      expect(rollup.status).toBe(400);
    }

    // Unknown brief ids are uniform 404s on every brief verb.
    const forgedBriefId = "00000000-0000-4000-8000-000000000000";
    for (const path of ["daily/dispatch-brief", "daily/skip-brief", "daily/wire-deliveries"]) {
      const response = await niceBackendFetch(`${SERVER_BASE}/${path}`, {
        method: "POST",
        accessType: "server",
        body: { brief_id: forgedBriefId },
      });
      expect(response.status).toBe(404);
    }
  });
});
