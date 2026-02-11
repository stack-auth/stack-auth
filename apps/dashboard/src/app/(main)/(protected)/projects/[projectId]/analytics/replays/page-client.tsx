"use client";

import { Alert, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Skeleton, Switch, Typography } from "@/components/ui";
import { useFromNow } from "@/hooks/use-from-now";
import {
  getDesiredGlobalOffsetFromPlaybackState,
  getReplayFinishAction,
  INTER_TAB_GAP_FAST_FORWARD_MULTIPLIER,
  applySeekState,
} from "@/lib/session-replay-playback";
import type { TabKey, TabStream } from "@/lib/session-replay-streams";
import {
  computeGlobalTimeline,
  globalOffsetToLocalOffset,
  groupChunksIntoTabStreams,
  localOffsetToGlobalOffset,
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

const PAGE_SIZE = 50;
const CHUNK_PAGE_SIZE = 250;
const CHUNK_EVENTS_CONCURRENCY = 8;
const EXTRA_TABS_TO_SHOW = 2;
const REPLAY_SETTINGS_STORAGE_KEY = "stack.session-replay.settings";
const LEGACY_PLAYER_SPEED_STORAGE_KEY = "stack.session-replay.speed";
const ALLOWED_PLAYER_SPEEDS = new Set([0.5, 1, 2, 4]);
const DEFAULT_REPLAY_SETTINGS = {
  playerSpeed: 1,
  skipInactivity: true,
  followActiveTab: false,
} as const;

type ReplaySettings = {
  playerSpeed: number,
  skipInactivity: boolean,
  followActiveTab: boolean,
};

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
  tabId: string | null,
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
  listSessionRecordingChunks: (sessionRecordingId: string, options?: { limit?: number, cursor?: string }) => Promise<{
    items: ChunkRow[],
    nextCursor: string | null,
  }>,
  getSessionRecordingChunkEvents: (sessionRecordingId: string, chunkId: string) => Promise<{ events: unknown[] }>,
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
    : DEFAULT_REPLAY_SETTINGS.playerSpeed;
  const skipInactivity = typeof value.skipInactivity === "boolean"
    ? value.skipInactivity
    : DEFAULT_REPLAY_SETTINGS.skipInactivity;
  const followActiveTab = typeof value.followActiveTab === "boolean"
    ? value.followActiveTab
    : DEFAULT_REPLAY_SETTINGS.followActiveTab;

  return { playerSpeed, skipInactivity, followActiveTab };
}

function getInitialReplaySettings(): ReplaySettings {
  if (typeof window === 'undefined') return DEFAULT_REPLAY_SETTINGS;
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
        return { ...DEFAULT_REPLAY_SETTINGS, playerSpeed: legacySpeed };
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_REPLAY_SETTINGS;
}

