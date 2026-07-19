import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../backend-helpers";

// E2E tests for the internal experiment-run lifecycle endpoints:
//   POST/GET /api/v1/internal/feature-flags/experiments/:experiment_id/runs
//   POST     .../runs/:run_id/{start,pause,resume,complete,revision}
//   GET      .../runs/:run_id/results
//   GET      /api/v1/internal/feature-flags/activity
//   GET      /api/v1/internal/feature-flags/experiment-schedule-processor
//
// Results assertions are shallow (shape only): there is no evaluation endpoint
// yet to generate real exposure data in ClickHouse, so the statistical content
// of results is covered by backend unit tests instead.

const EXPERIMENT_ID = "my-experiment";

function validExperimentConfig() {
  return {
    flag_id: "my-flag",
    assignment_unit: "user",
    traffic_allocation_basis_points: 10000,
    control_variant_id: "control",
    variants: {
      control: { weight_basis_points: 5000 },
      treatment: { weight_basis_points: 5000, flag_value: true },
    },
    primary_metric: { id: "signup", kind: "binary", event_name: "signed-up", direction: "increase" },
    attribution_window_days: 7,
  };
}

async function createProjectWithAnalytics() {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
}

async function createRun(config: unknown = validExperimentConfig()) {
  return await niceBackendFetch(`/api/v1/internal/feature-flags/experiments/${EXPERIMENT_ID}/runs`, {
    method: "POST",
    accessType: "admin",
    body: { experiment_config: config },
  });
}

async function listRuns() {
  return await niceBackendFetch(`/api/v1/internal/feature-flags/experiments/${EXPERIMENT_ID}/runs`, {
    method: "GET",
    accessType: "admin",
  });
}

async function transitionRun(runId: string, action: "start" | "pause" | "resume" | "complete", body: unknown = {}) {
  return await niceBackendFetch(`/api/v1/internal/feature-flags/experiments/${EXPERIMENT_ID}/runs/${runId}/${action}`, {
    method: "POST",
    accessType: "admin",
    body,
  });
}

describe("experiment run creation", () => {
  it("requires analytics to be enabled", async ({ expect }) => {
    await Project.createAndSwitch({ config: { magic_link_enabled: true } });
    // Analytics is disabled by default - do NOT call Project.updateConfig

    const res = await createRun();

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe("ANALYTICS_NOT_ENABLED");
  });

  it("creates a draft run with a frozen config snapshot and revision hash", async ({ expect }) => {
    await createProjectWithAnalytics();

    const res = await createRun();

    expect(res.status).toBe(201);
    // config_revision_hash is not stripped by the snapshot serializer, so it
    // is asserted separately and replaced before snapshotting the body.
    expect(res.body.config_revision_hash).toMatch(/^[0-9a-f]{64}$/);
    expect({ ...res.body, config_revision_hash: "<asserted above>" }).toMatchInlineSnapshot(`
      {
        "completed_at_millis": null,
        "config_revision_hash": "<asserted above>",
        "config_snapshot": {
          "assignment_unit": "user",
          "attribution_window_days": 7,
          "control_variant_id": "control",
          "flag_id": "my-flag",
          "guardrail_metrics": [],
          "primary_metric": {
            "direction": "increase",
            "event_name": "signed-up",
            "id": "signup",
            "kind": "binary",
          },
          "secondary_metrics": [],
          "traffic_allocation_basis_points": 10000,
          "variants": {
            "control": { "weight_basis_points": 5000 },
            "treatment": {
              "flag_value": true,
              "weight_basis_points": 5000,
            },
          },
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "created_by_user_id": null,
        "experiment_id": "my-experiment",
        "id": "<stripped UUID>",
        "paused_at_millis": null,
        "revision_number": 1,
        "scheduled_end_at_millis": null,
        "scheduled_start_at_millis": null,
        "started_at_millis": null,
        "state": "draft",
      }
    `);
  });

  it("rejects invalid experiment configurations", async ({ expect }) => {
    await createProjectWithAnalytics();

    // Variant weights not summing to exactly 10000 basis points
    const badWeightsRes = await createRun({
      ...validExperimentConfig(),
      variants: {
        control: { weight_basis_points: 5000 },
        treatment: { weight_basis_points: 4000 },
      },
    });
    expect(badWeightsRes.status).toBe(400);
    expect(badWeightsRes.body).toContain("Variant weights must sum to exactly 10000 basis points");

    // control_variant_id that is not a key of variants
    const badControlRes = await createRun({
      ...validExperimentConfig(),
      control_variant_id: "missing",
    });
    expect(badControlRes.status).toBe(400);
    expect(badControlRes.body).toContain("control_variant_id \"missing\" is not a key of variants");

    // Metric event names must be customer event names, not reserved ones
    const badMetricRes = await createRun({
      ...validExperimentConfig(),
      primary_metric: { id: "signup", kind: "binary", event_name: "$page-view", direction: "increase" },
    });
    expect(badMetricRes.status).toBe(400);
    expect(badMetricRes.body).toContain("Metric event names must be customer event names");

    // At least 2 variants are required
    const singleVariantRes = await createRun({
      ...validExperimentConfig(),
      variants: {
        control: { weight_basis_points: 10000 },
      },
    });
    expect(singleVariantRes.status).toBe(400);
    expect(singleVariantRes.body).toContain("Experiments must define between 2 and 10 variants");
  });

  it("lists created runs", async ({ expect }) => {
    await createProjectWithAnalytics();

    const firstRes = await createRun();
    expect(firstRes.status).toBe(201);
    const secondRes = await createRun();
    expect(secondRes.status).toBe(201);

    const res = await listRuns();
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    // Ordered newest-first, but two drafts created in the same millisecond
    // could tie-break by id, so assert order-insensitively.
    const byString = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
    expect(res.body.items.map((r: any) => r.id).sort(byString)).toEqual([firstRes.body.id, secondRes.body.id].sort(byString));
    expect(res.body.items.map((r: any) => r.revision_number).sort((a: number, b: number) => a - b)).toEqual([1, 2]);
    expect(res.body.items.every((r: any) => r.state === "draft")).toBe(true);
    expect(res.body.items.every((r: any) => r.experiment_id === EXPERIMENT_ID)).toBe(true);
  });
});

