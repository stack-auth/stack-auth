import { generateSecureRandomString } from "@hexclave/shared/dist/utils/crypto";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, InternalProjectKeys, Project, backendContext, niceBackendFetch, withInternalProject } from "../../../../backend-helpers";

// E2E tests for Hexclave Workflows v1 (internal-only rollout). These
// exercise the real engine end to end: sync -> version mint -> event ->
// run creation (runKey/onConflict) -> sandbox step execution (freestyle
// mock) -> memoization -> completion, plus cancel/upgrade/retry and the
// rollout gate on both sides.
//
// Notes on test hygiene: workflows cannot be deleted (versions are kept
// forever by design), and the internal project is shared across the whole
// e2e suite. Every workflow created here therefore (a) uses a unique random
// id, and (b) is "retired" at the end of its test by re-syncing it onto a
// custom event that is never sent again, so it stops reacting to future
// platform events/schedules.
//
// Dynamic ids/emails make inline snapshots impractical here, so these tests
// use toMatchObject assertions instead (deliberate deviation from the
// usual snapshot preference).

const CRON_AUTH = { "Authorization": "Bearer mock_cron_secret" };

function randomSlug(prefix: string): string {
  return `${prefix}-${generateSecureRandomString(8).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "x"}`;
}

async function tickWorkflowEngine(expect: any) {
  const response = await niceBackendFetch("/api/v1/internal/workflow-engine-step", {
    method: "GET",
    headers: CRON_AUTH,
    query: { only_one_step: "true" },
  });
  expect(response.status).toBe(200);
}

