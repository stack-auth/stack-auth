"use client";

import { Alert, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Skeleton, Switch, Typography } from "@/components/ui";
import { useFromNow } from "@/hooks/use-from-now";
import {
  getDesiredGlobalOffsetFromPlaybackState,
  INTER_TAB_GAP_FAST_FORWARD_MULTIPLIER,
} from "@/lib/session-replay-playback";
import type { TabKey, TabStream } from "@/lib/session-replay-streams";
import {
  computeGlobalTimeline,
  globalOffsetToLocalOffset,
  groupChunksIntoTabStreams,
  NULL_TAB_KEY,
} from "@/lib/session-replay-streams";
import { cn } from "@/lib/utils";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { ArrowsClockwiseIcon, FastForwardIcon, GearIcon, MonitorPlayIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import {
  createInitialState,
  replayReducer,
  ALLOWED_PLAYER_SPEEDS,
  type ReplaySettings,
  type ReplayState,
  type ReplayAction,
  type ReplayEffect,
  type StreamInfo,
  type ChunkRange,
} from "./session-replay-machine";

const PAGE_SIZE = 50;
const INITIAL_CHUNK_BATCH = 20;
const BACKGROUND_CHUNK_BATCH = 50;
const EXTRA_TABS_TO_SHOW = 2;
const REPLAY_SETTINGS_STORAGE_KEY = "stack.session-replay.settings";
const LEGACY_PLAYER_SPEED_STORAGE_KEY = "stack.session-replay.speed";

type RrwebEventWithTime = import("rrweb/typings/types").eventWithTime;
type RrwebReplayer = InstanceType<typeof import("rrweb").Replayer>;

type RecordingRow = {
  id: string,
  projectUser: {
    id: string,
    displayName: string | null,
    primaryEmail: string | null,
  },
  startedAt: Date,
  lastEventAt: Date,
  chunkCount: number,
  eventCount: number,
};

type ChunkRow = {
  id: string,
  batchId: string,
  sessionReplaySegmentId: string | null,
  eventCount: number,
  byteLength: number,
  firstEventAt: Date,
  lastEventAt: Date,
  createdAt: Date,
};

type AdminAppWithSessionRecordings = ReturnType<typeof useAdminApp> & {
  listSessionRecordings: (options?: { limit?: number, cursor?: string }) => Promise<{
    items: RecordingRow[],
    nextCursor: string | null,
  }>,
  getSessionRecordingEvents: (sessionRecordingId: string, options?: { offset?: number, limit?: number }) => Promise<{
    chunks: ChunkRow[],
    chunkEvents: Array<{ chunkId: string, events: unknown[] }>,
  }>,
};

function coerceRrwebEvents(raw: unknown[]): RrwebEventWithTime[] {
  const filtered: Array<{ timestamp: number }> = [];
  for (const e of raw) {
    if (typeof e !== "object" || e === null) continue;
    if (!("timestamp" in e)) continue;
    const ts = (e as { timestamp?: unknown }).timestamp;
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    filtered.push(e as { timestamp: number });
  }
  return filtered as unknown as RrwebEventWithTime[];
}

function formatDurationMs(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatTimelineMs(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${(m % 60).toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function DisplayDate({ date }: { date: Date }) {
  const fromNow = useFromNow(date);
  return <span>{fromNow}</span>;
}

function getRecordingTitle(r: RecordingRow) {
  return r.projectUser.displayName ?? r.projectUser.primaryEmail ?? r.projectUser.id;
}

function parseReplaySettings(raw: string): ReplaySettings | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const value = parsed as Record<string, unknown>;

  const playerSpeedRaw = value.playerSpeed;
  const playerSpeed = typeof playerSpeedRaw === "number" && ALLOWED_PLAYER_SPEEDS.has(playerSpeedRaw)
    ? playerSpeedRaw
    : 1;
  const skipInactivity = typeof value.skipInactivity === "boolean"
    ? value.skipInactivity
    : true;
  const followActiveTab = typeof value.followActiveTab === "boolean"
    ? value.followActiveTab
    : false;

  return { playerSpeed, skipInactivity, followActiveTab };
}

function getInitialReplaySettings(): ReplaySettings {
  if (typeof window === 'undefined') return { playerSpeed: 1, skipInactivity: true, followActiveTab: false };
  try {
    const rawSettings = localStorage.getItem(REPLAY_SETTINGS_STORAGE_KEY);
    if (rawSettings) {
      const parsed = parseReplaySettings(rawSettings);
      if (parsed) return parsed;
    }
    const rawLegacySpeed = localStorage.getItem(LEGACY_PLAYER_SPEED_STORAGE_KEY);
    if (rawLegacySpeed) {
      const legacySpeed = Number(rawLegacySpeed);
      if (Number.isFinite(legacySpeed) && ALLOWED_PLAYER_SPEEDS.has(legacySpeed)) {
        return { playerSpeed: legacySpeed, skipInactivity: true, followActiveTab: false };
      }
    }
  } catch {
    // ignore
  }
  return { playerSpeed: 1, skipInactivity: true, followActiveTab: false };
}

function Timeline({
  getCurrentTimeMs,
  playerIsPlaying,
  totalTimeMs,
  onTogglePlayPause,
  onSeek,
  playerSpeed,
  onSpeedChange,
}: {
  getCurrentTimeMs: () => number,
  playerIsPlaying: boolean,
  totalTimeMs: number,
  onTogglePlayPause: () => void,
  onSeek: (timeOffset: number) => void,
  playerSpeed: number,
  onSpeedChange: (speed: number) => void,
}) {
  const [currentTime, setCurrentTime] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    function tick() {
      setCurrentTime(getCurrentTimeMs());
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [getCurrentTimeMs]);

  const progress = totalTimeMs > 0 ? Math.min(currentTime / totalTimeMs, 1) : 0;

  const handleTrackClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (!el || totalTimeMs <= 0) return;
    const rect = el.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const timeOffset = fraction * totalTimeMs;
    onSeek(timeOffset);
  }, [totalTimeMs, onSeek]);

  return (
    <div className="border-t border-border/30 bg-background px-3 py-2 flex items-center gap-3">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={onTogglePlayPause}
      >
        {playerIsPlaying ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
      </Button>

      <span className="text-xs text-muted-foreground tabular-nums w-10 shrink-0 text-right">
        {formatTimelineMs(currentTime)}
      </span>

      <div
        ref={trackRef}
        onClick={handleTrackClick}
        className="flex-1 h-5 flex items-center cursor-pointer group"
      >
        <div className="w-full h-1.5 rounded-full bg-muted relative overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-foreground/60 group-hover:bg-foreground/80 rounded-full transition-colors"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      <span className="text-xs text-muted-foreground tabular-nums w-10 shrink-0">
        {formatTimelineMs(totalTimeMs)}
      </span>

      <select
        className="h-7 rounded-md border border-border/40 bg-background px-1.5 text-xs"
        value={playerSpeed}
        onChange={(e) => onSpeedChange(Number(e.target.value))}
      >
        <option value={0.5}>0.5x</option>
        <option value={1}>1x</option>
        <option value={2}>2x</option>
        <option value={4}>4x</option>
      </select>
    </div>
  );
}

function ReplaySettingsButton({
  settings,
  onSettingsChange,
}: {
  settings: ReplaySettings,
  onSettingsChange: (updates: Partial<ReplaySettings>) => void,
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => setOpen(true)}
        aria-label="Replay settings"
      >
        <GearIcon className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replay settings</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Typography className="text-sm font-medium">Skip inactivity</Typography>
                <Typography className="text-xs text-muted-foreground">
                  Fast-forward through idle periods during playback.
                </Typography>
              </div>
              <Switch
                checked={settings.skipInactivity}
                onCheckedChange={(checked) => onSettingsChange({ skipInactivity: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Typography className="text-sm font-medium">Follow active tab</Typography>
                <Typography className="text-xs text-muted-foreground">
                  Auto-switch to the tab that has activity at the current time.
                </Typography>
              </div>
              <Switch
                checked={settings.followActiveTab}
                onCheckedChange={(checked) => onSettingsChange({ followActiveTab: checked })}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Machine hook — wraps the pure reducer with a React-friendly interface.
// Returns `state` (for rendering) and `stateRef` (for callbacks).
// ---------------------------------------------------------------------------

function useReplayMachine(initialSettings: ReplaySettings) {
  const stateRef = useRef<ReplayState>(createInitialState(initialSettings));
  const [, forceRender] = useState(0);

  const dispatch = useCallback((action: ReplayAction): ReplayEffect[] => {
    const { state, effects } = replayReducer(stateRef.current, action);
    stateRef.current = state;
    forceRender(v => v + 1);
    return effects;
  }, []);

  return { state: stateRef.current, stateRef, dispatch };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PageClient() {
  const adminApp = useAdminApp() as AdminAppWithSessionRecordings;

  // ---- Recording list state (unchanged from original) ----

  const [recordings, setRecordings] = useState<RecordingRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const listBoxRef = useRef<HTMLDivElement | null>(null);

  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const selectedRecording = useMemo(
    () => recordings.find(r => r.id === selectedRecordingId) ?? null,
    [recordings, selectedRecordingId],
  );

  const hasAutoSelectedRef = useRef(false);
  const hasFetchedInitialRef = useRef(false);

  const loadPage = useCallback(async (cursor: string | null) => {
    if (cursor === null && hasFetchedInitialRef.current) return;
    if (cursor === null) hasFetchedInitialRef.current = true;
    if (cursor !== null && loadingMore) return;

    if (cursor === null) {
      setLoadingInitial(true);
    } else {
      setLoadingMore(true);
    }
    setListError(null);

    try {
      const res = await adminApp.listSessionRecordings({ limit: PAGE_SIZE, cursor: cursor ?? undefined });
      const items = cursor ? [...recordings, ...res.items] : res.items;
      setRecordings(items);
      setNextCursor(res.nextCursor);

      if (!cursor && !hasAutoSelectedRef.current && items.length > 0) {
        hasAutoSelectedRef.current = true;
        setSelectedRecordingId(items[0].id);
      }
    } catch (e: any) {
      setListError(e?.message ?? "Failed to load session recordings.");
    } finally {
      setLoadingInitial(false);
      setLoadingMore(false);
    }
  }, [adminApp, loadingMore, recordings]);

  useEffect(() => {
    runAsynchronously(() => loadPage(null), { noErrorLogging: true });
  }, [loadPage]);

  const onListScroll = useCallback(() => {
    const el = listBoxRef.current;
    if (!el) return;
    if (!nextCursor) return;
    if (loadingMore || loadingInitial) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < 200) {
      runAsynchronously(() => loadPage(nextCursor), { noErrorLogging: true });
    }
  }, [loadingInitial, loadingMore, loadPage, nextCursor]);

  // ---- Replay state machine ----

  const { state: ms, stateRef: msRef, dispatch: rawDispatch } = useReplayMachine(getInitialReplaySettings());

  // ---- DOM / rrweb refs (not managed by machine) ----

  const eventsByTabRef = useRef<Map<TabKey, RrwebEventWithTime[]>>(new Map());
  const containerByTabRef = useRef<Map<TabKey, HTMLDivElement | null>>(new Map());
  const replayerByTabRef = useRef<Map<TabKey, RrwebReplayer>>(new Map());
  const replayerRootByTabRef = useRef<Map<TabKey, HTMLDivElement>>(new Map());
  const resizeObserverByTabRef = useRef<Map<TabKey, ResizeObserver>>(new Map());
  const pendingInitByTabRef = useRef<Set<TabKey>>(new Set());
  const speedSubRef = useRef<{ unsubscribe: () => void } | null>(null);

  // Full TabStream objects for rendering (machine only stores StreamInfo).
  const [fullStreams, setFullStreams] = useState<TabStream<ChunkRow>[]>([]);
  const fullStreamsRef = useRef<TabStream<ChunkRow>[]>([]);

  // Generation counter for staleness checks in async operations.
  const genCounterRef = useRef(0);

  // ---- UI-only state ----
  const [isSkipping, setIsSkipping] = useState(false);
  const [uiVersion, setUiVersion] = useState(0);

  // ---- Derived values ----

  const playerIsPlaying = ms.playbackMode === "playing" || ms.playbackMode === "gap_fast_forward";
  const isBuffering = ms.playbackMode === "buffering";
  const replayFinished = ms.playbackMode === "finished";
  const isDownloading = ms.phase === "downloading";

  // ---- Imperative helpers ----

  const destroyReplayers = useCallback(() => {
    for (const obs of resizeObserverByTabRef.current.values()) {
      obs.disconnect();
    }
    resizeObserverByTabRef.current.clear();

    speedSubRef.current?.unsubscribe();
    speedSubRef.current = null;

    for (const r of replayerByTabRef.current.values()) {
      try {
        r.pause();
      } catch {
        // ignore
      }
    }
    replayerByTabRef.current.clear();
    replayerRootByTabRef.current.clear();

    for (const root of containerByTabRef.current.values()) {
      if (root) root.innerHTML = "";
    }
  }, []);

  // ---- act: dispatch action to machine + execute returned effects ----
  // Uses a ref to break circular dependency with ensureReplayerForTab.

  const actRef = useRef<(action: ReplayAction) => void>(() => {});

  const ensureReplayerForTab = useCallback(async (tabKey: TabKey, gen: number) => {
    if (msRef.current.generation !== gen) return;
    if (replayerByTabRef.current.has(tabKey)) return;

    const rootMaybe = containerByTabRef.current.get(tabKey) ?? null;
    if (!rootMaybe) {
      pendingInitByTabRef.current.add(tabKey);
      return;
    }
    const rootEl = rootMaybe;

    const eventsSnapshot = eventsByTabRef.current.get(tabKey)?.slice() ?? [];
    if (eventsSnapshot.length === 0) {
      pendingInitByTabRef.current.add(tabKey);
      return;
    }

    if (!msRef.current.hasFullSnapshotByTab.has(tabKey)) {
      // Last-resort: scan accumulated events for a FullSnapshot that the
      // chunk-level detection may have missed (eg. due to race conditions or
      // type coercion).  rrweb FullSnapshot is event type 2.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const hasSnapshot = eventsSnapshot.some(e => (e as any).type === 2 || (e as any).type === "2");
      if (!hasSnapshot) return;
      // Patch the machine state so subsequent checks pass.
      actRef.current({
        type: "CHUNK_LOADED",
        generation: gen,
        tabKey,
        hasFullSnapshot: true,
        loadedDurationMs: eventsSnapshot.length >= 2
          ? eventsSnapshot[eventsSnapshot.length - 1].timestamp - eventsSnapshot[0].timestamp
          : 0,
        hadEventsBeforeThisChunk: true,
      });
    }

    try {
      const { Replayer } = await import("rrweb");
      if (msRef.current.generation !== gen) return;
      if (replayerByTabRef.current.has(tabKey)) return;

      const eventsSnapshot2 = eventsByTabRef.current.get(tabKey)?.slice() ?? [];
      if (eventsSnapshot2.length === 0) return;

      const replayer = new Replayer(eventsSnapshot2, {
        root: rootEl,
        speed: msRef.current.settings.playerSpeed,
        skipInactive: msRef.current.settings.skipInactivity,
      });

      rootEl.style.position = "relative";
      rootEl.style.width = "100%";
      rootEl.style.height = "100%";
      rootEl.style.overflow = "hidden";

      replayer.wrapper.style.margin = "0";
      replayer.wrapper.style.position = "absolute";
      replayer.wrapper.style.transformOrigin = "top left";

      replayer.iframe.style.border = "0";

      const mouseEl = replayer.wrapper.querySelector(".replayer-mouse") as HTMLElement | null;
      if (mouseEl) {
        mouseEl.style.position = "absolute";
        mouseEl.style.width = "14px";
        mouseEl.style.height = "14px";
        mouseEl.style.borderRadius = "9999px";
        mouseEl.style.background = "rgba(255, 255, 255, 0.9)";
        mouseEl.style.border = "2px solid rgba(0, 0, 0, 0.55)";
        mouseEl.style.boxShadow = "0 2px 10px rgba(0,0,0,0.25)";
        mouseEl.style.transform = "translate(-50%, -50%)";
        mouseEl.style.pointerEvents = "none";
        mouseEl.style.zIndex = "2";
      }

      const mouseTailEl = replayer.wrapper.querySelector(".replayer-mouse-tail") as HTMLCanvasElement | null;
      if (mouseTailEl) {
        mouseTailEl.style.position = "absolute";
        mouseTailEl.style.inset = "0";
        mouseTailEl.style.pointerEvents = "none";
        mouseTailEl.style.zIndex = "1";
      }

      function updateScale() {
        const cw = rootEl.clientWidth;
        const ch = rootEl.clientHeight;
        const replayW = replayer.wrapper.offsetWidth;
        const replayH = replayer.wrapper.offsetHeight;
        if (replayW <= 0 || replayH <= 0 || cw <= 0 || ch <= 0) return;
        const isActive = msRef.current.activeTabKey === tabKey;
        const scale = isActive ? Math.min(cw / replayW, ch / replayH) : (cw / replayW);
        const scaledW = replayW * scale;
        const scaledH = replayH * scale;
        replayer.wrapper.style.left = isActive ? `${(cw - scaledW) / 2}px` : "0px";
        replayer.wrapper.style.top = isActive ? `${(ch - scaledH) / 2}px` : "0px";
        replayer.wrapper.style.transform = `scale(${scale})`;
      }

      updateScale();
      let scaleRaf = 0;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(scaleRaf);
        scaleRaf = requestAnimationFrame(updateScale);
      });
      observer.observe(rootEl);
      observer.observe(replayer.wrapper);
      resizeObserverByTabRef.current.set(tabKey, observer);

      replayerRootByTabRef.current.set(tabKey, rootEl);
      pendingInitByTabRef.current.delete(tabKey);

      // Register replayer BEFORE dispatching so effects can find it.
      replayerByTabRef.current.set(tabKey, replayer);

      // Finish handler — all logic is in the machine reducer.
      try {
        replayer.on("finish", () => {
          if (msRef.current.generation !== gen) return;
          if (msRef.current.activeTabKey !== tabKey) return;

          let localTime = 0;
          try {
            localTime = replayer.getCurrentTime();
          } catch {
            // ignore
          }

          actRef.current({
            type: "REPLAYER_FINISH",
            generation: gen,
            tabKey,
            localTimeMs: localTime,
            nowMs: performance.now(),
          });
        });
      } catch {
        // ignore
      }

      // Machine decides whether to play or pause this replayer.
      actRef.current({
        type: "REPLAYER_READY",
        generation: gen,
        tabKey,
      });

      setUiVersion(v => v + 1);
    } catch (e: any) {
      actRef.current({
        type: "REPLAYER_INIT_ERROR",
        generation: gen,
        message: e?.message ?? "Failed to initialize rrweb player.",
      });
    }
  }, [msRef]);

  // Effect executor — maps machine effects to imperative DOM/rrweb calls.
  function executeEffects(effects: ReplayEffect[]) {
    for (const effect of effects) {
      switch (effect.type) {
        case "play_replayer": {
          const r = replayerByTabRef.current.get(effect.tabKey);
          if (r) {
            try {
              r.play(effect.localOffsetMs);
            } catch {
              // ignore
            }
          } else {
            // Replayer doesn't exist — try to create it so REPLAYER_READY
            // can resume playback.  This covers race conditions where the
            // replayer hasn't been initialised yet when play is requested.
            runAsynchronously(() => ensureReplayerForTab(effect.tabKey, msRef.current.generation), { noErrorLogging: true });
          }
          break;
        }
        case "pause_replayer_at": {
          const r = replayerByTabRef.current.get(effect.tabKey);
          if (r) {
            try {
              r.pause(effect.localOffsetMs);
            } catch {
              // ignore
            }
          }
          break;
        }
        case "pause_all": {
          for (const r of replayerByTabRef.current.values()) {
            try {
              r.pause();
            } catch {
              // ignore
            }
          }
          break;
        }
        case "ensure_replayer": {
          runAsynchronously(() => ensureReplayerForTab(effect.tabKey, effect.generation), { noErrorLogging: true });
          break;
        }
        case "destroy_all_replayers": {
          destroyReplayers();
          eventsByTabRef.current = new Map();
          pendingInitByTabRef.current = new Set();
          setUiVersion(v => v + 1);
          break;
        }
        case "set_replayer_speed": {
          for (const r of replayerByTabRef.current.values()) {
            try {
              r.setConfig({ speed: effect.speed });
            } catch {
              // ignore
            }
          }
          break;
        }
        case "set_replayer_skip_inactive": {
          for (const r of replayerByTabRef.current.values()) {
            try {
              r.setConfig({ skipInactive: effect.skipInactive });
            } catch {
              // ignore
            }
          }
          if (!effect.skipInactive) setIsSkipping(false);
          break;
        }
        case "sync_mini_tabs": {
          const activeKey = msRef.current.activeTabKey;
          for (const [tabKey, r] of replayerByTabRef.current.entries()) {
            if (tabKey === activeKey) continue;
            const stream = msRef.current.streams.find(s => s.tabKey === tabKey);
            if (!stream) continue;
            const localOffset = globalOffsetToLocalOffset(
              msRef.current.globalStartTs,
              stream.firstEventAtMs,
              effect.globalOffsetMs,
            );
            try {
              r.pause(localOffset);
            } catch {
              // ignore
            }
          }
          break;
        }
        case "schedule_buffer_poll": {
          const { generation, tabKey, delayMs } = effect;
          setTimeout(() => {
            actRef.current({ type: "BUFFER_CHECK", generation, tabKey });
          }, delayMs);
          break;
        }
        case "recreate_replayer": {
          const tabKey = effect.tabKey;
          const r = replayerByTabRef.current.get(tabKey);
          if (r) {
            try {
              r.pause();
            } catch {
              // ignore
            }
          }
          replayerByTabRef.current.delete(tabKey);
          replayerRootByTabRef.current.delete(tabKey);
          const obs = resizeObserverByTabRef.current.get(tabKey);
          if (obs) {
            obs.disconnect();
            resizeObserverByTabRef.current.delete(tabKey);
          }
          pendingInitByTabRef.current.add(tabKey);
          runAsynchronously(() => ensureReplayerForTab(tabKey, effect.generation), { noErrorLogging: true });
          break;
        }
        case "save_settings": {
          try {
            localStorage.setItem(REPLAY_SETTINGS_STORAGE_KEY, JSON.stringify(effect.settings));
          } catch {
            // ignore
          }
          break;
        }
      }
    }
  }

  // Wire actRef: dispatch to machine + execute effects.
  actRef.current = (action: ReplayAction) => {
    const effects = rawDispatch(action);
    executeEffects(effects);
  };

  // ---- Container ref callback ----

  const setContainerRefForTab = useCallback((tabKey: TabKey, el: HTMLDivElement | null) => {
    containerByTabRef.current.set(tabKey, el);

    if (!el) return;

    const existingRoot = replayerRootByTabRef.current.get(tabKey);
    if (existingRoot && existingRoot !== el) {
      const r = replayerByTabRef.current.get(tabKey);
      if (r) {
        try {
          r.pause();
        } catch {
          // ignore
        }
        replayerByTabRef.current.delete(tabKey);
        replayerRootByTabRef.current.delete(tabKey);
      }
      const obs = resizeObserverByTabRef.current.get(tabKey);
      if (obs) {
        obs.disconnect();
        resizeObserverByTabRef.current.delete(tabKey);
      }
      pendingInitByTabRef.current.add(tabKey);
    }

    if (!pendingInitByTabRef.current.has(tabKey)) return;
    if ((eventsByTabRef.current.get(tabKey)?.length ?? 0) === 0) return;
    runAsynchronously(() => ensureReplayerForTab(tabKey, msRef.current.generation), { noErrorLogging: true });
  }, [ensureReplayerForTab, msRef]);

  // ---- Load chunks and download events ----

  const loadChunksAndDownload = useCallback(async (recordingId: string) => {
    const gen = ++genCounterRef.current;
    actRef.current({ type: "SELECT_RECORDING", generation: gen });
    setFullStreams([]);
    fullStreamsRef.current = [];

    // Helper: process a batch of chunk_events into the replayer state machine.
    function processChunkEvents(
      chunkEvents: Array<{ chunkId: string, events: unknown[] }>,
      allStreams: TabStream<ChunkRow>[],
      chunkIdToTabKey: Map<string, TabKey>,
    ) {
      for (const ce of chunkEvents) {
        if (msRef.current.generation !== gen) return;

        const tabKey = chunkIdToTabKey.get(ce.chunkId);
        if (!tabKey) continue;

        const events = coerceRrwebEvents(ce.events);
        const prev = eventsByTabRef.current.get(tabKey) ?? [];
        const wasEmpty = prev.length === 0;
        prev.push(...events);
        eventsByTabRef.current.set(tabKey, prev);

        const hasFullSnapshot = !msRef.current.hasFullSnapshotByTab.has(tabKey)
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          && events.some(e => Number((e as any).type) === 2);

        let loadedDurationMs = 0;
        if (prev.length >= 2) {
          loadedDurationMs = prev[prev.length - 1].timestamp - prev[0].timestamp;
        }

        if (!wasEmpty) {
          const r = replayerByTabRef.current.get(tabKey);
          if (r) {
            for (const event of events) {
              r.addEvent(event);
            }
          }
        }

        actRef.current({
          type: "CHUNK_LOADED",
          generation: gen,
          tabKey,
          hasFullSnapshot,
          loadedDurationMs,
          hadEventsBeforeThisChunk: !wasEmpty,
        });

        if (hasFullSnapshot || wasEmpty) {
          setUiVersion(v => v + 1);
        }
      }
    }

    try {
      // Phase 1: Fetch initial batch (fast start).
      const initialResponse = await adminApp.getSessionRecordingEvents(recordingId, { offset: 0, limit: INITIAL_CHUNK_BATCH });
      if (msRef.current.generation !== gen) return;

      const allChunkRows: ChunkRow[] = initialResponse.chunks.map((c) => ({
        id: c.id,
        batchId: c.batchId,
        sessionReplaySegmentId: c.sessionReplaySegmentId,
        eventCount: c.eventCount,
        byteLength: c.byteLength,
        firstEventAt: c.firstEventAt,
        lastEventAt: c.lastEventAt,
        createdAt: c.createdAt,
      }));

      const allStreams = groupChunksIntoTabStreams(allChunkRows);
      setFullStreams(allStreams);
      fullStreamsRef.current = allStreams;

      const { globalStartTs, globalTotalMs } = computeGlobalTimeline(allStreams);

      // Build chunk ranges from full metadata.
      const rangesByTab = new Map<TabKey, ChunkRange[]>();
      for (const s of allStreams) {
        const ranges = s.chunks
          .map((c) => ({ startTs: c.firstEventAt.getTime(), endTs: c.lastEventAt.getTime() }))
          .filter(r => Number.isFinite(r.startTs) && Number.isFinite(r.endTs) && r.endTs >= r.startTs)
          .sort((a, b) => a.startTs - b.startTs);

        const merged: ChunkRange[] = [];
        for (const r of ranges) {
          const last = merged[merged.length - 1] as ChunkRange | undefined;
          if (!last) {
            merged.push({ ...r });
            continue;
          }
          if (r.startTs <= last.endTs) {
            last.endTs = Math.max(last.endTs, r.endTs);
          } else {
            merged.push({ ...r });
          }
        }
        rangesByTab.set(s.tabKey, merged);
      }

      // Stable tab labels.
      const labelOrder = allStreams
        .slice()
        .sort((a, b) => {
          const first = a.firstEventAt.getTime() - b.firstEventAt.getTime();
          if (first !== 0) return first;
          return stringCompare(a.tabKey, b.tabKey);
        });
      const tabLabelIndex = new Map(labelOrder.map((s, i) => [s.tabKey, i + 1]));

      const streamInfos: StreamInfo[] = allStreams.map(s => ({
        tabKey: s.tabKey,
        firstEventAtMs: s.firstEventAt.getTime(),
        lastEventAtMs: s.lastEventAt.getTime(),
      }));

      actRef.current({
        type: "STREAMS_COMPUTED",
        generation: gen,
        streams: streamInfos,
        globalStartTs,
        globalTotalMs,
        chunkRangesByTab: rangesByTab,
        tabLabelIndex,
      });

      // Build chunk_id → tabKey lookup from full metadata.
      const chunkIdToTabKey = new Map<string, TabKey>();
      for (const s of allStreams) {
        for (const chunk of s.chunks) {
          chunkIdToTabKey.set(chunk.id, s.tabKey);
        }
      }

      // Process the initial batch of events.
      processChunkEvents(initialResponse.chunkEvents, allStreams, chunkIdToTabKey);

      // Phase 2: Background loading of remaining chunks.
      const totalChunks = allChunkRows.length;
      let offset = INITIAL_CHUNK_BATCH;

      while (offset < totalChunks) {
        if (msRef.current.generation !== gen) return;

        const batchResponse = await adminApp.getSessionRecordingEvents(recordingId, { offset, limit: BACKGROUND_CHUNK_BATCH });
        if (msRef.current.generation !== gen) return;

        processChunkEvents(batchResponse.chunkEvents, allStreams, chunkIdToTabKey);

        offset += BACKGROUND_CHUNK_BATCH;
      }
    } catch (e: any) {
      if (msRef.current.generation === gen) {
        actRef.current({ type: "DOWNLOAD_ERROR", generation: gen, message: e?.message ?? "Failed to load replay data." });
      }
      return;
    }

    if (msRef.current.generation === gen) {
      actRef.current({ type: "DOWNLOAD_COMPLETE", generation: gen });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminApp, msRef]);

  useEffect(() => {
    if (!selectedRecordingId || !selectedRecording) return;
    runAsynchronously(() => loadChunksAndDownload(selectedRecordingId), { noErrorLogging: true });
  }, [loadChunksAndDownload, selectedRecordingId, selectedRecording]);

  useEffect(() => {
    return () => {
      genCounterRef.current += 1;
      destroyReplayers();
    };
  }, [destroyReplayers]);

  // ---- Timeline time reading (smooth, direct from rrweb) ----

  const getCurrentGlobalTimeMs = useCallback(() => {
    const s = msRef.current;
    const key = s.activeTabKey;
    const r = key ? (replayerByTabRef.current.get(key) ?? null) : null;
    const stream = key ? s.streams.find(st => st.tabKey === key) ?? null : null;
    let activeLocalOffsetMs: number | null = null;
    if (r) {
      try {
        activeLocalOffsetMs = r.getCurrentTime();
      } catch {
        activeLocalOffsetMs = null;
      }
    }

    return getDesiredGlobalOffsetFromPlaybackState({
      gapFastForward: s.gapFastForward,
      playerIsPlaying: s.playbackMode === "playing" || s.playbackMode === "gap_fast_forward",
      nowMs: performance.now(),
      playerSpeed: s.settings.playerSpeed,
      pausedAtGlobalMs: s.pausedAtGlobalMs,
      activeLocalOffsetMs,
      activeStreamStartTs: stream?.firstEventAtMs ?? null,
      globalStartTs: s.globalStartTs,
      gapFastForwardMultiplier: INTER_TAB_GAP_FAST_FORWARD_MULTIPLIER,
    });
  }, [msRef]);

  // ---- RAF tick loop — drives UI time updates, gap completion, auto-follow ----

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let lastUpdateAt = 0;

    const tick = (now: number) => {
      if (cancelled) return;
      if (now - lastUpdateAt > 200) {
        lastUpdateAt = now;
        const key = msRef.current.activeTabKey;
        const r = key ? (replayerByTabRef.current.get(key) ?? null) : null;
        let activeLocalTimeMs: number | null = null;
        if (r) {
          try {
            activeLocalTimeMs = r.getCurrentTime();
          } catch {
            activeLocalTimeMs = null;
          }
        }

        actRef.current({
          type: "TICK",
          nowMs: performance.now(),
          activeReplayerLocalTimeMs: activeLocalTimeMs,
        });
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [msRef]);

  // ---- Skip indicator (speedService subscription) ----

  useEffect(() => {
    if (!ms.settings.skipInactivity) {
      setIsSkipping(false);
      speedSubRef.current?.unsubscribe();
      speedSubRef.current = null;
      return;
    }

    const key = ms.activeTabKey;
    const r = key ? replayerByTabRef.current.get(key) ?? null : null;

    setIsSkipping(false);
    speedSubRef.current?.unsubscribe();
    speedSubRef.current = null;

    if (!r) return;

    try {
      const sub = (r as any).speedService.subscribe((state: any) => {
        setIsSkipping(state.value === "skipping");
      });
      speedSubRef.current = sub;
    } catch {
      // ignore
    }
  }, [ms.activeTabKey, ms.settings.skipInactivity, uiVersion]);

  // ---- Action callbacks ----

  const togglePlayPause = useCallback(() => {
    actRef.current({ type: "TOGGLE_PLAY_PAUSE", nowMs: performance.now() });
  }, []);

  const handleSeek = useCallback((globalOffset: number) => {
    actRef.current({ type: "SEEK", globalOffsetMs: globalOffset, nowMs: performance.now() });
  }, []);

  const updateSpeed = useCallback((speed: number) => {
    actRef.current({ type: "UPDATE_SPEED", speed });
  }, []);

  const onSelectActiveTab = useCallback((tabKey: TabKey) => {
    actRef.current({ type: "SELECT_TAB", tabKey, nowMs: performance.now() });
  }, []);

  // ---- Derived rendering data ----

  const activeStream = useMemo(
    () => (ms.activeTabKey ? fullStreams.find(s => s.tabKey === ms.activeTabKey) ?? null : null),
    [ms.activeTabKey, fullStreams],
  );

  const visibleMiniStreams = useMemo(() => {
    void uiVersion;
    const currentTs = ms.globalStartTs + ms.currentGlobalTimeMsForUi;
    const candidates = fullStreams.filter(s =>
      s.tabKey !== ms.activeTabKey && ms.hasFullSnapshotByTab.has(s.tabKey)
    );
    const inRange = candidates.filter(s =>
      currentTs >= s.firstEventAt.getTime() && currentTs <= s.lastEventAt.getTime()
    );

    inRange.sort((a, b) => {
      const aLabel = ms.tabLabelIndex.get(a.tabKey) ?? Number.POSITIVE_INFINITY;
      const bLabel = ms.tabLabelIndex.get(b.tabKey) ?? Number.POSITIVE_INFINITY;
      if (aLabel !== bLabel) return aLabel - bLabel;
      return stringCompare(a.tabKey, b.tabKey);
    });

    return inRange.slice(0, EXTRA_TABS_TO_SHOW);
  }, [ms.activeTabKey, ms.currentGlobalTimeMsForUi, ms.globalStartTs, ms.hasFullSnapshotByTab, ms.tabLabelIndex, fullStreams, uiVersion]);

  const showRightColumn = visibleMiniStreams.length > 0;

  const miniIndexByKey = useMemo(() => {
    const m = new Map<TabKey, number>();
    for (const [idx, s] of visibleMiniStreams.entries()) {
      m.set(s.tabKey, idx);
    }
    return m;
  }, [visibleMiniStreams]);

  const getTabLabel = useCallback((tabKey: TabKey) => {
    const idx = ms.tabLabelIndex.get(tabKey);
    if (!idx) return "Tab";
    return `Tab ${idx}`;
  }, [ms.tabLabelIndex]);

  const activeHasEvents = useMemo(() => {
    if (!activeStream) return false;
    void uiVersion;
    return (eventsByTabRef.current.get(activeStream.tabKey)?.length ?? 0) > 0;
  }, [activeStream, uiVersion]);

  const renderableStreamCount = useMemo(() => {
    void uiVersion;
    return fullStreams.filter(s => ms.hasFullSnapshotByTab.has(s.tabKey)).length;
  }, [fullStreams, ms.hasFullSnapshotByTab, uiVersion]);

  const showMainTabLabel = renderableStreamCount > 1;

  // ---- Rendering ----

  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout title="Session Replays" fillWidth>
        <PanelGroup direction="horizontal" className="h-[calc(100vh-180px)] min-h-[520px] rounded-xl border border-border/40 overflow-hidden bg-background">
          <Panel defaultSize={25} minSize={16}>
            <div className="h-full flex flex-col">
              <div className="shrink-0 px-3 py-2 border-b border-border/30 flex items-center h-10">
                <Typography className="text-sm font-medium">
                  Sessions{!loadingInitial && recordings.length > 0 ? ` (${recordings.length}${nextCursor ? "+" : ""})` : ""}
                </Typography>
              </div>

              {listError && (
                <div className="p-3">
                  <Alert variant="destructive">{listError}</Alert>
                </div>
              )}

              <div
                ref={listBoxRef}
                onScroll={onListScroll}
                className="flex-1 overflow-y-auto"
              >
                {loadingInitial ? (
                  <div className="p-2 space-y-1">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="rounded-lg p-3">
                        <Skeleton className="h-4 w-36" />
                        <Skeleton className="mt-1.5 h-3 w-24" />
                      </div>
                    ))}
                  </div>
                ) : recordings.length === 0 ? (
                  <div className="p-6 text-center">
                    <Typography className="text-sm text-muted-foreground">
                      No replays yet.
                    </Typography>
                  </div>
                ) : (
                  <div className="p-1.5 space-y-0.5">
                    {recordings.map((r) => {
                      const isSelected = r.id === selectedRecordingId;
                      const durationMs = r.lastEventAt.getTime() - r.startedAt.getTime();
                      const duration = formatDurationMs(durationMs);
                      return (
                        <button
                          key={r.id}
                          onClick={() => setSelectedRecordingId(r.id)}
                          className={cn(
                            "w-full text-left rounded-lg px-3 py-2.5",
                            "transition-colors hover:transition-none",
                            isSelected ? "bg-muted/60 ring-1 ring-border/40" : "hover:bg-muted/20",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium truncate">
                              {getRecordingTitle(r)}
                            </span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {duration}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <DisplayDate date={r.lastEventAt} />
                          </div>
                        </button>
                      );
                    })}

                    {loadingMore && (
                      <div className="rounded-lg p-3">
                        <Skeleton className="h-4 w-36" />
                        <Skeleton className="mt-1.5 h-3 w-24" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="w-px bg-border/40 hover:bg-border transition-colors hover:transition-none" />

          <Panel defaultSize={75} minSize={35}>
            <div className="h-full flex flex-col">
              {(ms.downloadError || ms.playerError) && (
                <div className="p-3 space-y-2">
                  {ms.downloadError && <Alert variant="destructive">{ms.downloadError}</Alert>}
                  {ms.playerError && <Alert variant="destructive">{ms.playerError}</Alert>}
                </div>
              )}

              <div className="shrink-0 px-3 py-2 border-b border-border/30 flex items-center justify-between gap-3 h-10">
                <Typography className="text-sm font-medium truncate">
                  {selectedRecording ? getRecordingTitle(selectedRecording) : ""}
                </Typography>
                <ReplaySettingsButton
                  settings={ms.settings}
                  onSettingsChange={(updates) => actRef.current({ type: "UPDATE_SETTINGS", updates })}
                />
              </div>

              {selectedRecording ? (
                <div className="flex-1 overflow-hidden flex flex-col">
                  <div className="flex-1 overflow-hidden flex flex-col">
                    <div
                      className="flex-1 overflow-hidden grid grid-cols-[minmax(0,1fr)_260px] gap-px bg-border/40"
                      style={{
                        gridTemplateColumns: showRightColumn ? "minmax(0, 1fr) 260px" : "minmax(0, 1fr) 0px",
                        gridTemplateRows: showRightColumn ? `repeat(${EXTRA_TABS_TO_SHOW}, auto) 1fr` : "1fr",
                        transition: "grid-template-columns 180ms ease-out",
                      }}
                    >
                      {fullStreams.length === 0 && (
                        <div className="col-span-2 row-span-6 grid place-items-center bg-background">
                          <div className="text-center space-y-2 p-6">
                            {isDownloading ? (
                              <>
                                <Skeleton className="h-2 w-48 mx-auto" />
                                <Typography className="text-sm text-muted-foreground">
                                  Loading replay...
                                </Typography>
                              </>
                            ) : (
                              <Typography className="text-sm text-muted-foreground">
                                No replay data loaded yet.
                              </Typography>
                            )}
                          </div>
                        </div>
                      )}

                      {fullStreams.map((s) => {
                        const isActive = s.tabKey === ms.activeTabKey;
                        const miniIndex = miniIndexByKey.get(s.tabKey);
                        const isMiniVisible = miniIndex !== undefined && miniIndex >= 0 && miniIndex < EXTRA_TABS_TO_SHOW;
                        if (!isActive && !isMiniVisible) return null;

                        const title = getTabLabel(s.tabKey);

                        return (
                          <button
                            key={s.tabKey}
                            type="button"
                            onClick={() => {
                              if (!isActive) onSelectActiveTab(s.tabKey);
                            }}
                            className={cn(
                              "relative overflow-hidden bg-background text-left block w-full",
                              isActive ? "h-full cursor-default" : "transition-colors hover:transition-none hover:bg-muted/10",
                            )}
                            style={{
                              gridColumn: isActive ? "1" : "2",
                              gridRow: isActive ? ("1 / -1" as any) : ((miniIndex ?? 0) + 1),
                              ...(isActive ? {} : { aspectRatio: "16/10" }),
                            }}
                          >
                            <div
                              ref={(el) => setContainerRefForTab(s.tabKey, el)}
                              className="absolute inset-0 bg-background"
                            />

                            {!isActive && (
                              <div className="absolute inset-x-0 top-0 z-10 px-2 pt-1.5">
                                <span className="text-[11px] font-medium truncate bg-black/50 text-white px-2 py-0.5 rounded-full backdrop-blur-sm">{title}</span>
                              </div>
                            )}

                            {!isActive && !replayerByTabRef.current.has(s.tabKey) && (
                              <div className="absolute inset-0 grid place-items-center text-[11px] text-muted-foreground pointer-events-none">
                                Loading...
                              </div>
                            )}

                            {isActive && (
                              <>
                                {showMainTabLabel && (
                                  <div className="absolute inset-x-0 top-4 z-10 flex justify-start pointer-events-none px-4">
                                    <div className="flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-sm">
                                      <span className="text-xs text-white font-medium">{getTabLabel(s.tabKey)}</span>
                                      {s.tabKey === NULL_TAB_KEY && (
                                        <span className="text-xs text-white/70">unknown id</span>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {activeHasEvents && !playerIsPlaying && !isBuffering && (
                                  <div
                                    className="absolute inset-0 z-10 grid place-items-center cursor-pointer transition-opacity"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      if (replayFinished) {
                                        handleSeek(0);
                                      } else {
                                        togglePlayPause();
                                      }
                                    }}
                                  >
                                    {replayFinished ? (
                                      <div className="flex flex-col items-center gap-2">
                                        <div className="rounded-full bg-black/50 p-4 backdrop-blur-sm">
                                          <ArrowsClockwiseIcon className="h-10 w-10 text-white" weight="bold" />
                                        </div>
                                        <span className="text-sm text-white/80 bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm">
                                          Replay from start
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="rounded-full bg-black/50 p-4 backdrop-blur-sm">
                                        <PlayIcon className="h-10 w-10 text-white" weight="fill" />
                                      </div>
                                    )}
                                  </div>
                                )}

                                {activeHasEvents && ms.settings.skipInactivity && isSkipping && (
                                  <div className="absolute inset-x-0 top-4 z-10 flex justify-center pointer-events-none">
                                    <div className="flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-sm">
                                      <FastForwardIcon className="h-3.5 w-3.5 text-white" weight="fill" />
                                      <span className="text-xs text-white">Skipping inactivity</span>
                                    </div>
                                  </div>
                                )}

                                {activeHasEvents && isBuffering && (
                                  <div
                                    className="absolute inset-0 z-10 grid place-items-center cursor-pointer"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      togglePlayPause();
                                    }}
                                  >
                                    <div className="flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 backdrop-blur-sm">
                                      <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                      <span className="text-sm text-white">Buffering...</span>
                                    </div>
                                  </div>
                                )}

                                {activeHasEvents && playerIsPlaying && !isBuffering && (
                                  <div
                                    className="absolute inset-0 z-10 cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      togglePlayPause();
                                    }}
                                  />
                                )}

                                {!activeHasEvents && (
                                  <div className="absolute inset-0 grid place-items-center bg-background/80 backdrop-blur-sm">
                                    <div className="text-center space-y-2 p-6">
                                      {isDownloading ? (
                                        <>
                                          <Skeleton className="h-2 w-48 mx-auto" />
                                          <Typography className="text-sm text-muted-foreground">
                                            Loading replay...
                                          </Typography>
                                        </>
                                      ) : (
                                        <Typography className="text-sm text-muted-foreground">
                                          No events found.
                                        </Typography>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {activeStream && activeHasEvents && (
                      <Timeline
                        getCurrentTimeMs={getCurrentGlobalTimeMs}
                        playerIsPlaying={playerIsPlaying}
                        totalTimeMs={ms.globalTotalMs}
                        onTogglePlayPause={togglePlayPause}
                        onSeek={handleSeek}
                        playerSpeed={ms.settings.playerSpeed}
                        onSpeedChange={updateSpeed}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 grid place-items-center">
                  {loadingInitial ? (
                    <div className="text-center space-y-2 p-6">
                      <Skeleton className="h-2 w-48 mx-auto" />
                      <Typography className="text-sm text-muted-foreground">
                        Loading replay...
                      </Typography>
                    </div>
                  ) : (
                    <div className="text-center p-6">
                      <MonitorPlayIcon className="h-12 w-12 text-muted-foreground/40 mx-auto" />
                      <Typography className="mt-3 text-sm font-medium text-muted-foreground">
                        No session replays yet
                      </Typography>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Panel>
        </PanelGroup>
      </PageLayout>
    </AppEnabledGuard>
  );
}