describe("experiment run lifecycle transitions", () => {
  it("supports the start -> pause -> resume -> complete happy path", async ({ expect }) => {
    await createProjectWithAnalytics();
    const createRes = await createRun();
    expect(createRes.status).toBe(201);
    const runId = createRes.body.id;

    const startRes = await transitionRun(runId, "start");
    expect(startRes.status).toBe(200);
    expect(startRes.body.state).toBe("running");
    expect(startRes.body.started_at_millis).toEqual(expect.any(Number));

    const pauseRes = await transitionRun(runId, "pause");
    expect(pauseRes.status).toBe(200);
    expect(pauseRes.body.state).toBe("paused");
    expect(pauseRes.body.paused_at_millis).toEqual(expect.any(Number));

    const resumeRes = await transitionRun(runId, "resume");
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.state).toBe("running");

    const completeRes = await transitionRun(runId, "complete");
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.state).toBe("completed");
    expect(completeRes.body.completed_at_millis).toEqual(expect.any(Number));

    // Transitions never touch the frozen snapshot.
    expect(completeRes.body.config_revision_hash).toBe(createRes.body.config_revision_hash);
  });

  it("rejects invalid transitions with 409", async ({ expect }) => {
    await createProjectWithAnalytics();

    // Starting a completed run
    const firstCreateRes = await createRun();
    expect(firstCreateRes.status).toBe(201);
    const completedRunId = firstCreateRes.body.id;
    expect((await transitionRun(completedRunId, "start")).status).toBe(200);
    expect((await transitionRun(completedRunId, "complete")).status).toBe(200);
    const restartRes = await transitionRun(completedRunId, "start");
    expect(restartRes.status).toBe(409);
    expect(restartRes.body).toBe("Experiment run cannot be started in its current state");

    // Pausing a draft run
    const secondCreateRes = await createRun();
    expect(secondCreateRes.status).toBe(201);
    const draftRunId = secondCreateRes.body.id;
    const pauseDraftRes = await transitionRun(draftRunId, "pause");
    expect(pauseDraftRes.status).toBe(409);
    expect(pauseDraftRes.body).toBe("Experiment run cannot be paused in its current state");

    // Resuming a running (not paused) run
    expect((await transitionRun(draftRunId, "start")).status).toBe(200);
    const resumeRunningRes = await transitionRun(draftRunId, "resume");
    expect(resumeRunningRes.status).toBe(409);
    expect(resumeRunningRes.body).toBe("Experiment run cannot be resumed in its current state");
  });

  it("allows only one active run per experiment", async ({ expect }) => {
    await createProjectWithAnalytics();

    const firstCreateRes = await createRun();
    expect(firstCreateRes.status).toBe(201);
    const secondCreateRes = await createRun();
    expect(secondCreateRes.status).toBe(201);

    expect((await transitionRun(firstCreateRes.body.id, "start")).status).toBe(200);

    const secondStartRes = await transitionRun(secondCreateRes.body.id, "start");
    expect(secondStartRes.status).toBe(409);
    expect(secondStartRes.body).toBe("Another run of this experiment is already active");
  });

  it("freezes the config snapshot at start and keeps it immutable afterwards", async ({ expect }) => {
    await createProjectWithAnalytics();
    const createRes = await createRun();
    expect(createRes.status).toBe(201);
    const runId = createRes.body.id;

    // Starting with a config override re-freezes the snapshot from the
    // override; the draft snapshot was only provisional.
    const overrideConfig = { ...validExperimentConfig(), attribution_window_days: 14 };
    const startRes = await transitionRun(runId, "start", { experiment_config: overrideConfig });
    expect(startRes.status).toBe(200);
    expect(startRes.body.state).toBe("running");
    expect(startRes.body.config_snapshot.attribution_window_days).toBe(14);
    expect(startRes.body.config_revision_hash).not.toBe(createRes.body.config_revision_hash);

    const listRes = await listRuns();
    expect(listRes.status).toBe(200);
    const runningRun = listRes.body.items.find((r: any) => r.id === runId);
    expect(runningRun.state).toBe("running");
    expect(runningRun.config_snapshot).toEqual(startRes.body.config_snapshot);
    expect(runningRun.config_revision_hash).toBe(startRes.body.config_revision_hash);

    // Completing does not change the frozen snapshot or its hash.
    const completeRes = await transitionRun(runId, "complete");
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.config_revision_hash).toBe(startRes.body.config_revision_hash);
    expect(completeRes.body.config_snapshot).toEqual(startRes.body.config_snapshot);
  });
});

