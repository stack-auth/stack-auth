"use client";

import { cn } from "@/components/ui";
import { CheckIcon, XIcon } from "@phosphor-icons/react";

/**
 * A single selectable answer in a question — one full-width row with a radio/checkbox-style marker,
 * a label, and an optional description.
 *
 * Extracted from the growth interview's page-local `OptionChip` when the Games quiz needed the same
 * control (DESIGN-GUIDE §12: a reusable visual pattern belongs in design-components, not copied into
 * a second page). The quiz added the `state` prop — the interview only ever needs "neutral".
 */

export type DesignChoiceChipState = "neutral" | "correct" | "incorrect";

export type DesignChoiceChipProps = {
  label: string,
  description?: string | null,
  selected: boolean,
  /** False renders the chip read-only (a past answer), keeping it legible but visibly inert. */
  interactive: boolean,
  disabled?: boolean,
  /**
   * Post-answer grading. "correct" marks the right answer whether or not the player chose it, so a
   * wrong answer shows both what they picked and what they should have picked.
   */
  state?: DesignChoiceChipState,
  onToggle?: () => void,
};

const STATE_CONTAINER_CLASSES: Record<DesignChoiceChipState, string> = {
  neutral: "",
  correct: "border-emerald-500/50 bg-emerald-500/[0.08]",
  incorrect: "border-destructive/50 bg-destructive/[0.08]",
};

const STATE_MARKER_CLASSES: Record<DesignChoiceChipState, string> = {
  neutral: "",
  correct: "border-emerald-500 bg-emerald-500 text-white",
  incorrect: "border-destructive bg-destructive text-destructive-foreground",
};

export function DesignChoiceChip(props: DesignChoiceChipProps) {
  const state = props.state ?? "neutral";
  const disabled = props.disabled ?? false;
  const graded = state !== "neutral";

  return (
    <button
      type="button"
      disabled={!props.interactive || disabled}
      onClick={props.onToggle}
      aria-pressed={props.selected}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left text-sm",
        // Hover-exit only, per DESIGN-GUIDE §3.5: the colour settles back over 150ms when the
        // pointer leaves, but entering is instant so the control never feels like it lags a click.
        "transition-colors duration-150 hover:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        props.selected
          ? "border-primary/40 bg-primary/[0.08] text-foreground"
          : "border-foreground/[0.08] bg-foreground/[0.02] text-foreground",
        props.interactive && !disabled && !props.selected && "hover:bg-foreground/[0.05]",
        !props.interactive && !props.selected && !graded && "opacity-60",
        // Grading wins over selection: after an answer, what matters is right vs wrong, not what the
        // pointer last touched.
        STATE_CONTAINER_CLASSES[state],
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          props.selected ? "border-primary bg-primary text-primary-foreground" : "border-foreground/[0.25]",
          STATE_MARKER_CLASSES[state],
        )}
      >
        {state === "correct" && <CheckIcon size={10} weight="bold" />}
        {state === "incorrect" && <XIcon size={10} weight="bold" />}
        {state === "neutral" && props.selected && <CheckIcon size={10} weight="bold" />}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{props.label}</span>
        {props.description != null && <span className="text-xs text-muted-foreground">{props.description}</span>}
      </span>
      {/* The grading marker is a shape, not just a colour — DESIGN-GUIDE §8: correct/incorrect must
          stay readable for someone who cannot distinguish the green from the red. */}
      {graded && <span className="sr-only">{state === "correct" ? "Correct answer" : "Incorrect answer"}</span>}
    </button>
  );
}
