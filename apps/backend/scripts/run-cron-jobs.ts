import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, HexclaveAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";

const endpoints = [
  "/api/latest/internal/external-db-sync/sequencer",
  "/api/latest/internal/external-db-sync/poller",
];

const previewFillPoolEndpoint = "/api/latest/internal/preview/fill-pool";

const PREVIEW_FILL_POOL_ACTIVE_INTERVAL_MS = 5_000;
const PREVIEW_FILL_POOL_IDLE_INTERVAL_MS = 60_000;
const PREVIEW_FILL_POOL_ERROR_INTERVAL_MS = 10_000;
const BACKEND_HEALTH_POLL_INTERVAL_MS = 2_000;
const DEFAULT_BACKEND_HEALTH_MAX_WAIT_MS = 30_000;

type PreviewFillPoolResult = {
  ready_count_before: number,
  created_count: number,
  target_ready_count: number,
  deleted_expired_count: number,
};

function getBackendHealthMaxWaitMs(): number {
  const raw = getEnvVariable("STACK_CRON_BACKEND_READY_MAX_WAIT_MS", "");
  if (raw === "") return DEFAULT_BACKEND_HEALTH_MAX_WAIT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("STACK_CRON_BACKEND_READY_MAX_WAIT_MS must be a positive integer");
  }
  return parsed;
}

async function waitUntilBackendReady(baseUrl: string): Promise<void> {
  const maxWaitMs = getBackendHealthMaxWaitMs();
  const deadline = performance.now() + maxWaitMs;
  let lastFailure: string | undefined;

  while (performance.now() < deadline) {
    const healthResult = await Result.fromPromise(fetch(`${baseUrl}/health`));
    if (healthResult.status === "ok" && healthResult.data.ok) {
      return;
    }
    lastFailure = healthResult.status === "error"
      ? String(healthResult.error)
      : `HTTP ${healthResult.data.status}`;
    await wait(BACKEND_HEALTH_POLL_INTERVAL_MS);
  }

  throw new HexclaveAssertionError(
    `Backend at ${baseUrl} did not become healthy within ${maxWaitMs}ms (last failure: ${lastFailure ?? "unknown"})`,
    { baseUrl, maxWaitMs, lastFailure },
  );
}

function getPreviewFillPoolPollIntervalMs(result: PreviewFillPoolResult): number {
  const poolNeedsFilling = result.ready_count_before < result.target_ready_count;
  const didWork = result.created_count > 0 || result.deleted_expired_count > 0;
  if (poolNeedsFilling || didWork) {
    return PREVIEW_FILL_POOL_ACTIVE_INTERVAL_MS;
  }
  return PREVIEW_FILL_POOL_IDLE_INTERVAL_MS;
}

function logPreviewFillPoolActivity(result: PreviewFillPoolResult): void {
  const parts: string[] = [];
  if (result.created_count > 0) {
    parts.push(`created ${result.created_count}`);
  }
  if (result.deleted_expired_count > 0) {
    parts.push(`cleaned up ${result.deleted_expired_count} expired lease(s)`);
  }
  if (parts.length === 0) {
    return;
  }

  const readyCount = result.ready_count_before + result.created_count;
  console.log(`Preview pool: ${parts.join(", ")} (${readyCount}/${result.target_ready_count} ready)`);
}

async function runPreviewFillPool(baseUrl: string, cronSecret: string): Promise<PreviewFillPoolResult> {
  const res = await fetch(`${baseUrl}${previewFillPoolEndpoint}`, {
    headers: {
      "Authorization": `Bearer ${cronSecret}`,
      "x-stack-development-disable-extended-logging": "yes",
    },
  });
  if (!res.ok) {
    throw new HexclaveAssertionError(
      `Failed to call ${previewFillPoolEndpoint}: ${res.status} ${res.statusText}\n${await res.text()}`,
      { res },
    );
  }
  return await res.json() as PreviewFillPoolResult;
}

async function runPreviewFillPoolLoop(baseUrl: string, cronSecret: string): Promise<void> {
  console.log("Preview pool cron started (fills every 5s while below target, every 60s when full).");
  await waitUntilBackendReady(baseUrl);

  let isIdle = false;
  while (true) {
    const runResult = await Result.fromPromise(runPreviewFillPool(baseUrl, cronSecret));
    if (runResult.status === "error") {
      captureError("run-cron-jobs-preview", runResult.error);
      isIdle = false;
      await wait(PREVIEW_FILL_POOL_ERROR_INTERVAL_MS);
      continue;
    }

    const result = runResult.data;
    const didWork = result.created_count > 0 || result.deleted_expired_count > 0;
    const poolNeedsFilling = result.ready_count_before < result.target_ready_count;

    if (didWork) {
      logPreviewFillPoolActivity(result);
      isIdle = false;
    } else if (poolNeedsFilling) {
      isIdle = false;
    } else if (!isIdle) {
      console.log(
        `Preview pool full (${result.ready_count_before}/${result.target_ready_count} ready), `
        + `polling every ${PREVIEW_FILL_POOL_IDLE_INTERVAL_MS / 1000}s`,
      );
      isIdle = true;
    }

    await wait(getPreviewFillPoolPollIntervalMs(result));
  }
}

async function main() {
  const baseUrl = `http://localhost:${getEnvVariable('NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX', '81')}02`;

  if (getEnvVariable("NEXT_PUBLIC_STACK_IS_PREVIEW", "") === "true") {
    console.log("Preview mode is enabled, running preview-only cron jobs.");
    const cronSecret = getEnvVariable('CRON_SECRET', '');
    if (!cronSecret) {
      console.log("CRON_SECRET is not set; preview pool filling is disabled.");
      // Keep alive — concurrently uses -k and would kill all other processes if this exits
      setInterval(() => {}, 1 << 30);
      return;
    }

    runAsynchronously(() => runPreviewFillPoolLoop(baseUrl, cronSecret));
    return;
  }
  console.log("Starting cron jobs...");
  const cronSecret = getEnvVariable('CRON_SECRET');

  const run = async (endpoint: string) => {
    console.log(`Running ${endpoint}...`);
    const res = await fetch(`${baseUrl}${endpoint}`, {
      headers: { 'Authorization': `Bearer ${cronSecret}` },
    });
    if (!res.ok) throw new HexclaveAssertionError(`Failed to call ${endpoint}: ${res.status} ${res.statusText}\n${await res.text()}`, { res });
    console.log(`${endpoint} completed.`);
  };

  for (const endpoint of endpoints) {
    runAsynchronously(async () => {
      await waitUntilBackendReady(baseUrl);
      while (true) {
        const runResult = await Result.fromPromise(run(endpoint));
        if (runResult.status === "error") {
          captureError("run-cron-jobs", runResult.error);
        }
        await wait(1000);
      }
    });
  }
}

// eslint-disable-next-line no-restricted-syntax
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
