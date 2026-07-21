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
const SECOND_EXPERIMENT_ID = "my-second-experiment";
const DEFAULT_ATTRIBUTION_WINDOW_SECONDS = 7 * 24 * 60 * 60;

function validExperimentConfig() {
  return {
    hypothesis: "The treatment improves sign-up completion",
    flag_id: "my-flag",
    assignment_unit: "user",
    traffic_allocation_basis_points: 10000,
    control_variant_id: "control",
    variants: {
      control: { weight_basis_points: 5000, flag_value: false },
      treatment: { weight_basis_points: 5000, flag_value: true },
    },
    primary_metric: { id: "signup", kind: "binary", event_name: "signed-up", direction: "increase" },
    attribution_window_seconds: DEFAULT_ATTRIBUTION_WINDOW_SECONDS,
  };
}

function featureFlagsConfig(options?: {
  attributionWindowSeconds?: number,
  trafficAllocationBasisPoints?: number,
  startsAt?: string,
  endsAt?: string,
  onlyControlVariant?: boolean,
  funnelSteps?: Record<string, string>,
}) {
  const variantWeights = options?.onlyControlVariant === true ? { control: 10000 } : { control: 5000, treatment: 5000 };
  const variants = options?.onlyControlVariant === true
    ? { control: { value: false } }
    : { control: { value: false }, treatment: { value: true } };
  const primaryMetric = options?.funnelSteps === undefined ? {
    id: "signup",
    type: "custom_event",
    eventName: "signed-up",
    direction: "increase",
    attributionWindowSeconds: options?.attributionWindowSeconds ?? DEFAULT_ATTRIBUTION_WINDOW_SECONDS,
  } : {
    id: "signup",
    type: "funnel",
    direction: "increase",
    funnelSteps: options.funnelSteps,
    attributionWindowSeconds: options.attributionWindowSeconds ?? DEFAULT_ATTRIBUTION_WINDOW_SECONDS,
  };
  const experiment = {
    key: "my-experiment",
    hypothesis: "The treatment improves sign-up completion",
    flagId: "my-flag",
    assignmentUnit: "user",
    trafficAllocationBasisPoints: options?.trafficAllocationBasisPoints ?? 10000,
    controlVariantKey: "control",
    variantWeights,
    primaryMetric,
    ...(options?.startsAt === undefined ? {} : { startsAt: options.startsAt }),
    ...(options?.endsAt === undefined ? {} : { endsAt: options.endsAt }),
  };
  return {
    flags: {
      "my-flag": {
        key: "my-flag",
        type: "boolean",
        enabled: true,
        allocationSalt: "my-flag-allocation",
        fallbackVariantKey: "control",
        variants,
      },
    },
    experiments: {
      [EXPERIMENT_ID]: experiment,
      [SECOND_EXPERIMENT_ID]: { ...experiment, key: "my-second-experiment" },
    },
  };
}

async function updateFeatureFlagConfig(options?: Parameters<typeof featureFlagsConfig>[0], analyticsEnabled = true, featureFlagsEnabled = true) {
  await Project.updateConfig({
    apps: { installed: { analytics: { enabled: analyticsEnabled }, "feature-flags": { enabled: featureFlagsEnabled } } },
    featureFlags: featureFlagsConfig(options),
  });
}

async function createProjectWithAnalytics(options?: Parameters<typeof featureFlagsConfig>[0]) {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await updateFeatureFlagConfig(options);
}

