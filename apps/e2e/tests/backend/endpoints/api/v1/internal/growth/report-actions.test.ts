import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../../backend-helpers";
import { GROWTH_AGENT_AUTH, createGrowthProject, publishGrowthPresentationAsStaff, requireRunId } from "./growth-helpers";

const ADMIN_BASE = "/api/latest/internal/growth";
const AGENT_BASE = "/api/latest/internal/growth-agent";

// Growth fixtures seed sandbox-backed workflows during onboarding and can land around 60s under
// full-suite load, so default-timeout tests need 90s of headroom.

// The admin report/action surface has no write API of its own — reports and action items only come
// into existence through the machine-facing growth-agent routes. So these tests seed by "playing
// the agent" (like agent-simulation.test.ts, and deliberately WITHOUT mock-eve: no engine, no
// dispatch — phases keep attempt 0) and then exercise the admin read/ack routes on top.

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

const REPORT_SECTIONS = [
  { id: "current-state", kind: "markdown", title: "Current state", body_markdown: "Steady signups, low activation." },
  { id: "opportunities", kind: "markdown", title: "Opportunities", body_markdown: "Paid search and comparison content." },
];

const REPORT_DOCUMENT = {
  format: "growth-mdx-v1",
  source_mdx: "## Activation opportunity\n\n<Metric data=\"activation\" />\n\n<Experiment>\n\nShow a four-step checklist in empty workspaces.\n\n</Experiment>",
  data: [{
    id: "activation",
    kind: "metric",
    title: "New workspaces creating a second project",
    unit: "percent",
    source: "Workspace events · last 30 days",
    takeaway: "The second-project step is the largest activation gap.",
    value: 59,
    comparison_label: "created a first project",
    comparison_value: 74,
  }],
};

/**
 * Plays the agent through the write surfaces needed by this suite: save + complete the interview,
 * then save the report with three action items (one per registered type). Returns the ids the
 * admin surface should observe. Phase completion is intentionally omitted: run details are internal
 * analysis data and unavailable to customer tenancies, while report writes do not require phases to
 * be completed.
 */
async function seedCompletedRunWithReport(scope: { project_id: string, branch_id: string }, runId: string) {
  const questions = await niceBackendFetch(`${AGENT_BASE}/interview-questions`, {
    method: "POST",
    headers: GROWTH_AGENT_AUTH,
    body: {
      ...scope,
      run_id: runId,
      questions: [{
        question_key: "primary-goal",
        prompt: "What is your primary growth goal?",
        kind: "single",
        options: [{ id: "signups", label: "More signups" }, { id: "revenue", label: "More revenue" }],
      }],
    },
  });
  if (questions.status !== 200) {
    throw new Error(`Saving interview questions failed with status ${questions.status}.`);
  }
  const interviewComplete = await niceBackendFetch(`${AGENT_BASE}/interview/complete`, {
    method: "POST",
    headers: GROWTH_AGENT_AUTH,
    body: { ...scope, run_id: runId },
  });
  if (interviewComplete.status !== 200) {
    throw new Error(`Completing the interview failed with status ${interviewComplete.status}.`);
  }

  const artifact = await niceBackendFetch(`${AGENT_BASE}/artifacts`, {
    method: "POST",
    headers: GROWTH_AGENT_AUTH,
    body: { ...scope, run_id: runId, kind: "blog_draft", title: "Plannery vs incumbents", content: "# Draft\n\nFull post..." },
  });
  if (artifact.status !== 200) {
    throw new Error(`Saving the blog draft artifact failed with status ${artifact.status}.`);
  }
  const artifactId = (artifact.body as { artifact_id: string }).artifact_id;

  const report = await niceBackendFetch(`${AGENT_BASE}/report`, {
    method: "POST",
    headers: GROWTH_AGENT_AUTH,
    body: {
      ...scope,
      run_id: runId,
      title: "Growth analysis for Plannery",
      summary: "Focus on paid acquisition and comparison content.",
      content_md: "# Report\n\nDetails...",
      document: REPORT_DOCUMENT,
      sections: REPORT_SECTIONS,
      action_items: [
        { type_id: "run_ads", category: "reach", tags: ["search"], title: "Launch a search ads campaign", description: "Target small agencies.", document: REPORT_DOCUMENT },
        {
          type_id: "publish_blog",
          category: "reach",
          tags: ["comparison"],
          title: "Publish an SEO comparison post",
          description: "Compare against incumbents.",
          payload: { artifact_id: artifactId },
          watched_metrics: [{ metric_id: "new_signups", window_days: 30 }],
        },
        { type_id: "custom", category: "retention", tags: ["win-back"], title: "Email churned users", description: "Win-back campaign." },
      ],
    },
  });
  if (report.status !== 200) {
    throw new Error(`Saving the report failed with status ${report.status}.`);
  }
  await publishGrowthPresentationAsStaff(scope.project_id, (report.body as { report_id: string }).report_id, (report.body as { action_item_ids: string[] }).action_item_ids);
  return {
    reportId: (report.body as { report_id: string }).report_id,
    actionItemIds: (report.body as { action_item_ids: string[] }).action_item_ids,
    artifactId,
  };
}

