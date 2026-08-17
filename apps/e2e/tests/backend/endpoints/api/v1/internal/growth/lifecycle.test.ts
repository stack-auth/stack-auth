import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../../backend-helpers";
import { createGrowthProject, requireRunId } from "./growth-helpers";

const BASE_PATH = "/api/latest/internal/growth";

// Dynamic run ids make inline snapshots impractical for the run-shaped responses, so those use
// toMatchObject (deliberate deviation from the usual snapshot preference); the pre-onboarding
// status is fully deterministic and snapshotted.

describe("internal growth lifecycle", () => {
  it("rejects requests without admin access and requests on projects without the app", async ({ expect }) => {
    await Project.createAndSwitch();
    // App not enabled: even an admin request is rejected with a 400.
    const disabled = await niceBackendFetch(`${BASE_PATH}/status`, { accessType: "admin" });
    expect(disabled.status).toBe(400);

    await Project.updateConfig({ "apps.installed.gtm.enabled": true });
    // Enabled, but only admin access may read the growth workspace.
    const clientAccess = await niceBackendFetch(`${BASE_PATH}/status`, { accessType: "client" });
    expect(clientAccess.status).toBe(401);
    const serverOk = await niceBackendFetch(`${BASE_PATH}/status`, { accessType: "admin" });
    expect(serverOk.status).toBe(200);
  });

  it("returns a fully deterministic status before onboarding", async ({ expect }) => {
    await createGrowthProject();
    const response = await niceBackendFetch(`${BASE_PATH}/status`, { accessType: "admin" });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "analysis": {
            "completed_at_millis": null,
            "compute_metrics": null,
            "error_message": null,
            "integrations": null,
            "run_id": null,
            "started_at_millis": null,
            "state": "none",
            "steps": null,
            "trigger": null,
          },
          "counts": {
            "active_actions": 0,
            "enabled_tasks": 0,
            "suggested_actions": 0,
          },
          "interview": {
            "answered_count": 0,
            "estimated_total": 8,
            "state": "not_ready",
          },
          "latest_brief": null,
          "latest_report": null,
          "onboarding": {
            "completed": false,
            "completed_at_millis": null,
            "website_url": null,
          },
          "orchestration": {
            "workflows": [
              {
                "active_workflow_run_state": null,
                "edited": false,
                "exists": false,
                "last_failed_run_summary": null,
                "workflow_id": "growth-analysis",
              },
              {
                "active_workflow_run_state": null,
                "edited": false,
                "exists": false,
                "last_failed_run_summary": null,
                "workflow_id": "growth-daily-brief",
              },
            ],
          },
          "release": {
            "state": "not_ready",
          },
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("completes onboarding, creates the initial run with its phase plan, and flips the status", async ({ expect }) => {
    await createGrowthProject();

    const invalidUrl = await niceBackendFetch(`${BASE_PATH}/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "not a url" },
    });
    expect(invalidUrl.status).toBe(400);

    const onboarding = await niceBackendFetch(`${BASE_PATH}/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "https://plannery.example.com", company_summary: "Project management for small teams." },
    });
    expect(onboarding.status).toBe(200);
    const runId = requireRunId(onboarding.body);

    // Onboarding is once per branch.
    const again = await niceBackendFetch(`${BASE_PATH}/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "https://plannery.example.com" },
    });
    expect(again.status).toBe(400);

    const status = await niceBackendFetch(`${BASE_PATH}/status`, { accessType: "admin" });
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      onboarding: { completed: true, website_url: "https://plannery.example.com/" },
      analysis: { state: "running", run_id: runId, trigger: "initial" },
      interview: { state: "not_ready" },
    });
    // The step checklist covers every pre-interview phase except three deliberate exclusions: the
    // report phase (runs after the interview, would only confuse the checklist), the
    // compute-metrics phase (reported via the standalone `compute_metrics` block instead), and the
    // integrations phase (reported via the standalone `integrations` block instead).
    const analysis = (status.body as {
      analysis: {
        steps: { id: string, state: string, description: string }[],
        compute_metrics: { state: string, metric_labels: string[] } | null,
        integrations: { state: string, connection_ready: boolean } | null,
      },
    }).analysis;
    expect(analysis.steps.map((step) => step.id)).toEqual([
      "website-research",
      "data-analysis",
      "analysis:optimize-above-the-fold",
      "analysis:seo-aeo-strategy",
      "analysis:traffic-quality",
      "analysis:icp-visitor-outreach",
      "interview-questions",
    ]);
    expect(analysis.steps.every((step) => step.state === "pending")).toBe(true);
    // Every row must carry the hover explanation the dashboard renders. Pinned on the wire rather than
    // only in phases.test.ts so that dropping the field from the status body is caught here too.
    expect(analysis.steps.every((step) => step.description.length > 80)).toBe(true);
    // The metric labels come from the (churning) catalog, so only shape is pinned here; the label
    // list's derivation is metric-store.test.ts's job.
    expect(analysis.compute_metrics).toMatchObject({ state: "pending" });
    expect((analysis.compute_metrics?.metric_labels ?? []).length).toBeGreaterThan(0);
    // No orchestration tick has run in this test, so compute-metrics is still pending — the
    // integrations step must report "pending" (upcoming), not "waiting" (which requires settled
    // metrics), and no ad-platform connection exists on a fresh project.
    expect(analysis.integrations).toEqual({ state: "pending", connection_ready: false });

    const run = await niceBackendFetch(`${BASE_PATH}/runs/${runId}`, { accessType: "admin" });
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ id: runId, status: "pending", trigger: "initial" });
    expect((run.body as { phases: unknown[] }).phases).toHaveLength(10);
  });

  it("refuses concurrent runs and manual runs before onboarding", async ({ expect }) => {
    await createGrowthProject();

    const beforeOnboarding = await niceBackendFetch(`${BASE_PATH}/runs`, {
      accessType: "admin",
      method: "POST",
      body: { trigger: "manual" },
    });
    expect(beforeOnboarding.status).toBe(400);

    const onboarding = await niceBackendFetch(`${BASE_PATH}/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "https://plannery.example.com" },
    });
    expect(onboarding.status).toBe(200);

    // The initial run is still active, so a manual run collides with the one-active-run unique.
    const concurrent = await niceBackendFetch(`${BASE_PATH}/runs`, {
      accessType: "admin",
      method: "POST",
      body: { trigger: "manual" },
    });
    expect(concurrent.status).toBe(409);
  });

  it("only retries failed analyses", async ({ expect }) => {
    await createGrowthProject();
    const noRun = await niceBackendFetch(`${BASE_PATH}/analysis/retry`, { accessType: "admin", method: "POST" });
    expect(noRun.status).toBe(400);

    await niceBackendFetch(`${BASE_PATH}/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "https://plannery.example.com" },
    });
    // The fresh run is pending, not failed, so retrying is still a 400.
    const pendingRun = await niceBackendFetch(`${BASE_PATH}/analysis/retry`, { accessType: "admin", method: "POST" });
    expect(pendingRun.status).toBe(400);
  });

  it("scopes run reads to the project", async ({ expect }) => {
    await createGrowthProject();
    const onboarding = await niceBackendFetch(`${BASE_PATH}/onboarding`, {
      accessType: "admin",
      method: "POST",
      body: { website_url: "https://plannery.example.com" },
    });
    const runId = requireRunId(onboarding.body);

    // A different project (with the app enabled) must not see the first project's run.
    await createGrowthProject();
    const crossProject = await niceBackendFetch(`${BASE_PATH}/runs/${runId}`, { accessType: "admin" });
    expect(crossProject.status).toBe(404);
  });
});
