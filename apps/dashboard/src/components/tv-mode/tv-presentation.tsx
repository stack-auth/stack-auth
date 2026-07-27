"use client";

import {
  ArrowLeftIcon,
  BroadcastIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CloudSlashIcon,
  ConfettiIcon,
  CornersInIcon,
  CornersOutIcon,
  PauseIcon,
  PlayIcon,
  WarningCircleIcon,
  WifiHighIcon,
} from "@phosphor-icons/react";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { TvPresentedEvent, TvScreenId, TvScreenSnapshot, TvSnapshot } from "@/lib/tv-mode/types";
import { getNextTvScreenIndex, selectTvPresentationView } from "./presentation-controller";
import { getTvScreenDefinition, renderTvScreen } from "./screen-registry";

function getScreenOrThrow(snapshot: TvSnapshot, screenIndex: number): TvScreenSnapshot {
  const screenId = snapshot.profile.playlist.at(screenIndex);
  if (screenId == null) {
    throw new Error(`TV playlist has no screen at index ${screenIndex}`);
  }
  const screen = snapshot.screens.find((candidate) => candidate.id === screenId);
  if (screen == null) {
    throw new Error(`TV snapshot is missing configured screen "${screenId}"`);
  }
  return screen;
}

function formatFixtureTime(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(isoDate));
}

