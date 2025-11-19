import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { upstash } from "./upstash";

const EMAIL_QUEUE_FLOW_KEY = "stack-auth-email-queue-step-flow-key";

/**
 * Enqueues the email queue step on QStash. The step is idempotent; if the publish fails we log and continue.
 */
export async function enqueueEmailQueueStep(): Promise<void> {
  const baseUrl = getEnvVariable("NEXT_PUBLIC_STACK_API_URL");
  const url = new URL("/api/v1/internal/email-queue-step", baseUrl);
  try {
    await upstash.publishJSON({
      url: url.toString(),
      method: "POST",
      body: {},
      flowControl: {
        key: EMAIL_QUEUE_FLOW_KEY,
        parallelism: 1,
        rate: 1,
      },
    });
  } catch (error) {
    captureError("enqueue-email-queue-step", error);
  }
}
