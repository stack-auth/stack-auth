"use client";

import {
  ArrowCounterClockwiseIcon,
  BrainIcon,
  CheckCircleIcon,
  PauseIcon,
  PlayIcon,
  RocketLaunchIcon,
  SirenIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useId, type ChangeEvent, type ElementType } from "react";

import {
  DesignBadge,
  DesignButton,
  DesignCard,
  type DesignBadgeColor,
} from "@/components/design-components";
import { cn } from "@/lib/utils";

import {
  formatPlaybackTime,
  getPlaybackStage,
  type IncidentStage,
  type IncidentStory,
} from "./stories";

export type IncidentPlaybackProps = {
  story: IncidentStory,
  elapsedMs: number,
  isPlaying: boolean,
  onElapsedChange: (elapsedMs: number) => void,
  onPlayingChange: (playing: boolean) => void,
};

type StagePresentation = {
  icon: ElementType,
  color: DesignBadgeColor,
  label: string,
};

const stagePresentations = new Map<IncidentStage["kind"], StagePresentation>([
  ["healthy", { icon: CheckCircleIcon, color: "green", label: "Baseline" }],
  ["change", { icon: RocketLaunchIcon, color: "purple", label: "Change" }],
  ["impact", { icon: SirenIcon, color: "red", label: "Alert" }],
  ["diagnosis", { icon: BrainIcon, color: "cyan", label: "Diagnosis" }],
  ["mitigation", { icon: WrenchIcon, color: "orange", label: "Remediation" }],
  ["recovery", { icon: CheckCircleIcon, color: "green", label: "Recovery" }],
]);

function getStagePresentation(kind: IncidentStage["kind"]): StagePresentation {
  const presentation = stagePresentations.get(kind);
  if (presentation == null) {
    throw new Error(`Missing incident playback presentation for stage kind "${kind}".`);
  }
  return presentation;
}

function clampElapsed(elapsedMs: number, durationMs: number): number {
  return Math.min(Math.max(elapsedMs, 0), durationMs);
}

function getActiveStage(story: IncidentStory, elapsedMs: number): IncidentStage {
  const stage = getPlaybackStage(story, elapsedMs);
  if (stage == null) {
    throw new Error(`Incident story "${story.id}" must contain at least one playback stage.`);
  }
  return stage;
}

function getActiveStageIndex(story: IncidentStory, activeStage: IncidentStage): number {
  const index = story.stages.findIndex((stage) => stage.id === activeStage.id);
  if (index < 0) {
    throw new Error(`Active stage "${activeStage.id}" is missing from incident story "${story.id}".`);
  }
  return index;
}

