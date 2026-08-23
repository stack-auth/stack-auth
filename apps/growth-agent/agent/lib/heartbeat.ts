import { phaseHeartbeat } from "#lib/hexclave-client.ts";
import { parsePhaseContinuationToken, type PhaseSessionIdentity } from "#lib/phase-continuation.ts";
import type { PhaseSettlementContext } from "#lib/phase-settlement.ts";

/**
 * Spacing between two beats for the same phase. The backend engine reaps phases that have not
 * heartbeated for 15 minutes, so 60s leaves ~15 missed beats of slack before a live run gets reaped:
 * transient backend blips won't kill a run, while a genuinely dead session is detected within the
 * reap window.
 */
const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Upper bound on how long we keep beating for one session. The keepalive normally stops on the
 * session's terminal event; this cap is the backstop for a terminal event we never observe (process
 * restart on the emitting side, dropped event), so a phase whose session is really gone still
 * becomes reapable instead of being kept alive forever by our own timer.
 */
const KEEPALIVE_MAX_MS = 6 * 60 * 60_000;

type PhaseKeepalive = {
  readonly identity: PhaseSessionIdentity,
  readonly timer: ReturnType<typeof setInterval>,
  readonly startedAt: number,
  lastBeatAt: number | null,
  inFlight: boolean,
};

const keepalivesByToken = new Map<string, PhaseKeepalive>();

export function shouldBeatPhaseNow(lastBeatAt: number | null, now: number): boolean {
  return lastBeatAt == null || now - lastBeatAt >= HEARTBEAT_INTERVAL_MS;
}

export function hasKeepaliveExpired(startedAt: number, now: number): boolean {
  return now - startedAt >= KEEPALIVE_MAX_MS;
}

/**
 * Minimal local stand-in for @hexclave/shared's `runAsynchronously` (this app does not depend on the
 * shared package): detaches a promise from a context that cannot await it — a timer callback, or an
 * eve event handler we must not block, since the runtime may deliver a session's events one at a
 * time and a slow beat would then delay the session's own progress and terminal events. The two-arg
 * `.then` marks the promise as handled for the floating-promise lint while keeping the error path
 * explicit.
 */
function runDetached(label: string, fn: () => Promise<void>): void {
  fn().then(
    () => undefined,
    (error: unknown) => console.error(`[growth-agent] ${label}`, error),
  );
}

function beatDetached(keepalive: PhaseKeepalive): void {
  // Skip while a beat is still in flight (e.g. the backend is slow); overlapping beats add load
  // without adding liveness signal.
  if (keepalive.inFlight) return;
  keepalive.inFlight = true;
  keepalive.lastBeatAt = performance.now();
  const identity = keepalive.identity;
  runDetached(`phase heartbeat failed (will retry on the next beat): run=${identity.run_id} phase=${identity.phase_key} attempt=${identity.attempt}`, async () => {
    try {
      await phaseHeartbeat(identity);
    } finally {
      keepalive.inFlight = false;
    }
  });
}

function startKeepalive(token: string, identity: PhaseSessionIdentity): PhaseKeepalive {
  const timer = setInterval(() => {
    const existing = keepalivesByToken.get(token);
    if (existing == null) return;
    if (hasKeepaliveExpired(existing.startedAt, performance.now())) {
      stopKeepalive(token);
      return;
    }
    beatDetached(existing);
  }, HEARTBEAT_INTERVAL_MS);
  // Don't let the heartbeat timer keep the process alive on shutdown.
  timer.unref();
  const keepalive: PhaseKeepalive = { identity, timer, startedAt: performance.now(), lastBeatAt: null, inFlight: false };
  keepalivesByToken.set(token, keepalive);
  return keepalive;
}

function stopKeepalive(token: string): void {
  const keepalive = keepalivesByToken.get(token);
  if (keepalive == null) return;
  clearInterval(keepalive.timer);
  keepalivesByToken.delete(token);
}

/**
 * Notes that the phase behind this session's continuation token is alive, and keeps it alive until
 * its session settles.
 *
 * Liveness is anchored on the session's own events rather than on the request that dispatched the
 * phase: that request only starts a background eve session and returns, so there is no caller left
 * to hold a timer. But events alone are not enough — a single tool call (deep research, a sandboxed
 * analysis) can run past the reap window without emitting anything into this stream, and a delegated
 * subagent's progress is not mirrored here at all. So the first event a phase session emits also
 * arms a timer that keeps beating on its behalf, and the session's terminal event disarms it.
 *
 * Sessions that carry no phase token (chat, interview, quiz, …) are ignored: they have no phase
 * lifecycle to keep alive.
 */
export function noteGrowthPhaseProgress(channel: PhaseSettlementContext): void {
  const continuationToken = channel.continuation?.token;
  if (continuationToken == null) return;
  const identity = parsePhaseContinuationToken(continuationToken);
  if (identity == null) return;
  const keepalive = keepalivesByToken.get(continuationToken) ?? startKeepalive(continuationToken, identity);
  if (!shouldBeatPhaseNow(keepalive.lastBeatAt, performance.now())) return;
  beatDetached(keepalive);
}

/**
 * Stops beating for a settled session. Called before the phase is completed or failed, so a beat
 * cannot race the terminal write and hit the backend's "phase is not running" guard.
 */
export function stopGrowthPhaseHeartbeat(channel: PhaseSettlementContext): void {
  const continuationToken = channel.continuation?.token;
  if (continuationToken == null) return;
  stopKeepalive(continuationToken);
}