async function createRun(config: unknown = validExperimentConfig(), experimentId = EXPERIMENT_ID) {
  return await niceBackendFetch(`/api/v1/internal/feature-flags/experiments/${experimentId}/runs`, {
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

async function transitionRun(runId: string, action: "start" | "pause" | "resume" | "complete", body: unknown = {}, experimentId = EXPERIMENT_ID) {
  return await niceBackendFetch(`/api/v1/internal/feature-flags/experiments/${experimentId}/runs/${runId}/${action}`, {
    method: "POST",
    accessType: "admin",
    body,
  });
}

describe("experiment run creation", () => {
  it("requires analytics to be enabled", async ({ expect }) => {
    await Project.createAndSwitch({ config: { magic_link_enabled: true } });
    await updateFeatureFlagConfig(undefined, false);

    const res = await createRun();

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe("ANALYTICS_NOT_ENABLED");
  });

  it("creates a draft run with a frozen config snapshot and revision hash", async ({ expect }) => {
    await createProjectWithAnalytics();

    const res = await createRun();

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // config_revision_hash is not stripped by the snapshot serializer, so it
    // is asserted separately and replaced before snapshotting the body.
    expect(res.body.config_revision_hash).toMatch(/^[0-9a-f]{64}$/);
    expect({ ...res.body, config_revision_hash: "<asserted above>" }).toMatchInlineSnapshot(`
      {
        "completed_at_millis": null,
        "config_revision_hash": "<asserted above>",
        "config_snapshot": {
          "assignment_unit": "user",
          "attribution_window_seconds": 604800,
          "control_variant_id": "control",
          "flag_id": "my-flag",
          "guardrail_metrics": [],
          "hypothesis": "The treatment improves sign-up completion",
          "primary_metric": {
            "direction": "increase",
            "event_name": "signed-up",
            "id": "signup",
            "kind": "binary",
          },
          "secondary_metrics": [],
          "traffic_allocation_basis_points": 10000,
          "variants": {
            "control": {
              "flag_value": false,
              "weight_basis_points": 5000,
            },
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
        control: { weight_basis_points: 5000, flag_value: false },
        treatment: { weight_basis_points: 4000, flag_value: true },
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

    // Reserved event names other than the two supported auto-capture events
    // must not be accepted as conversion metrics.
    const badMetricRes = await createRun({
      ...validExperimentConfig(),
      primary_metric: { id: "signup", kind: "binary", event_name: "$feature-flag-exposure", direction: "increase" },
    });
    expect(badMetricRes.status).toBe(400);
    expect(badMetricRes.body).toContain("Metric event names must be customer events");

    // At least 2 variants are required
    const singleVariantRes = await createRun({
      ...validExperimentConfig(),
      variants: {
        control: { weight_basis_points: 10000, flag_value: false },
      },
    });
    expect(singleVariantRes.status).toBe(400);
    expect(singleVariantRes.body).toContain("Experiments must define between 2 and 10 variants");
  });

  it("derives funnel order from canonical step ids", async ({ expect }) => {
    await createProjectWithAnalytics({
      funnelSteps: { step_2: "purchase-completed", step_1: "checkout-started" },
    });
    const funnelConfig = {
      ...validExperimentConfig(),
      primary_metric: {
        id: "signup",
        kind: "funnel",
        steps: ["checkout-started", "purchase-completed"],
        direction: "increase",
      },
    };
    const createRes = await createRun(funnelConfig);
    expect(createRes.status).toBe(201);
    expect(createRes.body.config_snapshot.primary_metric.steps).toEqual(["checkout-started", "purchase-completed"]);

    await updateFeatureFlagConfig({ funnelSteps: { opened: "checkout-started", purchased: "purchase-completed" } });
    const invalidStepIdsRes = await createRun(funnelConfig);
    expect(invalidStepIdsRes.status).toBe(400);
    expect(invalidStepIdsRes.body).toContain("must use step_1, step_2, ... notation");
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
    expect(secondStartRes.body).toBe("Another active run already targets this experiment or feature flag");
  });

  it("allows only one active experiment per feature flag", async ({ expect }) => {
    await createProjectWithAnalytics();

    const firstCreateRes = await createRun();
    const secondCreateRes = await createRun(validExperimentConfig(), SECOND_EXPERIMENT_ID);
    expect(firstCreateRes.status).toBe(201);
    expect(secondCreateRes.status).toBe(201);
    expect((await transitionRun(firstCreateRes.body.id, "start")).status).toBe(200);

    const secondStartRes = await transitionRun(secondCreateRes.body.id, "start", {}, SECOND_EXPERIMENT_ID);
    expect(secondStartRes.status).toBe(409);
    expect(secondStartRes.body).toBe("Another active run already targets this experiment or feature flag");
  });

  it("freezes the config snapshot at start and keeps it immutable afterwards", async ({ expect }) => {
    await createProjectWithAnalytics();
    const createRes = await createRun();
    expect(createRes.status).toBe(201);
    const runId = createRes.body.id;

    // The published branch definition, not the draft or request body, is the
    // source of truth when assignment begins.
    const updatedWindowSeconds = 14 * 24 * 60 * 60;
    await updateFeatureFlagConfig({ attributionWindowSeconds: updatedWindowSeconds });
    const staleStartRes = await transitionRun(runId, "start", { experiment_config: validExperimentConfig() });
    expect(staleStartRes.status).toBe(400);
    expect(staleStartRes.body).toBe("Submitted experiment configuration does not exactly match the current branch definition");

    const startRes = await transitionRun(runId, "start");
    expect(startRes.status).toBe(200);
    expect(startRes.body.state).toBe("running");
    expect(startRes.body.config_snapshot.attribution_window_seconds).toBe(updatedWindowSeconds);
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

  it("serves frozen variants when the current branch definition changes", async ({ expect }) => {
    await createProjectWithAnalytics();
    const createRes = await createRun();
    expect(createRes.status).toBe(201);
    expect((await transitionRun(createRes.body.id, "start")).status).toBe(200);

    await updateFeatureFlagConfig({ onlyControlVariant: true });
    const bootstrapRes = await niceBackendFetch("/api/v1/feature-flags/bootstrap", {
      method: "GET",
      accessType: "server",
    });
    expect(bootstrapRes.status).toBe(200);
    expect(bootstrapRes.body.config.flags["my-flag"].variants).toMatchObject({
      control: { value: false },
      treatment: { value: true },
    });
    expect(bootstrapRes.body.config.flags["my-flag"].rules[`experiment_${createRes.body.id}`].variantWeights).toEqual({
      control: 5000,
      treatment: 5000,
    });
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
    await updateFeatureFlagConfig({ trafficAllocationBasisPoints: 5000 });
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
    const scheduledStartMillis = Date.now() - 60_000;
    await createProjectWithAnalytics({ startsAt: new Date(scheduledStartMillis).toISOString() });

    const createRes = await createRun({
      ...validExperimentConfig(),
      schedule: { start_at_millis: scheduledStartMillis },
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

  it("leaves scheduled runs in draft while a required app is disabled", async ({ expect }) => {
    const scheduledStartMillis = Date.now() - 60_000;
    const configOptions = { startsAt: new Date(scheduledStartMillis).toISOString() };
    await createProjectWithAnalytics(configOptions);
    const createRes = await createRun({
      ...validExperimentConfig(),
      schedule: { start_at_millis: scheduledStartMillis },
    });
    expect(createRes.status).toBe(201);

    await updateFeatureFlagConfig(configOptions, false, true);
    expect((await niceBackendFetch("/api/v1/internal/feature-flags/experiment-schedule-processor", {
      method: "GET",
      headers: cronHeaders,
    })).status).toBe(200);
    await updateFeatureFlagConfig(configOptions, true, true);
    expect((await listRuns()).body.items.find((run: any) => run.id === createRes.body.id).state).toBe("draft");

    await updateFeatureFlagConfig(configOptions, true, false);
    expect((await niceBackendFetch("/api/v1/internal/feature-flags/experiment-schedule-processor", {
      method: "GET",
      headers: cronHeaders,
    })).status).toBe(200);
    await updateFeatureFlagConfig(configOptions, true, true);
    expect((await listRuns()).body.items.find((run: any) => run.id === createRes.body.id).state).toBe("draft");
  });

  it("reconciles cancellation and postponement from current branch config", async ({ expect }) => {
    const originalStartMillis = Date.now() - 60_000;
    await createProjectWithAnalytics({ startsAt: new Date(originalStartMillis).toISOString() });
    const cancelledRun = await createRun({
      ...validExperimentConfig(),
      schedule: { start_at_millis: originalStartMillis },
    });
    expect(cancelledRun.status).toBe(201);

    await updateFeatureFlagConfig();
    expect((await niceBackendFetch("/api/v1/internal/feature-flags/experiment-schedule-processor", {
      method: "GET",
      headers: cronHeaders,
    })).status).toBe(200);
    const cancelled = (await listRuns()).body.items.find((run: any) => run.id === cancelledRun.body.id);
    expect(cancelled.state).toBe("draft");
    expect(cancelled.scheduled_start_at_millis).toBeNull();

    const postponedStartMillis = Date.now() + 60 * 60 * 1000;
    await updateFeatureFlagConfig({ startsAt: new Date(originalStartMillis).toISOString() });
    const postponedRun = await createRun({
      ...validExperimentConfig(),
      schedule: { start_at_millis: originalStartMillis },
    });
    expect(postponedRun.status).toBe(201);
    await updateFeatureFlagConfig({ startsAt: new Date(postponedStartMillis).toISOString() });
    expect((await niceBackendFetch("/api/v1/internal/feature-flags/experiment-schedule-processor", {
      method: "GET",
      headers: cronHeaders,
    })).status).toBe(200);
    const postponed = (await listRuns()).body.items.find((run: any) => run.id === postponedRun.body.id);
    expect(postponed.state).toBe("draft");
    expect(postponed.scheduled_start_at_millis).toBe(postponedStartMillis);
  });
});
