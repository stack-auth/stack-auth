import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  CheckIcon,
  CopyIcon,
  CornersInIcon,
  CornersOutIcon,
  CursorClickIcon,
  FastForwardIcon,
  KeyboardIcon,
  MagnifyingGlassIcon,
  MonitorPlayIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon,
  SkipBackIcon,
  SkipForwardIcon,
  XIcon,
} from "@phosphor-icons/react"
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises"
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings"

import type {ChunkRange, ReplayAction, ReplayEffect, ReplaySettings, ReplayState, StreamInfo} from "@/lib/session-replay/machine";
import type {TabKey, TabStream} from "@/lib/session-replay/streams";
import type {EventCategory} from "@/lib/session-replay/event-labels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { cn } from "@/lib/utils"
import { useAdminApp } from "@/lib/stack/admin-app"
import {
  ALLOWED_PLAYER_SPEEDS,
  
  
  
  
  
  
  createInitialState,
  replayReducer
} from "@/lib/session-replay/machine"
import {
  
  
  computeGlobalTimeline,
  globalOffsetToLocalOffset,
  groupChunksIntoTabStreams
} from "@/lib/session-replay/streams"
import {
  INTER_TAB_GAP_FAST_FORWARD_MULTIPLIER,
  getDesiredGlobalOffsetFromPlaybackState,
} from "@/lib/session-replay/playback"
import {
  EVENT_CATEGORIES,
  
  categorizeEvent,
  describeEvent,
  getConsoleSeverity,
  getMetaUrl,
  isClickEvent,
  isConsolePluginEvent,
  isPageNavigation,
  readEventData,
  readEventTimestamp,
  readEventType
} from "@/lib/session-replay/event-labels"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ProjectUserDrawerLink } from "@/components/console/project-entity-drawer-link"

type RrwebEventWithTime = import("rrweb/typings/types").eventWithTime
type RrwebReplayer = InstanceType<typeof import("rrweb").Replayer>

const INITIAL_CHUNK_BATCH = 20
const BACKGROUND_CHUNK_BATCH = 50
const EXTRA_TABS_TO_SHOW = 2
const REPLAY_SETTINGS_STORAGE_KEY = "stack.session-replay.settings"
const LEGACY_PLAYER_SPEED_STORAGE_KEY = "stack.session-replay.speed"
const EVENT_FILTERS_STORAGE_KEY = "stack.session-replay.event-filters"
const DEFAULT_INSPECTOR_WIDTH_PX = 360

type TimelineMarker = {
  timeMs: number,
  kind: "click" | "page",
  label: string,
}

type SessionReplayMeta = {
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
}

function coerceRrwebEvents(raw: Array<unknown>): Array<RrwebEventWithTime> {
  const filtered: Array<{ timestamp: number }> = []
  for (const e of raw) {
    if (typeof e !== "object" || e === null) continue
    if (!("timestamp" in e)) continue
    const ts = (e as { timestamp?: unknown }).timestamp
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue
    filtered.push(e as { timestamp: number })
  }
  return filtered as unknown as Array<RrwebEventWithTime>
}

function formatTimelineMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00"
  const totalSeconds = Math.floor(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return `${h}:${(m % 60).toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`
  }
  return `${m}:${s.toString().padStart(2, "0")}`
}

