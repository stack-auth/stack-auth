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
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  TvPresentedEventHighlight,
  TvPresentedTakeover,
  TvScreenId,
  TvScreenSnapshot,
  TvSnapshot,
} from "@/lib/tv-mode/types";
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

function EventHighlight({ highlight }: { highlight: TvPresentedEventHighlight }) {
  const isCelebration = highlight.variant === "celebration";
  const isResolved = highlight.variant === "resolved-incident";
  const tone = isCelebration
    ? "border-amber-200/20 bg-[radial-gradient(circle_at_10%_10%,rgba(251,191,36,0.18),transparent_55%),rgba(24,18,9,0.84)] text-amber-100"
    : isResolved
      ? "border-emerald-200/20 bg-[radial-gradient(circle_at_10%_10%,rgba(52,211,153,0.15),transparent_55%),rgba(8,24,18,0.84)] text-emerald-100"
      : "border-rose-200/20 bg-[radial-gradient(circle_at_10%_10%,rgba(251,113,133,0.16),transparent_55%),rgba(28,10,15,0.86)] text-rose-100";
  return (
    <motion.aside
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className={`pointer-events-none w-full rounded-[clamp(1rem,1.2vw,2.5rem)] border p-[clamp(1rem,1.3vw,2.7rem)] shadow-2xl backdrop-blur-2xl ${tone}`}
    >
      <div className="flex items-start gap-4">
        <div className="flex h-[clamp(2.5rem,3vw,6rem)] w-[clamp(2.5rem,3vw,6rem)] shrink-0 items-center justify-center rounded-xl bg-current/10">
          {isCelebration ? <ConfettiIcon className="h-1/2 w-1/2" weight="fill" /> : isResolved ? <CheckCircleIcon className="h-1/2 w-1/2" weight="fill" /> : <WarningCircleIcon className="h-1/2 w-1/2" weight="fill" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 text-[clamp(0.62rem,0.68vw,1.5rem)] font-semibold uppercase tracking-[0.16em]">
            <span>{isCelebration ? "Event Highlight" : isResolved ? "Resolved" : "Active Incident"}</span>
            <span className="text-white/35">{formatFixtureTime(highlight.event.updatedAt)}</span>
          </div>
          <h2 className="mt-2 line-clamp-2 text-[clamp(1rem,1.35vw,3.2rem)] font-semibold leading-tight text-white">{highlight.event.title}</h2>
          <p className="mt-2 line-clamp-2 text-[clamp(0.72rem,0.82vw,1.9rem)] leading-relaxed text-white/55">{highlight.event.summary}</p>
          <div className="mt-3 flex items-center justify-between gap-4 border-t border-white/10 pt-3 text-[clamp(0.68rem,0.76vw,1.8rem)]">
            <span className="text-white/40">{highlight.event.sourceLabel}</span>
            <span className="font-semibold tabular-nums text-white/85">{highlight.event.metricLabel} · {highlight.event.metricValue}</span>
          </div>
        </div>
      </div>
    </motion.aside>
  );
}

function EventTakeover({ takeover }: { takeover: TvPresentedTakeover }) {
  const isCelebration = takeover.variant === "celebration";
  const isRecovery = takeover.variant === "recovery-confirmation";
  const isCritical = takeover.variant === "critical-incident";
  return (
    <section className={`relative flex h-full flex-col overflow-hidden px-[clamp(2rem,6vw,8rem)] py-[clamp(2rem,6vh,6rem)] ${
      isCelebration
        ? "bg-[radial-gradient(circle_at_50%_0%,rgba(251,191,36,0.3),transparent_45%),linear-gradient(145deg,#241807,#070912_60%)]"
        : isRecovery
          ? "bg-[radial-gradient(circle_at_50%_0%,rgba(52,211,153,0.25),transparent_45%),linear-gradient(145deg,#082019,#070912_60%)]"
          : "bg-[radial-gradient(circle_at_50%_0%,rgba(244,63,94,0.28),transparent_45%),linear-gradient(145deg,#240a12,#090910_60%)]"
    }`}>
      <div className={`absolute left-1/2 top-0 h-[45vw] w-[45vw] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl ${isCelebration ? "bg-amber-300/10" : isRecovery ? "bg-emerald-300/10" : "bg-rose-400/10"}`} />
      <div className="relative flex items-center justify-between">
        <div className={`flex items-center gap-3 text-[clamp(0.7rem,0.9vw,1.05rem)] font-semibold uppercase tracking-[0.25em] ${isCelebration ? "text-amber-200" : isRecovery ? "text-emerald-200" : "text-rose-200"}`}>
          {isCelebration ? <ConfettiIcon className="h-[1.4em] w-[1.4em]" weight="fill" /> : isRecovery ? <CheckCircleIcon className="h-[1.4em] w-[1.4em]" weight="fill" /> : <BroadcastIcon className="h-[1.4em] w-[1.4em]" weight="fill" />}
          {isCelebration ? "Company milestone" : isRecovery ? "Incident resolved" : isCritical ? "Critical incident" : "Incident"}
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[clamp(0.68rem,0.8vw,0.95rem)] text-white/45">
          {takeover.event.sourceLabel}
        </div>
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center text-center">
        <div className={`mb-[clamp(1.5rem,3vh,3rem)] flex h-[clamp(4rem,7vw,8rem)] w-[clamp(4rem,7vw,8rem)] items-center justify-center rounded-[2rem] border ${
          isCelebration
            ? "border-amber-200/20 bg-amber-300/10 text-amber-100"
            : isRecovery
              ? "border-emerald-200/20 bg-emerald-300/10 text-emerald-100"
              : "border-rose-200/20 bg-rose-300/10 text-rose-100"
        }`}>
          {isCelebration ? <ConfettiIcon className="h-1/2 w-1/2" weight="fill" /> : isRecovery ? <CheckCircleIcon className="h-1/2 w-1/2" weight="fill" /> : <WarningCircleIcon className="h-1/2 w-1/2" weight="fill" />}
        </div>
        <h1 className="max-w-[14ch] text-[clamp(3rem,7vw,9rem)] font-semibold leading-[0.9] tracking-[-0.065em] text-white">
          {takeover.event.title}
        </h1>
        <p className="mt-[clamp(1.5rem,3vh,3rem)] max-w-[48rem] text-[clamp(1rem,1.5vw,1.8rem)] leading-relaxed text-white/52">
          {takeover.event.summary}
        </p>
        <div className="mt-[clamp(2rem,5vh,5rem)]">
          <p className="text-[clamp(0.68rem,0.85vw,1rem)] font-semibold uppercase tracking-[0.2em] text-white/38">{takeover.event.metricLabel}</p>
          <p className={`mt-2 text-[clamp(2.5rem,5vw,6rem)] font-semibold tabular-nums tracking-[-0.045em] ${isCelebration ? "text-amber-100" : isRecovery ? "text-emerald-100" : "text-rose-100"}`}>
            {takeover.event.metricValue}
          </p>
          {takeover.event.expectedRange == null ? null : <p className="mt-3 text-[clamp(0.75rem,0.9vw,1.25rem)] text-white/42">{takeover.event.expectedRange}</p>}
        </div>
      </div>

      <div className="relative flex items-center justify-between text-[clamp(0.7rem,0.8vw,0.95rem)] text-white/35">
        <span>{takeover.endsAt == null ? "This view remains until validated recovery" : "Returning to the playlist automatically"}</span>
        <span>Observed {formatFixtureTime(takeover.event.occurredAt)}</span>
      </div>
    </section>
  );
}

type FireworkParticle = {
  x: number,
  y: number,
  velocityX: number,
  velocityY: number,
  age: number,
  lifetime: number,
  radius: number,
  color: string,
};

function CelebrationFireworks({
  ambientActive,
  eventId,
  entryBurst,
  foreground = false,
}: {
  ambientActive: boolean,
  eventId: string | null,
  entryBurst: boolean,
  foreground?: boolean,
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if ((!ambientActive && !entryBurst) || canvas == null) return;
    const context = canvas.getContext("2d");
    if (context == null) return;
    let animationFrame = 0;
    let previousFrameAt = performance.now();
    let nextBurstAt = ambientActive
      ? previousFrameAt + (foreground ? 4_500 : 900)
      : Number.POSITIVE_INFINITY;
    let visible = document.visibilityState === "visible";
    const particles: FireworkParticle[] = [];
    const colors = ["#fef3c7", "#fde68a", "#fbbf24", "#f59e0b", "#fff7ed"];

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio, 2);
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const burst = (x: number, y: number, count: number) => {
      const available = Math.max(0, (foreground ? 24 : 180) - particles.length);
      for (let index = 0; index < Math.min(count, available); index += 1) {
        const angle = (Math.PI * 2 * index) / count + Math.random() * 0.18;
        const speed = 22 + Math.random() * 52;
        particles.push({
          x,
          y,
          velocityX: Math.cos(angle) * speed,
          velocityY: Math.sin(angle) * speed,
          age: 0,
          lifetime: 1.7 + Math.random() * 1.2,
          radius: 0.7 + Math.random() * 1.5,
          color: colors[Math.floor(Math.random() * colors.length)] ?? "#fde68a",
        });
      }
    };
    resize();
    if (entryBurst) {
      burst(canvas.clientWidth * 0.18, canvas.clientHeight * 0.3, 52);
      burst(canvas.clientWidth * 0.82, canvas.clientHeight * 0.3, 52);
    }

    const handleVisibility = () => {
      visible = document.visibilityState === "visible";
      previousFrameAt = performance.now();
    };
    const render = (now: number) => {
      animationFrame = window.requestAnimationFrame(render);
      if (!visible || now - previousFrameAt < 1000 / 30) return;
      const elapsed = Math.min((now - previousFrameAt) / 1000, 0.08);
      previousFrameAt = now;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      context.clearRect(0, 0, width, height);
      if (now >= nextBurstAt) {
        burst(
          width * (0.12 + Math.random() * 0.76),
          height * (0.18 + Math.random() * 0.48),
          foreground ? 4 + Math.floor(Math.random() * 4) : 28 + Math.floor(Math.random() * 24),
        );
        nextBurstAt = now + (foreground
          ? 8_000 + Math.random() * 6_000
          : 3_200 + Math.random() * 4_800);
      }
      context.globalCompositeOperation = "lighter";
      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        particle.age += elapsed;
        if (particle.age >= particle.lifetime) {
          particles.splice(index, 1);
          continue;
        }
        particle.velocityY += 24 * elapsed;
        particle.x += particle.velocityX * elapsed;
        particle.y += particle.velocityY * elapsed;
        const opacity = Math.max(0, 1 - particle.age / particle.lifetime) * (foreground ? 0.12 : 0.42);
        context.beginPath();
        context.fillStyle = particle.color;
        context.globalAlpha = opacity;
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
    };

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", handleVisibility);
    animationFrame = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
      context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    };
  }, [ambientActive, entryBurst, eventId, foreground]);

  return <canvas ref={canvasRef} aria-hidden className={`pointer-events-none absolute inset-0 h-full w-full ${foreground ? "z-[15] opacity-60" : "z-[5] opacity-90"}`} />;
}