async function fetchChunkEventsForStreamsParallel(
  adminApp: AdminAppWithSessionRecordings,
  recordingId: string,
  streams: Array<{ tabKey: TabKey, chunks: ChunkRow[] }>,
  gen: number,
  genRef: React.MutableRefObject<number>,
  onChunkLoaded: (tabKey: TabKey, chunkIndex: number, events: RrwebEventWithTime[]) => void,
) {
  // Important: prioritize each stream's earliest chunks so every tab can
  // initialize quickly (FullSnapshot is typically in chunk 0).
  const tasks: Array<{ tabKey: TabKey, chunkIndex: number, chunkId: string }> = [];
  const resultsByTab = new Map<TabKey, Array<RrwebEventWithTime[] | null>>();
  const reportedIndexByTab = new Map<TabKey, number>();

  let maxChunks = 0;
  for (const s of streams) {
    resultsByTab.set(s.tabKey, new Array(s.chunks.length).fill(null));
    reportedIndexByTab.set(s.tabKey, 0);
    maxChunks = Math.max(maxChunks, s.chunks.length);
  }

  for (let chunkIndex = 0; chunkIndex < maxChunks; chunkIndex++) {
    for (const s of streams) {
      const c = s.chunks[chunkIndex] as ChunkRow | undefined;
      if (!c) continue;
      tasks.push({ tabKey: s.tabKey, chunkIndex, chunkId: c.id });
    }
  }

  let nextTaskIndex = 0;

  async function worker() {
    while (nextTaskIndex < tasks.length) {
      if (genRef.current !== gen) return;
      const task = tasks[nextTaskIndex++];
      const ev = await adminApp.getSessionRecordingChunkEvents(recordingId, task.chunkId);
      if (genRef.current !== gen) return;

      const results = resultsByTab.get(task.tabKey) ?? [];
      results[task.chunkIndex] = coerceRrwebEvents(ev.events);

      let reported = reportedIndexByTab.get(task.tabKey) ?? 0;
      while (reported < results.length && results[reported] !== null) {
        onChunkLoaded(task.tabKey, reported, results[reported]!);
        reported++;
      }
      reportedIndexByTab.set(task.tabKey, reported);
    }
  }

  const workers = Array.from({ length: Math.min(CHUNK_EVENTS_CONCURRENCY, tasks.length) }, () => worker());
  await Promise.all(workers);
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

export default function PageClient() {
  // @stackframe/stack's public `StackAdminApp` type is missing the session replay
  // methods in `packages/stack/dist/index.d.mts`, but the runtime app object has them.
  const adminApp = useAdminApp() as AdminAppWithSessionRecordings;

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

  const selectionGenRef = useRef(0);
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

  // Player + download state
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const isDownloadingRef = useRef(false);
  isDownloadingRef.current = isDownloading;

  const [streams, setStreams] = useState<TabStream<ChunkRow>[]>([]);
  const streamsByKeyRef = useRef<Map<TabKey, TabStream<ChunkRow>>>(new Map());
  const streamsRef = useRef<TabStream<ChunkRow>[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<TabKey | null>(null);
  const activeTabKeyRef = useRef<TabKey | null>(null);
  const setActiveTab = useCallback((key: TabKey | null) => {
    activeTabKeyRef.current = key;
    setActiveTabKey(key);
  }, []);

  const globalStartTsRef = useRef(0);
  const [globalTotalTimeMs, setGlobalTotalTimeMs] = useState(0);
  const globalTotalTimeMsRef = useRef(0);
  // Inter-tab gap transition: animate timeline forward faster than realtime
  // until the next tab starts.
  const gapFastForwardRef = useRef<{
    fromGlobalMs: number,
    toGlobalMs: number,
    wallMs: number,
    nextTabKey: TabKey,
    gen: number,
  } | null>(null);
  const eventsByTabRef = useRef<Map<TabKey, RrwebEventWithTime[]>>(new Map());
  const loadedDurationByTabMsRef = useRef<Map<TabKey, number>>(new Map());
  const chunkRangesByTabRef = useRef<Map<TabKey, Array<{ startTs: number, endTs: number }>>>(new Map());
  const containerByTabRef = useRef<Map<TabKey, HTMLDivElement | null>>(new Map());
  const replayerByTabRef = useRef<Map<TabKey, RrwebReplayer>>(new Map());
  const replayerRootByTabRef = useRef<Map<TabKey, HTMLDivElement>>(new Map());
  const resizeObserverByTabRef = useRef<Map<TabKey, ResizeObserver>>(new Map());
  const pendingInitByTabRef = useRef<Set<TabKey>>(new Set());

  const tabLabelIndexByKeyRef = useRef<Map<TabKey, number>>(new Map());
  // Tracks which tabs have a FullSnapshot event (rrweb type 2).
  // Tabs without one render as blank white screens.
  const hasFullSnapshotByTabRef = useRef<Set<TabKey>>(new Set());

  const [uiVersion, setUiVersion] = useState(0);

  const [playerError, setPlayerError] = useState<string | null>(null);
  const [replaySettings, setReplaySettings] = useState<ReplaySettings>(getInitialReplaySettings);
  const replaySettingsRef = useRef(replaySettings);
  useEffect(() => {
    replaySettingsRef.current = replaySettings;
  }, [replaySettings]);

  const playerSpeed = replaySettings.playerSpeed;
  const playerSpeedRef = useRef(playerSpeed);
  useEffect(() => {
    playerSpeedRef.current = playerSpeed;
  }, [playerSpeed]);

  useEffect(() => {
    localStorage.setItem(REPLAY_SETTINGS_STORAGE_KEY, JSON.stringify(replaySettings));
  }, [replaySettings]);

  const [playerIsPlaying, setPlayerIsPlaying] = useState(false);
  const playerIsPlayingRef = useRef(false);
  useEffect(() => {
    playerIsPlayingRef.current = playerIsPlaying;
  }, [playerIsPlaying]);

  const [isSkipping, setIsSkipping] = useState(false);
  const speedSubRef = useRef<{ unsubscribe: () => void } | null>(null);

  const pausedAtGlobalRef = useRef(0);
  const [currentGlobalTimeMsForUi, setCurrentGlobalTimeMsForUi] = useState(0);
  const currentGlobalTimeMsForUiRef = useRef(0);
  useEffect(() => {
    currentGlobalTimeMsForUiRef.current = currentGlobalTimeMsForUi;
  }, [currentGlobalTimeMsForUi]);
  const [isBuffering, setIsBuffering] = useState(false);
  const isBufferingRef = useRef(false);
  useEffect(() => {
    isBufferingRef.current = isBuffering;
  }, [isBuffering]);
  const bufferingAtGlobalRef = useRef<number | null>(null);
  const autoResumeAfterBufferingRef = useRef(false);
  const autoPlayTriggeredRef = useRef(false);
  const suppressAutoFollowUntilRef = useRef(0);
  const [replayFinished, setReplayFinished] = useState(false);

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

  useEffect(() => {
    streamsRef.current = streams;
  }, [streams]);

  const resetReplayState = useCallback(() => {
    setDownloadError(null);
    setIsDownloading(false);
    setStreams([]);
    streamsByKeyRef.current = new Map();
    setActiveTab(null);
    globalStartTsRef.current = 0;
    setGlobalTotalTimeMs(0);
    globalTotalTimeMsRef.current = 0;
    gapFastForwardRef.current = null;
    eventsByTabRef.current = new Map();
    loadedDurationByTabMsRef.current = new Map();
    chunkRangesByTabRef.current = new Map();
    pendingInitByTabRef.current = new Set();
    setPlayerError(null);
    setPlayerIsPlaying(false);
    setIsSkipping(false);
    setIsBuffering(false);
    bufferingAtGlobalRef.current = null;
    autoResumeAfterBufferingRef.current = false;
    pausedAtGlobalRef.current = 0;
    autoPlayTriggeredRef.current = false;
    tabLabelIndexByKeyRef.current = new Map();
    hasFullSnapshotByTabRef.current = new Set();
    setReplayFinished(false);
    setCurrentGlobalTimeMsForUi(0);
    setUiVersion(v => v + 1);
    destroyReplayers();
  }, [destroyReplayers, setActiveTab]);

  const findBestTabAtGlobalOffset = useCallback((globalOffsetMs: number, excludeTabKey?: TabKey) => {
    const ts = globalStartTsRef.current + globalOffsetMs;
    const candidates = streamsRef.current.filter((s) => {
      if (excludeTabKey && s.tabKey === excludeTabKey) return false;
      // Skip tabs without a FullSnapshot — they render as blank.
      if (!hasFullSnapshotByTabRef.current.has(s.tabKey)) return false;
      const ranges = chunkRangesByTabRef.current.get(s.tabKey) ?? [];
      // Ranges are sorted by startTs.
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
      const aLabel = tabLabelIndexByKeyRef.current.get(a.tabKey) ?? Number.POSITIVE_INFINITY;
      const bLabel = tabLabelIndexByKeyRef.current.get(b.tabKey) ?? Number.POSITIVE_INFINITY;
      if (aLabel !== bLabel) return aLabel - bLabel;
      return stringCompare(a.tabKey, b.tabKey);
    });

    return candidates[0]!.tabKey;
  }, []);

  const isTabInRangeAtGlobalOffset = useCallback((tabKey: TabKey, globalOffsetMs: number): boolean => {
    if (!hasFullSnapshotByTabRef.current.has(tabKey)) return false;
    const ts = globalStartTsRef.current + globalOffsetMs;
    const ranges = chunkRangesByTabRef.current.get(tabKey) ?? [];
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
  }, []);

  const findNextTabStartAfterGlobalOffset = useCallback((globalOffsetMs: number) => {
    const ts = globalStartTsRef.current + globalOffsetMs;
    let bestStartTs = Infinity;
    let bestKey: TabKey | null = null;

    for (const s of streamsRef.current) {
      if (!hasFullSnapshotByTabRef.current.has(s.tabKey)) continue;
      const ranges = chunkRangesByTabRef.current.get(s.tabKey) ?? [];
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
      globalOffsetMs: bestStartTs - globalStartTsRef.current,
    };
  }, []);

  const getDesiredGlobalOffsetMs = useCallback(() => {
    const key = activeTabKeyRef.current;
    const r = key ? (replayerByTabRef.current.get(key) ?? null) : null;
    const s = key ? (streamsByKeyRef.current.get(key) ?? null) : null;
    let activeLocalOffsetMs: number | null = null;
    let activeStreamStartTs: number | null = null;
    if (r && s) {
      activeStreamStartTs = s.firstEventAt.getTime();
      try {
        activeLocalOffsetMs = r.getCurrentTime();
      } catch {
        activeLocalOffsetMs = null;
      }
    }

    return getDesiredGlobalOffsetFromPlaybackState({
      gapFastForward: gapFastForwardRef.current,
      playerIsPlaying: playerIsPlayingRef.current,
      nowMs: performance.now(),
      playerSpeed: playerSpeedRef.current,
      pausedAtGlobalMs: pausedAtGlobalRef.current,
      activeLocalOffsetMs,
      activeStreamStartTs,
      globalStartTs: globalStartTsRef.current,
      gapFastForwardMultiplier: INTER_TAB_GAP_FAST_FORWARD_MULTIPLIER,
    });
  }, []);

  const pauseAll = useCallback(() => {
    for (const r of replayerByTabRef.current.values()) {
      try {
        r.pause();
      } catch {
        // ignore
      }
    }
  }, []);

  const playActiveAtGlobalOffset = useCallback((globalOffsetMs: number) => {
    gapFastForwardRef.current = null;
    const activeKey = activeTabKeyRef.current;
    for (const [tabKey, r] of replayerByTabRef.current.entries()) {
      const stream = streamsByKeyRef.current.get(tabKey);
      const streamStartTs = stream?.firstEventAt.getTime() ?? globalStartTsRef.current;
      const localOffset = globalOffsetToLocalOffset(globalStartTsRef.current, streamStartTs, globalOffsetMs);
      try {
        if (tabKey === activeKey) {
          r.play(localOffset);
        } else {
          r.pause(localOffset);
        }
      } catch {
        // ignore
      }
    }
  }, []);

  const ensureReplayerForTab = useCallback(async (tabKey: TabKey, gen: number) => {
    if (selectionGenRef.current !== gen) return;
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

    // Don't create a replayer for tabs without a FullSnapshot — they render blank.
    if (!hasFullSnapshotByTabRef.current.has(tabKey)) return;

    try {
      const { Replayer } = await import("rrweb");
      if (selectionGenRef.current !== gen) return;

      const eventsSnapshot2 = eventsByTabRef.current.get(tabKey)?.slice() ?? [];
      if (eventsSnapshot2.length === 0) return;

      const replayer = new Replayer(eventsSnapshot2, {
        root: rootEl,
        speed: playerSpeedRef.current,
        skipInactive: replaySettingsRef.current.skipInactivity,
      });

      rootEl.style.position = "relative";
      rootEl.style.width = "100%";
      rootEl.style.height = "100%";
      rootEl.style.overflow = "hidden";

      replayer.wrapper.style.margin = "0";
      replayer.wrapper.style.position = "absolute";
      replayer.wrapper.style.transformOrigin = "top left";

      replayer.iframe.style.border = "0";

      // Mouse cursor styling (ensures it renders above the iframe consistently).
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
        const isActive = activeTabKeyRef.current === tabKey;
        // Active tab: fit entire replay centered. Mini tabs: fill width, align top (overflow clipped).
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

      const isActiveTab = activeTabKeyRef.current === tabKey;
      const shouldAutoPlay = !autoPlayTriggeredRef.current && isActiveTab;
      if (shouldAutoPlay) {
        autoPlayTriggeredRef.current = true;
      }

      // Seek this stream to the current global time and follow play/pause state.
      // Only the active tab should be playing; others get seeked but paused.
      // NOTE: The replayer is NOT yet registered in replayerByTabRef so that
      // getDesiredGlobalOffsetMs() falls back to pausedAtGlobalRef (which holds
      // the correct authoritative time) instead of reading getCurrentTime()=0
      // from the brand-new replayer.
      const stream = streamsByKeyRef.current.get(tabKey) ?? null;
      const streamStartTs = stream?.firstEventAt.getTime() ?? globalStartTsRef.current;
      const desiredGlobal = getDesiredGlobalOffsetMs();
      const desiredLocal = globalOffsetToLocalOffset(globalStartTsRef.current, streamStartTs, desiredGlobal);
      const shouldPlay = isActiveTab && (shouldAutoPlay || (playerIsPlayingRef.current && !isBufferingRef.current));
      try {
        if (shouldPlay) {
          replayer.play(desiredLocal);
        } else {
          replayer.pause(desiredLocal);
        }
      } catch {
        // ignore
      }

      // Register the replayer AFTER seeking so it doesn't pollute time readings.
      replayerByTabRef.current.set(tabKey, replayer);

      if (shouldAutoPlay && !isBufferingRef.current) {
        playerIsPlayingRef.current = true;
        setPlayerIsPlaying(true);
      }

      // Detect when playback reaches the end of loaded events (active stream only).
      try {
        replayer.on("finish", () => {
          if (selectionGenRef.current !== gen) return;
          if (activeTabKeyRef.current !== tabKey) return;

          let localTime = 0;
          try {
            localTime = replayer.getCurrentTime();
          } catch {
            // ignore
          }

          // Guard against premature finish: rrweb fires "finish" when its
          // internal timer exhausts events present at construction time.
          // Events added later via addEvent() extend the array but the
          // timer may already have stopped. Restart if more data exists.
          const loadedDurationMs = loadedDurationByTabMsRef.current.get(tabKey) ?? 0;
          if (loadedDurationMs > localTime + 100) {
            try {
              replayer.play(localTime);
            } catch {
              // ignore
            }
            return;
          }

          const stream2 = streamsByKeyRef.current.get(tabKey) ?? null;
          const streamStartTs2 = stream2?.firstEventAt.getTime() ?? globalStartTsRef.current;
          let globalOffset = localOffsetToGlobalOffset(globalStartTsRef.current, streamStartTs2, localTime);

          // Find the best OTHER tab at this offset (exclude the exhausted tab).
          let bestKey = findBestTabAtGlobalOffset(globalOffset, tabKey);

          // rrweb's finish callback can report a stale time from an earlier frame.
          // If it is meaningfully behind the authoritative timeline, retry with
          // the authoritative time.
          if (!bestKey && globalOffset + 500 < currentGlobalTimeMsForUiRef.current) {
            globalOffset = currentGlobalTimeMsForUiRef.current;
            bestKey = findBestTabAtGlobalOffset(globalOffset, tabKey);
          }

          // Another tab has events at this time — switch to it.
          if (bestKey) {
            const switchToKey = bestKey;
            setActiveTab(switchToKey);
            pausedAtGlobalRef.current = globalOffset;
            setIsBuffering(false);
            bufferingAtGlobalRef.current = null;
            autoResumeAfterBufferingRef.current = false;
            runAsynchronously(() => ensureReplayerForTab(switchToKey, gen), { noErrorLogging: true });
            playActiveAtGlobalOffset(globalOffset);
            setPlayerIsPlaying(true);
            suppressAutoFollowUntilRef.current = performance.now() + 400;
            return;
          }

          // No alternative tab — check for gap, buffer, or true finish.
          const nextStart = findNextTabStartAfterGlobalOffset(globalOffset);
          const finishAction = getReplayFinishAction({
            hasBestTabAtCurrentTime: false,
            isDownloading: isDownloadingRef.current,
            nextStartGlobalOffsetMs: nextStart?.globalOffsetMs ?? null,
            currentGlobalOffsetMs: Math.max(globalOffset, currentGlobalTimeMsForUiRef.current),
          });
          if (finishAction.type === "gap_fast_forward" && nextStart) {
            gapFastForwardRef.current = {
              fromGlobalMs: globalOffset,
              toGlobalMs: finishAction.toGlobalMs,
              wallMs: performance.now(),
              nextTabKey: nextStart.tabKey,
              gen,
            };
            pausedAtGlobalRef.current = globalOffset;
            return;
          }
          if (finishAction.type === "buffer_at_current") {
            pausedAtGlobalRef.current = globalOffset;
            bufferingAtGlobalRef.current = globalOffset;
            autoResumeAfterBufferingRef.current = true;
            setIsBuffering(true);
            setPlayerIsPlaying(false);
            return;
          }

          // End of recording — stop at the very end.
          pausedAtGlobalRef.current = globalTotalTimeMsRef.current;
          setCurrentGlobalTimeMsForUi(globalTotalTimeMsRef.current);
          pauseAll();
          setIsBuffering(false);
          setPlayerIsPlaying(false);
          setReplayFinished(true);
        });
      } catch {
        // ignore
      }

      setUiVersion(v => v + 1);
    } catch (e: any) {
      setPlayerError(e?.message ?? "Failed to initialize rrweb player.");
    }
  }, [findBestTabAtGlobalOffset, findNextTabStartAfterGlobalOffset, getDesiredGlobalOffsetMs, pauseAll, playActiveAtGlobalOffset, setActiveTab]);

  const setContainerRefForTab = useCallback((tabKey: TabKey, el: HTMLDivElement | null) => {
    containerByTabRef.current.set(tabKey, el);

    if (!el) return;

    // If a replayer already exists but was created with a different DOM node
    // (e.g. the tab unmounted and remounted), destroy the stale replayer so a
    // fresh one is created with the new element.
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
    runAsynchronously(() => ensureReplayerForTab(tabKey, selectionGenRef.current), { noErrorLogging: true });
  }, [ensureReplayerForTab]);

  const loadChunksAndDownload = useCallback(async (recordingId: string) => {
    const gen = ++selectionGenRef.current;
    resetReplayState();
    setIsDownloading(true);

    try {
      const allChunkRows: ChunkRow[] = [];
      let cursor: string | null = null;
      while (true) {
        const res: { items: ChunkRow[], nextCursor: string | null } = await adminApp.listSessionRecordingChunks(
          recordingId,
          { limit: CHUNK_PAGE_SIZE, cursor: cursor ?? undefined },
        );
        if (selectionGenRef.current !== gen) return;
        allChunkRows.push(...res.items);
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }

      const allStreams = groupChunksIntoTabStreams(allChunkRows);
      streamsByKeyRef.current = new Map(allStreams.map(s => [s.tabKey, s]));
      setStreams(allStreams);
      streamsRef.current = allStreams;

      const { globalStartTs, globalTotalMs } = computeGlobalTimeline(allStreams);
      globalStartTsRef.current = globalStartTs;
      setGlobalTotalTimeMs(globalTotalMs);
      globalTotalTimeMsRef.current = globalTotalMs;

      // Per-tab time ranges based on chunk metadata. This is what we use to decide
      // whether a tab has events "at" the current global time (and whether to buffer
      // or skip to the next chunk).
      const rangesByTab = new Map<TabKey, Array<{ startTs: number, endTs: number }>>();
      for (const s of allStreams) {
        const ranges = s.chunks
          .map((c) => ({ startTs: c.firstEventAt.getTime(), endTs: c.lastEventAt.getTime() }))
          .filter(r => Number.isFinite(r.startTs) && Number.isFinite(r.endTs) && r.endTs >= r.startTs)
          .sort((a, b) => a.startTs - b.startTs);

        // Merge overlaps/adjacent ranges to reduce churn.
        const merged: Array<{ startTs: number, endTs: number }> = [];
        for (const r of ranges) {
          const last = merged[merged.length - 1] as { startTs: number, endTs: number } | undefined;
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
      chunkRangesByTabRef.current = rangesByTab;

      // Stable tab labels: Tab 1 = lowest firstEventAt, Tab 2 = second-lowest, etc.
      const labelOrder = allStreams
        .slice()
        .sort((a, b) => {
          const first = a.firstEventAt.getTime() - b.firstEventAt.getTime();
          if (first !== 0) return first;
          return stringCompare(a.tabKey, b.tabKey);
        });
      tabLabelIndexByKeyRef.current = new Map(labelOrder.map((s, i) => [s.tabKey, i + 1]));

      // Start at the beginning of the overall replay (globalStartTs). This avoids
      // landing at an arbitrary offset when the most-recent tab started later.
      const initialActive = (
        allStreams.find(s => s.firstEventAt.getTime() === globalStartTs)?.tabKey
        ?? (allStreams[0] as TabStream<ChunkRow> | undefined)?.tabKey
        ?? null
      );
      setActiveTab(initialActive);
      pausedAtGlobalRef.current = 0;
      setCurrentGlobalTimeMsForUi(0);

      await fetchChunkEventsForStreamsParallel(
        adminApp,
        recordingId,
        allStreams.map(s => ({ tabKey: s.tabKey, chunks: s.chunks })),
        gen,
        selectionGenRef,
        (tabKey, _chunkIndex, events) => {
          const prev = eventsByTabRef.current.get(tabKey) ?? [];
          const wasEmpty = prev.length === 0;
          prev.push(...events);
          eventsByTabRef.current.set(tabKey, prev);

          // Track whether this tab has a FullSnapshot (rrweb type 2).
          // Without one the replayer renders a blank white screen.
          if (!hasFullSnapshotByTabRef.current.has(tabKey)) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if (events.some(e => (e as any).type === 2)) {
              hasFullSnapshotByTabRef.current.add(tabKey);
              setUiVersion(v => v + 1);
            }
          }

          if (prev.length >= 2) {
            loadedDurationByTabMsRef.current.set(tabKey, prev[prev.length - 1].timestamp - prev[0].timestamp);
          }

          if (wasEmpty && prev.length > 0) {
            runAsynchronously(() => ensureReplayerForTab(tabKey, gen), { noErrorLogging: true });
            setUiVersion(v => v + 1);
          } else {
            const r = replayerByTabRef.current.get(tabKey);
            if (r) {
              for (const event of events) {
                r.addEvent(event);
              }
            } else {
              runAsynchronously(() => ensureReplayerForTab(tabKey, gen), { noErrorLogging: true });
            }
          }

          // Resume playback if the active stream was buffering and now has enough data.
          if (activeTabKeyRef.current !== tabKey) return;
          if (bufferingAtGlobalRef.current === null) return;

          const stream = streamsByKeyRef.current.get(tabKey) ?? null;
          if (!stream) return;

          const targetLocal = globalOffsetToLocalOffset(
            globalStartTsRef.current,
            stream.firstEventAt.getTime(),
            bufferingAtGlobalRef.current,
          );
          const loaded = loadedDurationByTabMsRef.current.get(tabKey) ?? 0;

          if (loaded >= targetLocal) {
            const seekTo = bufferingAtGlobalRef.current;
            bufferingAtGlobalRef.current = null;
            setIsBuffering(false);

            if (autoResumeAfterBufferingRef.current) {
              autoResumeAfterBufferingRef.current = false;
              playActiveAtGlobalOffset(seekTo);
              setPlayerIsPlaying(true);
            }
          }
        },
      );
    } catch (e: any) {
      setDownloadError(e?.message ?? "Failed to load replay data.");
    } finally {
      if (selectionGenRef.current === gen) {
        setIsDownloading(false);
      }
    }
  }, [adminApp, ensureReplayerForTab, playActiveAtGlobalOffset, resetReplayState, setActiveTab]);

  useEffect(() => {
    if (!selectedRecordingId || !selectedRecording) return;
    runAsynchronously(() => loadChunksAndDownload(selectedRecordingId), { noErrorLogging: true });
  }, [loadChunksAndDownload, selectedRecordingId, selectedRecording]);

  // Safety net: if downloading finishes while buffering, resume playback.
  useEffect(() => {
    if (isDownloading) return;
    if (bufferingAtGlobalRef.current === null) return;
    if (!autoResumeAfterBufferingRef.current) return;
    const seekTo = bufferingAtGlobalRef.current;
    bufferingAtGlobalRef.current = null;
    autoResumeAfterBufferingRef.current = false;
    setIsBuffering(false);
    playActiveAtGlobalOffset(seekTo);
    setPlayerIsPlaying(true);
  }, [isDownloading, playActiveAtGlobalOffset]);

  useEffect(() => {
    return () => {
      selectionGenRef.current += 1;
      destroyReplayers();
    };
  }, [destroyReplayers]);

  const getCurrentGlobalTimeMs = useCallback(() => {
    return getDesiredGlobalOffsetMs();
  }, [getDesiredGlobalOffsetMs]);

  // Drives right-bar tab visibility (only show tabs "active" at the current time)
  // and avoids calling getCurrentGlobalTimeMs() directly during render.
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let lastUpdateAt = 0;

    const tick = (now: number) => {
      if (cancelled) return;
      // Throttle UI updates; the actual playback is handled by rrweb.
      if (now - lastUpdateAt > 200) {
        lastUpdateAt = now;
        let globalOffset = getCurrentGlobalTimeMs();
        const previousGlobalOffset = currentGlobalTimeMsForUiRef.current;

        // Guard against stale rrweb readings that momentarily report an older
        // time near replay end; otherwise auto-follow can jump back to older tabs.
        if (
          playerIsPlayingRef.current
          && !isBufferingRef.current
          && !gapFastForwardRef.current
          && performance.now() >= suppressAutoFollowUntilRef.current
          && globalOffset + 500 < previousGlobalOffset
        ) {
          globalOffset = previousGlobalOffset;
        }

        setCurrentGlobalTimeMsForUi(globalOffset);

        // Sync visible mini tab replayers to the current global time so their
        // thumbnails update during playback instead of staying frozen.
        if (playerIsPlayingRef.current && !isBufferingRef.current) {
          const activeKey = activeTabKeyRef.current;
          for (const [tabKey, r] of replayerByTabRef.current.entries()) {
            if (tabKey === activeKey) continue;
            const stream = streamsByKeyRef.current.get(tabKey);
            if (!stream) continue;
            const localOffset = globalOffsetToLocalOffset(
              globalStartTsRef.current,
              stream.firstEventAt.getTime(),
              globalOffset,
            );
            try {
              r.pause(localOffset);
            } catch {
              // ignore — replayer may not be ready yet
            }
          }
        }

        const gapFastForward = gapFastForwardRef.current;
        if (gapFastForward && globalOffset >= gapFastForward.toGlobalMs) {
          gapFastForwardRef.current = null;
          setActiveTab(gapFastForward.nextTabKey);
          pausedAtGlobalRef.current = gapFastForward.toGlobalMs;
          setCurrentGlobalTimeMsForUi(gapFastForward.toGlobalMs);
          setIsBuffering(false);
          bufferingAtGlobalRef.current = null;
          autoResumeAfterBufferingRef.current = false;
          suppressAutoFollowUntilRef.current = performance.now() + 200;
          runAsynchronously(() => ensureReplayerForTab(gapFastForward.nextTabKey, gapFastForward.gen), { noErrorLogging: true });
          playActiveAtGlobalOffset(gapFastForward.toGlobalMs);
          setPlayerIsPlaying(true);
          raf = requestAnimationFrame(tick);
          return;
        }

        // Auto-follow the tab that has events at the current global time.
        // This must use the authoritative time, not the last UI state.
        if (
          replaySettingsRef.current.followActiveTab
          && playerIsPlayingRef.current
          && !isBufferingRef.current
          && streamsRef.current.length > 1
        ) {
          if (performance.now() < suppressAutoFollowUntilRef.current) {
            // Recently seeked/started playback; wait for rrweb to catch up.
          } else if (activeTabKeyRef.current && isTabInRangeAtGlobalOffset(activeTabKeyRef.current, globalOffset)) {
            // Current tab still has events at this time — stay on it (stickiness).
          } else {
            const bestKey = findBestTabAtGlobalOffset(globalOffset);
            if (bestKey && bestKey !== activeTabKeyRef.current) {
              setActiveTab(bestKey);
              pausedAtGlobalRef.current = globalOffset;
              runAsynchronously(() => ensureReplayerForTab(bestKey, selectionGenRef.current), { noErrorLogging: true });
              playActiveAtGlobalOffset(globalOffset);
              suppressAutoFollowUntilRef.current = performance.now() + 200;
            }
            // When !bestKey (gap between tabs), active replayer finish handlers
            // fast-forward to the next tab start.
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [
    ensureReplayerForTab,
    findBestTabAtGlobalOffset,
    getCurrentGlobalTimeMs,
    isTabInRangeAtGlobalOffset,
    playActiveAtGlobalOffset,
    setActiveTab,
  ]);

  const togglePlayPause = useCallback(() => {
    if (playerIsPlaying || isBuffering) {
      if (!isBuffering) {
        pausedAtGlobalRef.current = getCurrentGlobalTimeMs();
        setCurrentGlobalTimeMsForUi(pausedAtGlobalRef.current);
      }
      gapFastForwardRef.current = null;
      pauseAll();
      bufferingAtGlobalRef.current = null;
      autoResumeAfterBufferingRef.current = false;
      setIsBuffering(false);
      setPlayerIsPlaying(false);
      return;
    }

    const target = pausedAtGlobalRef.current;
    const activeKey = activeTabKeyRef.current;
    const activeStream = activeKey ? streamsByKeyRef.current.get(activeKey) ?? null : null;
    if (isDownloadingRef.current && activeKey && activeStream) {
      const localTarget = globalOffsetToLocalOffset(globalStartTsRef.current, activeStream.firstEventAt.getTime(), target);
      const loaded = loadedDurationByTabMsRef.current.get(activeKey) ?? 0;
      if (localTarget > loaded) {
        bufferingAtGlobalRef.current = target;
        autoResumeAfterBufferingRef.current = true;
        setIsBuffering(true);
        return;
      }
    }

    bufferingAtGlobalRef.current = null;
    setIsBuffering(false);
    setReplayFinished(false);
    playActiveAtGlobalOffset(target);
    setPlayerIsPlaying(true);
    setCurrentGlobalTimeMsForUi(target);
    suppressAutoFollowUntilRef.current = performance.now() + 400;
  }, [getCurrentGlobalTimeMs, isBuffering, pauseAll, playActiveAtGlobalOffset, playerIsPlaying]);

  const handleSeek = useCallback((globalOffset: number) => {
    const seekState = applySeekState({ seekToGlobalMs: globalOffset });
    if (seekState.clearGapFastForward) {
      gapFastForwardRef.current = null;
    }
    pausedAtGlobalRef.current = seekState.pausedAtGlobalMs;
    setReplayFinished(false);

    // If the seek target is outside the currently active tab's time range,
    // switch to the best tab for that time.
    const desiredKey = findBestTabAtGlobalOffset(globalOffset);
    if (desiredKey && desiredKey !== activeTabKeyRef.current) {
      setActiveTab(desiredKey);
      runAsynchronously(() => ensureReplayerForTab(desiredKey, selectionGenRef.current), { noErrorLogging: true });
    }

    const activeKey = activeTabKeyRef.current;
    const activeStream = activeKey ? streamsByKeyRef.current.get(activeKey) ?? null : null;
    if (isDownloadingRef.current && activeKey && activeStream) {
      const localTarget = globalOffsetToLocalOffset(globalStartTsRef.current, activeStream.firstEventAt.getTime(), globalOffset);
      const loaded = loadedDurationByTabMsRef.current.get(activeKey) ?? 0;
      if (localTarget > loaded) {
        pauseAll();
        bufferingAtGlobalRef.current = globalOffset;
        autoResumeAfterBufferingRef.current = true;
        setIsBuffering(true);
        setPlayerIsPlaying(false);
        return;
      }
    }

    bufferingAtGlobalRef.current = null;
    autoResumeAfterBufferingRef.current = false;
    setIsBuffering(false);
    playActiveAtGlobalOffset(globalOffset);
    setPlayerIsPlaying(true);
    setCurrentGlobalTimeMsForUi(globalOffset);
    suppressAutoFollowUntilRef.current = performance.now() + 400;
  }, [ensureReplayerForTab, findBestTabAtGlobalOffset, pauseAll, playActiveAtGlobalOffset, setActiveTab]);

  const updateSpeed = useCallback((speed: number) => {
    if (!ALLOWED_PLAYER_SPEEDS.has(speed)) return;
    setReplaySettings((prev) => ({ ...prev, playerSpeed: speed }));
    for (const r of replayerByTabRef.current.values()) {
      try {
        r.setConfig({ speed });
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    for (const r of replayerByTabRef.current.values()) {
      try {
        r.setConfig({ skipInactive: replaySettings.skipInactivity });
      } catch {
        // ignore
      }
    }
    if (!replaySettings.skipInactivity) {
      setIsSkipping(false);
    }
  }, [replaySettings.skipInactivity]);

  const onSelectActiveTab = useCallback((tabKey: TabKey) => {
    const now = getCurrentGlobalTimeMs();
    setActiveTab(tabKey);
    suppressAutoFollowUntilRef.current = performance.now() + 5000;
    pausedAtGlobalRef.current = now;
    setIsSkipping(false);

    // Force a seek so the newly active tab aligns immediately.
    pauseAll();
    autoResumeAfterBufferingRef.current = false;
    bufferingAtGlobalRef.current = null;
    setIsBuffering(false);

    const stream = streamsByKeyRef.current.get(tabKey) ?? null;
    if (isDownloadingRef.current && stream) {
      const localTarget = globalOffsetToLocalOffset(globalStartTsRef.current, stream.firstEventAt.getTime(), now);
      const loaded = loadedDurationByTabMsRef.current.get(tabKey) ?? 0;
      if (localTarget > loaded) {
        bufferingAtGlobalRef.current = now;
        autoResumeAfterBufferingRef.current = true;
        setIsBuffering(true);
        setPlayerIsPlaying(false);
        runAsynchronously(() => ensureReplayerForTab(tabKey, selectionGenRef.current), { noErrorLogging: true });
        return;
      }
    }

    runAsynchronously(() => ensureReplayerForTab(tabKey, selectionGenRef.current), { noErrorLogging: true });

    if (playerIsPlayingRef.current && !isBufferingRef.current) {
      playActiveAtGlobalOffset(now);
      setPlayerIsPlaying(true);
    } else {
      setPlayerIsPlaying(false);
    }
  }, [ensureReplayerForTab, getCurrentGlobalTimeMs, pauseAll, playActiveAtGlobalOffset, setActiveTab]);

  // Subscribe to speedService on the active stream only (for skip indicator).
  useEffect(() => {
    if (!replaySettings.skipInactivity) {
      setIsSkipping(false);
      speedSubRef.current?.unsubscribe();
      speedSubRef.current = null;
      return;
    }

    const key = activeTabKey;
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
  }, [activeTabKey, replaySettings.skipInactivity, uiVersion]);

  const activeStream = useMemo(
    () => (activeTabKey ? streams.find(s => s.tabKey === activeTabKey) ?? null : null),
    [activeTabKey, streams],
  );

  const visibleMiniStreams = useMemo(() => {
    void uiVersion; // re-compute when FullSnapshot status changes
    const currentTs = globalStartTsRef.current + currentGlobalTimeMsForUi;
    const candidates = streams.filter(s =>
      s.tabKey !== activeTabKey && hasFullSnapshotByTabRef.current.has(s.tabKey)
    );
    const inRange = candidates.filter(s =>
      currentTs >= s.firstEventAt.getTime() && currentTs <= s.lastEventAt.getTime()
    );

    inRange.sort((a, b) => {
      const aLabel = tabLabelIndexByKeyRef.current.get(a.tabKey) ?? Number.POSITIVE_INFINITY;
      const bLabel = tabLabelIndexByKeyRef.current.get(b.tabKey) ?? Number.POSITIVE_INFINITY;
      if (aLabel !== bLabel) return aLabel - bLabel;
      return stringCompare(a.tabKey, b.tabKey);
    });

    return inRange.slice(0, EXTRA_TABS_TO_SHOW);
  }, [activeTabKey, currentGlobalTimeMsForUi, streams, uiVersion]);

  const showRightColumn = visibleMiniStreams.length > 0;

  const miniIndexByKey = useMemo(() => {
    const m = new Map<TabKey, number>();
    for (const [idx, s] of visibleMiniStreams.entries()) {
      m.set(s.tabKey, idx);
    }
    return m;
  }, [visibleMiniStreams]);

  const getTabLabel = useCallback((tabKey: TabKey) => {
    const idx = tabLabelIndexByKeyRef.current.get(tabKey);
    if (!idx) return "Tab";
    return `Tab ${idx}`;
  }, []);

  const activeHasEvents = useMemo(() => {
    if (!activeStream) return false;
    // uiVersion ensures re-render when events/replayers arrive.
    void uiVersion;
    return (eventsByTabRef.current.get(activeStream.tabKey)?.length ?? 0) > 0;
  }, [activeStream, uiVersion]);

  const renderableStreamCount = useMemo(() => {
    void uiVersion;
    return streams.filter(s => hasFullSnapshotByTabRef.current.has(s.tabKey)).length;
  }, [streams, uiVersion]);

  const showMainTabLabel = renderableStreamCount > 1;

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
              {(downloadError || playerError) && (
                <div className="p-3 space-y-2">
                  {downloadError && <Alert variant="destructive">{downloadError}</Alert>}
                  {playerError && <Alert variant="destructive">{playerError}</Alert>}
                </div>
              )}

              <div className="shrink-0 px-3 py-2 border-b border-border/30 flex items-center justify-between gap-3 h-10">
                <Typography className="text-sm font-medium truncate">
                  {selectedRecording ? getRecordingTitle(selectedRecording) : ""}
                </Typography>
                <ReplaySettingsButton
                  settings={replaySettings}
                  onSettingsChange={(updates) => setReplaySettings((prev) => ({ ...prev, ...updates }))}
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
                      {streams.length === 0 && (
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

                      {streams.map((s) => {
                        const isActive = s.tabKey === activeTabKey;
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
                                {/* Main tab label */}
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

                                {/* Paused / finished overlay */}
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

                                {/* Skipping inactivity indicator */}
                                {activeHasEvents && replaySettings.skipInactivity && isSkipping && (
                                  <div className="absolute inset-x-0 top-4 z-10 flex justify-center pointer-events-none">
                                    <div className="flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-sm">
                                      <FastForwardIcon className="h-3.5 w-3.5 text-white" weight="fill" />
                                      <span className="text-xs text-white">Skipping inactivity</span>
                                    </div>
                                  </div>
                                )}

                                {/* Buffering overlay — waiting for events to load */}
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

                                {/* Click to toggle play/pause during playback */}
                                {activeHasEvents && playerIsPlaying && !isBuffering && (
                                  <div
                                    className="absolute inset-0 z-10 cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      togglePlayPause();
                                    }}
                                  />
                                )}

                                {/* Loading / no events overlay */}
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
                        totalTimeMs={globalTotalTimeMs}
                        onTogglePlayPause={togglePlayPause}
                        onSeek={handleSeek}
                        playerSpeed={playerSpeed}
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
