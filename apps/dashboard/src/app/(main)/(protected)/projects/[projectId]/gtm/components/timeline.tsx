"use client";

import { cn } from "@/lib/utils";
import type { GrowthTimelineStepState } from "@/lib/growth/growth-timeline";
import { CheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

/**
 * Presentational primitives for the overview's vertical lifecycle timeline. Deliberately dumb: which
 * step is in which state is derived in lib/growth/growth-timeline.ts, and what each step contains is
 * decided by the overview — this file only owns the spine (markers, connectors, step shells).
 */

export function GrowthTimeline(props: { children: ReactNode }) {
  return <ol className="flex flex-col">{props.children}</ol>;
}

/** Every state the spine can render. "hidden" never reaches here — those steps return null. */
type VisibleStepState = Exclude<GrowthTimelineStepState, "hidden">;

function StepMarker(props: { state: VisibleStepState }) {
  switch (props.state) {
    case "done": {
      return (
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <CheckIcon weight="bold" className="size-3.5" />
        </div>
      );
    }
    case "current": {
      return (
        <div className="relative flex size-7 shrink-0 items-center justify-center rounded-full border border-cyan-500/50 bg-cyan-500/10">
          {/* The pulse is ambient (not information-bearing — the ring already marks the current step),
            * so it is motion-safe only. */}
          <span className="absolute size-2.5 rounded-full bg-cyan-500/40 motion-safe:animate-ping" />
          <span className="relative size-2.5 rounded-full bg-cyan-600 dark:bg-cyan-400" />
        </div>
      );
    }
    case "failed": {
      return (
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-destructive/40 bg-destructive/10 text-destructive">
          <WarningCircleIcon weight="fill" className="size-4" />
        </div>
      );
    }
    case "upcoming": {
      return (
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-foreground/[0.12] bg-foreground/[0.02]">
          <span className="size-2 rounded-full bg-foreground/[0.15]" />
        </div>
      );
    }
  }
}

/**
 * One step on the timeline. The marker column carries the state icon and, unless this is the last
 * step, a connector line down to the next marker (tinted green below completed steps so the "how far
 * am I" read works from the spine alone). `summary` renders inline next to the title — meant for the
 * compact one-line form of done steps — while `children` is the expanded content below the title.
 */
export function GrowthTimelineStep(props: {
  state: VisibleStepState,
  title: string,
  subtitle?: string,
  /** Inline content on the title row (compact done rows: the key fact + a quiet link). */
  summary?: ReactNode,
  /** Rendered next to the title, e.g. a status badge. */
  badge?: ReactNode,
  isLast?: boolean,
  children?: ReactNode,
}) {
  const { state } = props;
  const expanded = state === "current" || state === "failed";
  return (
    <li className="flex gap-3 sm:gap-4">
      <div className="flex flex-col items-center" aria-hidden>
        <StepMarker state={state} />
        {props.isLast !== true && (
          <div className={cn("w-px flex-1", state === "done" ? "bg-emerald-500/40" : "bg-foreground/[0.08]")} />
        )}
      </div>
      <div className={cn("min-w-0 flex-1", props.isLast === true ? "pb-0" : expanded ? "pb-8" : "pb-6")}>
        {/* min-h keeps single-line titles vertically centered on the size-7 marker. */}
        <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
          <span className={cn(
            "font-semibold tracking-tight",
            expanded ? "text-base text-foreground" : "text-sm",
            state === "done" && "text-foreground",
            state === "upcoming" && "text-muted-foreground/60",
          )}
          >
            {props.title}
          </span>
          {props.badge}
          {props.summary != null && <span className="min-w-0 text-sm text-muted-foreground">{props.summary}</span>}
        </div>
        {props.subtitle != null && (
          <p className={cn("mt-0.5 text-sm", state === "upcoming" ? "text-muted-foreground/50" : "text-muted-foreground")}>
            {props.subtitle}
          </p>
        )}
        {props.children != null && <div className="mt-3 flex flex-col gap-4">{props.children}</div>}
      </div>
    </li>
  );
}