function useAuthoritativeDeadlineActive(
  deadline: string | null,
  generatedAt: string | null,
): boolean {
  const [active, setActive] = useState(() => (
    deadline != null
    && generatedAt != null
    && new Date(deadline).getTime() > new Date(generatedAt).getTime()
  ));
  useEffect(() => {
    if (deadline == null || generatedAt == null) {
      setActive(false);
      return;
    }
    const remainingMilliseconds = Math.max(0, new Date(deadline).getTime() - new Date(generatedAt).getTime());
    setActive(remainingMilliseconds > 0);
    if (remainingMilliseconds === 0) return;
    const timeout = window.setTimeout(() => setActive(false), remainingMilliseconds);
    return () => window.clearTimeout(timeout);
  }, [deadline, generatedAt]);
  return active;
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
  const [boundedTakeoverCompleted, setBoundedTakeoverCompleted] = useState(false);
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
      : playlistKey?.split("\u0000").indexOf(initialScreenId) ?? -1;
    setScreenIndex(requestedIndex < 0 ? 0 : requestedIndex);
    setBoundedTakeoverCompleted(false);
    setRotationPaused(false);
  }, [initialScreenId, playlistKey, profileId]);

  const view = useMemo(
    () => snapshot == null
      ? null
      : selectTvPresentationView(snapshot, screenIndex, boundedTakeoverCompleted),
    [boundedTakeoverCompleted, screenIndex, snapshot],
  );
  const viewType = view?.type;
  const takeoverEndsAt = view?.type === "takeover" ? view.presentedTakeover.endsAt : null;
  const takeoverEventId = view?.type === "takeover"
    ? view.presentedTakeover.event.id
    : null;
  const generatedAt = snapshot?.generatedAt ?? null;
  const highlight = snapshot?.presentation.highlight ?? null;
  const timedHighlightVisible = useAuthoritativeDeadlineActive(highlight?.expiresAt ?? null, generatedAt);
  const highlightVisible = highlight != null
    && (highlight.expiresAt == null || timedHighlightVisible);
  const animationVisible = useAuthoritativeDeadlineActive(highlight?.animationExpiresAt ?? null, generatedAt);
  const takeoverIsCelebration = view?.type === "takeover" && view.presentedTakeover.variant === "celebration";
  const celebrationAnimationEligible = highlight?.variant === "celebration" && animationVisible;
  const celebrationAnimationActive = reducedMotion !== true
    && celebrationAnimationEligible
    && (view?.type !== "takeover" || takeoverIsCelebration);
  const playlistLength = snapshot?.profile.playlist.length;
  const activeScreenId = snapshot?.profile.playlist.at(screenIndex);
  const rotationDurationSeconds = activeScreenId == null
    ? snapshot?.profile.defaultDurationSeconds
    : snapshot?.profile.screenDurations?.find((entry) => entry.screenId === activeScreenId)?.durationSeconds
      ?? snapshot?.profile.defaultDurationSeconds;

  useEffect(() => {
    setBoundedTakeoverCompleted(false);
  }, [takeoverEventId]);

  useEffect(() => {
    if (viewType !== "takeover" || rotationPaused || takeoverEndsAt == null || generatedAt == null) return;
    const remainingMilliseconds = Math.max(0, new Date(takeoverEndsAt).getTime() - new Date(generatedAt).getTime());
    if (remainingMilliseconds === 0) {
      setBoundedTakeoverCompleted(true);
      return;
    }
    const timeout = window.setTimeout(() => setBoundedTakeoverCompleted(true), remainingMilliseconds);
    return () => window.clearTimeout(timeout);
  }, [generatedAt, rotationPaused, takeoverEndsAt, takeoverEventId, viewType]);

  useEffect(() => {
    if (viewType !== "screen" || playlistLength == null || rotationDurationSeconds == null) return;
    if (rotationPaused) return;
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
  const headerAccessory = highlight == null || !highlightVisible || view.type === "takeover"
    ? undefined
    : (
      <AnimatePresence>
        <EventHighlight highlight={highlight} />
      </AnimatePresence>
    );
  if (view.type === "fatal-error") {
    content = <PresentationMessage type="error" title="TV Mode is unavailable" message={view.message} />;
  } else if (view.type === "empty") {
    content = <PresentationMessage type="empty" title="Waiting for activity" message="This profile is ready. Data will appear as soon as the selected sources receive activity." />;
  } else if (view.type === "takeover") {
    content = <EventTakeover takeover={view.presentedTakeover} />;
  } else {
    activeScreen = getScreenOrThrow(snapshot, view.screenIndex);
    content = renderTvScreen(activeScreen, headerAccessory);
  }

  return (
    <div
      className="relative h-dvh min-h-[36rem] w-full overflow-hidden bg-[#070910] font-sans text-white"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(99,102,241,0.09),transparent_32%),radial-gradient(circle_at_85%_75%,rgba(34,211,238,0.06),transparent_30%)]" />
      <CelebrationFireworks
        ambientActive={celebrationAnimationActive}
        eventId={takeoverIsCelebration ? takeoverEventId : highlight?.event.id ?? null}
        entryBurst={reducedMotion !== true && takeoverIsCelebration}
      />
      <CelebrationFireworks
        ambientActive={celebrationAnimationActive}
        eventId={takeoverIsCelebration ? takeoverEventId : highlight?.event.id ?? null}
        entryBurst={false}
        foreground
      />
      <AnimatePresence mode="wait">
        <motion.div
          key={view.type === "screen" && activeScreen != null ? activeScreen.id : view.type}
          initial={reducedMotion ? false : { opacity: 0, scale: 1.008 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reducedMotion ? undefined : { opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.35, ease: "easeOut" }}
          className="pointer-events-none relative z-10 h-full"
        >
          {content}
        </motion.div>
      </AnimatePresence>

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
