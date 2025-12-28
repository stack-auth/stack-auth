import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously, wait } from "@stackframe/stack-shared/dist/utils/promises";

async function main() {
  console.log("Starting email queue processor...");
  const cronSecret = getEnvVariable('CRON_SECRET');

  const baseUrl = `http://localhost:${getEnvVariable('NEXT_PUBLIC_STACK_PORT_PREFIX', '81')}02`;

  // Wait a few seconds to make sure the server is fully started
  await wait(5_000);

  const run = () => runAsynchronously(async () => {
    // If a the server is restarted, then the existing email queue step may be cancelled prematurely. That's why we
    // have an extra loop here to detect and restart the email queue step if it completes too quickly.
    const startTime = performance.now();
    while (true) {
      console.log("Running email queue step...");
      const res = await fetch(`${baseUrl}/api/latest/internal/email-queue-step`, {
        method: "GET",
        headers: { 'Authorization': `Bearer ${cronSecret}` },
      });
      if (!res.ok) throw new StackAssertionError(`Failed to call email queue step: ${res.status} ${res.statusText}\n${await res.text()}`, { res });
      console.log("Email queue step completed.");

      const endTime = performance.now();
      if (endTime - startTime < 58_000) {
        console.log(`Detected a server restart before email queue step completed (after ${endTime - startTime}ms). Restarting email queue step now...`);
        await wait(1_000);
      } else {
        break;
      }
    }
  });

  setInterval(() => {
    run();
  }, 60000);
  run();
}

// eslint-disable-next-line no-restricted-syntax
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
