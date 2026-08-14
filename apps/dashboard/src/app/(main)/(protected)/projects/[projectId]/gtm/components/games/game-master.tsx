"use client";

import { DesignProgressBar } from "@/components/design-components";
import { cn } from "@/components/ui";
import { FireIcon } from "@phosphor-icons/react";

/**
 * The quiz's header strip: where you are in the round, what you've scored, and one line from the
 * game master.
 *
 * This is the only place in the product that talks like a game show, and it stays inside the games
 * routes deliberately — PRODUCT.md's register is "precise, calm", and the section works because it
 * is an obvious, bounded exception to that rather than a leak of it.
 */
export function GameMasterHeader(props: {
  progressLabel: string,
  answeredCount: number,
  questionCount: number,
  score: number,
  streak: number,
  line: string,
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-foreground/[0.08] bg-foreground/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{props.progressLabel}</span>
        <div className="flex items-center gap-3">
          <StreakFlame streak={props.streak} />
          <span className="text-sm font-semibold tabular-nums">{props.score.toLocaleString("en-US")}<span className="ml-1 text-xs font-normal text-muted-foreground">pts</span></span>
        </div>
      </div>
      <DesignProgressBar value={props.answeredCount} max={props.questionCount} size="sm" />
      <p className="text-sm text-muted-foreground">{props.line}</p>
    </div>
  );
}

/**
 * The streak counter. Renders nothing below two in a row: a "streak: 1" badge is just a restatement
 * of the last answer, and showing it would make the real streak feel unearned when it arrives.
 */
export function StreakFlame(props: { streak: number }) {
  if (props.streak < 2) return null;
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full border border-orange-500/40 bg-orange-500/[0.1] px-2 py-0.5",
        "text-[11px] font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400",
      )}
    >
      <FireIcon size={11} weight="fill" aria-hidden />
      {props.streak} in a row
    </span>
  );
}