function formatRelativeMs(ms: number): string {
  if (!Number.isFinite(ms)) return "+0:00.000"
  const sign = ms < 0 ? "-" : "+"
  const abs = Math.abs(ms)
  const totalSeconds = Math.floor(abs / 1000)
  const millis = Math.floor(abs - totalSeconds * 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${sign}${m}:${s.toString().padStart(2, "0")}.${millis
    .toString()
    .padStart(3, "0")}`
}

function formatLongDate(date: Date | null | undefined): string {
  if (!date) return "—"
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—"
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function parseReplaySettings(raw: string): ReplaySettings | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const value = parsed as Record<string, unknown>
  const playerSpeedRaw = value.playerSpeed
  const playerSpeed =
    typeof playerSpeedRaw === "number" && ALLOWED_PLAYER_SPEEDS.has(playerSpeedRaw)
      ? playerSpeedRaw
      : 1
  const skipInactivity =
    typeof value.skipInactivity === "boolean" ? value.skipInactivity : true
  const followActiveTab =
    typeof value.followActiveTab === "boolean" ? value.followActiveTab : false
  return { playerSpeed, skipInactivity, followActiveTab }
}

function getInitialReplaySettings(): ReplaySettings {
  if (typeof window === "undefined") {
    return { playerSpeed: 1, skipInactivity: true, followActiveTab: false }
  }
  try {
    const rawSettings = localStorage.getItem(REPLAY_SETTINGS_STORAGE_KEY)
    if (rawSettings) {
      const parsed = parseReplaySettings(rawSettings)
      if (parsed) return parsed
    }
    const rawLegacySpeed = localStorage.getItem(LEGACY_PLAYER_SPEED_STORAGE_KEY)
    if (rawLegacySpeed) {
      const legacySpeed = Number(rawLegacySpeed)
      if (Number.isFinite(legacySpeed) && ALLOWED_PLAYER_SPEEDS.has(legacySpeed)) {
        return {
          playerSpeed: legacySpeed,
          skipInactivity: true,
          followActiveTab: false,
        }
      }
    }
  } catch {
    // ignore
  }
  return { playerSpeed: 1, skipInactivity: true, followActiveTab: false }
}

function loadCategoryFilters(): Set<EventCategory> {
  if (typeof window === "undefined") return new Set(EVENT_CATEGORIES)
  try {
    const raw = localStorage.getItem(EVENT_FILTERS_STORAGE_KEY)
    if (!raw) return new Set(EVENT_CATEGORIES)
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return new Set(EVENT_CATEGORIES)
    return new Set(
      arr.filter((c): c is EventCategory =>
        EVENT_CATEGORIES.includes(c as EventCategory)
      )
    )
  } catch {
    return new Set(EVENT_CATEGORIES)
  }
}

function saveCategoryFilters(set: Set<EventCategory>) {
  try {
    localStorage.setItem(
      EVENT_FILTERS_STORAGE_KEY,
      JSON.stringify(Array.from(set))
    )
  } catch {
    // ignore
  }
}

function useReplayMachine(initialSettings: ReplaySettings) {
  const stateRef = useRef<ReplayState>(createInitialState(initialSettings))
  const [, forceRender] = useState(0)
  const dispatch = useCallback((action: ReplayAction): Array<ReplayEffect> => {
    const { state, effects } = replayReducer(stateRef.current, action)
    stateRef.current = state
    forceRender((v) => v + 1)
    return effects
  }, [])
  return { state: stateRef.current, stateRef, dispatch }
}

type ReplayPlayerProps = {
  projectId: string,
  sessionId: string,
}

export function ReplayPlayer({ projectId, sessionId }: ReplayPlayerProps) {
  const adminApp = useAdminApp()
  const playerWrapperRef = useRef<HTMLDivElement | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)

  const metaQuery = useQuery({
    queryKey: ["session-replay-meta", adminApp.projectId, sessionId] as const,
    queryFn: () => adminApp.getSessionReplay(sessionId),
    gcTime: 5 * 60 * 1000,
  })

  const { state: ms, stateRef: msRef, dispatch: rawDispatch } = useReplayMachine(
    getInitialReplaySettings()
  )

  const eventsByTabRef = useRef<Map<TabKey, Array<RrwebEventWithTime>>>(new Map())
  const containerByTabRef = useRef<Map<TabKey, HTMLDivElement | null>>(new Map())
  const replayerByTabRef = useRef<Map<TabKey, RrwebReplayer>>(new Map())
  const replayerRootByTabRef = useRef<Map<TabKey, HTMLDivElement>>(new Map())
  const resizeObserverByTabRef = useRef<Map<TabKey, ResizeObserver>>(new Map())
  const pendingInitByTabRef = useRef<Set<TabKey>>(new Set())
  const speedSubRef = useRef<{ unsubscribe: () => void } | null>(null)

  const [fullStreams, setFullStreams] = useState<Array<TabStream<ChunkRow>>>([])
  const fullStreamsRef = useRef<Array<TabStream<ChunkRow>>>([])
  const genCounterRef = useRef(0)
  const [isSkipping, setIsSkipping] = useState(false)
  const [uiVersion, setUiVersion] = useState(0)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const playerIsPlaying =
    ms.playbackMode === "playing" || ms.playbackMode === "gap_fast_forward"
  const isBuffering = ms.playbackMode === "buffering"
  const replayFinished = ms.playbackMode === "finished"
  const isDownloading = ms.phase === "downloading"

  const destroyReplayers = useCallback(() => {
    for (const obs of resizeObserverByTabRef.current.values()) {
      obs.disconnect()
    }
    resizeObserverByTabRef.current.clear()
    speedSubRef.current?.unsubscribe()
    speedSubRef.current = null
    for (const r of replayerByTabRef.current.values()) {
      try {
        r.pause()
      } catch {
        // ignore
      }
    }
    replayerByTabRef.current.clear()
    replayerRootByTabRef.current.clear()
    for (const root of containerByTabRef.current.values()) {
      if (root) root.innerHTML = ""
    }
  }, [])

  const actRef = useRef<(action: ReplayAction) => void>(() => {})

  const ensureReplayerForTab = useCallback(
    async (tabKey: TabKey, gen: number) => {
      if (msRef.current.generation !== gen) return
      if (replayerByTabRef.current.has(tabKey)) return

      const rootMaybe = containerByTabRef.current.get(tabKey) ?? null
      if (!rootMaybe) {
        pendingInitByTabRef.current.add(tabKey)
        return
      }
      const rootEl = rootMaybe

      const eventsSnapshot =
        eventsByTabRef.current.get(tabKey)?.slice() ?? []
      if (eventsSnapshot.length === 0) {
        pendingInitByTabRef.current.add(tabKey)
        return
      }

      if (!msRef.current.hasFullSnapshotByTab.has(tabKey)) {
        const hasSnapshot = eventsSnapshot.some(
          (e) => (e as { type?: number }).type === 2
        )
        if (!hasSnapshot) return
        actRef.current({
          type: "CHUNK_LOADED",
          generation: gen,
          tabKey,
          hasFullSnapshot: true,
          loadedDurationMs:
            eventsSnapshot.length >= 2
              ? eventsSnapshot[eventsSnapshot.length - 1].timestamp -
                eventsSnapshot[0].timestamp
              : 0,
          hadEventsBeforeThisChunk: true,
        })
      }

      try {
        const { Replayer } = await import("rrweb")
        if (msRef.current.generation !== gen) return
        if (replayerByTabRef.current.has(tabKey)) return

        const eventsSnapshot2 =
          eventsByTabRef.current.get(tabKey)?.slice() ?? []
        if (eventsSnapshot2.length === 0) return

        const replayer = new Replayer(eventsSnapshot2, {
          root: rootEl,
          speed: msRef.current.settings.playerSpeed,
          skipInactive: msRef.current.settings.skipInactivity,
          triggerFocus: false,
        })

        rootEl.style.position = "relative"
        rootEl.style.width = "100%"
        rootEl.style.height = "100%"
        rootEl.style.overflow = "hidden"

        replayer.wrapper.style.margin = "0"
        replayer.wrapper.style.position = "absolute"
        replayer.wrapper.style.transformOrigin = "top left"

        replayer.iframe.style.border = "0"
        replayer.iframe.style.background = "white"

        const mouseEl = replayer.wrapper.querySelector<HTMLElement>(
          ".replayer-mouse"
        )
        if (mouseEl) {
          mouseEl.style.position = "absolute"
          mouseEl.style.width = "14px"
          mouseEl.style.height = "14px"
          mouseEl.style.borderRadius = "9999px"
          mouseEl.style.background = "rgba(255, 255, 255, 0.9)"
          mouseEl.style.border = "2px solid rgba(0, 0, 0, 0.55)"
          mouseEl.style.boxShadow = "0 2px 10px rgba(0,0,0,0.25)"
          mouseEl.style.transform = "translate(-50%, -50%)"
          mouseEl.style.pointerEvents = "none"
          mouseEl.style.zIndex = "2"
        }

        const mouseTailEl = replayer.wrapper.querySelector<HTMLCanvasElement>(
          ".replayer-mouse-tail"
        )
        if (mouseTailEl) {
          mouseTailEl.style.position = "absolute"
          mouseTailEl.style.inset = "0"
          mouseTailEl.style.pointerEvents = "none"
          mouseTailEl.style.zIndex = "1"
        }

        function updateScale() {
          const cw = rootEl.clientWidth
          const ch = rootEl.clientHeight
          const replayW = replayer.wrapper.offsetWidth
          const replayH = replayer.wrapper.offsetHeight
          if (replayW <= 0 || replayH <= 0 || cw <= 0 || ch <= 0) return
          const isActive = msRef.current.activeTabKey === tabKey
          const scale = isActive
            ? Math.min(cw / replayW, ch / replayH)
            : cw / replayW
          const scaledW = replayW * scale
          const scaledH = replayH * scale
          replayer.wrapper.style.left = isActive
            ? `${(cw - scaledW) / 2}px`
            : "0px"
          replayer.wrapper.style.top = isActive
            ? `${(ch - scaledH) / 2}px`
            : "0px"
          replayer.wrapper.style.transform = `scale(${scale})`
        }

        updateScale()
        let scaleRaf = 0
        const observer = new ResizeObserver(() => {
          cancelAnimationFrame(scaleRaf)
          scaleRaf = requestAnimationFrame(updateScale)
        })
        observer.observe(rootEl)
        observer.observe(replayer.wrapper)
        resizeObserverByTabRef.current.set(tabKey, observer)

        replayerRootByTabRef.current.set(tabKey, rootEl)
        pendingInitByTabRef.current.delete(tabKey)
        replayerByTabRef.current.set(tabKey, replayer)

        try {
          replayer.on("finish", () => {
            if (msRef.current.generation !== gen) return
            if (msRef.current.activeTabKey !== tabKey) return
            let localTime = 0
            try {
              localTime = replayer.getCurrentTime()
            } catch {
              // ignore
            }
            actRef.current({
              type: "REPLAYER_FINISH",
              generation: gen,
              tabKey,
              localTimeMs: localTime,
              nowMs: performance.now(),
            })
          })
        } catch {
          // ignore
        }

        actRef.current({ type: "REPLAYER_READY", generation: gen, tabKey })
        setUiVersion((v) => v + 1)
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to initialize rrweb player."
        actRef.current({ type: "REPLAYER_INIT_ERROR", generation: gen, message: msg })
      }
    },
    [msRef]
  )

  const executeEffects = useCallback(
    (effects: Array<ReplayEffect>) => {
      for (const effect of effects) {
        switch (effect.type) {
          case "play_replayer": {
            const r = replayerByTabRef.current.get(effect.tabKey)
            if (r) {
              try {
                r.play(effect.localOffsetMs)
              } catch {
                // ignore
              }
            } else {
              runAsynchronously(
                () => ensureReplayerForTab(effect.tabKey, msRef.current.generation),
                { noErrorLogging: true }
              )
            }
            break
          }
          case "pause_replayer_at": {
            const r = replayerByTabRef.current.get(effect.tabKey)
            if (r) {
              try {
                r.pause(effect.localOffsetMs)
              } catch {
                // ignore
              }
            }
            break
          }
          case "pause_all": {
            for (const r of replayerByTabRef.current.values()) {
              try {
                r.pause()
              } catch {
                // ignore
              }
            }
            break
          }
          case "ensure_replayer": {
            runAsynchronously(
              () => ensureReplayerForTab(effect.tabKey, effect.generation),
              { noErrorLogging: true }
            )
            break
          }
          case "destroy_all_replayers": {
            destroyReplayers()
            eventsByTabRef.current = new Map()
            pendingInitByTabRef.current = new Set()
            setUiVersion((v) => v + 1)
            break
          }
          case "set_replayer_speed": {
            for (const r of replayerByTabRef.current.values()) {
              try {
                r.setConfig({ speed: effect.speed })
              } catch {
                // ignore
              }
            }
            break
          }
          case "set_replayer_skip_inactive": {
            for (const r of replayerByTabRef.current.values()) {
              try {
                r.setConfig({ skipInactive: effect.skipInactive })
              } catch {
                // ignore
              }
            }
            if (!effect.skipInactive) setIsSkipping(false)
            break
          }
          case "sync_mini_tabs": {
            const activeKey = msRef.current.activeTabKey
            for (const [tabKey, r] of replayerByTabRef.current.entries()) {
              if (tabKey === activeKey) continue
              const stream = msRef.current.streams.find((s) => s.tabKey === tabKey)
              if (!stream) continue
              const localOffset = globalOffsetToLocalOffset(
                msRef.current.globalStartTs,
                stream.firstEventAtMs,
                effect.globalOffsetMs
              )
              try {
                r.pause(localOffset)
              } catch {
                // ignore
              }
            }
            break
          }
          case "schedule_buffer_poll": {
            const { generation, tabKey, delayMs } = effect
            setTimeout(() => {
              actRef.current({ type: "BUFFER_CHECK", generation, tabKey })
            }, delayMs)
            break
          }
          case "recreate_replayer": {
            const tabKey = effect.tabKey
            const r = replayerByTabRef.current.get(tabKey)
            if (r) {
              try {
                r.pause()
              } catch {
                // ignore
              }
            }
            replayerByTabRef.current.delete(tabKey)
            replayerRootByTabRef.current.delete(tabKey)
            const obs = resizeObserverByTabRef.current.get(tabKey)
            if (obs) {
              obs.disconnect()
              resizeObserverByTabRef.current.delete(tabKey)
            }
            pendingInitByTabRef.current.add(tabKey)
            runAsynchronously(
              () => ensureReplayerForTab(tabKey, effect.generation),
              { noErrorLogging: true }
            )
            break
          }
          case "save_settings": {
            try {
              localStorage.setItem(
                REPLAY_SETTINGS_STORAGE_KEY,
                JSON.stringify(effect.settings)
              )
            } catch {
              // ignore
            }
            break
          }
        }
      }
    },
    [destroyReplayers, ensureReplayerForTab, msRef]
  )

  actRef.current = (action: ReplayAction) => {
    const effects = rawDispatch(action)
    executeEffects(effects)
  }

  const setContainerRefForTab = useCallback(
    (tabKey: TabKey, el: HTMLDivElement | null) => {
      containerByTabRef.current.set(tabKey, el)
      if (!el) return
      const existingRoot = replayerRootByTabRef.current.get(tabKey)
      if (existingRoot && existingRoot !== el) {
        const r = replayerByTabRef.current.get(tabKey)
        if (r) {
          try {
            r.pause()
          } catch {
            // ignore
          }
          replayerByTabRef.current.delete(tabKey)
          replayerRootByTabRef.current.delete(tabKey)
        }
        const obs = resizeObserverByTabRef.current.get(tabKey)
        if (obs) {
          obs.disconnect()
          resizeObserverByTabRef.current.delete(tabKey)
        }
        pendingInitByTabRef.current.add(tabKey)
      }
      if (!pendingInitByTabRef.current.has(tabKey)) return
      if ((eventsByTabRef.current.get(tabKey)?.length ?? 0) === 0) return
      runAsynchronously(
        () => ensureReplayerForTab(tabKey, msRef.current.generation),
        { noErrorLogging: true }
      )
    },
    [ensureReplayerForTab, msRef]
  )

  const loadChunksAndDownload = useCallback(
    async (recordingId: string) => {
      const gen = ++genCounterRef.current
      actRef.current({ type: "SELECT_RECORDING", generation: gen })
      setFullStreams([])
      fullStreamsRef.current = []
      setDownloadError(null)

      function processChunkEvents(
        chunkEvents: Array<{ chunkId: string, events: Array<unknown> }>,
        chunkIdToTabKey: Map<string, TabKey>
      ) {
        for (const ce of chunkEvents) {
          if (msRef.current.generation !== gen) return
          const tabKey = chunkIdToTabKey.get(ce.chunkId)
          if (!tabKey) continue
          const events = coerceRrwebEvents(ce.events)
          const prev = eventsByTabRef.current.get(tabKey) ?? []
          const wasEmpty = prev.length === 0
          prev.push(...events)
          eventsByTabRef.current.set(tabKey, prev)

          const hasFullSnapshot =
            !msRef.current.hasFullSnapshotByTab.has(tabKey) &&
            events.some((e) => Number((e as { type?: number }).type) === 2)

          let loadedDurationMs = 0
          if (prev.length >= 2) {
            loadedDurationMs =
              prev[prev.length - 1].timestamp - prev[0].timestamp
          }

          if (!wasEmpty) {
            const r = replayerByTabRef.current.get(tabKey)
            if (r) {
              for (const event of events) {
                r.addEvent(event)
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
          })

          if (hasFullSnapshot || wasEmpty) {
            setUiVersion((v) => v + 1)
          }
        }
      }

      try {
        const initialResponse = await adminApp.getSessionReplayEvents(recordingId, {
          offset: 0,
          limit: INITIAL_CHUNK_BATCH,
        })
        if (msRef.current.generation !== gen) return

        const allChunkRows: Array<ChunkRow> = initialResponse.chunks.map((c) => ({
          id: c.id,
          batchId: c.batchId,
          sessionReplaySegmentId: c.sessionReplaySegmentId,
          eventCount: c.eventCount,
          byteLength: c.byteLength,
          firstEventAt: c.firstEventAt,
          lastEventAt: c.lastEventAt,
          createdAt: c.createdAt,
        }))

        const allStreams = groupChunksIntoTabStreams(allChunkRows)
        setFullStreams(allStreams)
        fullStreamsRef.current = allStreams

        const { globalStartTs, globalTotalMs } = computeGlobalTimeline(allStreams)

        const rangesByTab = new Map<TabKey, Array<ChunkRange>>()
        for (const s of allStreams) {
          const ranges = s.chunks
            .map((c) => ({
              startTs: c.firstEventAt.getTime(),
              endTs: c.lastEventAt.getTime(),
            }))
            .filter(
              (r) =>
                Number.isFinite(r.startTs) &&
                Number.isFinite(r.endTs) &&
                r.endTs >= r.startTs
            )
            .sort((a, b) => a.startTs - b.startTs)
          const merged: Array<ChunkRange> = []
          for (const r of ranges) {
            const last = merged[merged.length - 1] as ChunkRange | undefined
            if (!last) {
              merged.push({ ...r })
              continue
            }
            if (r.startTs <= last.endTs) {
              last.endTs = Math.max(last.endTs, r.endTs)
            } else {
              merged.push({ ...r })
            }
          }
          rangesByTab.set(s.tabKey, merged)
        }

        const labelOrder = allStreams.slice().sort((a, b) => {
          const first = a.firstEventAt.getTime() - b.firstEventAt.getTime()
          if (first !== 0) return first
          return stringCompare(a.tabKey, b.tabKey)
        })
        const tabLabelIndex = new Map(
          labelOrder.map((s, i) => [s.tabKey, i + 1])
        )

        const streamInfos: Array<StreamInfo> = allStreams.map((s) => ({
          tabKey: s.tabKey,
          firstEventAtMs: s.firstEventAt.getTime(),
          lastEventAtMs: s.lastEventAt.getTime(),
        }))

        actRef.current({
          type: "STREAMS_COMPUTED",
          generation: gen,
          streams: streamInfos,
          globalStartTs,
          globalTotalMs,
          chunkRangesByTab: rangesByTab,
          tabLabelIndex,
        })

        const chunkIdToTabKey = new Map<string, TabKey>()
        for (const s of allStreams) {
          for (const chunk of s.chunks) {
            chunkIdToTabKey.set(chunk.id, s.tabKey)
          }
        }

        processChunkEvents(initialResponse.chunkEvents, chunkIdToTabKey)

        const totalChunks = allChunkRows.length
        let offset = INITIAL_CHUNK_BATCH

        while (offset < totalChunks) {
          if (msRef.current.generation !== gen) return
          const batchResponse = await adminApp.getSessionReplayEvents(recordingId, {
            offset,
            limit: BACKGROUND_CHUNK_BATCH,
          })
          if (msRef.current.generation !== gen) return
          processChunkEvents(batchResponse.chunkEvents, chunkIdToTabKey)
          offset += BACKGROUND_CHUNK_BATCH
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load replay data."
        if (msRef.current.generation === gen) {
          actRef.current({ type: "DOWNLOAD_ERROR", generation: gen, message: msg })
          setDownloadError(msg)
        }
        return
      }

      if (msRef.current.generation === gen) {
        actRef.current({ type: "DOWNLOAD_COMPLETE", generation: gen })
      }
    },
    [adminApp, msRef]
  )

  useEffect(() => {
    runAsynchronously(() => loadChunksAndDownload(sessionId), {
      noErrorLogging: true,
    })
  }, [sessionId, loadChunksAndDownload])

  useEffect(() => {
    return () => {
      genCounterRef.current += 1
      destroyReplayers()
    }
  }, [destroyReplayers])

  const getCurrentGlobalTimeMs = useCallback(() => {
    const s = msRef.current
    const key = s.activeTabKey
    const r = key ? replayerByTabRef.current.get(key) ?? null : null
    const stream = key
      ? s.streams.find((st) => st.tabKey === key) ?? null
      : null
    let activeLocalOffsetMs: number | null = null
    if (r) {
      try {
        activeLocalOffsetMs = r.getCurrentTime()
      } catch {
        activeLocalOffsetMs = null
      }
    }
    return getDesiredGlobalOffsetFromPlaybackState({
      gapFastForward: s.gapFastForward,
      playerIsPlaying:
        s.playbackMode === "playing" || s.playbackMode === "gap_fast_forward",
      nowMs: performance.now(),
      playerSpeed: s.settings.playerSpeed,
      pausedAtGlobalMs: s.pausedAtGlobalMs,
      activeLocalOffsetMs,
      activeStreamStartTs: stream?.firstEventAtMs ?? null,
      globalStartTs: s.globalStartTs,
      gapFastForwardMultiplier: INTER_TAB_GAP_FAST_FORWARD_MULTIPLIER,
    })
  }, [msRef])

  useEffect(() => {
    let cancelled = false
    let raf = 0
    let lastUpdateAt = 0
    const tick = (now: number) => {
      if (cancelled) return
      if (now - lastUpdateAt > 200) {
        lastUpdateAt = now
        const key = msRef.current.activeTabKey
        const r = key ? replayerByTabRef.current.get(key) ?? null : null
        let activeLocalTimeMs: number | null = null
        if (r) {
          try {
            activeLocalTimeMs = r.getCurrentTime()
          } catch {
            activeLocalTimeMs = null
          }
        }
        actRef.current({
          type: "TICK",
          nowMs: performance.now(),
          activeReplayerLocalTimeMs: activeLocalTimeMs,
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [msRef])

  useEffect(() => {
    if (!ms.settings.skipInactivity) {
      setIsSkipping(false)
      speedSubRef.current?.unsubscribe()
      speedSubRef.current = null
      return
    }
    const key = ms.activeTabKey
    const r = key ? replayerByTabRef.current.get(key) ?? null : null
    setIsSkipping(false)
    speedSubRef.current?.unsubscribe()
    speedSubRef.current = null
    if (!r) return
    try {
      const sub = (
        r as unknown as { speedService: { subscribe: (cb: (s: { value: string }) => void) => { unsubscribe: () => void } } }
      ).speedService.subscribe((state) => {
        setIsSkipping(state.value === "skipping")
      })
      speedSubRef.current = sub
    } catch {
      // ignore
    }
  }, [ms.activeTabKey, ms.settings.skipInactivity, uiVersion])

  const togglePlayPause = useCallback(() => {
    actRef.current({ type: "TOGGLE_PLAY_PAUSE", nowMs: performance.now() })
  }, [])

  const handleSeek = useCallback((globalOffset: number) => {
    actRef.current({
      type: "SEEK",
      globalOffsetMs: globalOffset,
      nowMs: performance.now(),
    })
  }, [])

  const updateSpeed = useCallback((speed: number) => {
    actRef.current({ type: "UPDATE_SPEED", speed })
  }, [])

  const updateSettings = useCallback(
    (updates: Partial<ReplaySettings>) => {
      actRef.current({ type: "UPDATE_SETTINGS", updates })
    },
    []
  )

  const onSelectActiveTab = useCallback((tabKey: TabKey) => {
    actRef.current({ type: "SELECT_TAB", tabKey, nowMs: performance.now() })
  }, [])

  const visibleMiniStreams = useMemo(() => {
    void uiVersion
    const currentTs = ms.globalStartTs + ms.currentGlobalTimeMsForUi
    const candidates = fullStreams.filter(
      (s) =>
        s.tabKey !== ms.activeTabKey && ms.hasFullSnapshotByTab.has(s.tabKey)
    )
    const inRange = candidates.filter(
      (s) =>
        currentTs >= s.firstEventAt.getTime() &&
        currentTs <= s.lastEventAt.getTime()
    )
    inRange.sort((a, b) => {
      const aLabel =
        ms.tabLabelIndex.get(a.tabKey) ?? Number.POSITIVE_INFINITY
      const bLabel =
        ms.tabLabelIndex.get(b.tabKey) ?? Number.POSITIVE_INFINITY
      if (aLabel !== bLabel) return aLabel - bLabel
      return stringCompare(a.tabKey, b.tabKey)
    })
    return inRange.slice(0, EXTRA_TABS_TO_SHOW)
  }, [
    ms.activeTabKey,
    ms.currentGlobalTimeMsForUi,
    ms.globalStartTs,
    ms.hasFullSnapshotByTab,
    ms.tabLabelIndex,
    fullStreams,
    uiVersion,
  ])

  const renderableStreams = useMemo(() => {
    void uiVersion
    return fullStreams.filter((s) => ms.hasFullSnapshotByTab.has(s.tabKey))
  }, [fullStreams, ms.hasFullSnapshotByTab, uiVersion])

  const activeEvents = useMemo(() => {
    void uiVersion
    if (!ms.activeTabKey) return [] as Array<RrwebEventWithTime>
    return eventsByTabRef.current.get(ms.activeTabKey) ?? []
  }, [ms.activeTabKey, uiVersion])

  const timelineMarkers = useMemo<Array<TimelineMarker>>(() => {
    if (ms.globalTotalMs <= 0) return []
    const result: Array<TimelineMarker> = []
    for (const ev of activeEvents) {
      const ts = readEventTimestamp(ev)
      if (ts == null) continue
      const offset = ts - ms.globalStartTs
      if (offset < 0 || offset > ms.globalTotalMs) continue
      if (isClickEvent(ev)) {
        result.push({ timeMs: offset, kind: "click", label: "Click" })
      } else if (isPageNavigation(ev)) {
        const url = getMetaUrl(ev)
        result.push({
          timeMs: offset,
          kind: "page",
          label: url ?? "Page navigation",
        })
      }
    }
    return result
  }, [activeEvents, ms.globalStartTs, ms.globalTotalMs])

  const chunkRangeOverlay = useMemo(() => {
    if (!ms.activeTabKey || ms.globalTotalMs <= 0) return [] as Array<{ left: number, width: number }>
    const ranges = ms.chunkRangesByTab.get(ms.activeTabKey) ?? []
    return ranges
      .map((r) => {
        const startOffset = r.startTs - ms.globalStartTs
        const endOffset = r.endTs - ms.globalStartTs
        const left = Math.max(0, startOffset / ms.globalTotalMs) * 100
        const width =
          Math.min(
            1,
            Math.max(0, (endOffset - startOffset) / ms.globalTotalMs)
          ) * 100
        return { left, width }
      })
      .filter((r) => r.width > 0)
  }, [ms.activeTabKey, ms.chunkRangesByTab, ms.globalStartTs, ms.globalTotalMs])

  const handleToggleFullscreen = useCallback(() => {
    const el = playerWrapperRef.current
    if (!el) return
    if (document.fullscreenElement) {
      runAsynchronously(() => document.exitFullscreen(), { noErrorLogging: true })
    } else {
      runAsynchronously(() => el.requestFullscreen(), { noErrorLogging: true })
    }
  }, [])

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof HTMLElement) {
        if (
          t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable
        ) {
          return
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === " ") {
        e.preventDefault()
        togglePlayPause()
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault()
        const delta = e.shiftKey ? 10000 : 5000
        const dir = e.key === "ArrowLeft" ? -1 : 1
        const target = Math.max(
          0,
          Math.min(
            msRef.current.globalTotalMs,
            getCurrentGlobalTimeMs() + dir * delta
          )
        )
        handleSeek(target)
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault()
        handleToggleFullscreen()
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault()
        updateSettings({ skipInactivity: !msRef.current.settings.skipInactivity })
      } else if (e.key === "?") {
        e.preventDefault()
        setShowShortcuts((v) => !v)
      } else if (["0", "1", "2", "3"].includes(e.key)) {
        const speeds = Array.from(ALLOWED_PLAYER_SPEEDS).sort((a, b) => a - b)
        const idx = Number(e.key)
        const speed = speeds[idx]
        if (typeof speed === "number") {
          e.preventDefault()
          updateSpeed(speed)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [
    togglePlayPause,
    handleSeek,
    handleToggleFullscreen,
    updateSettings,
    updateSpeed,
    getCurrentGlobalTimeMs,
    msRef,
  ])

  const meta: SessionReplayMeta | null = metaQuery.data ?? null
  const userLabel =
    meta?.projectUser.displayName ??
    meta?.projectUser.primaryEmail ??
    meta?.projectUser.id ??
    null

  return (
    <TooltipProvider>
      <div
        ref={playerWrapperRef}
        className={cn(
          "flex min-h-0 flex-1 flex-col bg-background",
          isFullscreen && "h-screen w-screen"
        )}
      >
        <ReplayHeader
          projectId={projectId}
          sessionId={sessionId}
          userLabel={userLabel}
          userId={meta?.projectUser.id ?? null}
          onShowShortcuts={() => setShowShortcuts(true)}
        />

        <div className="min-h-0 flex-1">
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            <ResizablePanel defaultSize={72} minSize={40}>
              <div className="flex h-full min-h-0 flex-col">
                <PlayerStage
                  isDownloading={isDownloading}
                  isBuffering={isBuffering}
                  replayFinished={replayFinished}
                  isSkipping={isSkipping}
                  downloadError={downloadError}
                  renderableStreams={renderableStreams}
                  visibleMiniStreams={visibleMiniStreams}
                  activeTabKey={ms.activeTabKey}
                  tabLabelIndex={ms.tabLabelIndex}
                  setContainerRefForTab={setContainerRefForTab}
                  onSelectTab={onSelectActiveTab}
                  onReplayAgain={() => handleSeek(0)}
                  hasAnySnapshot={ms.hasFullSnapshotByTab.size > 0}
                />
                <Seekbar
                  totalTimeMs={ms.globalTotalMs}
                  getCurrentTimeMs={getCurrentGlobalTimeMs}
                  markers={timelineMarkers}
                  chunkRangeOverlay={chunkRangeOverlay}
                  onSeek={handleSeek}
                />
                <Controls
                  isPlaying={playerIsPlaying}
                  totalTimeMs={ms.globalTotalMs}
                  getCurrentTimeMs={getCurrentGlobalTimeMs}
                  speed={ms.settings.playerSpeed}
                  skipInactivity={ms.settings.skipInactivity}
                  isFullscreen={isFullscreen}
                  onTogglePlayPause={togglePlayPause}
                  onSeek={handleSeek}
                  onChangeSpeed={updateSpeed}
                  onToggleSkipInactivity={() =>
                    updateSettings({
                      skipInactivity: !ms.settings.skipInactivity,
                    })
                  }
                  onToggleFullscreen={handleToggleFullscreen}
                  onShowShortcuts={() => setShowShortcuts(true)}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle className="w-px bg-border hover:bg-border" />
            <ResizablePanel
              defaultSize={28}
              minSize={20}
              style={{ minWidth: 280 }}
              className="bg-background"
            >
              <Inspector
                meta={meta}
                metaLoading={metaQuery.isLoading}
                metaError={
                  metaQuery.isError
                    ? metaQuery.error instanceof Error
                      ? metaQuery.error.message
                      : "Unknown error"
                    : null
                }
                streamCount={renderableStreams.length}
                events={activeEvents}
                globalStartTs={ms.globalStartTs}
                getCurrentTimeMs={getCurrentGlobalTimeMs}
                onSeek={handleSeek}
                inspectorWidthHint={DEFAULT_INSPECTOR_WIDTH_PX}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {showShortcuts ? (
          <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />
        ) : null}
      </div>
    </TooltipProvider>
  )
}

type ChunkRow = {
  id: string,
  batchId: string,
  sessionReplaySegmentId: string | null,
  eventCount: number,
  byteLength: number,
  firstEventAt: Date,
  lastEventAt: Date,
  createdAt: Date,
}

function ReplayHeader({
  projectId,
  sessionId,
  userLabel,
  userId,
  onShowShortcuts,
}: {
  projectId: string,
  sessionId: string,
  userLabel: string | null,
  userId: string | null,
  onShowShortcuts: () => void,
}) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(sessionId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-4">
      <Link
        to="/projects/$projectId/session-replays"
        params={{ projectId }}
        className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground hover:bg-muted"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back
      </Link>
      <div className="h-5 w-px bg-border" />
      <div className="flex min-w-0 items-center gap-2">
        <MonitorPlayIcon className="size-4 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground">
          {sessionId.slice(0, 8)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={copied ? "Copied" : "Copy session id"}
          onClick={onCopy}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
      {userLabel ? (
        <div className="ml-1 flex min-w-0 items-center gap-1.5">
          {userId ? (
            <ProjectUserDrawerLink
              userId={userId}
              className="truncate rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs hover:bg-muted"
            >
              {userLabel}
            </ProjectUserDrawerLink>
          ) : (
            <span className="truncate rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs">
              {userLabel}
            </span>
          )}
        </div>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Keyboard shortcuts"
                onClick={onShowShortcuts}
              >
                <KeyboardIcon />
              </Button>
            }
          />
          <TooltipContent>Shortcuts (?)</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

function PlayerStage({
  isDownloading,
  isBuffering,
  replayFinished,
  isSkipping,
  downloadError,
  renderableStreams,
  visibleMiniStreams,
  activeTabKey,
  tabLabelIndex,
  setContainerRefForTab,
  onSelectTab,
  onReplayAgain,
  hasAnySnapshot,
}: {
  isDownloading: boolean,
  isBuffering: boolean,
  replayFinished: boolean,
  isSkipping: boolean,
  downloadError: string | null,
  renderableStreams: Array<TabStream<ChunkRow>>,
  visibleMiniStreams: Array<TabStream<ChunkRow>>,
  activeTabKey: TabKey | null,
  tabLabelIndex: Map<TabKey, number>,
  setContainerRefForTab: (tabKey: TabKey, el: HTMLDivElement | null) => void,
  onSelectTab: (tabKey: TabKey) => void,
  onReplayAgain: () => void,
  hasAnySnapshot: boolean,
}) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-zinc-950 dark:bg-black">
      {renderableStreams.map((stream) => {
        const isActive = stream.tabKey === activeTabKey
        if (isActive) {
          return (
            <div
              key={stream.tabKey}
              ref={(el) => setContainerRefForTab(stream.tabKey, el)}
              className="absolute inset-0"
            />
          )
        }
        return null
      })}

      {visibleMiniStreams.length > 0 ? (
        <div className="pointer-events-auto absolute right-3 top-3 z-20 flex flex-col gap-2">
          {visibleMiniStreams.map((stream) => {
            const idx = tabLabelIndex.get(stream.tabKey) ?? 0
            return (
              <button
                key={stream.tabKey}
                type="button"
                onClick={() => onSelectTab(stream.tabKey)}
                className="group relative h-[100px] w-[160px] overflow-hidden rounded-md border border-white/10 bg-black/60 shadow-lg ring-0 transition-all hover:ring-2 hover:ring-white/40"
                aria-label={`Switch to tab ${idx}`}
              >
                <div
                  ref={(el) => setContainerRefForTab(stream.tabKey, el)}
                  className="absolute inset-0"
                />
                <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] text-white">
                  Tab {idx}
                </div>
              </button>
            )
          })}
        </div>
      ) : null}

      {isSkipping ? (
        <div className="pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-amber-500/90 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-black">
          <FastForwardIcon className="size-3" weight="fill" />
          Skipping inactivity
        </div>
      ) : null}

      {downloadError ? (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/50 px-6">
          <div className="max-w-md rounded-lg border border-red-500/40 bg-zinc-900/90 px-4 py-3 text-center text-sm text-red-200">
            {downloadError}
          </div>
        </div>
      ) : null}

      {isBuffering && !replayFinished ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/40">
          <div className="flex flex-col items-center gap-2 rounded-md bg-black/60 px-4 py-3 text-white">
            <Spinner className="size-6" />
            <span className="font-mono text-[10px] uppercase tracking-wider">
              Buffering
            </span>
          </div>
        </div>
      ) : null}

      {replayFinished ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/55">
          <div className="flex flex-col items-center gap-3 rounded-lg bg-zinc-900/80 px-6 py-5 text-white">
            <span className="text-base font-semibold">Replay finished</span>
            <Button onClick={onReplayAgain} size="sm" variant="secondary">
              <ArrowsClockwiseIcon />
              Replay again
            </Button>
          </div>
        </div>
      ) : null}

      {!hasAnySnapshot && !downloadError ? (
        <div className="absolute inset-0 z-10 grid place-items-center text-center">
          <div className="flex flex-col items-center gap-2 text-white/70">
            {isDownloading ? <Spinner className="size-7 text-white" /> : null}
            <span className="font-mono text-[10px] uppercase tracking-wider">
              {isDownloading ? "Loading replay" : "Waiting for first snapshot"}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Seekbar({
  totalTimeMs,
  getCurrentTimeMs,
  markers,
  chunkRangeOverlay,
  onSeek,
}: {
  totalTimeMs: number,
  getCurrentTimeMs: () => number,
  markers: Array<TimelineMarker>,
  chunkRangeOverlay: Array<{ left: number, width: number }>,
  onSeek: (ms: number) => void,
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const playheadRef = useRef<HTMLDivElement | null>(null)
  const [hover, setHover] = useState<{ x: number, marker: TimelineMarker | null } | null>(null)
  const draggingRef = useRef(false)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const t = getCurrentTimeMs()
      const head = playheadRef.current
      if (head && totalTimeMs > 0) {
        const pct = Math.min(1, Math.max(0, t / totalTimeMs))
        head.style.transform = `translateX(${pct * 100}cqw)`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getCurrentTimeMs, totalTimeMs])

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el || totalTimeMs <= 0) return
      const rect = el.getBoundingClientRect()
      const fraction = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width)
      )
      onSeek(fraction * totalTimeMs)
    },
    [onSeek, totalTimeMs]
  )

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    seekFromEvent(e.clientX)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) {
      seekFromEvent(e.clientX)
    }
    const el = trackRef.current
    if (!el || totalTimeMs <= 0) {
      setHover(null)
      return
    }
    const rect = el.getBoundingClientRect()
    const fraction = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width)
    )
    const t = fraction * totalTimeMs
    let nearest: TimelineMarker | null = null
    let nearestDist = Infinity
    const tolerance = totalTimeMs * 0.01
    for (const m of markers) {
      const d = Math.abs(m.timeMs - t)
      if (d < nearestDist && d <= tolerance) {
        nearest = m
        nearestDist = d
      }
    }
    setHover({ x: e.clientX - rect.left, marker: nearest })
  }
  const onPointerUp = () => {
    draggingRef.current = false
  }

  return (
    <div className="shrink-0 border-t bg-background px-4 pt-2 pb-1">
      <div
        ref={trackRef}
        className="relative h-6 cursor-pointer touch-none [container-type:inline-size]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setHover(null)
          draggingRef.current = false
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        {chunkRangeOverlay.map((r, i) => (
          <div
            key={i}
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted-foreground/25"
            style={{ left: `${r.left}%`, width: `${r.width}%` }}
          />
        ))}
        {markers.map((m, i) => {
          const left = totalTimeMs > 0 ? (m.timeMs / totalTimeMs) * 100 : 0
          return (
            <div
              key={i}
              className={cn(
                "absolute top-1/2 h-2 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-sm",
                m.kind === "click"
                  ? "bg-blue-500"
                  : "bg-emerald-500"
              )}
              style={{ left: `${left}%` }}
            />
          )
        })}
        <div
          ref={playheadRef}
          className="pointer-events-none absolute top-1/2 left-0 h-3 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
        />
        {hover ? (
          <div
            className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 rounded-md bg-foreground px-2 py-0.5 text-[10px] text-background"
            style={{ left: hover.x }}
          >
            {hover.marker ? (
              <span className="flex items-center gap-1.5">
                <span className="font-mono">
                  {formatTimelineMs(hover.marker.timeMs)}
                </span>
                <span className="opacity-80">{hover.marker.label}</span>
              </span>
            ) : (
              <span className="font-mono">
                {formatTimelineMs(
                  totalTimeMs > 0 && trackRef.current
                    ? (hover.x / trackRef.current.getBoundingClientRect().width) *
                        totalTimeMs
                    : 0
                )}
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Controls({
  isPlaying,
  totalTimeMs,
  getCurrentTimeMs,
  speed,
  skipInactivity,
  isFullscreen,
  onTogglePlayPause,
  onSeek,
  onChangeSpeed,
  onToggleSkipInactivity,
  onToggleFullscreen,
  onShowShortcuts,
}: {
  isPlaying: boolean,
  totalTimeMs: number,
  getCurrentTimeMs: () => number,
  speed: number,
  skipInactivity: boolean,
  isFullscreen: boolean,
  onTogglePlayPause: () => void,
  onSeek: (ms: number) => void,
  onChangeSpeed: (s: number) => void,
  onToggleSkipInactivity: () => void,
  onToggleFullscreen: () => void,
  onShowShortcuts: () => void,
}) {
  const [tickTime, setTickTime] = useState(0)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      setTickTime(getCurrentTimeMs())
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [getCurrentTimeMs])

  const speeds = useMemo(
    () => Array.from(ALLOWED_PLAYER_SPEEDS).sort((a, b) => a - b),
    []
  )

  const skipBy = (delta: number) => {
    const next = Math.max(0, Math.min(totalTimeMs, getCurrentTimeMs() + delta))
    onSeek(next)
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-t bg-background px-3">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => skipBy(-10000)}
              aria-label="Skip back 10 seconds"
            >
              <SkipBackIcon />
            </Button>
          }
        />
        <TooltipContent>Back 10s</TooltipContent>
      </Tooltip>
      <Button
        type="button"
        size="icon-sm"
        variant="default"
        onClick={onTogglePlayPause}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <PauseIcon weight="fill" /> : <PlayIcon weight="fill" />}
      </Button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => skipBy(10000)}
              aria-label="Skip forward 10 seconds"
            >
              <SkipForwardIcon />
            </Button>
          }
        />
        <TooltipContent>Forward 10s</TooltipContent>
      </Tooltip>

      <div className="ml-1 font-mono text-xs tabular-nums text-muted-foreground">
        <span className="text-foreground">{formatTimelineMs(tickTime)}</span>
        <span className="px-1">/</span>
        <span>{formatTimelineMs(totalTimeMs)}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="outline" size="sm" className="font-mono">
                {speed}×
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-[120px]">
            {speeds.map((s) => (
              <DropdownMenuItem
                key={s}
                onClick={() => onChangeSpeed(s)}
                className={cn(
                  "font-mono",
                  s === speed && "bg-muted"
                )}
              >
                {s}×
                {s === speed ? <CheckIcon className="ml-auto" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <label className="flex select-none items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            checked={skipInactivity}
            onCheckedChange={onToggleSkipInactivity}
            aria-label="Skip inactivity"
          />
          <span>Skip inactivity</span>
        </label>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onShowShortcuts}
                aria-label="Shortcuts"
              >
                <KeyboardIcon />
              </Button>
            }
          />
          <TooltipContent>Shortcuts (?)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onToggleFullscreen}
                aria-label="Toggle fullscreen"
              >
                {isFullscreen ? <CornersInIcon /> : <CornersOutIcon />}
              </Button>
            }
          />
          <TooltipContent>Fullscreen (f)</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

function Inspector({
  meta,
  metaLoading,
  metaError,
  streamCount,
  events,
  globalStartTs,
  getCurrentTimeMs,
  onSeek,
}: {
  meta: SessionReplayMeta | null,
  metaLoading: boolean,
  metaError: string | null,
  streamCount: number,
  events: Array<RrwebEventWithTime>,
  globalStartTs: number,
  getCurrentTimeMs: () => number,
  onSeek: (ms: number) => void,
  inspectorWidthHint: number,
}) {
  const [tab, setTab] = useState<"overview" | "events" | "console" | "network">(
    "overview"
  )

  return (
    <div className="flex h-full min-h-0 flex-col border-l bg-background">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as typeof tab)}
        className="flex h-full min-h-0 flex-col gap-0"
      >
        <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
          <TabsList variant="line" className="h-8 bg-transparent">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="console">Console</TabsTrigger>
            <TabsTrigger value="network">Network</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto p-4">
          <OverviewPanel
            meta={meta}
            loading={metaLoading}
            error={metaError}
            streamCount={streamCount}
          />
        </TabsContent>
        <TabsContent value="events" className="flex min-h-0 flex-1 flex-col">
          <EventsPanel
            events={events}
            globalStartTs={globalStartTs}
            getCurrentTimeMs={getCurrentTimeMs}
            onSeek={onSeek}
          />
        </TabsContent>
        <TabsContent value="console" className="flex min-h-0 flex-1 flex-col">
          <ConsolePanel
            events={events}
            globalStartTs={globalStartTs}
            onSeek={onSeek}
          />
        </TabsContent>
        <TabsContent value="network" className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="grid place-items-center pt-12 text-center">
            <div className="max-w-xs space-y-1">
              <p className="text-sm font-medium">Network capture not yet available</p>
              <p className="text-xs text-muted-foreground">
                Network events aren't surfaced in this build.
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function OverviewPanel({
  meta,
  loading,
  error,
  streamCount,
}: {
  meta: SessionReplayMeta | null,
  loading: boolean,
  error: string | null,
  streamCount: number,
}) {
  const [copied, setCopied] = useState(false)

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    )
  }
  if (error) {
    return <p className="text-xs text-red-500">{error}</p>
  }
  if (!meta) {
    return <p className="text-xs text-muted-foreground">No metadata.</p>
  }

  const userLabel =
    meta.projectUser.displayName ?? meta.projectUser.primaryEmail ?? meta.projectUser.id
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(meta.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // ignore
    }
  }
  const duration = meta.lastEventAt.getTime() - meta.startedAt.getTime()

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h4 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          User
        </h4>
        <ProjectUserDrawerLink
          userId={meta.projectUser.id}
          className="block truncate rounded-md border bg-muted/30 px-3 py-2 text-sm hover:bg-muted/60"
        >
          <div className="truncate font-medium">{userLabel}</div>
          {meta.projectUser.primaryEmail ? (
            <div className="truncate text-xs text-muted-foreground">
              {meta.projectUser.primaryEmail}
            </div>
          ) : null}
        </ProjectUserDrawerLink>
      </section>

      <section className="space-y-2">
        <h4 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          Session
        </h4>
        <div className="flex items-center gap-1.5">
          <code className="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">
            {meta.id}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={copied ? "Copied" : "Copy"}
            onClick={onCopy}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
      </section>

      <section className="space-y-1.5">
        <DetailRow label="Started">{formatLongDate(meta.startedAt)}</DetailRow>
        <DetailRow label="Last event">
          {formatLongDate(meta.lastEventAt)}
        </DetailRow>
        <DetailRow label="Duration">{formatDuration(duration)}</DetailRow>
        <DetailRow label="Events">
          <span className="font-mono text-xs">
            {meta.eventCount.toLocaleString()}
          </span>
        </DetailRow>
        <DetailRow label="Chunks">
          <span className="font-mono text-xs">
            {meta.chunkCount.toLocaleString()}
          </span>
        </DetailRow>
        <DetailRow label="Tabs">
          <span className="font-mono text-xs">{streamCount}</span>
        </DetailRow>
      </section>
    </div>
  )
}

function DetailRow({
  label,
  children,
}: {
  label: string,
  children: React.ReactNode,
}) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-3">
      <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <div className="min-w-0 truncate text-sm">{children}</div>
    </div>
  )
}

function EventsPanel({
  events,
  globalStartTs,
  getCurrentTimeMs,
  onSeek,
}: {
  events: Array<RrwebEventWithTime>,
  globalStartTs: number,
  getCurrentTimeMs: () => number,
  onSeek: (ms: number) => void,
}) {
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState<Set<EventCategory>>(() =>
    loadCategoryFilters()
  )
  const parentRef = useRef<HTMLDivElement | null>(null)
  const hoverPauseRef = useRef<{ flag: boolean, lastLeaveAt: number }>({
    flag: false,
    lastLeaveAt: 0,
  })

  const toggleFilter = (cat: EventCategory) => {
    setFilters((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      saveCategoryFilters(next)
      return next
    })
  }

  const rows = useMemo(() => {
    const lower = search.trim().toLowerCase()
    return events
      .map((e, idx) => {
        const ts = readEventTimestamp(e)
        if (ts == null) return null
        const cat = categorizeEvent(e)
        const label = describeEvent(e)
        return { idx, event: e, ts, cat, label }
      })
      .filter((row): row is NonNullable<typeof row> => row != null)
      .filter((row) => filters.has(row.cat) || row.cat === "Other" || row.cat === "Plugin")
      .filter((row) =>
        lower.length === 0 ? true : row.label.toLowerCase().includes(lower)
      )
  }, [events, filters, search])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 12,
  })

  const [activeRow, setActiveRow] = useState<number>(-1)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const now = getCurrentTimeMs()
      const targetTs = globalStartTs + now
      let bestIdx = -1
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].ts <= targetTs) bestIdx = i
        else break
      }
      setActiveRow((prev) => (prev === bestIdx ? prev : bestIdx))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getCurrentTimeMs, globalStartTs, rows])

  useEffect(() => {
    if (activeRow < 0) return
    if (hoverPauseRef.current.flag) return
    if (
      hoverPauseRef.current.lastLeaveAt > 0 &&
      performance.now() - hoverPauseRef.current.lastLeaveAt < 1500
    ) {
      return
    }
    virtualizer.scrollToIndex(activeRow, { align: "center" })
  }, [activeRow, virtualizer])

  return (
    <>
      <div className="shrink-0 space-y-2 border-b p-3">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events"
            className="h-8 ps-8"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {EVENT_CATEGORIES.map((cat) => {
            const active = filters.has(cat)
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleFilter(cat)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                )}
              >
                {cat}
              </button>
            )
          })}
        </div>
      </div>
      <div
        ref={parentRef}
        onMouseEnter={() => {
          hoverPauseRef.current.flag = true
        }}
        onMouseLeave={() => {
          hoverPauseRef.current.flag = false
          hoverPauseRef.current.lastLeaveAt = performance.now()
        }}
        className="min-h-0 flex-1 overflow-auto"
      >
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No events match the current filters.
          </p>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((vr) => {
              const row = rows[vr.index]
              if (!row) return null
              const offset = row.ts - globalStartTs
              const isActive = vr.index === activeRow
              return (
                <button
                  key={vr.key}
                  type="button"
                  onClick={() => onSeek(Math.max(0, offset))}
                  className={cn(
                    "absolute left-0 right-0 flex w-full items-center gap-3 border-b px-3 text-left transition-colors hover:bg-muted/60",
                    isActive && "bg-muted"
                  )}
                  style={{
                    height: `${vr.size}px`,
                    transform: `translateY(${vr.start}px)`,
                  }}
                >
                  <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
                    {formatRelativeMs(offset)}
                  </span>
                  <Badge
                    variant="secondary"
                    className="shrink-0 text-[10px] font-medium"
                  >
                    {row.cat}
                  </Badge>
                  <span className="min-w-0 truncate text-xs">{row.label}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

function ConsolePanel({
  events,
  globalStartTs,
  onSeek,
}: {
  events: Array<RrwebEventWithTime>,
  globalStartTs: number,
  onSeek: (ms: number) => void,
}) {
  const consoleRows = useMemo(() => {
    const out: Array<{
      ts: number,
      severity: "info" | "warn" | "error",
      text: string,
    }> = []
    for (const ev of events) {
      if (!isConsolePluginEvent(ev)) continue
      const ts = readEventTimestamp(ev)
      if (ts == null) continue
      const data = readEventData(ev)
      const payload = data?.payload as
        | { payload?: Array<unknown>, level?: unknown }
        | undefined
      const segments = Array.isArray(payload?.payload) ? payload.payload : []
      const text = segments
        .map((seg) => (typeof seg === "string" ? seg : safeStringify(seg)))
        .join(" ")
      out.push({ ts, severity: getConsoleSeverity(ev), text })
    }
    return out
  }, [events])

  if (consoleRows.length === 0) {
    return (
      <div className="grid flex-1 place-items-center px-6 py-12 text-center">
        <div className="max-w-xs space-y-1">
          <p className="text-sm font-medium">No console captures</p>
          <p className="text-xs text-muted-foreground">
            Make sure the rrweb console plugin is enabled at capture time.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <ul className="divide-y">
        {consoleRows.map((row, i) => {
          const offset = row.ts - globalStartTs
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onSeek(Math.max(0, offset))}
                className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-muted/60"
              >
                <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
                  {formatRelativeMs(offset)}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase",
                    row.severity === "error" &&
                      "bg-red-500/15 text-red-600 dark:text-red-400",
                    row.severity === "warn" &&
                      "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                    row.severity === "info" &&
                      "bg-muted text-muted-foreground"
                  )}
                >
                  {row.severity}
                </span>
                <span className="min-w-0 break-words font-mono text-[11px]">
                  {row.text || "—"}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const items: Array<[string, string]> = [
    ["Space", "Play / pause"],
    ["←  /  →", "Seek -5s / +5s (Shift = ±10s)"],
    ["0 / 1 / 2 / 3", "Speed 0.5×, 1×, 2×, 4×"],
    ["s", "Toggle skip inactivity"],
    ["f", "Toggle fullscreen"],
    ["?", "Toggle this overlay"],
  ]
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[min(28rem,90vw)] rounded-lg border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3">
          <h3 className="text-sm font-semibold">Keyboard shortcuts</h3>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
        <ul className="space-y-2">
          {items.map(([key, desc]) => (
            <li
              key={key}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="text-muted-foreground">{desc}</span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                {key}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// Suppress unused-import noise from icons that may only render conditionally.
void CursorClickIcon
void RewindIcon
void readEventType
