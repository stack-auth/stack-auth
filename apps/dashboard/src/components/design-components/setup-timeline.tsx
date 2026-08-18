"use client";

import { Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { DesignButton } from "@hexclave/dashboard-ui-components";
import { CheckIcon, WarningIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

/**
 * A vertical, numbered setup timeline with real per-step state.
 *
 * The visual language is copied from the project-setup page's inline timeline
 * (app/(main)/(protected)/projects/[projectId]/(overview)/setup-page.tsx) so the two read as the
 * same component to a user, but this one is a real component with state rather than a hardcoded
 * list, and it fixes a positioning bug in the original: there, the step circle is
 * `absolute ... -start-4` while the nearest `relative` ancestor is the `<ol>`, not the `<li>`, so
 * every circle stacks at the top of the list. Here each `<li>` is `relative`, so a circle positions
 * against its own row.
 *
 * Purely presentational — deciding which step is `current` is the caller's job, which keeps that
 * logic in a plain function that can be unit-tested without rendering anything.
 */

export type SetupTimelineStepState =
  /** Finished. Shows a check instead of its number. */
  | "done"
  /** The one thing the user should do next. Exactly one step should normally have this. */
  | "current"
  /** Not reached yet. Rendered dimmed rather than hidden, so the user can see what's coming. */
  | "todo"
  /** Reached, but something is wrong that the user must fix — a declined scope, a missing payment method. */
  | "blocked";

export type SetupTimelineStep = {
  id: string,
  title: string,
  state: SetupTimelineStepState,
  description?: ReactNode,
  content?: ReactNode,
  action?: {
    label: string,
    /** Async handlers are fine — DesignButton manages its own loading state for them. */
    onClick: () => void | Promise<void>,
    variant?: "primary" | "secondary",
  },
};

function StepCircle(props: { state: SetupTimelineStepState, index: number }) {
  const base = "absolute flex items-center justify-center w-8 h-8 rounded-full -start-4 ring-4 ring-white dark:ring-zinc-900";

  switch (props.state) {
    case "done": {
      return (
        <span className={cn(base, "bg-emerald-100 dark:bg-emerald-900/60")} aria-hidden>
          <CheckIcon className="w-4 h-4 text-emerald-700 dark:text-emerald-300" weight="bold" />
        </span>
      );
    }
    case "blocked": {
      return (
        <span className={cn(base, "bg-amber-100 dark:bg-amber-900/60")} aria-hidden>
          <WarningIcon className="w-4 h-4 text-amber-700 dark:text-amber-300" weight="bold" />
        </span>
      );
    }
    case "current": {
      return (
        <span className={cn(base, "bg-zinc-900 dark:bg-zinc-100")} aria-hidden>
          <span className="text-white dark:text-zinc-900 font-semibold text-sm">{props.index + 1}</span>
        </span>
      );
    }
    case "todo": {
      return (
        <span className={cn(base, "bg-zinc-100 dark:bg-zinc-800")} aria-hidden>
          <span className="text-zinc-500 dark:text-zinc-400 font-semibold text-sm">{props.index + 1}</span>
        </span>
      );
    }
  }
}

const STEP_STATE_LABELS: Record<SetupTimelineStepState, string> = {
  done: "completed",
  current: "current step",
  todo: "not started",
  blocked: "needs attention",
};

export function SetupTimeline(props: { steps: SetupTimelineStep[], className?: string }) {
  return (
    <ol className={cn("relative border-s border-gray-200 dark:border-gray-700", props.className)}>
      {props.steps.map((step, index) => (
        // Two things have to be true at once here, and they interact:
        //   - `relative` on the <li> (not just the <ol>) is what makes each circle align to its own
        //     row. The original inline timeline omits it, so all of its circles stack at the top.
        //   - Because of that, the circle's `-start-4` is now measured from THIS row's box, so the
        //     circle spans -16px..+16px within it. Spacing the content with a margin (as the
        //     original does) would leave the text starting at 0 and sitting under the circle, so the
        //     content is inset with padding instead: the row's box still lines up with the connector
        //     line, the circle stays centred on it, and the text starts clear of it.
        <li
          key={step.id}
          className={cn(
            "relative ps-10 flex flex-col lg:flex-row gap-6 lg:gap-10",
            index === props.steps.length - 1 ? "mb-0" : "mb-12",
          )}
        >
          <StepCircle state={step.state} index={index} />

          <div className="flex flex-col justify-start gap-1 lg:max-w-[180px] lg:min-w-[180px]">
            <h3 className={cn("font-medium leading-tight", step.state === "todo" && "text-muted-foreground")}>
              {step.title}
            </h3>
            {/* The state is visible only through colour and iconography, so name it for screen readers. */}
            <span className="sr-only">{STEP_STATE_LABELS[step.state]}</span>
            {step.description != null && (
              <Typography variant="secondary" type="footnote">{step.description}</Typography>
            )}
          </div>

          <div
            className={cn(
              "flex min-w-0 flex-grow flex-col gap-4",
              // Dimmed rather than hidden: seeing what's coming is useful, and collapsing the row
              // would make the timeline jump as steps complete.
              step.state === "todo" && "opacity-50",
            )}
          >
            {step.content}
            {step.action != null && (
              <div className="flex">
                <DesignButton
                  onClick={step.action.onClick}
                  variant={step.action.variant === "secondary" ? "secondary" : "default"}
                  disabled={step.state === "todo"}
                >
                  {step.action.label}
                </DesignButton>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
