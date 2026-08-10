import { wait } from "@hexclave/shared/dist/utils/promises";

const POLL_INTERVAL_MS = 1_000;
const MAX_RETRY_DELAY_MS = 10_000;

export async function pollForConfigPush(options: {
  shouldContinue: () => boolean,
  getPushedConfigSource: () => Promise<{ type: string }>,
  onTransientError: (error: unknown) => void,
  onPollSucceeded: () => void,
  waitForNextAttempt?: (milliseconds: number) => Promise<void>,
}): Promise<"linked" | "cancelled"> {
  const waitForNextAttempt = options.waitForNextAttempt ?? wait;
  let retryDelayMs = POLL_INTERVAL_MS;
  let consecutiveFailureReported = false;

  while (options.shouldContinue()) {
    let source: { type: string };
    try {
      source = await options.getPushedConfigSource();
    } catch (error) {
      // A status request is only an observation; retrying it cannot duplicate a
      // config push. Keep the user in the waiting flow through transient rollout
      // or network failures instead of requiring a full page reload.
      if (!options.shouldContinue()) {
        return "cancelled";
      }
      if (!consecutiveFailureReported) {
        options.onTransientError(error);
        consecutiveFailureReported = true;
      }
      await waitForNextAttempt(retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
      continue;
    }

    // The user may have navigated back while the request was in flight.
    if (!options.shouldContinue()) {
      return "cancelled";
    }

    options.onPollSucceeded();
    consecutiveFailureReported = false;
    retryDelayMs = POLL_INTERVAL_MS;
    if (source.type !== "unlinked") {
      return "linked";
    }
    await waitForNextAttempt(POLL_INTERVAL_MS);
  }

  return "cancelled";
}
