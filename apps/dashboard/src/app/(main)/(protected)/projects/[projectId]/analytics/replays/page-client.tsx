"use client";

import { Alert, Button, Skeleton, Typography } from "@/components/ui";
import { useFromNow } from "@/hooks/use-from-now";
import { cn } from "@/lib/utils";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { FastForwardIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

const PAGE_SIZE = 50;
const CHUNK_PAGE_SIZE = 250;
const CHUNK_EVENTS_CONCURRENCY = 6;

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

async function fetchChunkEventsParallel(
  adminApp: ReturnType<typeof useAdminApp>,
  recordingId: string,
  chunks: ChunkRow[],
  gen: number,
  genRef: React.MutableRefObject<number>,
  onChunkLoaded: (chunkIndex: number, events: RrwebEventWithTime[]) => void,
) {
  const results: (RrwebEventWithTime[] | null)[] = new Array(chunks.length).fill(null);
  let nextIndex = 0;
  let reported = 0;

  async function worker() {
    while (nextIndex < chunks.length) {
      if (genRef.current !== gen) return;
      const idx = nextIndex++;
      const c = chunks[idx];
      const ev = await adminApp.getSessionRecordingChunkEvents(recordingId, c.id);
      if (genRef.current !== gen) return;
      results[idx] = coerceRrwebEvents(ev.events);
      while (reported < results.length && results[reported] !== null) {
        onChunkLoaded(reported, results[reported]!);
        reported++;
      }
    }
  }

  const workers = Array.from({ length: Math.min(CHUNK_EVENTS_CONCURRENCY, chunks.length) }, () => worker());
  await Promise.all(workers);
}

function Timeline({
  replayerRef,
  playerIsPlaying,
  totalTimeMs,
  onTogglePlayPause,
  onSeek,
  playerSpeed,
  onSpeedChange,
}: {
  replayerRef: React.MutableRefObject<RrwebReplayer | null>,
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
      const r = replayerRef.current;
      if (r) {
        try {
          setCurrentTime(r.getCurrentTime());
        } catch {
          // replayer may not be ready yet
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [replayerRef]);

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

export default function PageClient() {
  const adminApp = useAdminApp();

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
  const playerInitTriggeredRef = useRef(false);

  const allEventsRef = useRef<RrwebEventWithTime[]>([]);
  const [playerEvents, setPlayerEvents] = useState<RrwebEventWithTime[] | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playerSpeed, setPlayerSpeed] = useState(1);
  const [playerIsPlaying, setPlayerIsPlaying] = useState(false);
  const [playerVersion, setPlayerVersion] = useState(0);
  const [playerTotalTimeMs, setPlayerTotalTimeMs] = useState(0);
  const [isSkipping, setIsSkipping] = useState(false);
  const playerSpeedRef = useRef(playerSpeed);
  const pausedAtRef = useRef(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const bufferingAtRef = useRef<number | null>(null);
  const loadedDurationMsRef = useRef(0);
  const isDownloadingRef = useRef(false);
  isDownloadingRef.current = isDownloading;

  useEffect(() => {
    playerSpeedRef.current = playerSpeed;
  }, [playerSpeed]);

  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const replayerRef = useRef<RrwebReplayer | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const speedSubRef = useRef<{ unsubscribe: () => void } | null>(null);

  const resetReplayState = useCallback(() => {
    setDownloadError(null);
    setIsDownloading(false);
    allEventsRef.current = [];
    playerInitTriggeredRef.current = false;

    setPlayerEvents(null);
    setPlayerError(null);
    setPlayerIsPlaying(false);
    setPlayerSpeed(1);
    setPlayerVersion(v => v + 1);
    setPlayerTotalTimeMs(0);
    setIsSkipping(false);
    setIsBuffering(false);
    bufferingAtRef.current = null;
    loadedDurationMsRef.current = 0;
    pausedAtRef.current = 0;
  }, []);

  const destroyReplayer = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    speedSubRef.current?.unsubscribe();
    speedSubRef.current = null;
    replayerRef.current?.pause();
    replayerRef.current = null;
    if (playerContainerRef.current) {
      playerContainerRef.current.innerHTML = "";
    }
  }, []);

  // (Re)initialize rrweb replayer when we have a snapshot to play.
  useEffect(() => {
    destroyReplayer();
    setPlayerIsPlaying(false);
    setPlayerError(null);
    setIsSkipping(false);

    if (!playerEvents) {
      return;
    }
    const root = playerContainerRef.current;
    if (!root) return;

    runAsynchronously(async () => {
      try {
        const { Replayer } = await import("rrweb");
        // Snapshot events at construction time — includes events that arrived
        // while the dynamic import was loading
        const eventsSnapshot = allEventsRef.current.slice();
        if (eventsSnapshot.length === 0) return;
        const replayer = new Replayer(eventsSnapshot, {
          root,
          speed: playerSpeedRef.current,
          skipInactive: true,
        });

        // Container setup
        root.style.position = "relative";
        root.style.width = "100%";
        root.style.height = "100%";
        root.style.overflow = "hidden";

        // Let rrweb keep the wrapper at the recorded viewport size, but position
        // it absolutely so we can scale+center it within the container.
        replayer.wrapper.style.margin = "0";
        replayer.wrapper.style.position = "absolute";
        replayer.wrapper.style.transformOrigin = "top left";

        replayer.iframe.style.border = "0";

        // Mouse cursor styling
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

        // Scale-to-fit: read the recorded viewport size dynamically from the
        // wrapper (CSS transform doesn't affect offsetWidth/offsetHeight), then
        // scale it to fit the container while preserving aspect ratio.
        function updateScale() {
          const cw = root!.clientWidth;
          const ch = root!.clientHeight;
          const replayW = replayer.wrapper.offsetWidth;
          const replayH = replayer.wrapper.offsetHeight;
          if (replayW <= 0 || replayH <= 0 || cw <= 0 || ch <= 0) return;
          const scale = Math.min(cw / replayW, ch / replayH);
          const scaledW = replayW * scale;
          const scaledH = replayH * scale;
          replayer.wrapper.style.left = `${(cw - scaledW) / 2}px`;
          replayer.wrapper.style.top = `${(ch - scaledH) / 2}px`;
          replayer.wrapper.style.transform = `scale(${scale})`;
        }

        updateScale();
        // Observe both the container (for window resize / panel drag) and
        // the wrapper (for when rrweb sets dimensions after snapshot rebuild).
        const observer = new ResizeObserver(updateScale);
        observer.observe(root);
        observer.observe(replayer.wrapper);
        resizeObserverRef.current = observer;

        // Subscribe to speedService to detect skip-inactive fast-forward
        try {
          const sub = (replayer as any).speedService.subscribe((state: any) => {
            setIsSkipping(state.value === "skipping");
          });
          speedSubRef.current = sub;
        } catch {
          // speedService may not be available in all rrweb versions
        }

        replayerRef.current = replayer;

        // Detect when playback reaches the end of loaded events
        try {
          replayer.on('finish', () => {
            if (isDownloadingRef.current) {
              // Ran out of loaded events while more chunks are still arriving
              let currentTime = 0;
              try {
                currentTime = replayer.getCurrentTime();
              } catch {
                // replayer may not be ready
              }
              bufferingAtRef.current = currentTime;
              pausedAtRef.current = currentTime;
              setIsBuffering(true);
              setPlayerIsPlaying(false);
            } else {
              setPlayerIsPlaying(false);
            }
          });
        } catch {
          // .on() may not be available in all rrweb versions
        }

        // Always autoplay
        replayer.play();
        setPlayerIsPlaying(true);
      } catch (e: any) {
        setPlayerError(e?.message ?? "Failed to initialize rrweb player.");
      }
    }, { noErrorLogging: true });

    return () => {
      destroyReplayer();
    };
  }, [destroyReplayer, playerEvents, playerVersion]);

  // Fetch chunks and stream events to the player progressively.
  // Playback begins as soon as the first chunk arrives (which contains the
  // rrweb FullSnapshot); subsequent chunks are fed via addEvent().
  const loadChunksAndDownload = useCallback(async (recordingId: string, knownDurationMs: number) => {
    const gen = ++selectionGenRef.current;
    resetReplayState();
    setPlayerTotalTimeMs(knownDurationMs);
    setIsDownloading(true);

    try {
      const allChunkRows: ChunkRow[] = [];
      let cursor: string | null = null;
      while (true) {
        const res = await adminApp.listSessionRecordingChunks(recordingId, { limit: CHUNK_PAGE_SIZE, cursor: cursor ?? undefined });
        if (selectionGenRef.current !== gen) return;
        allChunkRows.push(...res.items);
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }

      await fetchChunkEventsParallel(
        adminApp,
        recordingId,
        allChunkRows,
        gen,
        selectionGenRef,
        (_chunkIndex, events) => {
          allEventsRef.current.push(...events);

          // Start playback as soon as the first events arrive
          if (!playerInitTriggeredRef.current && allEventsRef.current.length > 0) {
            playerInitTriggeredRef.current = true;
            setPlayerEvents(allEventsRef.current.slice());
            setPlayerVersion(v => v + 1);
          } else if (replayerRef.current) {
            // Feed events to the live replayer
            for (const event of events) {
              replayerRef.current.addEvent(event);
            }
          }
          // Events arriving while the Replayer is still initialising (after
          // playerInitTriggered but before replayerRef is set) are safe —
          // the init effect snapshots allEventsRef.current at construction time.

          // Track how far events have been loaded (for buffering checks)
          const all = allEventsRef.current;
          if (all.length >= 2) {
            loadedDurationMsRef.current = all[all.length - 1].timestamp - all[0].timestamp;
          }

          // Resume playback if we were buffering and now have enough data
          if (bufferingAtRef.current !== null && loadedDurationMsRef.current >= bufferingAtRef.current) {
            const seekTo = bufferingAtRef.current;
            bufferingAtRef.current = null;
            setIsBuffering(false);
            const r = replayerRef.current;
            if (r) {
              r.play(seekTo);
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
  }, [adminApp, resetReplayState]);

  useEffect(() => {
    if (!selectedRecordingId || !selectedRecording) return;
    const durationMs = selectedRecording.lastEventAt.getTime() - selectedRecording.startedAt.getTime();
    runAsynchronously(() => loadChunksAndDownload(selectedRecordingId, durationMs), { noErrorLogging: true });
  }, [loadChunksAndDownload, selectedRecordingId, selectedRecording]);

  // Safety net: if downloading finishes while buffering, resume playback.
  // Normally the onChunkLoaded callback handles this, but this covers edge
  // cases where loaded duration doesn't quite reach the seek target due to
  // rounding between recording metadata and event timestamps.
  useEffect(() => {
    if (!isDownloading && bufferingAtRef.current !== null) {
      const seekTo = bufferingAtRef.current;
      bufferingAtRef.current = null;
      setIsBuffering(false);
      const r = replayerRef.current;
      if (r) {
        r.play(seekTo);
        setPlayerIsPlaying(true);
      }
    }
  }, [isDownloading]);

  useEffect(() => {
    return () => {
      selectionGenRef.current += 1;
      destroyReplayer();
    };
  }, [destroyReplayer]);

  const togglePlayPause = useCallback(() => {
    const r = replayerRef.current;
    if (!r) return;
    if (playerIsPlaying || isBuffering) {
      // Pause — also cancel any pending buffering
      if (!isBuffering) {
        try {
          pausedAtRef.current = r.getCurrentTime();
        } catch {
          // Ignore: the replayer may throw if it's not ready yet.
        }
      }
      r.pause();
      bufferingAtRef.current = null;
      setIsBuffering(false);
      setPlayerIsPlaying(false);
    } else {
      // Resume — check if we need to buffer first
      const target = pausedAtRef.current;
      if (isDownloadingRef.current && target > loadedDurationMsRef.current) {
        bufferingAtRef.current = target;
        setIsBuffering(true);
      } else {
        r.play(target);
        setPlayerIsPlaying(true);
      }
    }
  }, [playerIsPlaying, isBuffering]);

  const handleSeek = useCallback((timeOffset: number) => {
    const r = replayerRef.current;
    if (!r) return;
    pausedAtRef.current = timeOffset;
    if (isDownloadingRef.current && timeOffset > loadedDurationMsRef.current) {
      // Target is past loaded events — pause and wait for data
      r.pause();
      bufferingAtRef.current = timeOffset;
      setIsBuffering(true);
      setPlayerIsPlaying(false);
    } else {
      bufferingAtRef.current = null;
      setIsBuffering(false);
      r.play(timeOffset);
      setPlayerIsPlaying(true);
    }
  }, []);

  const updateSpeed = useCallback((speed: number) => {
    setPlayerSpeed(speed);
    const r = replayerRef.current;
    if (r) r.setConfig({ speed });
  }, []);

  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout title="Session Replays" fillWidth>
        <PanelGroup direction="horizontal" className="h-[calc(100vh-180px)] min-h-[520px] rounded-xl border border-border/40 overflow-hidden bg-background">
          <Panel defaultSize={25} minSize={16}>
            <div className="h-full flex flex-col">
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
                      const duration = formatDurationMs(r.lastEventAt.getTime() - r.startedAt.getTime());
                      return (
                        <button
                          key={r.id}
                          onClick={() => setSelectedRecordingId(r.id)}
                          className={cn(
                            "w-full text-left rounded-lg px-3 py-2",
                            "transition-colors hover:transition-none",
                            isSelected ? "bg-muted/50" : "hover:bg-muted/20",
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

              {selectedRecording ? (
                <div className="flex-1 overflow-hidden flex flex-col">
                  <div className="flex-1 relative overflow-hidden">
                    <div ref={playerContainerRef} className="absolute inset-0 bg-background" />

                    {/* Paused overlay with play button */}
                    {playerEvents && !playerIsPlaying && !isBuffering && (
                      <div
                        className="absolute inset-0 z-10 grid place-items-center cursor-pointer transition-opacity"
                        onClick={togglePlayPause}
                      >
                        <div className="rounded-full bg-black/50 p-4 backdrop-blur-sm">
                          <PlayIcon className="h-10 w-10 text-white" weight="fill" />
                        </div>
                      </div>
                    )}

                    {/* Skipping inactivity indicator */}
                    {playerEvents && isSkipping && (
                      <div className="absolute inset-x-0 top-4 z-10 flex justify-center pointer-events-none">
                        <div className="flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-sm">
                          <FastForwardIcon className="h-3.5 w-3.5 text-white" weight="fill" />
                          <span className="text-xs text-white">Skipping inactivity</span>
                        </div>
                      </div>
                    )}

                    {/* Buffering overlay — waiting for events to load */}
                    {playerEvents && isBuffering && (
                      <div className="absolute inset-0 z-10 grid place-items-center cursor-pointer" onClick={togglePlayPause}>
                        <div className="flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 backdrop-blur-sm">
                          <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                          <span className="text-sm text-white">Buffering...</span>
                        </div>
                      </div>
                    )}

                    {/* Loading / no events overlay */}
                    {!playerEvents && (
                      <div className="absolute inset-0 grid place-items-center bg-background/80 backdrop-blur-sm">
                        <div className="text-center space-y-2 p-6">
                          {isDownloading ? (
                            <>
                              <Skeleton className="h-2 w-48 mx-auto" />
                              <Typography className="text-sm text-muted-foreground">
                                Loading replay data...
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
                  </div>

                  {playerEvents && (
                    <Timeline
                      replayerRef={replayerRef}
                      playerIsPlaying={playerIsPlaying}
                      totalTimeMs={playerTotalTimeMs}
                      onTogglePlayPause={togglePlayPause}
                      onSeek={handleSeek}
                      playerSpeed={playerSpeed}
                      onSpeedChange={updateSpeed}
                    />
                  )}
                </div>
              ) : (
                <div className="flex-1 grid place-items-center">
                  <Typography className="text-sm text-muted-foreground">
                    Select a replay to start.
                  </Typography>
                </div>
              )}
            </div>
          </Panel>
        </PanelGroup>
      </PageLayout>
    </AppEnabledGuard>
  );
}
