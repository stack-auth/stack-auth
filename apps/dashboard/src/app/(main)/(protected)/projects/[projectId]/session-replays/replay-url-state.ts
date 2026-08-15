/**
 * Session-replay URL helpers.
 *
 * `?at=` is either a wall-clock epoch-ms (the shareable form, because a replay's
 * global offset is an implementation detail of the player) or a small offset-ms
 * for hand-edited URLs. Epoch ms from 2001 onward are 13 digits (~1e12); replay
 * durations are almost always under a day (8.64e7). 1e11 (~1973 as epoch, ~27h
 * as an offset) is the split.
 */

export const REPLAY_SEEK_EPOCH_SPLIT_MS = 100_000_000_000;

export type ReplaySeekAt =
  | { kind: "epoch", value: number }
  | { kind: "offset", value: number };

export function parseReplaySeekAt(raw: string | null): ReplaySeekAt | null {
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return null;
  if (value >= REPLAY_SEEK_EPOCH_SPLIT_MS) return { kind: "epoch", value };
  return { kind: "offset", value };
}

export function replaySeekOffsetMs(seek: ReplaySeekAt, globalStartTs: number, globalTotalMs: number): number {
  const offset = seek.kind === "epoch" ? seek.value - globalStartTs : seek.value;
  return Math.min(Math.max(offset, 0), Math.max(globalTotalMs, 0));
}
