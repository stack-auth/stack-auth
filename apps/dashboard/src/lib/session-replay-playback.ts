export const INTER_TAB_GAP_FAST_FORWARD_MULTIPLIER = 12;

export type GapFastForwardState = {
  fromGlobalMs: number,
  toGlobalMs: number,
  wallMs: number,
};

export function getDesiredGlobalOffsetFromPlaybackState(options: {
  gapFastForward: GapFastForwardState | null,
  playerIsPlaying: boolean,
  nowMs: number,
  playerSpeed: number,
  pausedAtGlobalMs: number,
  activeLocalOffsetMs: number | null,
  activeStreamStartTs: number | null,
  globalStartTs: number,
  gapFastForwardMultiplier?: number,
}) {
  const gapMultiplier = options.gapFastForwardMultiplier ?? INTER_TAB_GAP_FAST_FORWARD_MULTIPLIER;

  const gapFastForward = options.gapFastForward;
  if (gapFastForward && options.playerIsPlaying) {
    const elapsed = (options.nowMs - gapFastForward.wallMs) * options.playerSpeed * gapMultiplier;
    return Math.min(gapFastForward.toGlobalMs, gapFastForward.fromGlobalMs + elapsed);
  }

  if (!options.playerIsPlaying) return options.pausedAtGlobalMs;

  if (options.activeLocalOffsetMs === null || options.activeStreamStartTs === null) {
    return options.pausedAtGlobalMs;
  }

  return options.activeLocalOffsetMs + (options.activeStreamStartTs - options.globalStartTs);
}

export type ReplayFinishAction =
  | { type: "buffer_at_current" }
  | { type: "gap_fast_forward", toGlobalMs: number }
  | { type: "finish_replay" };

export function getReplayFinishAction(options: {
  hasBestTabAtCurrentTime: boolean,
  isDownloading: boolean,
  nextStartGlobalOffsetMs: number | null,
  currentGlobalOffsetMs?: number,
}) : ReplayFinishAction {
  if (options.hasBestTabAtCurrentTime) {
    throw new Error("getReplayFinishAction() expects hasBestTabAtCurrentTime=false");
  }
  if (
    options.nextStartGlobalOffsetMs !== null
    && (
      options.currentGlobalOffsetMs === undefined
      || options.nextStartGlobalOffsetMs > options.currentGlobalOffsetMs
    )
  ) {
    return { type: "gap_fast_forward", toGlobalMs: options.nextStartGlobalOffsetMs };
  }
  if (options.isDownloading) {
    return { type: "buffer_at_current" };
  }
  return { type: "finish_replay" };
}

export function applySeekState(options: {
  seekToGlobalMs: number,
}) {
  return {
    pausedAtGlobalMs: options.seekToGlobalMs,
    clearGapFastForward: true,
  };
}
