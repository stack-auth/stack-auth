import type { TabKey, TabStream } from "@/lib/session-replay-streams";
import {
  getDesiredGlobalOffsetFromPlaybackState,
  getReplayFinishAction,
  INTER_TAB_GAP_FAST_FORWARD_MULTIPLIER,
  applySeekState,
} from "@/lib/session-replay-playback";
import {
  globalOffsetToLocalOffset,
  localOffsetToGlobalOffset,
} from "@/lib/session-replay-streams";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";

// ---------------------------------------------------------------------------
// Shared constants (also used by the component shell)
// ---------------------------------------------------------------------------

export const ALLOWED_PLAYER_SPEEDS = new Set([0.5, 1, 2, 4]);

export const DEFAULT_REPLAY_SETTINGS: ReplaySettings = {
  playerSpeed: 1,
  skipInactivity: true,
  followActiveTab: false,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReplaySettings = {
  playerSpeed: number,
  skipInactivity: boolean,
  followActiveTab: boolean,
};

export type ChunkRange = { startTs: number, endTs: number };

export type GapFastForward = {
  fromGlobalMs: number,
  toGlobalMs: number,
  wallMs: number,
  nextTabKey: TabKey,
  gen: number,
};

export type PlaybackMode =
  | "paused"
  | "playing"
  | "buffering"
  | "gap_fast_forward"
  | "finished";

export type Phase = "idle" | "downloading" | "ready";

/** Minimal stream info the machine needs (no DOM / rrweb refs). */
export type StreamInfo = {
  tabKey: TabKey,
  firstEventAtMs: number,
  lastEventAtMs: number,
};

export type ReplayState = {
  generation: number,
  phase: Phase,

  playbackMode: PlaybackMode,
  activeTabKey: TabKey | null,
  pausedAtGlobalMs: number,
  currentGlobalTimeMsForUi: number,

  streams: StreamInfo[],
  globalStartTs: number,
  globalTotalMs: number,

  chunkRangesByTab: Map<TabKey, ChunkRange[]>,
  tabLabelIndex: Map<TabKey, number>,
  hasFullSnapshotByTab: Set<TabKey>,
  loadedDurationByTabMs: Map<TabKey, number>,
  tabsWithEvents: Set<TabKey>,

  replayerReady: Set<TabKey>,

  settings: ReplaySettings,
  autoPlayTriggered: boolean,
  suppressAutoFollowUntilWallMs: number,
  autoResumeAfterBuffering: boolean,
  bufferingAtGlobalMs: number | null,

  gapFastForward: GapFastForward | null,

  /** Tracks the localTimeMs of the last premature-finish retry so we can
   *  detect an infinite loop where rrweb keeps firing "finish" at the same
   *  position because `addEvent` didn't extend the playable range. */
  prematureFinishRetryLocalMs: number | null,

  downloadError: string | null,
  playerError: string | null,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ReplayAction =
  | { type: "SELECT_RECORDING", generation: number }
  | {
    type: "STREAMS_COMPUTED",
    generation: number,
    streams: StreamInfo[],
    globalStartTs: number,
    globalTotalMs: number,
    chunkRangesByTab: Map<TabKey, ChunkRange[]>,
    tabLabelIndex: Map<TabKey, number>,
  }
  | { type: "DOWNLOAD_COMPLETE", generation: number }
  | { type: "DOWNLOAD_ERROR", generation: number, message: string }
  | {
    type: "CHUNK_LOADED",
    generation: number,
    tabKey: TabKey,
    hasFullSnapshot: boolean,
    loadedDurationMs: number,
    hadEventsBeforeThisChunk: boolean,
  }
  | { type: "REPLAYER_READY", generation: number, tabKey: TabKey }
  | { type: "REPLAYER_INIT_ERROR", generation: number, message: string }
  | {
    type: "REPLAYER_FINISH",
    generation: number,
    tabKey: TabKey,
    localTimeMs: number,
    nowMs: number,
  }
  | { type: "TOGGLE_PLAY_PAUSE", nowMs: number }
  | { type: "SEEK", globalOffsetMs: number, nowMs: number }
  | { type: "SELECT_TAB", tabKey: TabKey, nowMs: number }
  | { type: "UPDATE_SPEED", speed: number }
  | { type: "UPDATE_SETTINGS", updates: Partial<ReplaySettings> }
  | {
    type: "TICK",
    nowMs: number,
    activeReplayerLocalTimeMs: number | null,
  }
  | { type: "BUFFER_CHECK", generation: number, tabKey: TabKey }
  | { type: "RESET" };

// ---------------------------------------------------------------------------
// Effects (data, not imperative)
// ---------------------------------------------------------------------------

export type ReplayEffect =
  | { type: "play_replayer", tabKey: TabKey, localOffsetMs: number }
  | { type: "pause_replayer_at", tabKey: TabKey, localOffsetMs: number }
  | { type: "pause_all" }
  | { type: "ensure_replayer", tabKey: TabKey, generation: number }
  | { type: "destroy_all_replayers" }
  | { type: "set_replayer_speed", speed: number }
  | { type: "set_replayer_skip_inactive", skipInactive: boolean }
  | { type: "sync_mini_tabs", globalOffsetMs: number }
  | { type: "schedule_buffer_poll", generation: number, tabKey: TabKey, localTimeMs: number, delayMs: number }
  | { type: "save_settings", settings: ReplaySettings }
  | { type: "recreate_replayer", tabKey: TabKey, generation: number };

export type ReducerResult = {
  state: ReplayState,
  effects: ReplayEffect[],
};

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export function createInitialState(settings?: ReplaySettings): ReplayState {
  return {
    generation: 0,
    phase: "idle",
    playbackMode: "paused",
    activeTabKey: null,
    pausedAtGlobalMs: 0,
    currentGlobalTimeMsForUi: 0,
    streams: [],
    globalStartTs: 0,
    globalTotalMs: 0,
    chunkRangesByTab: new Map(),
    tabLabelIndex: new Map(),
    hasFullSnapshotByTab: new Set(),
    loadedDurationByTabMs: new Map(),
    tabsWithEvents: new Set(),
    replayerReady: new Set(),
    settings: settings ?? { ...DEFAULT_REPLAY_SETTINGS },
    autoPlayTriggered: false,
    suppressAutoFollowUntilWallMs: 0,
    autoResumeAfterBuffering: false,
    bufferingAtGlobalMs: null,
    gapFastForward: null,
    prematureFinishRetryLocalMs: null,
    downloadError: null,
    playerError: null,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function findBestTabAtGlobalOffset(
  state: ReplayState,
  globalOffsetMs: number,
  excludeTabKey?: TabKey,
): TabKey | null {
  const ts = state.globalStartTs + globalOffsetMs;
  const candidates = state.streams.filter((s) => {
    if (excludeTabKey && s.tabKey === excludeTabKey) return false;
    if (!state.hasFullSnapshotByTab.has(s.tabKey)) return false;
    const ranges = state.chunkRangesByTab.get(s.tabKey) ?? [];
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = ranges[mid]!;
      if (ts < r.startTs) {
        hi = mid - 1;
      } else if (ts > r.endTs) {
        lo = mid + 1;
      } else {
        return true;
      }
    }
    return false;
  });
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aLabel = state.tabLabelIndex.get(a.tabKey) ?? Number.POSITIVE_INFINITY;
    const bLabel = state.tabLabelIndex.get(b.tabKey) ?? Number.POSITIVE_INFINITY;
    if (aLabel !== bLabel) return aLabel - bLabel;
    return stringCompare(a.tabKey, b.tabKey);
  });

  return candidates[0]!.tabKey;
}

export function isTabInRangeAtGlobalOffset(
  state: ReplayState,
  tabKey: TabKey,
  globalOffsetMs: number,
): boolean {
  if (!state.hasFullSnapshotByTab.has(tabKey)) return false;
  const ts = state.globalStartTs + globalOffsetMs;
  const ranges = state.chunkRangesByTab.get(tabKey) ?? [];
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid]!;
    if (ts < r.startTs) {
      hi = mid - 1;
    } else if (ts > r.endTs) {
      lo = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

export function findNextTabStartAfterGlobalOffset(
  state: ReplayState,
  globalOffsetMs: number,
): { tabKey: TabKey, globalOffsetMs: number } | null {
  const ts = state.globalStartTs + globalOffsetMs;
  let bestStartTs = Infinity;
  let bestKey: TabKey | null = null;

  for (const s of state.streams) {
    if (!state.hasFullSnapshotByTab.has(s.tabKey)) continue;
    const ranges = state.chunkRangesByTab.get(s.tabKey) ?? [];
    for (const r of ranges) {
      if (r.startTs <= ts) continue;
      if (r.startTs < bestStartTs) {
        bestStartTs = r.startTs;
        bestKey = s.tabKey;
      }
      break; // ranges sorted by start
    }
  }

  if (!bestKey || !Number.isFinite(bestStartTs)) return null;
  return {
    tabKey: bestKey,
    globalOffsetMs: bestStartTs - state.globalStartTs,
  };
}

function getStreamInfo(state: ReplayState, tabKey: TabKey): StreamInfo | null {
  return state.streams.find(s => s.tabKey === tabKey) ?? null;
}

function computeDesiredGlobalOffset(
  state: ReplayState,
  nowMs: number,
  activeReplayerLocalTimeMs: number | null,
): number {
  const activeStream = state.activeTabKey ? getStreamInfo(state, state.activeTabKey) : null;
  return getDesiredGlobalOffsetFromPlaybackState({
    gapFastForward: state.gapFastForward,
    playerIsPlaying: state.playbackMode === "playing" || state.playbackMode === "gap_fast_forward",
    nowMs,
    playerSpeed: state.settings.playerSpeed,
    pausedAtGlobalMs: state.pausedAtGlobalMs,
    activeLocalOffsetMs: activeReplayerLocalTimeMs,
    activeStreamStartTs: activeStream?.firstEventAtMs ?? null,
    globalStartTs: state.globalStartTs,
    gapFastForwardMultiplier: INTER_TAB_GAP_FAST_FORWARD_MULTIPLIER,
  });
}

function playEffectsForAllTabs(state: ReplayState, globalOffsetMs: number): ReplayEffect[] {
  const effects: ReplayEffect[] = [];
  for (const s of state.streams) {
    const localOffset = globalOffsetToLocalOffset(state.globalStartTs, s.firstEventAtMs, globalOffsetMs);
    if (s.tabKey === state.activeTabKey) {
      effects.push({ type: "play_replayer", tabKey: s.tabKey, localOffsetMs: localOffset });
    } else if (state.replayerReady.has(s.tabKey)) {
      effects.push({ type: "pause_replayer_at", tabKey: s.tabKey, localOffsetMs: localOffset });
    }
  }
  return effects;
}

function isStaleGeneration(state: ReplayState, generation: number): boolean {
  return generation !== state.generation;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function replayReducer(state: ReplayState, action: ReplayAction): ReducerResult {
  switch (action.type) {
    case "SELECT_RECORDING": {
      const newState: ReplayState = {
        ...createInitialState(state.settings),
        generation: action.generation,
        phase: "downloading",
      };
      return {
        state: newState,
        effects: [{ type: "destroy_all_replayers" }],
      };
    }

    case "STREAMS_COMPUTED": {
      if (isStaleGeneration(state, action.generation)) return { state, effects: [] };
      const firstStream = action.streams[0] as StreamInfo | undefined;
      const initialActive = (
        action.streams.find(s => s.firstEventAtMs === action.globalStartTs)?.tabKey
        ?? firstStream?.tabKey
        ?? null
      );
      return {
        state: {
          ...state,
          streams: action.streams,
          globalStartTs: action.globalStartTs,
          globalTotalMs: action.globalTotalMs,
          chunkRangesByTab: action.chunkRangesByTab,
          tabLabelIndex: action.tabLabelIndex,
          activeTabKey: initialActive,
          pausedAtGlobalMs: 0,
          currentGlobalTimeMsForUi: 0,
        },
        effects: [],
      };
    }

    case "DOWNLOAD_COMPLETE": {
      if (isStaleGeneration(state, action.generation)) return { state, effects: [] };

      const effects: ReplayEffect[] = [];
      let newPlaybackMode = state.playbackMode;

      // Safety net: if buffering when download finishes, resume
      if (state.bufferingAtGlobalMs !== null && state.autoResumeAfterBuffering) {
        const seekTo = state.bufferingAtGlobalMs;
        newPlaybackMode = "playing";
        effects.push(...playEffectsForAllTabs({ ...state, playbackMode: "playing", activeTabKey: state.activeTabKey }, seekTo));
      }

      return {
        state: {
          ...state,
          phase: "ready",
          playbackMode: state.bufferingAtGlobalMs !== null && state.autoResumeAfterBuffering
            ? "playing"
            : (state.playbackMode === "buffering" ? "paused" : state.playbackMode),
          bufferingAtGlobalMs: null,
          autoResumeAfterBuffering: false,
        },
        effects,
      };
    }

    case "DOWNLOAD_ERROR": {
      if (isStaleGeneration(state, action.generation)) return { state, effects: [] };
      return {
        state: {
          ...state,
          phase: "ready",
          downloadError: action.message,
        },
        effects: [],
      };
    }

    case "CHUNK_LOADED": {
      if (isStaleGeneration(state, action.generation)) return { state, effects: [] };

      const newHasFullSnapshot = new Set(state.hasFullSnapshotByTab);
      if (action.hasFullSnapshot) {
        newHasFullSnapshot.add(action.tabKey);
      }

      const newLoadedDuration = new Map(state.loadedDurationByTabMs);
      newLoadedDuration.set(action.tabKey, action.loadedDurationMs);

      const newTabsWithEvents = new Set(state.tabsWithEvents);
      newTabsWithEvents.add(action.tabKey);

      const effects: ReplayEffect[] = [];

      // Ensure replayer for any tab that has a full snapshot but no ready replayer.
      // This covers first-chunk init, tabs that got a FullSnapshot in a later chunk,
      // and retry after a failed/pending init.  ensureReplayerForTab is idempotent.
      if (newHasFullSnapshot.has(action.tabKey) && !state.replayerReady.has(action.tabKey)) {
        effects.push({ type: "ensure_replayer", tabKey: action.tabKey, generation: action.generation });
      }

      // Check if buffering can be resolved by new data
      let newPlaybackMode = state.playbackMode;
      let newBufferingAtGlobalMs = state.bufferingAtGlobalMs;
      let newAutoResumeAfterBuffering = state.autoResumeAfterBuffering;
      let newPausedAtGlobalMs = state.pausedAtGlobalMs;

      if (
        state.activeTabKey === action.tabKey
        && state.bufferingAtGlobalMs !== null
      ) {
        const stream = getStreamInfo(state, action.tabKey);
        if (stream) {
          const targetLocal = globalOffsetToLocalOffset(
            state.globalStartTs,
            stream.firstEventAtMs,
            state.bufferingAtGlobalMs,
          );
          const bufferAhead = state.phase === "downloading" ? 2000 : 0;
          if (action.loadedDurationMs >= targetLocal + bufferAhead) {
            const seekTo = state.bufferingAtGlobalMs;
            newBufferingAtGlobalMs = null;

            if (state.autoResumeAfterBuffering) {
              newAutoResumeAfterBuffering = false;
              newPlaybackMode = "playing";
              newPausedAtGlobalMs = seekTo;
              effects.push(...playEffectsForAllTabs(
                { ...state, playbackMode: "playing", activeTabKey: state.activeTabKey },
                seekTo,
              ));
            } else {
              newPlaybackMode = "paused";
            }
          }
        }
      }

      return {
        state: {
          ...state,
          hasFullSnapshotByTab: newHasFullSnapshot,
          loadedDurationByTabMs: newLoadedDuration,
          tabsWithEvents: newTabsWithEvents,
          playbackMode: newPlaybackMode,
          bufferingAtGlobalMs: newBufferingAtGlobalMs,
          autoResumeAfterBuffering: newAutoResumeAfterBuffering,
          pausedAtGlobalMs: newPausedAtGlobalMs,
        },
        effects,
      };
    }

    case "REPLAYER_READY": {
      if (isStaleGeneration(state, action.generation)) return { state, effects: [] };

      const newReplayerReady = new Set(state.replayerReady);
      newReplayerReady.add(action.tabKey);

      const isActiveTab = state.activeTabKey === action.tabKey;
      const shouldAutoPlay = !state.autoPlayTriggered && isActiveTab;
      const shouldPlay = isActiveTab && (shouldAutoPlay || (state.playbackMode === "playing"));

      const effects: ReplayEffect[] = [];
      const stream = getStreamInfo(state, action.tabKey);
      const streamStartTs = stream?.firstEventAtMs ?? state.globalStartTs;
      const desiredLocal = globalOffsetToLocalOffset(state.globalStartTs, streamStartTs, state.pausedAtGlobalMs);

      if (shouldPlay) {
        effects.push({ type: "play_replayer", tabKey: action.tabKey, localOffsetMs: desiredLocal });
      } else {
        effects.push({ type: "pause_replayer_at", tabKey: action.tabKey, localOffsetMs: desiredLocal });
      }

      return {
        state: {
          ...state,
          replayerReady: newReplayerReady,
          autoPlayTriggered: state.autoPlayTriggered || shouldAutoPlay,
          playbackMode: shouldAutoPlay && state.playbackMode !== "buffering"
            ? "playing"
            : state.playbackMode,
        },
        effects,
      };
    }

    case "REPLAYER_INIT_ERROR": {
      if (isStaleGeneration(state, action.generation)) return { state, effects: [] };
      return {
        state: { ...state, playerError: action.message },
        effects: [],
      };
    }

    case "REPLAYER_FINISH": {
      if (isStaleGeneration(state, action.generation)) return { state, effects: [] };
      if (state.activeTabKey !== action.tabKey) return { state, effects: [] };

      const localTime = action.localTimeMs;
      const loadedDurationMs = state.loadedDurationByTabMs.get(action.tabKey) ?? 0;

      // Premature finish: rrweb fires "finish" but more data was added via addEvent.
      // Guard: if we already retried at this same position, rrweb's addEvent didn't
      // extend the playable range.  Recreate the replayer with all loaded events
      // instead of looping infinitely.
      if (loadedDurationMs > localTime + 100) {
        const isRepeatedAtSamePosition =
          state.prematureFinishRetryLocalMs !== null
          && Math.abs(state.prematureFinishRetryLocalMs - localTime) < 200;

        if (isRepeatedAtSamePosition) {
          // Loop detected — recreate the rrweb Replayer with all loaded events.
          const newReplayerReady = new Set(state.replayerReady);
          newReplayerReady.delete(action.tabKey);
          return {
            state: {
              ...state,
              replayerReady: newReplayerReady,
              prematureFinishRetryLocalMs: null,
            },
            effects: [{ type: "recreate_replayer", tabKey: action.tabKey, generation: action.generation }],
          };
        }

        return {
          state: { ...state, prematureFinishRetryLocalMs: localTime },
          effects: [{ type: "play_replayer", tabKey: action.tabKey, localOffsetMs: localTime }],
        };
      }

      const stream = getStreamInfo(state, action.tabKey);
      const streamStartTs = stream?.firstEventAtMs ?? state.globalStartTs;
      const tabExpectedDurationMs = stream
        ? stream.lastEventAtMs - stream.firstEventAtMs
        : null;

      // Buffer if still downloading and tab expects more events
      if (
        state.phase === "downloading"
        && tabExpectedDurationMs !== null
        && tabExpectedDurationMs > localTime + 500
      ) {
        const globalOffset = localOffsetToGlobalOffset(state.globalStartTs, streamStartTs, localTime);
        return {
          state: {
            ...state,
            playbackMode: "buffering",
            pausedAtGlobalMs: globalOffset,
            bufferingAtGlobalMs: globalOffset,
            autoResumeAfterBuffering: true,
          },
          effects: [
            { type: "schedule_buffer_poll", generation: action.generation, tabKey: action.tabKey, localTimeMs: localTime, delayMs: 500 },
          ],
        };
      }

      let globalOffset = localOffsetToGlobalOffset(state.globalStartTs, streamStartTs, localTime);

      // Find the best OTHER tab at this offset
      let bestKey = findBestTabAtGlobalOffset(state, globalOffset, action.tabKey);

      // Retry with authoritative time if stale
      if (!bestKey && globalOffset + 500 < state.currentGlobalTimeMsForUi) {
        globalOffset = state.currentGlobalTimeMsForUi;
        bestKey = findBestTabAtGlobalOffset(state, globalOffset, action.tabKey);
      }

      // Another tab has events — switch
      if (bestKey) {
        const effects: ReplayEffect[] = [
          { type: "ensure_replayer", tabKey: bestKey, generation: action.generation },
          ...playEffectsForAllTabs(
            { ...state, activeTabKey: bestKey },
            globalOffset,
          ),
        ];
        return {
          state: {
            ...state,
            activeTabKey: bestKey,
            playbackMode: "playing",
            pausedAtGlobalMs: globalOffset,
            bufferingAtGlobalMs: null,
            autoResumeAfterBuffering: false,
            suppressAutoFollowUntilWallMs: action.nowMs + 400,
          },
          effects,
        };
      }

      // No alternative tab — gap, buffer, or true finish
      const currentTabHasMoreExpectedEvents = tabExpectedDurationMs !== null
        && tabExpectedDurationMs > localTime + 500;

      const nextStart = findNextTabStartAfterGlobalOffset(state, globalOffset);
      const finishAction = getReplayFinishAction({
        hasBestTabAtCurrentTime: false,
        isDownloading: state.phase === "downloading",
        nextStartGlobalOffsetMs: nextStart?.globalOffsetMs ?? null,
        currentGlobalOffsetMs: Math.max(globalOffset, state.currentGlobalTimeMsForUi),
        currentTabHasMoreExpectedEvents,
      });

      if (finishAction.type === "gap_fast_forward" && nextStart) {
        const gff: GapFastForward = {
          fromGlobalMs: globalOffset,
          toGlobalMs: finishAction.toGlobalMs,
          wallMs: action.nowMs,
          nextTabKey: nextStart.tabKey,
          gen: action.generation,
        };
        return {
          state: {
            ...state,
            playbackMode: "gap_fast_forward",
            gapFastForward: gff,
            pausedAtGlobalMs: globalOffset,
          },
          effects: [],
        };
      }

      if (finishAction.type === "buffer_at_current") {
        return {
          state: {
            ...state,
            playbackMode: "buffering",
            pausedAtGlobalMs: globalOffset,
            bufferingAtGlobalMs: globalOffset,
            autoResumeAfterBuffering: true,
          },
          effects: [],
        };
      }

      // True finish
      return {
        state: {
          ...state,
          playbackMode: "finished",
          pausedAtGlobalMs: state.globalTotalMs,
          currentGlobalTimeMsForUi: state.globalTotalMs,
          gapFastForward: null,
          bufferingAtGlobalMs: null,
        },
        effects: [{ type: "pause_all" }],
      };
    }

    case "TOGGLE_PLAY_PAUSE": {
      const isPlaying = state.playbackMode === "playing" || state.playbackMode === "gap_fast_forward";
      const isBuffering = state.playbackMode === "buffering";

      if (isPlaying || isBuffering) {
        // Pause
        return {
          state: {
            ...state,
            playbackMode: "paused",
            gapFastForward: null,
            bufferingAtGlobalMs: null,
            autoResumeAfterBuffering: false,
          },
          effects: [{ type: "pause_all" }],
        };
      }

      // Play
      const target = state.pausedAtGlobalMs;

      // Check if active tab needs buffering
      if (state.phase === "downloading" && state.activeTabKey) {
        const stream = getStreamInfo(state, state.activeTabKey);
        if (stream) {
          const localTarget = globalOffsetToLocalOffset(state.globalStartTs, stream.firstEventAtMs, target);
          const loaded = state.loadedDurationByTabMs.get(state.activeTabKey) ?? 0;
          if (localTarget > loaded) {
            return {
              state: {
                ...state,
                playbackMode: "buffering",
                bufferingAtGlobalMs: target,
                autoResumeAfterBuffering: true,
              },
              effects: [],
            };
          }
        }
      }

      return {
        state: {
          ...state,
          playbackMode: "playing",
          bufferingAtGlobalMs: null,
          gapFastForward: null,
          suppressAutoFollowUntilWallMs: action.nowMs + 400,
        },
        effects: playEffectsForAllTabs(state, target),
      };
    }

    case "SEEK": {
      const seekState = applySeekState({ seekToGlobalMs: action.globalOffsetMs });
      let newActiveTabKey = state.activeTabKey;
      const effects: ReplayEffect[] = [];

      // Switch tab if seek target is outside active tab's range
      const desiredKey = findBestTabAtGlobalOffset(state, action.globalOffsetMs);
      if (desiredKey && desiredKey !== state.activeTabKey) {
        newActiveTabKey = desiredKey;
        effects.push({ type: "ensure_replayer", tabKey: desiredKey, generation: state.generation });
      }

      const stateWithNewTab = { ...state, activeTabKey: newActiveTabKey };

      // Check if buffering needed
      if (state.phase === "downloading" && newActiveTabKey) {
        const stream = getStreamInfo(state, newActiveTabKey);
        if (stream) {
          const localTarget = globalOffsetToLocalOffset(state.globalStartTs, stream.firstEventAtMs, action.globalOffsetMs);
          const loaded = state.loadedDurationByTabMs.get(newActiveTabKey) ?? 0;
          if (localTarget > loaded) {
            effects.push({ type: "pause_all" });
            return {
              state: {
                ...stateWithNewTab,
                playbackMode: "buffering",
                pausedAtGlobalMs: seekState.pausedAtGlobalMs,
                gapFastForward: null,
                bufferingAtGlobalMs: action.globalOffsetMs,
                autoResumeAfterBuffering: true,
                prematureFinishRetryLocalMs: null,
              },
              effects,
            };
          }
        }
      }

      effects.push(...playEffectsForAllTabs(stateWithNewTab, action.globalOffsetMs));

      return {
        state: {
          ...stateWithNewTab,
          playbackMode: "playing",
          pausedAtGlobalMs: seekState.pausedAtGlobalMs,
          gapFastForward: null,
          bufferingAtGlobalMs: null,
          autoResumeAfterBuffering: false,
          currentGlobalTimeMsForUi: action.globalOffsetMs,
          suppressAutoFollowUntilWallMs: action.nowMs + 400,
          prematureFinishRetryLocalMs: null,
        },
        effects,
      };
    }

    case "SELECT_TAB": {
      const effects: ReplayEffect[] = [{ type: "pause_all" }];
      const wasPlaying = state.playbackMode === "playing" || state.playbackMode === "gap_fast_forward";

      // Check if buffering needed for the new tab
      if (state.phase === "downloading") {
        const stream = getStreamInfo(state, action.tabKey);
        if (stream) {
          const localTarget = globalOffsetToLocalOffset(state.globalStartTs, stream.firstEventAtMs, state.pausedAtGlobalMs);
          const loaded = state.loadedDurationByTabMs.get(action.tabKey) ?? 0;
          if (localTarget > loaded) {
            effects.push({ type: "ensure_replayer", tabKey: action.tabKey, generation: state.generation });
            return {
              state: {
                ...state,
                activeTabKey: action.tabKey,
                playbackMode: "buffering",
                gapFastForward: null,
                bufferingAtGlobalMs: state.pausedAtGlobalMs,
                autoResumeAfterBuffering: true,
                suppressAutoFollowUntilWallMs: action.nowMs + 5000,
                prematureFinishRetryLocalMs: null,
              },
              effects,
            };
          }
        }
      }

      effects.push({ type: "ensure_replayer", tabKey: action.tabKey, generation: state.generation });

      if (wasPlaying) {
        effects.push(...playEffectsForAllTabs({ ...state, activeTabKey: action.tabKey }, state.pausedAtGlobalMs));
      }

      return {
        state: {
          ...state,
          activeTabKey: action.tabKey,
          playbackMode: wasPlaying ? "playing" : "paused",
          gapFastForward: null,
          bufferingAtGlobalMs: null,
          autoResumeAfterBuffering: false,
          suppressAutoFollowUntilWallMs: action.nowMs + 5000,
          prematureFinishRetryLocalMs: null,
        },
        effects,
      };
    }

    case "UPDATE_SPEED": {
      if (!ALLOWED_PLAYER_SPEEDS.has(action.speed)) return { state, effects: [] };
      const newSettings = { ...state.settings, playerSpeed: action.speed };
      return {
        state: { ...state, settings: newSettings },
        effects: [
          { type: "set_replayer_speed", speed: action.speed },
          { type: "save_settings", settings: newSettings },
        ],
      };
    }

    case "UPDATE_SETTINGS": {
      const newSettings = { ...state.settings, ...action.updates };
      const effects: ReplayEffect[] = [
        { type: "save_settings", settings: newSettings },
      ];

      if (action.updates.skipInactivity !== undefined) {
        effects.push({ type: "set_replayer_skip_inactive", skipInactive: action.updates.skipInactivity });
      }

      return {
        state: { ...state, settings: newSettings },
        effects,
      };
    }

    case "TICK": {
      let globalOffset = computeDesiredGlobalOffset(state, action.nowMs, action.activeReplayerLocalTimeMs);
      const previousGlobalOffset = state.currentGlobalTimeMsForUi;
      const effects: ReplayEffect[] = [];

      // Monotonicity guard: during playing, don't let stale rrweb readings jump back
      if (
        state.playbackMode === "playing"
        && !state.gapFastForward
        && action.nowMs >= state.suppressAutoFollowUntilWallMs
        && globalOffset + 500 < previousGlobalOffset
      ) {
        globalOffset = previousGlobalOffset;
      }

      let newState = { ...state, currentGlobalTimeMsForUi: globalOffset };

      // Sync mini tabs
      if (state.playbackMode === "playing") {
        effects.push({ type: "sync_mini_tabs", globalOffsetMs: globalOffset });
      }

      // Gap fast-forward completion
      const gff = state.gapFastForward;
      if (gff && globalOffset >= gff.toGlobalMs) {
        newState = {
          ...newState,
          gapFastForward: null,
          activeTabKey: gff.nextTabKey,
          playbackMode: "playing",
          pausedAtGlobalMs: gff.toGlobalMs,
          currentGlobalTimeMsForUi: gff.toGlobalMs,
          bufferingAtGlobalMs: null,
          autoResumeAfterBuffering: false,
          suppressAutoFollowUntilWallMs: action.nowMs + 200,
        };
        effects.push(
          { type: "ensure_replayer", tabKey: gff.nextTabKey, generation: gff.gen },
          ...playEffectsForAllTabs(newState, gff.toGlobalMs),
        );
        return { state: newState, effects };
      }

      // Auto-follow active tab
      if (
        state.settings.followActiveTab
        && state.playbackMode === "playing"
        && state.streams.length > 1
      ) {
        if (action.nowMs >= state.suppressAutoFollowUntilWallMs) {
          const activeInRange = state.activeTabKey
            ? isTabInRangeAtGlobalOffset(state, state.activeTabKey, globalOffset)
            : false;
          if (!activeInRange) {
            const bestKey = findBestTabAtGlobalOffset(state, globalOffset);
            if (bestKey && bestKey !== state.activeTabKey) {
              newState = {
                ...newState,
                activeTabKey: bestKey,
                pausedAtGlobalMs: globalOffset,
                suppressAutoFollowUntilWallMs: action.nowMs + 200,
              };
              effects.push(
                { type: "ensure_replayer", tabKey: bestKey, generation: state.generation },
                ...playEffectsForAllTabs(newState, globalOffset),
              );
            }
          }
        }
      }

      return { state: newState, effects };
    }

    case "BUFFER_CHECK": {
      if (isStaleGeneration(state, action.generation)) return { state, effects: [] };
      if (state.activeTabKey !== action.tabKey) return { state, effects: [] };
      if (state.playbackMode !== "buffering") return { state, effects: [] };
      if (state.bufferingAtGlobalMs === null) return { state, effects: [] };

      const stream = getStreamInfo(state, action.tabKey);
      if (!stream) return { state, effects: [] };

      const localTarget = globalOffsetToLocalOffset(state.globalStartTs, stream.firstEventAtMs, state.bufferingAtGlobalMs);
      const loaded = state.loadedDurationByTabMs.get(action.tabKey) ?? 0;

      if (loaded > localTarget + 2000 || state.phase !== "downloading") {
        const seekTo = state.bufferingAtGlobalMs;
        return {
          state: {
            ...state,
            playbackMode: "playing",
            bufferingAtGlobalMs: null,
            autoResumeAfterBuffering: false,
          },
          effects: playEffectsForAllTabs(state, seekTo),
        };
      }

      // Still buffering — schedule another poll
      return {
        state,
        effects: [
          { type: "schedule_buffer_poll", generation: action.generation, tabKey: action.tabKey, localTimeMs: localTarget, delayMs: 500 },
        ],
      };
    }

    case "RESET": {
      return {
        state: createInitialState(state.settings),
        effects: [{ type: "destroy_all_replayers" }],
      };
    }

    default: {
      return { state, effects: [] };
    }
  }
}