describe("experiment run revisions", () => {
  it("creates an immediately-running successor and completes the predecessor", async ({ expect }) => {
    await createProjectWithAnalytics();
    const createRes = await createRun();
    expect(createRes.status).toBe(201);
    const oldRunId = createRes.body.id;
    expect((await transitionRun(oldRunId, "start")).status).toBe(200);
    const oldHash = createRes.body.config_revision_hash;

    const revisedConfig = { ...validExperimentConfig(), traffic_allocation_basis_points: 5000 };
    const revisionRes = await niceBackendFetch(`/api/v1/internal/feature-flags/experiments/${EXPERIMENT_ID}/runs/${oldRunId}/revision`, {
      method: "POST",
      accessType: "admin",
      body: { experiment_config: revisedConfig },
    });
    expect(revisionRes.status).toBe(200);
    expect(revisionRes.body.state).toBe("running");
    expect(revisionRes.body.revision_number).toBe(2);
    expect(revisionRes.body.id).not.toBe(oldRunId);
    expect(revisionRes.body.config_revision_hash).not.toBe(oldHash);
    expect(revisionRes.body.config_snapshot.traffic_allocation_basis_points).toBe(5000);

    const listRes = await listRuns();
    expect(listRes.status).toBe(200);
    const oldRun = listRes.body.items.find((r: any) => r.id === oldRunId);
    expect(oldRun.state).toBe("completed");
    // The predecessor keeps its own frozen snapshot; its exposures/results
    // stay attached to the old revision hash.
    expect(oldRun.config_revision_hash).toBe(oldHash);
  });

  it("rejects revising a draft run with 409", async ({ expect }) => {
    await createProjectWithAnalytics();
    const createRes = await createRun();
    expect(createRes.status).toBe(201);

    const revisionRes = await niceBackendFetch(`/api/v1/internal/feature-flags/experiments/${EXPERIMENT_ID}/runs/${createRes.body.id}/revision`, {
      method: "POST",
      accessType: "admin",
      body: { experiment_config: validExperimentConfig() },
    });
    expect(revisionRes.status).toBe(409);
    expect(revisionRes.body).toBe("Experiment run cannot be revised in its current state");
  });
});