async function pollWithTicks<T>(expect: any, check: () => Promise<T | null>, options: { timeoutMs?: number } = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    await tickWorkflowEngine(expect);
    const result = await check();
    if (result != null) return result;
    if (Date.now() > deadline) throw new Error(`pollWithTicks: condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function createWorkflow(expect: any, workflowId: string, source: string) {
  const response = await niceBackendFetch("/api/v1/internal/workflows", {
    method: "POST",
    accessType: "admin",
    body: { id: workflowId, source },
  });
  expect(response).toMatchObject({
    status: 201,
    body: { workflow_id: workflowId, version: 1, created: true },
  });
}

async function updateWorkflowSource(expect: any, workflowId: string, source: string, expectedVersion: number) {
  const response = await niceBackendFetch(`/api/v1/internal/workflows/${workflowId}/source`, {
    method: "PATCH",
    accessType: "admin",
    body: { source },
  });
  expect(response).toMatchObject({
    status: 200,
    body: { workflow_id: workflowId, version: expectedVersion, created: true },
  });
}

/** Stops a workflow from reacting to anything ever again (see hygiene note above). */
async function retireWorkflow(expect: any, workflowId: string) {
  const response = await niceBackendFetch(`/api/v1/internal/workflows/${workflowId}/source`, {
    method: "PATCH",
    accessType: "admin",
    body: {
      source: `import { workflow, customEvent } from "@hexclave/workflows";
export default workflow("${workflowId}", { on: [customEvent("retired-${workflowId}")] }, async (event, step) => {});
`,
    },
  });
  expect(response.status).toBe(200);
  await niceBackendFetch(`/api/v1/internal/workflows/${workflowId}/runs/cancel`, {
    method: "POST",
    accessType: "admin",
    body: {},
  });
}

async function sendCustomEvent(expect: any, name: string, data: unknown) {
  const response = await niceBackendFetch("/api/v1/internal/workflows/events", {
    method: "POST",
    accessType: "admin",
    body: { name, data },
  });
  expect(response).toMatchObject({ status: 200, body: { event_id: expect.any(String) } });
  return response.body.event_id as string;
}

async function listRuns(workflowId: string, query: Record<string, string> = {}) {
  const response = await niceBackendFetch(`/api/v1/internal/workflows/${workflowId}/runs`, {
    method: "GET",
    accessType: "admin",
    query,
  });
  if (response.status !== 200) throw new Error(`listRuns failed: ${JSON.stringify(response.body)}`);
  return response.body as { runs: any[], next_cursor: string | null };
}

describe("rollout gate", () => {
  it("returns 404 from every workflows route for a non-internal project", async ({ expect }) => {
    await Auth.fastSignUp();
    const { adminAccessToken, projectId } = await Project.createAndGetAdminToken();
    backendContext.set({ projectKeys: { projectId, adminAccessToken } });

    const someUuid = "12345678-1234-5234-9234-123456789012";
    const routes: { method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: any }[] = [
      { method: "GET", path: "/api/v1/internal/workflows" },
      { method: "POST", path: "/api/v1/internal/workflows", body: { id: "gated", source: "x" } },
      { method: "PATCH", path: "/api/v1/internal/workflows/gated/source", body: { source: "x" } },
      { method: "GET", path: "/api/v1/internal/workflows/gated/versions" },
      { method: "GET", path: "/api/v1/internal/workflows/gated/runs" },
      { method: "POST", path: "/api/v1/internal/workflows/gated/runs/cancel", body: {} },
      { method: "POST", path: "/api/v1/internal/workflows/gated/runs/upgrade", body: { to_version: 1 } },
      { method: "GET", path: `/api/v1/internal/workflows/runs/${someUuid}` },
      { method: "POST", path: `/api/v1/internal/workflows/runs/${someUuid}/retry`, body: {} },
      { method: "POST", path: "/api/v1/internal/workflows/events", body: { name: "gated", data: {} } },
      { method: "GET", path: "/api/v1/internal/workflows/secrets" },
      { method: "POST", path: "/api/v1/internal/workflows/secrets", body: { key: "GATED", value: "x" } },
      { method: "DELETE", path: "/api/v1/internal/workflows/secrets/GATED" },
    ];
    for (const route of routes) {
      const response = await niceBackendFetch(route.path, {
        method: route.method,
        accessType: "admin",
        ...(route.body !== undefined ? { body: route.body } : {}),
      });
      expect(response.status, `expected 404 for ${route.method} ${route.path}`).toBe(404);
      expect(JSON.stringify(response.body)).toContain("Workflows are not available for this project");
    }
  });

  it("does not create runs on the internal project for entity mutations in other projects", async ({ expect }) => {
    const workflowId = randomSlug("e2e-isolation");
    await withInternalProject(async () => {
      await createWorkflow(expect, workflowId, `import { workflow } from "@hexclave/workflows";
export default workflow("${workflowId}", {
  on: ["user.created"],
  runKey: (event) => "user:" + event.data.id,
}, async (event, step) => {
  await step.run("noop", () => event.data.primary_email);
});
`);
    });

    // A user created in a NON-internal project must never reach the internal
    // project's workflows (events are tenancy-scoped and the gate refuses to
    // even enqueue for disabled projects).
    await Auth.fastSignUp();
    const otherEmail = `${randomSlug("isolated")}@example.com`;
    await Project.createAndSwitch();
    const createUserResponse = await niceBackendFetch("/api/v1/users", {
      method: "POST",
      accessType: "server",
      body: { primary_email: otherEmail },
    });
    expect(createUserResponse.status).toBe(201);

    await withInternalProject(async () => {
      await tickWorkflowEngine(expect);
      await tickWorkflowEngine(expect);
      const { runs } = await listRuns(workflowId);
      expect(runs.filter((run) => run.trigger_summary === otherEmail)).toEqual([]);
      await retireWorkflow(expect, workflowId);
    });
  });
});

describe("workflow lifecycle", () => {
  it("syncs, versions, runs steps durably, memoizes, dedupes by runKey, and injects secrets", { timeout: 180_000 }, async ({ expect }) => {
    await withInternalProject(async () => {
      const workflowId = randomSlug("e2e-lifecycle");
      const eventName = randomSlug("e2e-ping");
      const secretKey = `E2E_SECRET_${generateSecureRandomString(6).replace(/[^a-zA-Z0-9]/g, "").toUpperCase() || "X"}`;

      const setSecretResponse = await niceBackendFetch("/api/v1/internal/workflows/secrets", {
        method: "POST",
        accessType: "admin",
        body: { key: secretKey, value: "hunter2" },
      });
      expect(setSecretResponse.status).toBe(200);

      const source = `import { workflow, customEvent } from "@hexclave/workflows";

export default workflow("${workflowId}", {
  on: [customEvent("${eventName}")],
  runKey: (event) => "order:" + event.data.orderId,
  onConflict: "skip",
}, async (event, step) => {
  const doubled = await step.run("double", () => event.data.amount * 2);
  await step.sleep("short-nap", "1s");
  const secretValue = await step.run("read-secret", () => process.env["${secretKey}"] ?? null);
  console.log("processed order", event.data.orderId);
});
`;
      await createWorkflow(expect, workflowId, source);

      // Creating the same id twice is an explicit error.
      const duplicateResponse = await niceBackendFetch("/api/v1/internal/workflows", {
        method: "POST",
        accessType: "admin",
        body: { id: workflowId, source },
      });
      expect(duplicateResponse.status).toBe(400);

      // Unchanged source does not mint a version.
      const unchangedResponse = await niceBackendFetch(`/api/v1/internal/workflows/${workflowId}/source`, {
        method: "PATCH",
        accessType: "admin",
        body: { source },
      });
      expect(unchangedResponse).toMatchObject({ status: 200, body: { version: 1, created: false } });

      // The workflow shows up in the list with its parsed triggers.
      const listResponse = await niceBackendFetch("/api/v1/internal/workflows", { method: "GET", accessType: "admin" });
      expect(listResponse.status).toBe(200);
      const summary = listResponse.body.workflows.find((workflow: any) => workflow.id === workflowId);
      expect(summary).toMatchObject({
        id: workflowId,
        latest_version: 1,
        triggers: [{ type: "event", event_type: `custom.${eventName}` }],
      });

      // Duplicate delivery: two events mapping to the same runKey while the
      // first run is active -> onConflict "skip" collapses them to one run.
      await sendCustomEvent(expect, eventName, { orderId: "o1", amount: 21 });
      await sendCustomEvent(expect, eventName, { orderId: "o1", amount: 21 });

      const completedRun = await pollWithTicks(expect, async () => {
        const { runs } = await listRuns(workflowId);
        return runs.find((run) => run.run_key === "order:o1" && run.state === "completed") ?? null;
      }, { timeoutMs: 120_000 });

      const { runs: allRunsForKey } = await listRuns(workflowId, { run_key: "order:o1" });
      expect(allRunsForKey).toHaveLength(1);

      const detailsResponse = await niceBackendFetch(`/api/v1/internal/workflows/runs/${completedRun.id}`, {
        method: "GET",
        accessType: "admin",
      });
      expect(detailsResponse.status).toBe(200);
      const details = detailsResponse.body;
      expect(details).toMatchObject({
        id: completedRun.id,
        workflow_id: workflowId,
        run_key: "order:o1",
        state: "completed",
        version: 1,
        trigger_type: `custom.${eventName}`,
        steps_recorded: 3,
        error_summary: null,
      });
      expect(details.trigger_payload).toEqual({ orderId: "o1", amount: 21 });
      const stepsByKey = new Map<string, any>(details.steps.map((step: any) => [step.step_key, step]));
      expect(stepsByKey.get("double")).toMatchObject({ kind: "run", result: 42, executed_at_version: 1 });
      expect(stepsByKey.get("short-nap")).toMatchObject({ kind: "sleep" });
      expect(stepsByKey.get("read-secret")).toMatchObject({ kind: "run", result: "hunter2" });
      const logs = details.step_attempts.map((attempt: any) => attempt.logs ?? "").join("\n");
      expect(logs).toContain("processed order o1");

      // Secrets are write-only: the list shows keys, never values.
      const secretsResponse = await niceBackendFetch("/api/v1/internal/workflows/secrets", { method: "GET", accessType: "admin" });
      expect(secretsResponse.body.secrets.find((secret: any) => secret.key === secretKey)).toMatchObject({ key: secretKey });
      expect(JSON.stringify(secretsResponse.body)).not.toContain("hunter2");
      const deleteSecretResponse = await niceBackendFetch(`/api/v1/internal/workflows/secrets/${secretKey}`, { method: "DELETE", accessType: "admin" });
      expect(deleteSecretResponse.status).toBe(200);

      await retireWorkflow(expect, workflowId);
    });
  });

  it("rejects non-self-contained sources at sync time", async ({ expect }) => {
    await withInternalProject(async () => {
      const response = await niceBackendFetch("/api/v1/internal/workflows", {
        method: "POST",
        accessType: "admin",
        body: {
          id: randomSlug("e2e-imports"),
          source: `import fs from "fs";\nimport { workflow } from "@hexclave/workflows";\nexport default workflow("x", { on: ["user.created"] }, async () => {});`,
        },
      });
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain("self-contained");
    });
  });

  it("lets workflow code call back into the platform via hexclaveApp", { timeout: 180_000 }, async ({ expect }) => {
    await withInternalProject(async () => {
      const workflowId = randomSlug("e2e-callback");
      const eventName = randomSlug("e2e-fetch-user");
      const email = `${randomSlug("wf-user")}@example.com`;

      const createUserResponse = await niceBackendFetch("/api/v1/users", {
        method: "POST",
        accessType: "server",
        body: { primary_email: email },
      });
      expect(createUserResponse.status).toBe(201);
      const userId = createUserResponse.body.id as string;

      await createWorkflow(expect, workflowId, `import { workflow, customEvent, hexclaveApp } from "@hexclave/workflows";
export default workflow("${workflowId}", {
  on: [customEvent("${eventName}")],
  runKey: (event) => "user:" + event.data.userId,
}, async (event, step) => {
  const user = await step.run("fetch-user", () => hexclaveApp.getUser(event.data.userId));
  if (user == null) return;
  await step.run("tag-user", () => hexclaveApp.updateUser(user.id, { serverMetadata: { taggedByWorkflow: true } }));
});
`);
      await sendCustomEvent(expect, eventName, { userId });

      const completedRun = await pollWithTicks(expect, async () => {
        const { runs } = await listRuns(workflowId);
        return runs.find((run) => run.state === "completed") ?? null;
      }, { timeoutMs: 120_000 });

      const detailsResponse = await niceBackendFetch(`/api/v1/internal/workflows/runs/${completedRun.id}`, {
        method: "GET",
        accessType: "admin",
      });
      const stepsByKey = new Map<string, any>(detailsResponse.body.steps.map((step: any) => [step.step_key, step]));
      expect(stepsByKey.get("fetch-user").result).toMatchObject({ id: userId, primary_email: email });

      // The side effect actually happened, with first-party credentials.
      const userResponse = await niceBackendFetch(`/api/v1/users/${userId}`, { method: "GET", accessType: "server" });
      expect(userResponse.body.server_metadata).toEqual({ taggedByWorkflow: true });

      await retireWorkflow(expect, workflowId);
    });
  });

  it("fails runs on NonRetriableError with the user-error channel, and supports manual retry", { timeout: 180_000 }, async ({ expect }) => {
    await withInternalProject(async () => {
      const workflowId = randomSlug("e2e-failure");
      const eventName = randomSlug("e2e-boom");

      await createWorkflow(expect, workflowId, `import { workflow, customEvent, NonRetriableError } from "@hexclave/workflows";
export default workflow("${workflowId}", {
  on: [customEvent("${eventName}")],
  runKey: (event) => "boom:" + event.data.id,
}, async (event, step) => {
  await step.run("always-fails", () => {
    throw new NonRetriableError("user has no primary email");
  });
});
`);
      await sendCustomEvent(expect, eventName, { id: "b1" });

      const failedRun = await pollWithTicks(expect, async () => {
        const { runs } = await listRuns(workflowId);
        return runs.find((run) => run.state === "failed") ?? null;
      }, { timeoutMs: 120_000 });
      expect(failedRun).toMatchObject({
        state: "failed",
        failure_kind: "user",
        error_summary: "NonRetriableError: user has no primary email",
        current_step_id: "always-fails",
      });

      // NonRetriable = exactly one attempt, no backoff retries.
      const detailsResponse = await niceBackendFetch(`/api/v1/internal/workflows/runs/${failedRun.id}`, { method: "GET", accessType: "admin" });
      expect(detailsResponse.body.step_attempts).toHaveLength(1);

      // Dashboard-internal retry: fresh attempt budget, resumes from the
      // failed step (and fails again, since the code is deterministic).
      const retryResponse = await niceBackendFetch(`/api/v1/internal/workflows/runs/${failedRun.id}/retry`, {
        method: "POST",
        accessType: "admin",
        body: {},
      });
      expect(retryResponse).toMatchObject({ status: 200, body: { run_id: failedRun.id } });
      await pollWithTicks(expect, async () => {
        const { runs } = await listRuns(workflowId);
        return runs.find((run) => run.id === failedRun.id && run.state === "failed") ?? null;
      }, { timeoutMs: 120_000 });

      // Retrying a non-failed (already re-failed, so pick a bogus state):
      // canceling the failed run is rejected too (only active runs cancel).
      const cancelResponse = await niceBackendFetch(`/api/v1/internal/workflows/${workflowId}/runs/cancel`, {
        method: "POST",
        accessType: "admin",
        body: { run_key: "boom:b1" },
      });
      expect(cancelResponse).toMatchObject({ status: 200, body: { canceled_count: 0 } });

      await retireWorkflow(expect, workflowId);
    });
  });

  it("cancels sleeping runs atomically and upgrades runs with skip-on-divergence", { timeout: 240_000 }, async ({ expect }) => {
    await withInternalProject(async () => {
      const workflowId = randomSlug("e2e-upgrade");
      const eventName = randomSlug("e2e-sleepy");

      const v1Source = `import { workflow, customEvent } from "@hexclave/workflows";
export default workflow("${workflowId}", {
  on: [customEvent("${eventName}")],
  runKey: (event) => "sleepy:" + event.data.id,
}, async (event, step) => {
  const greeting = await step.run("greet", () => "hello " + event.data.id);
  await step.sleep("long-nap", "1h");
  await step.run("after-nap", () => greeting + " again");
});
`;
      await createWorkflow(expect, workflowId, v1Source);
      await sendCustomEvent(expect, eventName, { id: "s1" });

      const sleepingRun = await pollWithTicks(expect, async () => {
        const { runs } = await listRuns(workflowId);
        return runs.find((run) => run.state === "sleeping") ?? null;
      }, { timeoutMs: 120_000 });
      expect(sleepingRun).toMatchObject({
        state: "sleeping",
        version: 1,
        current_step_id: "long-nap",
        next_wake_at_millis: expect.any(Number),
      });

      // v2 RENAMES the sleep step: the sleeping run is suspended on a step
      // the new code no longer reaches -> mechanically divergent -> the
      // upgrade SKIPS it (no paused state; it keeps executing v1).
      await updateWorkflowSource(expect, workflowId, v1Source.replace(/long-nap/g, "renamed-nap"), 2);
      const divergedUpgradeResponse = await niceBackendFetch(`/api/v1/internal/workflows/${workflowId}/runs/upgrade`, {
        method: "POST",
        accessType: "admin",
        body: { to_version: 2 },
      });
      expect(divergedUpgradeResponse).toMatchObject({
        status: 200,
        body: {
          upgraded_count: 0,
          skipped: [{
            run_id: sleepingRun.id,
            run_key: "sleepy:s1",
            from_version: 1,
            diagnostic: {
              reason: "suspended-step-not-reached",
              suspended_step_key: "long-nap",
            },
          }],
        },
      });
      // The diagnostic is also persisted on the run for the dashboard.
      const divergedRun = (await listRuns(workflowId, { run_key: "sleepy:s1" })).runs[0];
      expect(divergedRun).toMatchObject({
        version: 1,
        last_upgrade_divergence: { reason: "suspended-step-not-reached" },
      });

      // v3 keeps the original step graph (plus an extra step after the
      // sleep): the replay arrives at the same suspended sleep -> clean
      // transfer.
      await updateWorkflowSource(expect, workflowId, v1Source.replace(
        `await step.run("after-nap", () => greeting + " again");`,
        `await step.run("after-nap", () => greeting + " again");\n  await step.run("extra", () => "extra");`,
      ), 3);
      const cleanUpgradeResponse = await niceBackendFetch(`/api/v1/internal/workflows/${workflowId}/runs/upgrade`, {
        method: "POST",
        accessType: "admin",
        body: { to_version: 3 },
      });
      expect(cleanUpgradeResponse).toMatchObject({
        status: 200,
        body: { upgraded_count: 1, skipped: [] },
      });
      const upgradedRun = (await listRuns(workflowId, { run_key: "sleepy:s1" })).runs[0];
      expect(upgradedRun).toMatchObject({ version: 3, state: "sleeping", last_upgrade_divergence: null });

      // Atomic query-cancel by key.
      const cancelResponse = await niceBackendFetch(`/api/v1/internal/workflows/${workflowId}/runs/cancel`, {
        method: "POST",
        accessType: "admin",
        body: { run_key: "sleepy:s1" },
      });
      expect(cancelResponse).toMatchObject({ status: 200, body: { canceled_count: 1 } });
      const canceledRun = (await listRuns(workflowId, { run_key: "sleepy:s1" })).runs[0];
      expect(canceledRun).toMatchObject({ state: "canceled" });

      // With the key freed, cancel-existing semantics are NOT in play (skip
      // default): a fresh event starts a fresh run. Versions list shows the
      // full timeline with in-flight counts.
      const versionsResponse = await niceBackendFetch(`/api/v1/internal/workflows/${workflowId}/versions`, {
        method: "GET",
        accessType: "admin",
      });
      expect(versionsResponse.status).toBe(200);
      expect(versionsResponse.body.versions.map((version: any) => version.version)).toEqual([3, 2, 1]);
      expect(versionsResponse.body.versions[0]).toMatchObject({ is_latest: true });

      await retireWorkflow(expect, workflowId);
    });
  });

  it("reacts to platform events (user.created) through the transactional outbox", { timeout: 180_000 }, async ({ expect }) => {
    await withInternalProject(async () => {
      const workflowId = randomSlug("e2e-platform");
      const email = `${randomSlug("wf-platform")}@example.com`;

      await createWorkflow(expect, workflowId, `import { workflow } from "@hexclave/workflows";
export default workflow("${workflowId}", {
  on: ["user.created"],
  runKey: (event) => "user:" + event.data.id,
}, async (event, step) => {
  await step.run("snapshot-email", () => event.data.primary_email);
});
`);

      const createUserResponse = await niceBackendFetch("/api/v1/users", {
        method: "POST",
        accessType: "server",
        body: { primary_email: email },
      });
      expect(createUserResponse.status).toBe(201);

      const run = await pollWithTicks(expect, async () => {
        const { runs } = await listRuns(workflowId);
        return runs.find((r) => r.trigger_summary === email && r.state === "completed") ?? null;
      }, { timeoutMs: 120_000 });
      expect(run).toMatchObject({
        trigger_type: "user.created",
        run_key: `user:${createUserResponse.body.id}`,
      });

      await retireWorkflow(expect, workflowId);
    });
  });

  it("rejects malformed custom events", async ({ expect }) => {
    await withInternalProject(async () => {
      const prefixedResponse = await niceBackendFetch("/api/v1/internal/workflows/events", {
        method: "POST",
        accessType: "admin",
        body: { name: "custom.already-prefixed", data: {} },
      });
      expect(prefixedResponse.status).toBe(400);
      expect(JSON.stringify(prefixedResponse.body)).toContain("automatically prefixed");

      const oversizedResponse = await niceBackendFetch("/api/v1/internal/workflows/events", {
        method: "POST",
        accessType: "admin",
        body: { name: "too-big", data: { blob: "x".repeat(300 * 1024) } },
      });
      expect(oversizedResponse.status).toBe(400);
      expect(JSON.stringify(oversizedResponse.body)).toContain("256 KiB");
    });
  });
});
