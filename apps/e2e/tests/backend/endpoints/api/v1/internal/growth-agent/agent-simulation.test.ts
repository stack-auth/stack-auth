import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../../backend-helpers";
import { GROWTH_AGENT_AUTH, createGrowthProject, requireRunId } from "../growth/growth-helpers";

const ADMIN_BASE = "/api/latest/internal/growth";
const AGENT_BASE = "/api/latest/internal/growth-agent";

// These tests "play the agent": they drive the machine-facing growth-agent write API end to end the
// way Eve would during an analysis run. No orchestration runs here (neither the workflow engine nor
// the growth-server bridge is ticked), so phases keep their schema-default attempt of 0 — the
// simulation echoes attempt 0, which is the real invariant (body attempt === stored attempt), and
// the stale-attempt test proves any other echo is fenced with a 409. The orchestration-driven
// lifecycle (dispatches, attempt bumps, run transitions) lives in growth-workflows.test.ts.

async function createGrowthProjectWithIds() {
  const projectKeys = await createGrowthProject();
  if (projectKeys === "no-project") {
    throw new Error("createGrowthProject should have switched the context to a fresh project.");
  }
  // Tests always run against the default branch.
  return { projectId: projectKeys.projectId, branchId: "main" };
}

async function completeOnboarding() {
  const onboarding = await niceBackendFetch(`${ADMIN_BASE}/onboarding`, {
    accessType: "admin",
    method: "POST",
    body: { website_url: "https://plannery.example.com", company_summary: "Project management for small teams." },
  });
  if (onboarding.status !== 200) {
    throw new Error(`Growth onboarding failed with status ${onboarding.status}.`);
  }
  return requireRunId(onboarding.body);
}

async function getRunPhaseKeys(runId: string): Promise<string[]> {
  const run = await niceBackendFetch(`${ADMIN_BASE}/runs/${runId}`, { accessType: "admin" });
  if (run.status !== 200) {
    throw new Error(`Reading the run failed with status ${run.status}.`);
  }
  return (run.body as { phases: { phase_key: string }[] }).phases.map((phase) => phase.phase_key);
}

