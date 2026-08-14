"use client";

import { Confetti } from "@/components/confetti";
import { DesignBadge } from "@/components/design-components";
import { cn } from "@/components/ui";
import type { GrowthQuizRound } from "@/lib/growth/games/growth-games-types";
import { quizAccuracyPercent, shouldCelebrateQuizRound } from "@/lib/growth/games/quiz-display";
import { useReducedMotion } from "motion/react";

/**
 * End-of-round summary: rank, score, accuracy, and a per-question recap so a wrong answer is a thing
 * you can learn from rather than just a lost point.
 *
 * Confetti fires here and only here, and only above QUIZ_CELEBRATION_ACCURACY. Per-question
 * celebration was deliberately not built: it would turn the section into a slot machine, and
 * DESIGN-GUIDE §3.5 warns against large animated movement in dense surfaces.
 */
export function QuizScoreboard(props: { round: GrowthQuizRound }) {
  const reduceMotion = useReducedMotion();
  const accuracy = quizAccuracyPercent(props.round.correctCount, props.round.questionCount);
  const celebrate = shouldCelebrateQuizRound(props.round.correctCount, props.round.questionCount);

  return (
    <div className="flex flex-col gap-4">
      {celebrate && reduceMotion !== true && <Confetti />}

      <div className="rounded-2xl border border-foreground/[0.08] bg-foreground/[0.02] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Final rank</span>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{props.round.rankTitle}</h2>
            <p className="text-sm text-muted-foreground">{props.round.rankBlurb}</p>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-2xl font-semibold tabular-nums">{props.round.score.toLocaleString("en-US")}</span>
            <span className="text-xs text-muted-foreground tabular-nums">of {props.round.maxScore.toLocaleString("en-US")} points</span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <DesignBadge label={`${props.round.correctCount} of ${props.round.questionCount} right`} color={accuracy >= 60 ? "green" : "orange"} size="sm" />
          <DesignBadge label={`${accuracy}% accuracy`} color="blue" size="sm" />
          {props.round.bestStreak >= 2 && <DesignBadge label={`Best streak: ${props.round.bestStreak}`} color="orange" size="sm" />}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">How it went</span>
        {props.round.questions.map((question) => (
          <div
            key={question.orderIndex}
            className={cn(
              "flex flex-col gap-1 rounded-xl border px-3 py-2",
              question.isCorrect === true
                ? "border-emerald-500/30 bg-emerald-500/[0.04]"
                : "border-destructive/30 bg-destructive/[0.04]",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm">{question.text}</span>
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {question.isCorrect === true ? "Right" : "Wrong"}
              </span>
            </div>
            {/* trueValueLabel is non-null for every answered question; a finished round has no
                unanswered ones, so the fallback is unreachable in practice and exists only so a
                partially-loaded round cannot render "undefined". */}
            <span className="text-xs text-muted-foreground">
              Answer: <span className="font-medium tabular-nums text-foreground">{question.trueValueLabel ?? "—"}</span>
            </span>
          </div>
        ))}
      </div>

      {/* No "play again": the quiz is a published artefact, and replaying the same questions with the
          answers already revealed is not a game. The next one arrives when Hexclave publishes it. */}
    </div>
  );
}
