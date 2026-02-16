import { describe, expect, it } from "vitest";
import {
  getDesiredGlobalOffsetFromPlaybackState,
  getReplayFinishAction,
  applySeekState,
  INTER_TAB_GAP_FAST_FORWARD_MULTIPLIER,
} from "@/lib/session-replay-playback";

describe("getDesiredGlobalOffsetFromPlaybackState", () => {
  it("returns pausedAtGlobalMs when paused", () => {
    expect(getDesiredGlobalOffsetFromPlaybackState({
      gapFastForward: null,
      playerIsPlaying: false,
      nowMs: 1000,
      playerSpeed: 1,
      pausedAtGlobalMs: 5000,
      activeLocalOffsetMs: 3000,
      activeStreamStartTs: 100,
      globalStartTs: 0,
    })).toBe(5000);
  });

  it("computes global offset from active replayer local time when playing", () => {
    // globalOffset = activeLocalOffsetMs + (activeStreamStartTs - globalStartTs)
    expect(getDesiredGlobalOffsetFromPlaybackState({
      gapFastForward: null,
      playerIsPlaying: true,
      nowMs: 1000,
      playerSpeed: 1,
      pausedAtGlobalMs: 0,
      activeLocalOffsetMs: 2000,
      activeStreamStartTs: 500,
      globalStartTs: 100,
    })).toBe(2000 + (500 - 100));
  });

  it("falls back to pausedAtGlobalMs when playing but no active replayer", () => {
    expect(getDesiredGlobalOffsetFromPlaybackState({
      gapFastForward: null,
      playerIsPlaying: true,
      nowMs: 1000,
      playerSpeed: 1,
      pausedAtGlobalMs: 3000,
      activeLocalOffsetMs: null,
      activeStreamStartTs: null,
      globalStartTs: 0,
    })).toBe(3000);
  });

  it("computes gap fast-forward interpolation", () => {
    const wallMs = 1000;
    const nowMs = 1100; // 100ms elapsed
    const speed = 2;
    const multiplier = INTER_TAB_GAP_FAST_FORWARD_MULTIPLIER;
    const from = 5000;
    const to = 20000;

    const result = getDesiredGlobalOffsetFromPlaybackState({
      gapFastForward: { fromGlobalMs: from, toGlobalMs: to, wallMs },
      playerIsPlaying: true,
      nowMs,
      playerSpeed: speed,
      pausedAtGlobalMs: 0,
      activeLocalOffsetMs: null,
      activeStreamStartTs: null,
      globalStartTs: 0,
    });

    const expected = Math.min(to, from + (nowMs - wallMs) * speed * multiplier);
    expect(result).toBe(expected);
  });

  it("clamps gap fast-forward to toGlobalMs", () => {
    const result = getDesiredGlobalOffsetFromPlaybackState({
      gapFastForward: { fromGlobalMs: 5000, toGlobalMs: 6000, wallMs: 0 },
      playerIsPlaying: true,
      nowMs: 999999,
      playerSpeed: 4,
      pausedAtGlobalMs: 0,
      activeLocalOffsetMs: null,
      activeStreamStartTs: null,
      globalStartTs: 0,
    });

    expect(result).toBe(6000);
  });

  it("uses custom gapFastForwardMultiplier", () => {
    const result = getDesiredGlobalOffsetFromPlaybackState({
      gapFastForward: { fromGlobalMs: 0, toGlobalMs: 100000, wallMs: 0 },
      playerIsPlaying: true,
      nowMs: 100,
      playerSpeed: 1,
      pausedAtGlobalMs: 0,
      activeLocalOffsetMs: null,
      activeStreamStartTs: null,
      globalStartTs: 0,
      gapFastForwardMultiplier: 1,
    });

    expect(result).toBe(100);
  });
});

describe("getReplayFinishAction", () => {
  it("throws when hasBestTabAtCurrentTime is true", () => {
    expect(() => getReplayFinishAction({
      hasBestTabAtCurrentTime: true,
      isDownloading: false,
      nextStartGlobalOffsetMs: null,
    })).toThrow();
  });

  it("returns buffer_at_current when downloading and tab has more expected events", () => {
    const result = getReplayFinishAction({
      hasBestTabAtCurrentTime: false,
      isDownloading: true,
      nextStartGlobalOffsetMs: 10000,
      currentTabHasMoreExpectedEvents: true,
    });
    expect(result).toEqual({ type: "buffer_at_current" });
  });

  it("returns gap_fast_forward when next start exists after current offset", () => {
    const result = getReplayFinishAction({
      hasBestTabAtCurrentTime: false,
      isDownloading: false,
      nextStartGlobalOffsetMs: 10000,
      currentGlobalOffsetMs: 5000,
    });
    expect(result).toEqual({ type: "gap_fast_forward", toGlobalMs: 10000 });
  });

  it("returns gap_fast_forward when no currentGlobalOffsetMs provided", () => {
    const result = getReplayFinishAction({
      hasBestTabAtCurrentTime: false,
      isDownloading: false,
      nextStartGlobalOffsetMs: 10000,
    });
    expect(result).toEqual({ type: "gap_fast_forward", toGlobalMs: 10000 });
  });

  it("returns buffer_at_current when downloading and no next start but gap-forward is not possible", () => {
    const result = getReplayFinishAction({
      hasBestTabAtCurrentTime: false,
      isDownloading: true,
      nextStartGlobalOffsetMs: null,
    });
    expect(result).toEqual({ type: "buffer_at_current" });
  });

  it("returns finish_replay when not downloading and no next tab", () => {
    const result = getReplayFinishAction({
      hasBestTabAtCurrentTime: false,
      isDownloading: false,
      nextStartGlobalOffsetMs: null,
    });
    expect(result).toEqual({ type: "finish_replay" });
  });

  it("does not gap-forward when next start is behind current offset", () => {
    const result = getReplayFinishAction({
      hasBestTabAtCurrentTime: false,
      isDownloading: false,
      nextStartGlobalOffsetMs: 3000,
      currentGlobalOffsetMs: 5000,
    });
    // next start <= current => skip, falls through to finish
    expect(result).toEqual({ type: "finish_replay" });
  });
});

describe("applySeekState", () => {
  it("returns pausedAtGlobalMs and clearGapFastForward", () => {
    const result = applySeekState({ seekToGlobalMs: 7500 });
    expect(result).toEqual({
      pausedAtGlobalMs: 7500,
      clearGapFastForward: true,
    });
  });
});
