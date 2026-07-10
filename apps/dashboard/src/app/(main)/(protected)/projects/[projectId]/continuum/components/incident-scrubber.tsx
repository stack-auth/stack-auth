"use client";

import { ArrowCounterClockwiseIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react";
import type { ContinuumIncidentStory } from "../fixtures/types";

/**
 * Minimal transport bar. Stage markers are unlabeled ticks on the track itself
 * (labels overlapped badly since acts cluster near the start); the active act
 * is announced once, next to the time.
 */
export function IncidentScrubber({
  story,
  elapsedMs,
  isPlaying,
  waitingOnGate,
  activeStageId,
  formatTime,
  onElapsedChange,
  onPlayingChange,
  onRestart,
}: {
  story: ContinuumIncidentStory,
  elapsedMs: number,
  isPlaying: boolean,
  waitingOnGate: boolean,
  activeStageId: string,
  formatTime: (elapsedMs: number) => string,
  onElapsedChange: (elapsedMs: number) => void,
  onPlayingChange: (isPlaying: boolean) => void,
  onRestart: () => void,
}) {
  const activeStage = story.stages.find((stage) => stage.id === activeStageId);
  const progressPercent = (elapsedMs / story.durationMs) * 100;

  return (
    <div className="rounded-lg border border-black/[0.08] px-3 py-2.5 dark:border-white/[0.08]">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          disabled={waitingOnGate || elapsedMs >= story.durationMs}
          onClick={() => onPlayingChange(!isPlaying)}
          className="flex size-7 shrink-0 items-center justify-center rounded-md border border-black/[0.08] text-foreground transition-colors duration-150 hover:bg-black/[0.04] hover:transition-none disabled:opacity-40 dark:border-white/[0.08] dark:hover:bg-white/[0.06]"
        >
          {isPlaying ? <PauseIcon className="size-3.5" weight="fill" /> : <PlayIcon className="size-3.5" weight="fill" />}
        </button>
        <button
          type="button"
          aria-label="Restart"
          onClick={onRestart}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-black/[0.04] hover:text-foreground hover:transition-none dark:hover:bg-white/[0.06]"
        >
          <ArrowCounterClockwiseIcon className="size-3.5" />
        </button>

        {/* Track with stage ticks baked in */}
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center">
            <div className="relative h-1 w-full rounded-full bg-black/[0.08] dark:bg-white/[0.1]">
              <div
                className={`absolute inset-y-0 left-0 rounded-full ${waitingOnGate ? "bg-amber-500" : "bg-[#7c6cff]"}`}
                style={{ width: `${progressPercent}%` }}
              />
              {story.stages.map((stage) => (
                <span
                  key={stage.id}
                  className={[
                    "absolute top-1/2 size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full",
                    stage.gate != null
                      ? elapsedMs >= stage.offsetMs ? "bg-amber-500" : "bg-amber-500/50"
                      : elapsedMs >= stage.offsetMs ? "bg-[#7c6cff]" : "bg-black/20 dark:bg-white/25",
                  ].join(" ")}
                  style={{ left: `${(stage.offsetMs / story.durationMs) * 100}%` }}
                />
              ))}
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={story.durationMs}
            step={250}
            value={elapsedMs}
            aria-label="Playback position"
            onChange={(event) => onElapsedChange(event.currentTarget.valueAsNumber)}
            className="relative z-10 h-7 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
          />
        </div>

        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatTime(elapsedMs)} / {formatTime(story.durationMs)}
        </span>
      </div>

      {activeStage != null && (
        <p className="mt-1.5 truncate pl-[4.75rem] text-[11px] text-muted-foreground">
          Act {activeStage.act} · {activeStage.title}
          {waitingOnGate ? " — waiting on your decision" : ""}
        </p>
      )}
    </div>
  );
}
