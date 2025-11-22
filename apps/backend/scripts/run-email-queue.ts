import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";

async function main() {
  console.log("Starting email queue processor...");
  const cronSecret = getEnvVariable('CRON_SECRET');
  if (!cronSecret) throw new Error("CRON_SECRET environment variable is not set.");

  const baseUrl = `http://localhost:${getEnvVariable('NEXT_PUBLIC_STACK_PORT_PREFIX', '81')}02`;

  setInterval(() => {
    runAsynchronously(async () => {
      console.log("Running email queue step...");
      const res = await fetch(`${baseUrl}/api/latest/internal/email-queue-step`, {
        headers: { 'Authorization': `Bearer ${cronSecret}` },
      });
      if (!res.ok) throw new StackAssertionError(`Failed to call email queue step: ${res.status} ${res.statusText}\n${await res.text()}`, { res });
      console.log("Email queue step completed.");
    });
  }, 60000);
}

// eslint-disable-next-line no-restricted-syntax
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