describe("experiment run results", () => {
  async function getResults(runId: string) {
    return await niceBackendFetch(`/api/v1/internal/feature-flags/experiments/${EXPERIMENT_ID}/runs/${runId}/results`, {
      method: "GET",
      accessType: "admin",
    });
  }

  it("returns 400 for a draft run and result shape for a started run", async ({ expect }) => {
    await createProjectWithAnalytics();
    const createRes = await createRun();
    expect(createRes.status).toBe(201);
    const runId = createRes.body.id;

    const draftResultsRes = await getResults(runId);
    expect(draftResultsRes.status).toBe(400);
    expect(draftResultsRes.body).toBe("Experiment run has not started yet, so there are no results");

    expect((await transitionRun(runId, "start")).status).toBe(200);

    // With no exposure data (no evaluation endpoint exists yet), only the
    // shape is asserted: srm and winner must be present, and with zero
    // subjects there can be no winner.
    const resultsRes = await getResults(runId);
    expect(resultsRes.status).toBe(200);
    expect(resultsRes.body.srm).toEqual({ detected: false, statistic: null, p_value: null });
    expect(resultsRes.body.winner).toEqual({ status: "no_winner", reason: "insufficient_data" });
    expect(resultsRes.body.winner_rollout).toBe(null);
  });
});

describe("feature flag activity feed", () => {
  it("returns the audit entries of a run's lifecycle", async ({ expect }) => {
    await createProjectWithAnalytics();
    const createRes = await createRun();
    expect(createRes.status).toBe(201);
    const runId = createRes.body.id;
    expect((await transitionRun(runId, "start")).status).toBe(200);
    expect((await transitionRun(runId, "pause")).status).toBe(200);
    expect((await transitionRun(runId, "resume")).status).toBe(200);
    expect((await transitionRun(runId, "complete")).status).toBe(200);

    const activityRes = await niceBackendFetch("/api/v1/internal/feature-flags/activity", {
      method: "GET",
      accessType: "admin",
      query: {
        resource_type: "experiment_run",
        resource_id: runId,
      },
    });
    expect(activityRes.status).toBe(200);
    expect(activityRes.body.next_cursor).toBe(null);
    // Newest-first audit trail of the transitions above.
    expect(activityRes.body.items.map((item: any) => item.action)).toMatchInlineSnapshot(`
      [
        "completed",
        "resumed",
        "paused",
        "started",
        "created",
      ]
    `);
    expect(activityRes.body.items.every((item: any) => item.source === "admin_api")).toBe(true);
    expect(activityRes.body.items.every((item: any) => item.actor_type === "admin_key")).toBe(true);
  });
});

describe("experiment schedule processor", () => {
  // The e2e environment configures the backend with CRON_SECRET=mock_cron_secret
  // (same invocation pattern as the email-queue-step and failed-emails-digest
  // cron tests).
  const cronHeaders = { "Authorization": "Bearer mock_cron_secret" };

  it("rejects invalid cron authorization", async ({ expect }) => {
    const res = await niceBackendFetch("/api/v1/internal/feature-flags/experiment-schedule-processor", {
      method: "GET",
      headers: { "Authorization": "Bearer some_invalid_secret" },
    });
    expect(res).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": "Invalid cron authorization",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("starts runs whose scheduled start time has passed, idempotently", async ({ expect }) => {
    await createProjectWithAnalytics();

    const createRes = await createRun({
      ...validExperimentConfig(),
      schedule: { start_at_millis: Date.now() - 60_000 },
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.state).toBe("draft");
    expect(createRes.body.scheduled_start_at_millis).toEqual(expect.any(Number));
    const runId = createRes.body.id;

    const firstProcessRes = await niceBackendFetch("/api/v1/internal/feature-flags/experiment-schedule-processor", {
      method: "GET",
      headers: cronHeaders,
    });
    expect(firstProcessRes.status).toBe(200);
    // The processor is global, so parallel test workers may contribute
    // additional started/completed runs; at minimum ours must be included.
    expect(firstProcessRes.body.started).toBeGreaterThanOrEqual(1);

    const listRes = await listRuns();
    expect(listRes.status).toBe(200);
    const run = listRes.body.items.find((r: any) => r.id === runId);
    expect(run.state).toBe("running");
    expect(run.started_at_millis).toEqual(expect.any(Number));

    // Idempotency: a second invocation must not touch the already-started run.
    // (The global started count can't be asserted to be 0 because other test
    // workers may have scheduled runs of their own, so assert on the run.)
    const secondProcessRes = await niceBackendFetch("/api/v1/internal/feature-flags/experiment-schedule-processor", {
      method: "GET",
      headers: cronHeaders,
    });
    expect(secondProcessRes.status).toBe(200);

    const secondListRes = await listRuns();
    expect(secondListRes.status).toBe(200);
    const runAfterSecondProcess = secondListRes.body.items.find((r: any) => r.id === runId);
    expect(runAfterSecondProcess.state).toBe("running");
    expect(runAfterSecondProcess.started_at_millis).toBe(run.started_at_millis);
  });
});