function PresentationStatus({ snapshot }: { snapshot: TvSnapshot }) {
  if (snapshot.connectionStatus === "offline") {
    return (
      <div className="flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-[clamp(0.7rem,0.8vw,1.9rem)] font-medium text-amber-100">
        <CloudSlashIcon className="h-[1.15em] w-[1.15em]" weight="bold" />
        Offline · showing the last safe snapshot
      </div>
    );
  }
  if (snapshot.connectionStatus === "stale") {
    return (
      <div className="flex items-center gap-2 rounded-full border border-orange-300/20 bg-orange-300/10 px-4 py-2 text-[clamp(0.7rem,0.8vw,1.9rem)] font-medium text-orange-100">
        <WarningCircleIcon className="h-[1.15em] w-[1.15em]" weight="fill" />
        Data is stale
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-[clamp(0.68rem,0.78vw,1.8rem)] text-white/38">
      <WifiHighIcon className="h-[1.15em] w-[1.15em] text-emerald-300/70" weight="bold" />
      Updated {formatFixtureTime(snapshot.generatedAt)}
    </div>
  );
}

function EventBanner({ presentedEvent }: { presentedEvent: TvPresentedEvent }) {
  const isCelebration = presentedEvent.event.kind === "celebration";
  return (
    <div className="absolute left-1/2 top-[clamp(1.25rem,2.5vh,2.5rem)] z-30 w-[min(92vw,64rem)] -translate-x-1/2">
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className={`flex items-center gap-4 rounded-2xl border px-5 py-4 shadow-2xl backdrop-blur-2xl ${
          isCelebration
            ? "border-violet-300/20 bg-violet-950/75 shadow-violet-950/40"
            : "border-amber-300/20 bg-amber-950/75 shadow-amber-950/40"
        }`}
      >
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${isCelebration ? "bg-violet-300/15 text-violet-200" : "bg-amber-300/15 text-amber-200"}`}>
          {isCelebration ? <ConfettiIcon className="h-6 w-6" weight="fill" /> : <WarningCircleIcon className="h-6 w-6" weight="fill" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
            {isCelebration ? "Milestone" : "Notice"}
          </p>
          <p className="mt-1 truncate text-lg font-medium text-white">{presentedEvent.event.title}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-white/40">{presentedEvent.event.metricLabel}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-white">{presentedEvent.event.metricValue}</p>
        </div>
      </motion.div>
    </div>
  );
}

function EventTakeover({ presentedEvent }: { presentedEvent: TvPresentedEvent }) {
  const isCelebration = presentedEvent.event.kind === "celebration";
  return (
    <section className={`relative flex h-full flex-col overflow-hidden px-[clamp(2rem,6vw,8rem)] py-[clamp(2rem,6vh,6rem)] ${
      isCelebration
        ? "bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,246,0.3),transparent_45%),linear-gradient(145deg,#110b25,#070912_60%)]"
        : "bg-[radial-gradient(circle_at_50%_0%,rgba(244,63,94,0.28),transparent_45%),linear-gradient(145deg,#240a12,#090910_60%)]"
    }`}>
      <div className={`absolute left-1/2 top-0 h-[45vw] w-[45vw] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl ${isCelebration ? "bg-violet-400/10" : "bg-rose-400/10"}`} />
      <div className="relative flex items-center justify-between">
        <div className={`flex items-center gap-3 text-[clamp(0.7rem,0.9vw,1.05rem)] font-semibold uppercase tracking-[0.25em] ${isCelebration ? "text-violet-200" : "text-rose-200"}`}>
          {isCelebration ? <ConfettiIcon className="h-[1.4em] w-[1.4em]" weight="fill" /> : <BroadcastIcon className="h-[1.4em] w-[1.4em]" weight="fill" />}
          {isCelebration ? "Company milestone" : "Critical incident"}
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[clamp(0.68rem,0.8vw,0.95rem)] text-white/45">
          {presentedEvent.event.sourceLabel}
        </div>
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center text-center">
        <div className={`mb-[clamp(1.5rem,3vh,3rem)] flex h-[clamp(4rem,7vw,8rem)] w-[clamp(4rem,7vw,8rem)] items-center justify-center rounded-[2rem] border ${
          isCelebration
            ? "border-violet-200/20 bg-violet-300/10 text-violet-100"
            : "border-rose-200/20 bg-rose-300/10 text-rose-100"
        }`}>
          {isCelebration ? <ConfettiIcon className="h-1/2 w-1/2" weight="fill" /> : <WarningCircleIcon className="h-1/2 w-1/2" weight="fill" />}
        </div>
        <h1 className="max-w-[14ch] text-[clamp(3rem,7vw,9rem)] font-semibold leading-[0.9] tracking-[-0.065em] text-white">
          {presentedEvent.event.title}
        </h1>
        <p className="mt-[clamp(1.5rem,3vh,3rem)] max-w-[48rem] text-[clamp(1rem,1.5vw,1.8rem)] leading-relaxed text-white/52">
          {presentedEvent.event.summary}
        </p>
        <div className="mt-[clamp(2rem,5vh,5rem)]">
          <p className="text-[clamp(0.68rem,0.85vw,1rem)] font-semibold uppercase tracking-[0.2em] text-white/38">{presentedEvent.event.metricLabel}</p>
          <p className={`mt-2 text-[clamp(2.5rem,5vw,6rem)] font-semibold tabular-nums tracking-[-0.045em] ${isCelebration ? "text-violet-100" : "text-rose-100"}`}>
            {presentedEvent.event.metricValue}
          </p>
        </div>
      </div>

      <div className="relative flex items-center justify-between text-[clamp(0.7rem,0.8vw,0.95rem)] text-white/35">
        <span>{presentedEvent.decision.treatment === "temporary-takeover" ? "Returning to the playlist automatically" : "This view remains until the incident recovers"}</span>
        <span>Started {formatFixtureTime(presentedEvent.event.startedAt)}</span>
      </div>
    </section>
  );
}

function PresentationMessage({
  type,
  title,
  message,
}: {
  type: "loading" | "empty" | "error",
  title: string,
  message: string,
}) {
  const Icon = type === "error" ? WarningCircleIcon : type === "empty" ? CheckCircleIcon : BroadcastIcon;
  return (
    <div className="flex h-full items-center justify-center bg-[#070910] px-8 text-center text-white">
      <div className="max-w-2xl">
        <div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-[1.75rem] border ${
          type === "error" ? "border-rose-300/20 bg-rose-300/10 text-rose-200" : "border-white/10 bg-white/[0.04] text-white/65"
        }`}>
          <Icon className={`h-10 w-10 ${type === "loading" ? "animate-pulse motion-reduce:animate-none" : ""}`} weight="fill" />
        </div>
        <h1 className="mt-8 text-[clamp(2.4rem,5vw,5.5rem)] font-semibold tracking-[-0.055em]">{title}</h1>
        <p className="mt-5 text-[clamp(0.95rem,1.35vw,1.5rem)] leading-relaxed text-white/45">{message}</p>
      </div>
    </div>
  );
}

