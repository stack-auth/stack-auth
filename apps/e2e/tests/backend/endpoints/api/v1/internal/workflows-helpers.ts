import { generateSecureRandomString } from "@hexclave/shared/dist/utils/crypto";
import { request } from "node:http";
import type { ExpectStatic } from "vitest";
import { STACK_BACKEND_BASE_URL } from "../../../../../helpers";
import { niceBackendFetch } from "../../../../backend-helpers";

// Shared drivers for e2e suites that exercise the workflow engine. Extracted from
// workflows.test.ts so the growth suites (growth-workflows.test.ts, action-workflows.test.ts, ...)
// can drive the same engine without duplicating the tick/poll/CRUD choreography. Behavior-identical
// to the originals; workflows.test.ts remains the canonical consumer.

export const CRON_AUTH = { "authorization": "Bearer mock_cron_secret" };
const TICK_REQUEST_TIMEOUT_MS = 660_000;
const TICK_DELAY_MS = 1_000;

function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  return error != null && typeof error === "object" && "code" in error && error.code === "ABORT_ERR";
}

export function randomSlug(prefix: string): string {
  return `${prefix}-${generateSecureRandomString(8).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "x"}`;
}

export async function tickWorkflowEngine(expect: ExpectStatic, signal?: AbortSignal): Promise<void> {
  const url = new URL("/api/v1/internal/workflow-engine-step?only_one_step=true", STACK_BACKEND_BASE_URL);
  const status = await new Promise<number>((resolve, reject) => {
    const requestHandle = request(url, {
      method: "GET",
      signal,
      headers: {
        ...CRON_AUTH,
        "x-stack-disable-artificial-development-delay": "yes",
        "x-stack-development-disable-extended-logging": "yes",
      },
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
      response.once("error", reject);
    });
    requestHandle.once("error", reject);
    requestHandle.setTimeout(TICK_REQUEST_TIMEOUT_MS, () => {
      requestHandle.destroy(new Error(`Workflow engine tick exceeded ${TICK_REQUEST_TIMEOUT_MS}ms.`));
    });
    requestHandle.end();
  });
  expect(status).toBe(200);
}

export function startBackgroundWorkflowEngineTicks(expect: ExpectStatic): { stop: () => Promise<void> } {
  let stopped = false;
  let tickError: unknown = null;
  const abortController = new AbortController();
  const loop = (async () => {
    while (!stopped) {
      try {
        await tickWorkflowEngine(expect, abortController.signal);
      } catch (error) {
        if (abortController.signal.aborted && isAbortError(error)) {
          break;
        }
        tickError = error;
        stopped = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, TICK_DELAY_MS));
    }
  })();

  return {
    async stop() {
      stopped = true;
      abortController.abort();
      await loop;
      if (tickError != null) throw tickError;
    },
  };
}

export async function withBackgroundWorkflowEngineTicks<T>(expect: ExpectStatic, fn: () => Promise<T>): Promise<T> {
  const driver = startBackgroundWorkflowEngineTicks(expect);
  let fnFailed = false;
  try {
    return await fn();
  } catch (error) {
    fnFailed = true;
    throw error;
  } finally {
    if (fnFailed) {
      try {
        await driver.stop();
      } catch {
        // Preserve the test failure that caused teardown.
      }
    } else {
      await driver.stop();
    }
  }
}

export async function pollWithTicks<T>(expect: ExpectStatic, check: () => Promise<T | null>, options: { timeoutMs?: number, driveTicks?: boolean } = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const startedAt = performance.now();
  while (true) {
    const result = await check();
    if (result != null) return result;
    if (performance.now() - startedAt > timeoutMs) throw new Error(`pollWithTicks: condition not met within ${timeoutMs}ms`);
    if (options.driveTicks !== false) await tickWorkflowEngine(expect);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export async function createWorkflow(expect: ExpectStatic, workflowId: string, source: string) {
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

export async function updateWorkflowSource(expect: ExpectStatic, workflowId: string, source: string, expectedVersion: number) {
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

/** Permanently removes the workflow, including active work and history. */
export async function retireWorkflow(expect: ExpectStatic, workflowId: string) {
  const response = await niceBackendFetch(`/api/v1/internal/workflows/${workflowId}`, {
    method: "DELETE",
    accessType: "admin",
  });
  expect(response.status).toBe(200);
}

export async function sendCustomEvent(expect: ExpectStatic, name: string, data: unknown) {
  const response = await niceBackendFetch("/api/v1/internal/workflows/events", {
    method: "POST",
    accessType: "admin",
    body: { name, data },
  });
  expect(response).toMatchObject({ status: 200, body: { event_id: expect.any(String) } });
  return response.body.event_id as string;
}

export async function listRuns(workflowId: string, query: Record<string, string> = {}) {
  const response = await niceBackendFetch(`/api/v1/internal/workflows/${workflowId}/runs`, {
    method: "GET",
    accessType: "admin",
    query,
  });
  if (response.status !== 200) throw new Error(`listRuns failed: ${JSON.stringify(response.body)}`);
  return response.body as { runs: any[], next_cursor: string | null }; // eslint-disable-line @typescript-eslint/no-explicit-any -- run shapes are backend-defined JSON; tests narrow them per-assertion, same as the original in workflows.test.ts
}