export function IncidentPlayback({
  story,
  elapsedMs,
  isPlaying,
  onElapsedChange,
  onPlayingChange,
}: IncidentPlaybackProps) {
  const shouldReduceMotion = useReducedMotion();
  const rangeId = useId();
  const safeElapsedMs = clampElapsed(elapsedMs, story.durationMs);
  const activeStage = getActiveStage(story, safeElapsedMs);
  const activeStageIndex = getActiveStageIndex(story, activeStage);
  const progressPercent = story.durationMs === 0
    ? 0
    : (safeElapsedMs / story.durationMs) * 100;
  const activePresentation = getStagePresentation(activeStage.kind);
  const ActiveIcon = activePresentation.icon;

  const handleRangeChange = (event: ChangeEvent<HTMLInputElement>) => {
    onElapsedChange(Number(event.currentTarget.value));
  };

  const handleRestart = () => {
    onElapsedChange(0);
  };

  const handleStageSelect = (stage: IncidentStage) => {
    onElapsedChange(stage.offsetMs);
  };

  return (
    <DesignCard
      title="Incident playback"
      subtitle="Replay every signal from change to recovery"
      icon={PlayIcon}
      gradient="cyan"
      contentClassName="space-y-5"
      actions={(
        <DesignBadge
          label={isPlaying ? "Live playback" : "Paused"}
          color={isPlaying ? "green" : "orange"}
          icon={isPlaying ? PlayIcon : PauseIcon}
          size="sm"
        />
      )}
    >
      <div className="flex flex-col gap-4 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-foreground/[0.06] sm:p-4">
        <div className="flex items-center gap-2">
          <DesignButton
            type="button"
            size="icon"
            variant="secondary"
            className="h-9 w-9 rounded-xl transition-opacity duration-150 hover:transition-none"
            aria-label={isPlaying ? "Pause incident playback" : "Play incident playback"}
            aria-pressed={isPlaying}
            onClick={() => onPlayingChange(!isPlaying)}
          >
            {isPlaying
              ? <PauseIcon className="h-4 w-4" weight="fill" />
              : <PlayIcon className="h-4 w-4" weight="fill" />}
          </DesignButton>
          <DesignButton
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 rounded-xl transition-opacity duration-150 hover:transition-none"
            aria-label="Restart incident playback"
            disabled={safeElapsedMs === 0}
            onClick={handleRestart}
          >
            <ArrowCounterClockwiseIcon className="h-4 w-4" />
          </DesignButton>

          <div className="ml-auto flex items-baseline gap-1 font-mono text-xs tabular-nums">
            <span className="font-semibold text-foreground">{formatPlaybackTime(safeElapsedMs)}</span>
            <span className="text-muted-foreground">/ {formatPlaybackTime(story.durationMs)}</span>
          </div>
        </div>

        <div className="relative pb-1 pt-5">
          <label htmlFor={rangeId} className="sr-only">
            Incident playback position
          </label>
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 top-[1.625rem] h-1 overflow-hidden rounded-full bg-foreground/10"
          >
            <motion.div
              className="h-full origin-left rounded-full bg-cyan-500"
              animate={{ scaleX: progressPercent / 100 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }}
            />
          </div>
          <input
            id={rangeId}
            type="range"
            min={0}
            max={story.durationMs}
            step={100}
            value={safeElapsedMs}
            onChange={handleRangeChange}
            aria-valuemin={0}
            aria-valuemax={story.durationMs}
            aria-valuenow={safeElapsedMs}
            aria-valuetext={`${formatPlaybackTime(safeElapsedMs)} of ${formatPlaybackTime(story.durationMs)}`}
            className="relative z-10 h-4 w-full cursor-pointer appearance-none bg-transparent accent-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 focus-visible:ring-offset-4 focus-visible:ring-offset-background disabled:cursor-not-allowed [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-cyan-500 [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:mt-[-6px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:shadow-sm"
          />

          <div className="absolute inset-x-0 top-0 h-5" aria-hidden>
            {story.stages.map((stage, index) => {
              const markerPercent = story.durationMs === 0 ? 0 : (stage.offsetMs / story.durationMs) * 100;
              const isReached = index <= activeStageIndex;
              return (
                <span
                  key={stage.id}
                  className={cn(
                    "absolute top-0 h-2 w-px -translate-x-1/2 rounded-full",
                    isReached ? "bg-cyan-500" : "bg-foreground/20",
                  )}
                  style={{ left: `${markerPercent}%` }}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div
        className="relative grid grid-cols-2 gap-x-2 gap-y-3 sm:grid-cols-3 lg:grid-cols-6"
        role="list"
        aria-label="Incident stages"
      >
        <div
          aria-hidden
          className="absolute left-3 right-3 top-3 hidden h-px bg-foreground/10 lg:block"
        />
        {story.stages.map((stage, index) => {
          const presentation = getStagePresentation(stage.kind);
          const StageIcon = presentation.icon;
          const isActive = stage.id === activeStage.id;
          const isReached = index <= activeStageIndex;

          return (
            <div key={stage.id} role="listitem" className="relative z-10 min-w-0">
              <button
                type="button"
                aria-current={isActive ? "step" : undefined}
                aria-label={`Jump to ${stage.title} at ${formatPlaybackTime(stage.offsetMs)}`}
                onClick={() => handleStageSelect(stage)}
                className={cn(
                  "group/stage w-full rounded-xl p-2 text-left outline-none ring-offset-background transition-[background-color,opacity] duration-150 hover:transition-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 focus-visible:ring-offset-2",
                  isActive ? "bg-foreground/[0.07]" : "hover:bg-foreground/[0.04]",
                  !isReached && "opacity-55 hover:opacity-100",
                )}
              >
                <span
                  className={cn(
                    "mb-2 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-background transition-colors duration-150 group-hover/stage:transition-none",
                    isReached
                      ? "bg-cyan-500 text-primary-foreground"
                      : "bg-foreground/10 text-muted-foreground",
                  )}
                >
                  <StageIcon className="h-3.5 w-3.5" weight={isActive ? "fill" : "regular"} />
                </span>
                <span className="block truncate text-[10px] font-semibold uppercase tracking-wider text-foreground">
                  {stage.title}
                </span>
                <span className="mt-0.5 block font-mono text-[10px] tabular-nums text-muted-foreground">
                  {formatPlaybackTime(stage.offsetMs)}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      <motion.div
        key={activeStage.id}
        initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: "easeOut" }}
        className="relative overflow-hidden rounded-xl bg-foreground/[0.035] p-4 ring-1 ring-foreground/[0.07]"
        aria-live="polite"
        aria-atomic="true"
      >
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 w-1 bg-cyan-500"
        />
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-700 ring-1 ring-cyan-500/20 dark:text-cyan-300">
            <ActiveIcon className="h-4 w-4" weight="duotone" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <DesignBadge
                label={activePresentation.label}
                color={activePresentation.color}
                icon={ActiveIcon}
                size="sm"
              />
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                Stage {activeStageIndex + 1} of {story.stages.length}
              </span>
            </div>
            <h3 className="mt-2 text-sm font-semibold text-foreground">{activeStage.title}</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              {activeStage.summary}
            </p>
          </div>
        </div>
      </motion.div>
    </DesignCard>
  );
}