export function TvPresentation({
  snapshot,
  loading = false,
  unavailableReason = null,
  onExit,
  initialScreenId,
}: {
  snapshot: TvSnapshot | null,
  loading?: boolean,
  unavailableReason?: "offline" | "error" | null,
  onExit: () => void,
  initialScreenId?: TvScreenId,
}) {
  const reducedMotion = useReducedMotion();
  const [screenIndex, setScreenIndex] = useState(0);
  const [temporaryTakeoverDismissed, setTemporaryTakeoverDismissed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [rotationPaused, setRotationPaused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const profileId = snapshot?.profile.id;
  const playlistKey = snapshot?.profile.playlist.join("\u0000");

  // Polling replaces the snapshot object every 15 seconds. Reset only when the
  // presentation configuration changes so a data refresh cannot restart the
  // rotation timer or send a manually selected screen back to the first slide.
  useEffect(() => {
    const requestedIndex = initialScreenId == null
      ? 0
      : snapshot?.profile.playlist.indexOf(initialScreenId) ?? -1;
    setScreenIndex(requestedIndex < 0 ? 0 : requestedIndex);
    setTemporaryTakeoverDismissed(false);
    setRotationPaused(false);
  }, [initialScreenId, playlistKey, profileId]);

  const view = useMemo(
    () => snapshot == null
      ? null
      : selectTvPresentationView(snapshot, screenIndex, temporaryTakeoverDismissed),
    [screenIndex, snapshot, temporaryTakeoverDismissed],
  );
  const viewType = view?.type;
  const takeoverTreatment = view?.type === "takeover"
    ? view.presentedEvent.decision.treatment
    : null;
  const takeoverDurationSeconds = view?.type === "takeover"
    ? view.presentedEvent.decision.displayForSeconds
    : null;
  const takeoverEventId = view?.type === "takeover"
    ? view.presentedEvent.event.id
    : null;
  const playlistLength = snapshot?.profile.playlist.length;
  const rotationDurationSeconds = snapshot?.profile.defaultDurationSeconds;

  useEffect(() => {
    if (viewType == null || rotationPaused) return;
    if (viewType === "takeover") {
      if (takeoverTreatment !== "temporary-takeover" || takeoverDurationSeconds == null) return;
      const timeout = window.setTimeout(() => setTemporaryTakeoverDismissed(true), takeoverDurationSeconds * 1000);
      return () => window.clearTimeout(timeout);
    }
    if (viewType !== "screen" || playlistLength == null || rotationDurationSeconds == null) return;
    const timeout = window.setTimeout(
      () => setScreenIndex((current) => getNextTvScreenIndex(current, playlistLength)),
      rotationDurationSeconds * 1000,
    );
    return () => window.clearTimeout(timeout);
  }, [
    playlistLength,
    rotationDurationSeconds,
    rotationPaused,
    screenIndex,
    takeoverDurationSeconds,
    takeoverEventId,
    takeoverTreatment,
    viewType,
  ]);

  useEffect(() => {
    if (!controlsVisible) return;
    const timeout = window.setTimeout(() => setControlsVisible(false), 2800);
    return () => window.clearTimeout(timeout);
  }, [controlsVisible]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const showControls = () => setControlsVisible(true);
    const handleKeyDown = (event: KeyboardEvent) => {
      showControls();
      if (snapshot == null || view?.type !== "screen") return;
      if (event.key === "ArrowLeft") {
        setScreenIndex((current) => (current - 1 + snapshot.profile.playlist.length) % snapshot.profile.playlist.length);
      } else if (event.key === "ArrowRight") {
        setScreenIndex((current) => getNextTvScreenIndex(current, snapshot.profile.playlist.length));
      } else if (event.key === " ") {
        event.preventDefault();
        setRotationPaused((current) => !current);
      } else if (event.key.toLowerCase() === "f") {
        runAsynchronously(document.fullscreenElement == null
          ? document.documentElement.requestFullscreen()
          : document.exitFullscreen());
      }
    };
    window.addEventListener("mousemove", showControls);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousemove", showControls);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [snapshot, view]);

  if (loading) {
    return <div className="h-dvh w-full"><PresentationMessage type="loading" title="Preparing TV Mode" message="Assembling the latest office-safe snapshot…" /></div>;
  }
  if (snapshot == null && unavailableReason === "offline") {
    return <div className="h-dvh w-full"><PresentationMessage type="error" title="TV Mode is offline" message="Reconnect to load the first presentation snapshot." /></div>;
  }
  if (snapshot == null || view == null) {
    return <div className="h-dvh w-full"><PresentationMessage type="error" title="TV Mode is unavailable" message="The presentation snapshot could not be loaded." /></div>;
  }

  let content;
  let activeScreen: TvScreenSnapshot | null = null;
  if (view.type === "fatal-error") {
    content = <PresentationMessage type="error" title="TV Mode is unavailable" message={view.message} />;
  } else if (view.type === "empty") {
    content = <PresentationMessage type="empty" title="Waiting for activity" message="This profile is ready. Data will appear as soon as the selected sources receive activity." />;
  } else if (view.type === "takeover") {
    content = <EventTakeover presentedEvent={view.presentedEvent} />;
  } else {
    activeScreen = getScreenOrThrow(snapshot, view.screenIndex);
    content = renderTvScreen(activeScreen);
  }

  return (
    <div
      className="relative h-dvh min-h-[36rem] w-full overflow-hidden bg-[#070910] font-sans text-white"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(99,102,241,0.09),transparent_32%),radial-gradient(circle_at_85%_75%,rgba(34,211,238,0.06),transparent_30%)]" />
      <AnimatePresence mode="wait">
        <motion.div
          key={view.type === "screen" && activeScreen != null ? activeScreen.id : view.type}
          initial={reducedMotion ? false : { opacity: 0, scale: 1.008 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reducedMotion ? undefined : { opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.35, ease: "easeOut" }}
          className="pointer-events-none relative h-full"
        >
          {content}
        </motion.div>
      </AnimatePresence>

      {snapshot.presentation.banner == null || view.type === "takeover" ? null : (
        <AnimatePresence>
          <EventBanner presentedEvent={snapshot.presentation.banner} />
        </AnimatePresence>
      )}

      {view.type === "screen" && activeScreen != null ? (
        <footer className="pointer-events-none absolute inset-x-[clamp(2rem,5vw,14rem)] bottom-[clamp(1rem,2.5vh,5rem)] z-20 flex items-center justify-between">
          <div className="flex min-w-0 max-w-[34%] items-center gap-3">
            <span className="truncate text-[clamp(0.68rem,0.8vw,1.9rem)] font-medium text-white/55">{snapshot.project.displayName}</span>
            <span className="h-1 w-1 rounded-full bg-white/20" />
            <span className="truncate text-[clamp(0.68rem,0.8vw,1.9rem)] text-white/30">{snapshot.profile.displayName}</span>
          </div>
          <div className="flex items-center gap-2" aria-label={`Screen ${screenIndex + 1} of ${snapshot.profile.playlist.length}`}>
            {snapshot.profile.playlist.map((screenId, index) => (
              <span key={screenId} className={`h-1.5 rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none ${index === screenIndex ? "w-8 bg-white/75" : "w-1.5 bg-white/18"}`} />
            ))}
          </div>
          <PresentationStatus snapshot={snapshot} />
        </footer>
      ) : null}

      <div className={`absolute left-5 top-5 z-40 transition-opacity duration-200 hover:transition-none motion-reduce:transition-none ${controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <button type="button" onClick={onExit} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/55 px-4 py-2 text-sm font-medium text-white/75 backdrop-blur-xl hover:bg-black/75">
          <ArrowLeftIcon className="h-4 w-4" weight="bold" />
          Exit TV Mode
        </button>
      </div>

      {view.type === "screen" ? (
        <div className={`absolute bottom-[clamp(3.5rem,7vh,6rem)] left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/10 bg-black/65 p-1.5 shadow-2xl backdrop-blur-xl transition-opacity duration-200 hover:transition-none motion-reduce:transition-none ${controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}>
          <button
            type="button"
            onClick={() => setScreenIndex((current) => (current - 1 + snapshot.profile.playlist.length) % snapshot.profile.playlist.length)}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white/65 hover:bg-white/10 hover:text-white"
            aria-label="Previous screen"
          >
            <CaretLeftIcon className="h-5 w-5" weight="bold" />
          </button>
          <button
            type="button"
            onClick={() => setRotationPaused((current) => !current)}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white/65 hover:bg-white/10 hover:text-white"
            aria-label={rotationPaused ? "Resume rotation" : "Pause rotation"}
          >
            {rotationPaused ? <PlayIcon className="h-5 w-5" weight="fill" /> : <PauseIcon className="h-5 w-5" weight="fill" />}
          </button>
          <button
            type="button"
            onClick={() => setScreenIndex((current) => getNextTvScreenIndex(current, snapshot.profile.playlist.length))}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white/65 hover:bg-white/10 hover:text-white"
            aria-label="Next screen"
          >
            <CaretRightIcon className="h-5 w-5" weight="bold" />
          </button>
          <span className="mx-1 h-6 w-px bg-white/10" />
          <button
            type="button"
            onClick={() => runAsynchronously(document.fullscreenElement == null
              ? document.documentElement.requestFullscreen()
              : document.exitFullscreen())}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white/65 hover:bg-white/10 hover:text-white"
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? <CornersInIcon className="h-5 w-5" weight="bold" /> : <CornersOutIcon className="h-5 w-5" weight="bold" />}
          </button>
        </div>
      ) : null}
    </div>
  );
}
