import { phaseHeartbeat } from "#lib/hexclave-client.ts";
import { parsePhaseContinuationToken, type PhaseSessionIdentity } from "#lib/phase-continuation.ts";
import type { PhaseSettlementContext } from "#lib/phase-settlement.ts";

const HEARTBEAT_INTERVAL_MS = 60_000;

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

function runDetached(label: string, fn: () => Promise<void>): void {
  fn().then(
    () => undefined,
    (error: unknown) => console.error(`[growth-agent] ${label}`, error),
  );
}

function beatDetached(keepalive: PhaseKeepalive): void {
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

export function noteGrowthPhaseProgress(channel: PhaseSettlementContext): void {
  const continuationToken = channel.continuation?.token;
  if (continuationToken == null) return;
  const identity = parsePhaseContinuationToken(continuationToken);
  if (identity == null) return;
  const keepalive = keepalivesByToken.get(continuationToken) ?? startKeepalive(continuationToken, identity);
  if (!shouldBeatPhaseNow(keepalive.lastBeatAt, performance.now())) return;
  beatDetached(keepalive);
}

export function stopGrowthPhaseHeartbeat(channel: PhaseSettlementContext): void {
  const continuationToken = channel.continuation?.token;
  if (continuationToken == null) return;
  stopKeepalive(continuationToken);
}
