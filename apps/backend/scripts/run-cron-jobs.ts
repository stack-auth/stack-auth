import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";

const endpoints = [
  "/api/latest/internal/external-db-sync/sequencer",
  "/api/latest/internal/external-db-sync/poller",
];

async function main() {
  console.log("Starting cron jobs...");
  const cronSecret = getEnvVariable('CRON_SECRET');

  const baseUrl = `http://localhost:${getEnvVariable('NEXT_PUBLIC_STACK_PORT_PREFIX', '81')}02`;

  const run = async (endpoint: string) => {
    console.log(`Running ${endpoint}...`);
    const res = await fetch(`${baseUrl}${endpoint}`, {
      headers: { 'Authorization': `Bearer ${cronSecret}` },
    });
    if (!res.ok) throw new StackAssertionError(`Failed to call ${endpoint}: ${res.status} ${res.statusText}\n${await res.text()}`, { res });
    console.log(`${endpoint} completed.`);
  };

  for (const endpoint of endpoints) {
    runAsynchronously(async () => {
      while (true) {
        const runResult = await Result.fromPromise(run(endpoint));
        if (runResult.status === "error") {
          captureError("run-cron-jobs", runResult.error);
        }
        // Vercel only guarantees minute-granularity for cron jobs, so we randomize the interval
        await wait(Math.random() * 120_000);
      }
    });
  }
}

// eslint-disable-next-line no-restricted-syntax
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
