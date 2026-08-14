"use client";

import { DesignButton } from "@/components/design-components";
import type { GrowthPublishedQuiz } from "@/lib/growth/games/growth-games-types";
import { GameControllerIcon } from "@phosphor-icons/react";

/**
 * The customer's only entry point to the quiz: a strip directly above the insights section, shown
 * when Hexclave staff have published a quiz for this project.
 *
 * There is no Games page and no nav item — a quiz is something a customer is offered, not something
 * they go looking for. That also means this banner is the only place a finished score lives, hence
 * the completed state rather than simply hiding once played.
 *
 * Written in the same register as the section it sits above, not as an ad: PRODUCT.md's brand is
 * "precise, calm", and the playful part of this feature belongs inside the dialog.
 */
export function QuizBanner(props: {
  published: GrowthPublishedQuiz,
  onPlay: () => void,
}) {
  const game = props.published.game;
  // Nothing published — render nothing at all rather than an empty state. There is nothing here for
  // the customer to do anything about.
  if (game == null) return null;

  const round = props.published.round;
  const completed = round != null && round.status === "completed";
  const inProgress = round != null && round.status === "ready";

  const headline = completed
    ? `You scored ${round.score} of ${round.maxScore} — ${round.rankTitle.toLowerCase()}.`
    : inProgress
      ? `You're ${round.answeredCount} of ${round.questionCount} questions in.`
      : "How well do you know your users?";

  const detail = completed
    ? `${round.correctCount} of ${round.questionCount} right.`
    : inProgress
      ? "Pick up where you left off."
      : `${game.questionCount} questions about your own numbers. No peeking at the metrics page.`;

  return (
    <div className="mx-auto mb-6 flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-foreground/[0.1] bg-foreground/[0.02] px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="relative mt-0.5 flex shrink-0 items-center justify-center">
          <GameControllerIcon className="size-4 text-muted-foreground" aria-hidden />
          {/* Unread dot, same idiom as an unread daily brief (brief-card.tsx). Only while the quiz
              is genuinely new — once they have started, the headline itself carries the state. */}
          {round == null && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-cyan-500" aria-label="New" />}
        </span>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium">{headline}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
      <DesignButton size="sm" variant={completed ? "outline" : "default"} onClick={props.onPlay}>
        {completed ? "See your answers" : inProgress ? "Resume" : "Play"}
      </DesignButton>
    </div>
  );
}
