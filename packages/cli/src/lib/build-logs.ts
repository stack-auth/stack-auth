// Follows a deployment's build logs and writes them out as they arrive.
//
// A deploy spends most of its wall-clock inside ONE remote build (every service
// of the deployment source is built by the same machine), so without this the
// CLI is silent for minutes and the only way to see what the builder is doing
// is to open the dashboard. Streaming it here makes `hexclave deploy` readable
// in a terminal and, more importantly, in CI — where nobody is going to click a
// link, and the build output is the whole reason the job failed.
//
// Two properties of the backend's log endpoint shape everything below:
//
//   * It REPLAYS the whole log on every request. So resuming means skipping the
//     lines already written rather than passing a cursor — the endpoint has no
//     cursor to pass.
//   * It stops following after a few minutes and closes, expecting the client
//     to re-request. A build longer than that cap is therefore several requests
//     stitched together here, which the reader must never notice.

import { errorMessage } from "./errors.js";

// Between a "not building yet" answer (the build id isn't attached to the
// deployment yet) and the next attempt. Deliberately close to the deploy's own
// poll interval: the first build lines should appear about as promptly as the
// first status line.
const RETRY_INTERVAL_MS = 2_000;
// Consecutive transport failures before giving up on the logs. The deploy
// itself keeps running either way — losing the log tail must never fail a
// deploy that succeeded.
const MAX_CONSECUTIVE_FAILURES = 5;

// The backend's own stream markers, emitted INTO the log body (the response has
// already begun, so it has no other way to say these things). They are not
// build output: they are not replayed on the next request, so counting them
// toward the replay skip would silently drop one real line per reconnect.
export const STREAM_TIMEOUT_MARKER = "[hexclave] Log stream timed out while the build is still running; re-request to continue following.";
export const STREAM_ERROR_MARKER = "[hexclave] Log stream ended unexpectedly.";

export function isStreamMarkerLine(line: string): boolean {
  return line === STREAM_TIMEOUT_MARKER || line === STREAM_ERROR_MARKER;
}

export type FollowBuildLogsOptions = {
  /** Absolute URL of the deployment's build-log endpoint. */
  url: string,
  /** Called per request, so a long build re-authenticates with a fresh token. */
  getAuthHeaders: () => Promise<Record<string, string>>,
  /** Whether the deployment has reached a terminal state; bounds the follow loop. */
  isDeploymentFinished: () => boolean,
  /** Receives one build-log line at a time, without its trailing newline. */
  write: (line: string) => void,
  /** Receives a one-line note about a recoverable problem with the stream itself. */
  warn?: (message: string) => void,
  /** Stops the follower promptly; aborts the in-flight request too. */
  signal?: AbortSignal,
  // Injection points for tests.
  fetchImpl?: typeof fetch,
  waitImpl?: (ms: number) => Promise<void>,
};

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Streams the deployment's build logs to `write` until the build finishes, the
 * deployment reaches a terminal state, or `signal` aborts.
 *
 * Never rejects for a log-side problem: a build log that cannot be read is a
 * degraded deploy, not a failed one. It only rejects if `write` itself throws.
 */
export async function followBuildLogs(options: FollowBuildLogsOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait = options.waitImpl ?? defaultWait;
  const warn = options.warn ?? ((message: string) => console.error(message));
  // How many build-log lines have been written. Because every request replays
  // from the start, this doubles as the number of lines to skip on the next one.
  let writtenLineCount = 0;
  let consecutiveFailures = 0;
  // Once the deployment is terminal the build cannot still be producing output,
  // so exactly ONE more pass runs — enough to pick up a tail that landed between
  // the last poll and the finish — and then the loop ends. Without this the
  // follower would depend on the server ever reporting the log as complete.
  let wasFinishedBeforeLastPass = false;

  while (!(options.signal?.aborted ?? false)) {
    if (wasFinishedBeforeLastPass) return;
    wasFinishedBeforeLastPass = options.isDeploymentFinished();

    let response: Response;
    try {
      response = await fetchImpl(options.url, {
        headers: { ...await options.getAuthHeaders(), accept: "text/plain" },
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted ?? false) return;
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        warn(`Warning: gave up streaming the build logs after ${consecutiveFailures} failed attempts (${errorMessage(error)}). They are still readable in the dashboard.`);
        return;
      }
      await wait(RETRY_INTERVAL_MS);
      continue;
    }

    if (response.status === 400) {
      // "No build logs yet" — the build id is not attached to the deployment
      // yet, or this deploy never produced a build at all. Both read the same
      // from here, and the terminal-state check above ends the loop for the
      // second one, so there is nothing to report either way.
      await response.body?.cancel().catch(() => {});
      await wait(RETRY_INTERVAL_MS);
      continue;
    }
    if (!response.ok || response.body == null) {
      await response.body?.cancel().catch(() => {});
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        warn(`Warning: gave up streaming the build logs (HTTP ${response.status}). They are still readable in the dashboard.`);
        return;
      }
      await wait(RETRY_INTERVAL_MS);
      continue;
    }
    consecutiveFailures = 0;

    let seenLineCount = 0;
    // Held on an object rather than in two `let` flags: they are written from
    // inside handleLine, and TypeScript keeps narrowing plain locals to their
    // initializer across a closure it cannot see run.
    const pass = { timedOut: false, endedUnexpectedly: false };
    const handleLine = (line: string) => {
      if (line === STREAM_TIMEOUT_MARKER) {
        // Swallowed on purpose: the reconnect is transparent, so telling the
        // reader to "re-request to continue following" would be advice about a
        // mechanism they are not operating.
        pass.timedOut = true;
        return;
      }
      if (line === STREAM_ERROR_MARKER) {
        pass.endedUnexpectedly = true;
        return;
      }
      seenLineCount += 1;
      if (seenLineCount <= writtenLineCount) return;
      writtenLineCount = seenLineCount;
      options.write(line);
    };

    try {
      await readLines(response.body, handleLine, options.signal);
    } catch (error) {
      if (options.signal?.aborted ?? false) return;
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        warn(`Warning: the build log stream kept dropping (${errorMessage(error)}). The rest of it is in the dashboard.`);
        return;
      }
      await wait(RETRY_INTERVAL_MS);
      continue;
    }

    // Timed out: the build is still going, so pick straight back up rather than
    // waiting — the replay is fast and the reader is mid-build.
    if (pass.timedOut) continue;
    if (pass.endedUnexpectedly) {
      await wait(RETRY_INTERVAL_MS);
      continue;
    }
    // A clean close means the server saw the build as complete; there is no
    // more log to follow.
    return;
  }
}

/** Splits a byte stream into lines, tolerating chunk boundaries mid-line and a missing final newline. */
async function readLines(body: ReadableStream<Uint8Array>, onLine: (line: string) => void, signal: AbortSignal | undefined): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const drainBuffer = () => {
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) break;
      // Trailing \r so a builder emitting CRLF doesn't leave one on every line.
      onLine(buffer.slice(0, newlineIndex).replace(/\r$/, ""));
      buffer = buffer.slice(newlineIndex + 1);
    }
  };
  try {
    while (!(signal?.aborted ?? false)) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      drainBuffer();
    }
    buffer += decoder.decode();
    drainBuffer();
    // A final line without its newline is still a line worth showing.
    if (buffer !== "") onLine(buffer.replace(/\r$/, ""));
  } finally {
    reader.releaseLock();
  }
}
