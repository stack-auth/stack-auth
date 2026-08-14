"use client";

import { DesignButton } from "@/components/design-components";
import { cn } from "@/components/ui";
import { CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react";

/**
 * The panel under a graded question: whether they got it, what the number actually was, and why the
 * metric is worth knowing.
 *
 * The real figure is the point of the whole game — a wrong answer is only useful if it comes with
 * the truth attached — so it is the largest thing in the panel regardless of the verdict.
 */
export function QuizReveal(props: {
  correct: boolean,
  line: string,
  trueValueLabel: string,
  explanation: string,
  pointsAwarded: number,
  isLastQuestion: boolean,
  onNext: () => Promise<void>,
}) {
  const Icon = props.correct ? CheckCircleIcon : XCircleIcon;
  return (
    <div
      className={cn(
        "mt-3 rounded-2xl border p-4",
        props.correct
          ? "border-emerald-500/40 bg-emerald-500/[0.06]"
          : "border-destructive/40 bg-destructive/[0.06]",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon
          size={18}
          weight="fill"
          aria-hidden
          className={cn("mt-0.5 shrink-0", props.correct ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}
        />
        <div className="flex flex-col gap-1">
          {/* The verdict is stated in words as well as colour and icon, so it survives both
              prefers-reduced-motion and a reader who cannot tell the two tints apart. */}
          <p className="text-sm font-medium">
            {props.correct ? "Correct." : "Not quite."} {props.line}
          </p>
          <p className="text-sm text-muted-foreground">
            The real number is <span className="font-semibold tabular-nums text-foreground">{props.trueValueLabel}</span>.
          </p>
          <p className="text-xs text-muted-foreground">{props.explanation}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {props.pointsAwarded > 0 ? `+${props.pointsAwarded} points` : "No points"}
        </span>
        <DesignButton size="sm" variant="outline" onClick={props.onNext}>
          {props.isLastQuestion ? "See your score" : "Next question"}
        </DesignButton>
      </div>
    </div>
  );
}