describe.sequential("internal growth reports and actions", { timeout: 300_000 }, () => {
  it("serves the report by id and as latest, with its action items", async ({ expect }) => {
    const { projectId, branchId } = await createGrowthProjectWithIds();
    const scope = { project_id: projectId, branch_id: branchId };
    const runId = await completeOnboarding();
    const { reportId, actionItemIds } = await seedCompletedRunWithReport(scope, runId);

    // No report exists under the id "latest"-shaped lookup until we saved one — asserted implicitly
    // by the cross-project test below; here the customer-safe presentation shape must round-trip.
    const latest = await niceBackendFetch(`${ADMIN_BASE}/reports/latest`, { accessType: "admin" });
    expect(latest.status).toBe(200);
    expect(latest.body).toMatchObject({
      id: reportId,
      run_id: runId,
      presentation: { format: "sandboxed-tsx-v1", version: 1, tsx_source: "const Dashboard = () => null;" },
    });
    expect(latest.body).not.toHaveProperty("content_md");
    expect(latest.body).not.toHaveProperty("document");
    expect(latest.body).not.toHaveProperty("sections");
    const actionItems = (latest.body as { action_items: { id: string, type_id: string, status: string, title: string, description: string, has_workflow: boolean, created_at_millis: number, activated_at_millis: number | null, completed_at_millis: number | null, payload?: unknown, document?: unknown, brief_id?: unknown, report_id?: unknown, workflow?: unknown }[] }).action_items;
    expect(actionItems).toHaveLength(3);
    expect(actionItems.map((item) => item.id).sort()).toEqual([...actionItemIds].sort());
    expect(actionItems.map((item) => item.type_id)).toEqual(["run_ads", "publish_blog", "custom"]);
    for (const item of actionItems) {
      expect(item).toMatchObject({
        status: "proposed",
        title: expect.any(String),
        description: expect.any(String),
        has_workflow: expect.any(Boolean),
        activated_at_millis: null,
        completed_at_millis: null,
      });
      expect(typeof item.created_at_millis).toBe("number");
      expect(item).not.toHaveProperty("payload");
      expect(item).not.toHaveProperty("document");
      expect(item).not.toHaveProperty("brief_id");
      expect(item).not.toHaveProperty("report_id");
      expect(item).not.toHaveProperty("workflow");
    }

    const byId = await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}`, { accessType: "admin" });
    expect(byId.status).toBe(200);
    expect(byId.body).toMatchObject({ id: reportId });

    // Garbage ids must be a clean 404, not a database cast error.
    const garbageId = await niceBackendFetch(`${ADMIN_BASE}/reports/not-a-real-id`, { accessType: "admin" });
    expect(garbageId.status).toBe(404);

    // Another project (with the app enabled) must see neither the report by id nor any "latest".
    await createGrowthProjectWithIds();
    const crossProject = await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}`, { accessType: "admin" });
    expect(crossProject.status).toBe(404);
    const emptyLatest = await niceBackendFetch(`${ADMIN_BASE}/reports/latest`, { accessType: "admin" });
    expect(emptyLatest.status).toBe(404);
  });

  it("rejects non-admin access and projects without the growth app", async ({ expect }) => {
    const { projectId, branchId } = await createGrowthProjectWithIds();
    const scope = { project_id: projectId, branch_id: branchId };
    const runId = await completeOnboarding();
    const { reportId, actionItemIds } = await seedCompletedRunWithReport(scope, runId);
    const firstActionItemId = actionItemIds[0];

    const clientReport = await niceBackendFetch(`${ADMIN_BASE}/reports/latest`, { accessType: "client" });
    expect(clientReport.status).toBe(401);
    const clientActions = await niceBackendFetch(`${ADMIN_BASE}/actions`, { accessType: "client" });
    expect(clientActions.status).toBe(401);
    const clientActivate = await niceBackendFetch(`${ADMIN_BASE}/actions/${firstActionItemId}/activate`, { accessType: "client", method: "POST" });
    expect(clientActivate.status).toBe(401);

    // Disabling the app cuts off the whole surface, even for admins and existing data.
    await Project.updateConfig({ "apps.installed.gtm.enabled": false });
    const disabledReport = await niceBackendFetch(`${ADMIN_BASE}/reports/${reportId}`, { accessType: "admin" });
    expect(disabledReport.status).toBe(400);
    const disabledActions = await niceBackendFetch(`${ADMIN_BASE}/actions`, { accessType: "admin" });
    expect(disabledActions.status).toBe(400);
    const disabledMetrics = await niceBackendFetch(`${ADMIN_BASE}/actions/${firstActionItemId}/metrics`, { accessType: "admin" });
    expect(disabledMetrics.status).toBe(400);
  });
});
