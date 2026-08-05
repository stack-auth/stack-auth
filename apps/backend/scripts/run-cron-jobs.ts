import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { captureError, HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously, wait } from "@hexclave/shared/dist/utils/promises";
import { Result } from "@hexclave/shared/dist/utils/results";

const endpoints = [
  "/api/latest/internal/external-db-sync/sequencer",
  "/api/latest/internal/external-db-sync/poller",
  "/api/latest/internal/workflow-engine-step",
  "/api/latest/internal/brain-engine-step",
];

export async function waitForBackend(options: {
  baseUrl: string,
  fetchImpl?: (url: string) => Promise<{ ok: boolean }>,
  waitImpl?: (milliseconds: number) => Promise<void>,
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const waitImpl = options.waitImpl ?? wait;
  while (true) {
    const probe = await Result.fromPromise(fetchImpl(options.baseUrl));
    if (probe.status === "ok" && probe.data.ok) {
      return;
    }
    await waitImpl(1000);
  }
}

async function main() {
  if (getEnvVariable("NEXT_PUBLIC_STACK_IS_PREVIEW", "") === "true") {
    console.log("Preview mode is enabled, skipping cron jobs.");
    // Keep alive — concurrently uses -k and would kill all other processes if this exits
    setInterval(() => {}, 1 << 30);
    return;
  }
  console.log("Starting cron jobs...");
  const cronSecret = getEnvVariable('CRON_SECRET');

  const baseUrl = `http://localhost:${getEnvVariable('NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX', '81')}02`;
  await waitForBackend({ baseUrl });
  console.log("Backend is ready; starting cron jobs.");

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
      while (true) {
        const runResult = await Result.fromPromise(run(endpoint));
        if (runResult.status === "error") {
          captureError("run-cron-jobs", runResult.error);
          // Elysia's development process restarts when generated routes or
          // imported source change. Once one request fails, wait silently for
          // the backend to bind again instead of logging ECONNREFUSED every
          // second for the duration of the restart.
          await waitForBackend({ baseUrl });
        }
        await wait(1000);
      }
    });
  }
}

if (import.meta.vitest == null) {
  // eslint-disable-next-line no-restricted-syntax
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
