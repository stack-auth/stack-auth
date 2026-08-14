import { phaseHeartbeat } from "#lib/hexclave-client.ts";
import type { AnalysisPhaseRunRequest } from "#lib/types.ts";

/**
 * Interval between heartbeats. The backend engine reaps phases that have not
 * heartbeated for 15 minutes, so 60s gives us ~15 missed beats of slack
 * before a live run gets reaped — transient backend blips won't kill a run,
 * while a genuinely dead agent process is detected within the reap window.
 */
const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Starts the phase heartbeat loop for an in-flight analysis phase and returns
 * a stop function (call it in a `finally`). Each beat echoes the attempt
 * number, so a beat from a stale attempt is rejected by the backend's fencing
 * and shows up here as an error.
 *
 * A failed beat is logged, not thrown: the timer callback is a detachment
 * boundary (nothing awaits it, so a throw would be an unhandled rejection and
 * could crash the process), and a missed beat is recoverable — the run keeps
 * going and the next beat retries. If every beat fails for 15 minutes the
 * backend reaps the phase, which is exactly the intended dead-agent behavior.
 */
/**
 * Minimal local stand-in for @hexclave/shared's `runAsynchronously` (this app
 * does not depend on the shared package): detaches a promise from a context
 * that cannot await it (a timer callback), logging any rejection. The two-arg
 * `.then` marks the promise as handled for the floating-promise lint while
 * keeping the error path explicit.
 */
function runDetachedFromTimer(label: string, fn: () => Promise<void>): void {
  fn().then(
    () => undefined,
    (error: unknown) => console.error(`[growth-agent] ${label}`, error),
  );
}

/**
 * The loop itself, shared by every run kind that has a heartbeat endpoint. `label` is used only to
 * describe a failed beat in the log line, so it must identify the anchor without being a secret.
 */
function startHeartbeatLoop(label: string, beat: () => Promise<void>): () => void {
  let inFlight = false;
  const timer = setInterval(() => {
    // Skip a tick if the previous beat is still in flight (e.g. the backend is
    // slow); overlapping beats would add load without adding liveness signal.
    if (inFlight) return;
    inFlight = true;
    runDetachedFromTimer(`${label} heartbeat failed (will retry next interval)`, async () => {
      try {
        await beat();
      } finally {
        inFlight = false;
      }
    });
  }, HEARTBEAT_INTERVAL_MS);
  // Don't let the heartbeat timer keep the process alive on shutdown.
  timer.unref();
  return () => clearInterval(timer);
}

export function startPhaseHeartbeat(input: AnalysisPhaseRunRequest): () => void {
  return startHeartbeatLoop(
    `phase run=${input.run_id} phase=${input.phase_key} attempt=${input.attempt}`,
    async () => { await phaseHeartbeat(input); },
  );
}
