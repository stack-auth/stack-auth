import { phaseHeartbeat } from "#lib/hexclave-client.ts";
import { parsePhaseContinuationToken } from "#lib/phase-continuation.ts";
import type { PhaseSettlementContext } from "#lib/phase-settlement.ts";

/**
 * Minimum spacing between two beats for the same phase. The backend engine reaps phases that have
 * not heartbeated for 15 minutes, so 60s leaves ~15 missed beats of slack before a live run gets
 * reaped: transient backend blips won't kill a run, while a genuinely dead session is detected
 * within the reap window.
 */
const HEARTBEAT_MIN_INTERVAL_MS = 60_000;

/**
 * Phase liveness is event-driven rather than timer-driven, because a phase no longer runs inside the
 * request that dispatched it: that request only starts a background eve session and returns, so
 * there is no long-lived caller left to hold a `setInterval`. Instead every progress event the
 * session emits (tool results, appended assistant text, new turns) doubles as a liveness signal, and
 * a phase that emits nothing for 15 minutes is genuinely wedged — which is exactly what the backend
 * should reap.
 */
export function shouldBeatPhaseNow(lastBeatAt: number | null, now: number): boolean {
  return lastBeatAt == null || now - lastBeatAt >= HEARTBEAT_MIN_INTERVAL_MS;
}

const lastBeatAtByToken = new Map<string, number>();

/**
 * Beats the phase behind this session's continuation token, throttled to {@link
 * HEARTBEAT_MIN_INTERVAL_MS}. Sessions that carry no phase token (chat, interview, quiz, …) are
 * ignored: they have no phase lifecycle to keep alive.
 *
 * A failed beat is logged, not thrown: the caller is a channel event handler whose failure would
 * abort event delivery for the session, and a missed beat is recoverable — the next progress event
 * retries it. If every beat fails for the whole reap window the phase is reaped, which is the
 * intended dead-agent behavior.
 */
export async function beatGrowthPhaseFromProgressEvent(channel: PhaseSettlementContext): Promise<void> {
  const continuationToken = channel.continuation?.token;
  if (continuationToken == null) return;
  const identity = parsePhaseContinuationToken(continuationToken);
  if (identity == null) return;
  const now = performance.now();
  if (!shouldBeatPhaseNow(lastBeatAtByToken.get(continuationToken) ?? null, now)) return;
  // Recorded before awaiting so a slow beat also acts as the in-flight guard: overlapping beats add
  // backend load without adding liveness signal.
  lastBeatAtByToken.set(continuationToken, now);
  try {
    await phaseHeartbeat(identity);
  } catch (error) {
    console.error(`[growth-agent] phase heartbeat failed (will retry on the next progress event): run=${identity.run_id} phase=${identity.phase_key} attempt=${identity.attempt}`, error);
  }
}

/**
 * Drops the throttle bookkeeping for a settled session so the map does not grow with the process's
 * lifetime.
 */
export function forgetGrowthPhaseHeartbeat(channel: PhaseSettlementContext): void {
  const continuationToken = channel.continuation?.token;
  if (continuationToken == null) return;
  lastBeatAtByToken.delete(continuationToken);
}