describe("growth agent simulation", () => {
  it("runs a full analysis: phase lifecycle, findings, artifacts, interview, report, brief, tasks", async ({ expect }) => {
    const { projectId, branchId } = await createGrowthProjectWithIds();
    const scope = { project_id: projectId, branch_id: branchId };
    const runId = await completeOnboarding();

    const phaseKeys = await getRunPhaseKeys(runId);
    expect(phaseKeys).toHaveLength(10);

    for (const phaseKey of phaseKeys) {
      const start = await niceBackendFetch(`${AGENT_BASE}/runs/${runId}/phases/${phaseKey}/start`, {
        method: "POST",
        headers: GROWTH_AGENT_AUTH,
        body: { ...scope, attempt: 0, eve_session_id: `eve-session-${phaseKey}` },
      });
      expect(start).toMatchObject({ status: 200, body: { status: "running" } });

      const heartbeat = await niceBackendFetch(`${AGENT_BASE}/runs/${runId}/phases/${phaseKey}/heartbeat`, {
        method: "POST",
        headers: GROWTH_AGENT_AUTH,
        body: { ...scope, attempt: 0 },
      });
      expect(heartbeat).toMatchObject({ status: 200, body: { status: "running" } });

      const complete = await niceBackendFetch(`${AGENT_BASE}/runs/${runId}/phases/${phaseKey}/complete`, {
        method: "POST",
        headers: GROWTH_AGENT_AUTH,
        body: { ...scope, attempt: 0 },
      });
      expect(complete).toMatchObject({ status: 200, body: { status: "completed" } });
    }

    // Completing an already-completed phase at the same attempt is an idempotent no-op.
    const completeAgain = await niceBackendFetch(`${AGENT_BASE}/runs/${runId}/phases/website-research/complete`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, attempt: 0 },
    });
    expect(completeAgain).toMatchObject({ status: 200, body: { status: "completed" } });

    // Findings: the in-batch duplicate is skipped, and re-sending the whole batch skips everything.
    const findingsBody = {
      ...scope,
      run_id: runId,
      source: "website-research",
      findings: [
        { kind: "competitor", category: "reach", tags: ["competitor"], title: "Competitor: Basecamp", body: "Established player in team PM." },
        { kind: "competitor", category: "reach", tags: ["competitor"], title: "Competitor: Basecamp", body: "Duplicate row that must be skipped." },
        { kind: "audience", category: "reach", tags: ["audience"], title: "ICP: small agencies", body: "5-20 person service teams.", data: { confidence: 0.8 } },
      ],
    };
    const findings = await niceBackendFetch(`${AGENT_BASE}/findings`, { method: "POST", headers: GROWTH_AGENT_AUTH, body: findingsBody });
    expect(findings).toMatchObject({ status: 200, body: { created_count: 2, skipped_count: 1 } });
    const findingsAgain = await niceBackendFetch(`${AGENT_BASE}/findings`, { method: "POST", headers: GROWTH_AGENT_AUTH, body: findingsBody });
    expect(findingsAgain).toMatchObject({ status: 200, body: { created_count: 0, skipped_count: 3 } });

    // Artifacts upsert on (run, kind, title): the second POST updates in place and echoes the same id.
    const artifact = await niceBackendFetch(`${AGENT_BASE}/artifacts`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, run_id: runId, kind: "crawl-summary", title: "Homepage crawl", content: "v1 content" },
    });
    expect(artifact.status).toBe(200);
    const artifactId = (artifact.body as { artifact_id: string }).artifact_id;
    const artifactAgain = await niceBackendFetch(`${AGENT_BASE}/artifacts`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, run_id: runId, kind: "crawl-summary", title: "Homepage crawl", content: "v2 content", metadata: { pages: 12 } },
    });
    expect(artifactAgain).toMatchObject({ status: 200, body: { artifact_id: artifactId } });

    // Interview question plan: created once, then wholesale-replaced while still unanswered.
    const questions = await niceBackendFetch(`${AGENT_BASE}/interview-questions`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: {
        ...scope,
        run_id: runId,
        questions: [
          {
            question_key: "primary-goal",
            prompt: "What is your primary growth goal?",
            kind: "single",
            options: [{ id: "signups", label: "More signups" }, { id: "revenue", label: "More revenue" }],
          },
          {
            question_key: "channels",
            prompt: "Which channels have you tried?",
            kind: "multi",
            options: [{ id: "ads", label: "Paid ads" }, { id: "seo", label: "SEO", description: "Organic search" }],
            allow_skip: false,
          },
        ],
      },
    });
    expect(questions.status).toBe(200);
    const interviewId = (questions.body as { interview_id: string }).interview_id;
    expect(questions.body).toMatchObject({ interview_id: interviewId, question_count: 2 });

    const replacedQuestions = await niceBackendFetch(`${AGENT_BASE}/interview-questions`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: {
        ...scope,
        run_id: runId,
        questions: [
          {
            question_key: "primary-goal",
            prompt: "What is your primary growth goal right now?",
            kind: "single",
            options: [{ id: "signups", label: "More signups" }],
            origin: "adaptive",
          },
        ],
      },
    });
    // Pending-replace success path: replacing an answered plan (409) only becomes testable once
    // Phase 7 adds the answer surface.
    expect(replacedQuestions).toMatchObject({ status: 200, body: { interview_id: interviewId, question_count: 1 } });

    const interviewComplete = await niceBackendFetch(`${AGENT_BASE}/interview/complete`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, run_id: runId },
    });
    expect(interviewComplete).toMatchObject({ status: 200, body: { status: "completed" } });
    // Idempotent no-op on retry.
    const interviewCompleteAgain = await niceBackendFetch(`${AGENT_BASE}/interview/complete`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, run_id: runId },
    });
    expect(interviewCompleteAgain).toMatchObject({ status: 200, body: { status: "completed" } });

    // Report with two proposed action items; the re-POST replaces both (all still "proposed").
    const reportBody = {
      ...scope,
      run_id: runId,
      title: "Growth analysis for Plannery",
      summary: "Focus on paid acquisition and content.",
      content_md: "# Report\n\nDetails...",
      sections: [{ id: "overview", title: "Overview", kind: "markdown", body_markdown: "..." }],
      action_items: [
        { type_id: "run_ads", category: "reach", tags: ["search"], title: "Launch a search ads campaign", description: "Target small agencies." },
        {
          type_id: "publish_blog",
          category: "reach",
          tags: ["comparison"],
          title: "Publish an SEO comparison post",
          description: "Compare against incumbents.",
          watched_metrics: [{ metric_id: "new_signups", window_days: 30 }],
        },
      ],
    };
    const report = await niceBackendFetch(`${AGENT_BASE}/report`, { method: "POST", headers: GROWTH_AGENT_AUTH, body: reportBody });
    expect(report.status).toBe(200);
    const reportId = (report.body as { report_id: string }).report_id;
    const firstActionItemIds = (report.body as { action_item_ids: string[] }).action_item_ids;
    expect(firstActionItemIds).toHaveLength(2);

    const reportAgain = await niceBackendFetch(`${AGENT_BASE}/report`, { method: "POST", headers: GROWTH_AGENT_AUTH, body: reportBody });
    expect(reportAgain.status).toBe(200);
    expect((reportAgain.body as { report_id: string }).report_id).toBe(reportId);
    const secondActionItemIds = (reportAgain.body as { action_item_ids: string[] }).action_item_ids;
    expect(secondActionItemIds).toHaveLength(2);
    // Proposed-only items are deleted and recreated, so the ids must all be new.
    expect(secondActionItemIds.some((id) => firstActionItemIds.includes(id))).toBe(false);

    // Daily brief upsert: same day converges onto the same row.
    const brief = await niceBackendFetch(`${AGENT_BASE}/briefs`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, date: "2026-08-04", summary: "Signups up 12%.", content_md: "## Brief", data: { deltas: { new_signups: 12 } } },
    });
    expect(brief.status).toBe(200);
    const briefId = (brief.body as { brief_id: string }).brief_id;
    const briefAgain = await niceBackendFetch(`${AGENT_BASE}/briefs`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, date: "2026-08-04", summary: "Signups up 13%.", content_md: "## Brief v2" },
    });
    expect(briefAgain).toMatchObject({ status: 200, body: { brief_id: briefId } });

    // Brief-attached action item: retrying the identical request converges onto the same item.
    const actionItem = await niceBackendFetch(`${AGENT_BASE}/action-items`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, brief_id: briefId, type_id: "custom", category: "retention", tags: ["win-back"], title: "Email churned users", description: "Win-back campaign." },
    });
    expect(actionItem.status).toBe(200);
    const actionItemId = (actionItem.body as { action_item_id: string }).action_item_id;
    const actionItemAgain = await niceBackendFetch(`${AGENT_BASE}/action-items`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, brief_id: briefId, type_id: "custom", category: "retention", tags: ["win-back"], title: "Email churned users", description: "Win-back campaign." },
    });
    expect(actionItemAgain).toMatchObject({ status: 200, body: { action_item_id: actionItemId } });

    // Final dashboard-visible state. The run status stays "pending": run-level transitions belong
    // to the orchestration (driven by the growth workflows), and the agent API must never touch
    // them. enabled_tasks is frozen at 0 on the wire — scheduled tasks migrated to customer
    // workflows (see action-workflows.test.ts).
    const status = await niceBackendFetch(`${ADMIN_BASE}/status`, { accessType: "admin" });
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      analysis: { run_id: runId },
      counts: { suggested_actions: 3, enabled_tasks: 0 },
    });
    const steps = (status.body as { analysis: { steps: { state: string }[] } }).analysis.steps;
    expect(steps.every((step) => step.state === "done")).toBe(true);

    const run = await niceBackendFetch(`${ADMIN_BASE}/runs/${runId}`, { accessType: "admin" });
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ id: runId, status: "pending" });
    const phases = (run.body as { phases: { status: string, attempt: number }[] }).phases;
    expect(phases).toHaveLength(10);
    expect(phases.every((phase) => phase.status === "completed" && phase.attempt === 0)).toBe(true);
  });

  it("rejects wrong or missing agent secrets with a 401", async ({ expect }) => {
    const { projectId, branchId } = await createGrowthProjectWithIds();
    const runId = await completeOnboarding();

    const wrongSecret = await niceBackendFetch(`${AGENT_BASE}/runs/${runId}/phases/website-research/start`, {
      method: "POST",
      headers: { "authorization": "Bearer definitely-not-the-secret" },
      body: { project_id: projectId, branch_id: branchId, attempt: 0 },
    });
    expect(wrongSecret.status).toBe(401);

    const missingHeader = await niceBackendFetch(`${AGENT_BASE}/findings`, {
      method: "POST",
      body: { project_id: projectId, branch_id: branchId, source: "chat", findings: [{ kind: "note", category: "product", tags: [], title: "t", body: "b" }] },
    });
    expect(missingHeader.status).toBe(401);
  });

  it("scopes runs to the authenticated project and fences stale attempts", async ({ expect }) => {
    await createGrowthProjectWithIds();
    const foreignRunId = await completeOnboarding();

    // A second project (with the app enabled) must not be able to touch the first project's run, even
    // with the valid machine secret.
    const { projectId, branchId } = await createGrowthProjectWithIds();
    const scope = { project_id: projectId, branch_id: branchId };
    const crossProject = await niceBackendFetch(`${AGENT_BASE}/runs/${foreignRunId}/phases/website-research/start`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, attempt: 0 },
    });
    expect(crossProject.status).toBe(404);
    const crossProjectFindings = await niceBackendFetch(`${AGENT_BASE}/findings`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, run_id: foreignRunId, source: "chat", findings: [{ kind: "note", category: "product", tags: [], title: "t", body: "b" }] },
    });
    expect(crossProjectFindings.status).toBe(404);

    const runId = await completeOnboarding();
    // Zombie fence: a lifecycle call echoing any attempt other than the stored one is rejected.
    const staleAttempt = await niceBackendFetch(`${AGENT_BASE}/runs/${runId}/phases/website-research/complete`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, attempt: 99 },
    });
    expect(staleAttempt.status).toBe(409);

    // Heartbeats are only legal while the phase is running.
    const earlyHeartbeat = await niceBackendFetch(`${AGENT_BASE}/runs/${runId}/phases/website-research/heartbeat`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, attempt: 0 },
    });
    expect(earlyHeartbeat.status).toBe(409);
  });

  it("validates content-write inputs loudly", async ({ expect }) => {
    const { projectId, branchId } = await createGrowthProjectWithIds();
    const scope = { project_id: projectId, branch_id: branchId };
    const runId = await completeOnboarding();

    const badSource = await niceBackendFetch(`${AGENT_BASE}/findings`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, run_id: runId, source: "made-up-source", findings: [{ kind: "note", category: "product", tags: [], title: "t", body: "b" }] },
    });
    expect(badSource.status).toBe(400);

    const badType = await niceBackendFetch(`${AGENT_BASE}/action-items`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, type_id: "made-up-type", category: "conversion", tags: [], title: "t", description: "d" },
    });
    expect(badType.status).toBe(400);

    const badDate = await niceBackendFetch(`${AGENT_BASE}/briefs`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { ...scope, date: "2026-02-30", summary: "s", content_md: "c" },
    });
    expect(badDate.status).toBe(400);

    const badWatchedMetric = await niceBackendFetch(`${AGENT_BASE}/report`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: {
        ...scope,
        run_id: runId,
        summary: "s",
        content_md: "c",
        action_items: [{ type_id: "run_ads", category: "reach", tags: [], title: "t", description: "d", watched_metrics: [{ metric_id: "nonsense", window_days: 14 }] }],
      },
    });
    expect(badWatchedMetric.status).toBe(400);
  });

  it("rejects agent requests for projects without the growth app", async ({ expect }) => {
    const { projectId, branchId } = await createGrowthProjectWithIds();
    const runId = await completeOnboarding();
    // Disable the app again: the agent secret alone must not grant access to a project that never
    // opted into growth.
    await Project.updateConfig({ "apps.installed.gtm.enabled": false });
    const disabled = await niceBackendFetch(`${AGENT_BASE}/runs/${runId}/phases/website-research/start`, {
      method: "POST",
      headers: GROWTH_AGENT_AUTH,
      body: { project_id: projectId, branch_id: branchId, attempt: 0 },
    });
    expect(disabled.status).toBe(400);
  });
});
