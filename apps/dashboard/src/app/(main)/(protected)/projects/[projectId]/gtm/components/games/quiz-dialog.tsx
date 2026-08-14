"use client";

import { DesignAlert, DesignButton, DesignDialog } from "@/components/design-components";
import {
  finishGrowthQuizRound,
  getGrowthQuizRound,
  startGrowthQuizRound,
  submitGrowthQuizAnswer,
} from "@/lib/growth/games/growth-games-api";
import { gameMasterAnswerLine, pickGameMasterLine } from "@/lib/growth/games/game-master-copy";
import type { GrowthQuizAnswerResult, GrowthQuizRound } from "@/lib/growth/games/growth-games-types";
import { quizProgressLabel } from "@/lib/growth/games/quiz-display";
import { buildGrowthDemoQuizRound } from "@/lib/growth/growth-demo-data";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useCallback, useEffect, useState } from "react";
import { useAdminApp } from "../../../use-admin-app";
import { GameMasterHeader } from "./game-master";
import { QuizQuestionCard } from "./quiz-question-card";
import { QuizReveal } from "./quiz-reveal";
import { QuizScoreboard } from "./quiz-scoreboard";

/**
 * One playthrough, in a dialog over the insights page.
 *
 * The round object returned by the API is the single source of truth for where the player is: the
 * current question is the first unanswered one, and a finished round is one where none are left.
 * Deriving position from the data rather than tracking a separate index is what makes resuming work
 * without any extra code — the same render that handles a fresh round handles a half-finished one,
 * including one abandoned in another tab yesterday.
 */

type RoundState =
  | { status: "starting" }
  | { status: "error", message: string }
  | { status: "playing", round: GrowthQuizRound, reveal: GrowthQuizAnswerResult | null };

function StartingSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Opening your round">
      <div className="h-20 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
      <div className="h-52 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
    </div>
  );
}

function QuizRunner(props: { demo: boolean, onRoundChanged: () => void }) {
  const app = useAdminApp();
  const [state, setState] = useState<RoundState>({ status: "starting" });
  const [submitting, setSubmitting] = useState(false);

  const beginRound = useCallback(async () => {
    setState({ status: "starting" });
    if (props.demo) {
      setState({ status: "playing", round: buildGrowthDemoQuizRound(), reveal: null });
      return;
    }
    try {
      // Safe to call on every open: the backend hands back the round already in progress rather than
      // minting a second one, so this doubles as the resume path.
      setState({ status: "playing", round: await startGrowthQuizRound(app), reveal: null });
    } catch (error) {
      captureError("growth-quiz-start", error);
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [app, props.demo]);

  useEffect(() => {
    runAsynchronously(beginRound());
  }, [beginRound]);

  const submitAnswer = async (orderIndex: number, optionId: string) => {
    if (state.status !== "playing") return;
    const roundId = state.round.id;
    setSubmitting(true);
    try {
      const result = await submitGrowthQuizAnswer(app, roundId, { orderIndex, optionId });
      // Re-fetched rather than patched locally: the reveal response deliberately does not carry the
      // whole round, and the server is the only place that knows the graded question's true value
      // label and running totals.
      const round = await getGrowthQuizRound(app, roundId);
      setState({ status: "playing", round, reveal: result });
      props.onRoundChanged();
    } catch (error) {
      captureError("growth-quiz-answer", error);
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setSubmitting(false);
    }
  };

  const advance = async () => {
    if (state.status !== "playing") return;
    const round = state.round;
    const allAnswered = round.questions.every((question) => question.answeredOptionId != null);
    if (!allAnswered) {
      setState({ status: "playing", round, reveal: null });
      return;
    }
    if (props.demo) {
      setState({ status: "playing", round: { ...round, status: "completed" }, reveal: null });
      return;
    }
    try {
      setState({ status: "playing", round: await finishGrowthQuizRound(app, round.id), reveal: null });
      props.onRoundChanged();
    } catch (error) {
      captureError("growth-quiz-finish", error);
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  if (state.status === "starting") return <StartingSkeleton />;

  if (state.status === "error") {
    return (
      <DesignAlert variant="error">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>Something went wrong mid-round: {state.message}</span>
          <DesignButton variant="outline" size="sm" onClick={beginRound}>Try again</DesignButton>
        </div>
      </DesignAlert>
    );
  }

  const round = state.round;
  if (round.status === "completed") {
    // No "play again": the quiz is a published artefact, and replaying the same eight questions with
    // the answers already revealed is not a game. The next one arrives when staff publish it.
    return <QuizScoreboard round={round} />;
  }

  // The current question is whichever one is being revealed, or else the first unanswered one.
  const current = state.reveal != null
    ? round.questions[state.reveal.answeredCount - 1]
    : round.questions.find((question) => question.answeredOptionId == null);

  if (current == null) {
    // Every question is answered but the round has not been finalized — the finish call is the next
    // step, not an error. Reachable after a reload between the last answer and the finish request.
    return (
      <div className="flex justify-center">
        <DesignButton onClick={advance}>See your score</DesignButton>
      </div>
    );
  }

  const answeredCount = round.questions.filter((question) => question.answeredOptionId != null).length;

  return (
    <div className="flex flex-col gap-4">
      <GameMasterHeader
        progressLabel={quizProgressLabel(state.reveal == null ? answeredCount : answeredCount - 1, round.questionCount)}
        answeredCount={answeredCount}
        questionCount={round.questionCount}
        score={round.score}
        streak={state.reveal?.correct === true ? state.reveal.streak : 0}
        // The header carries the ambient line for the round; the verdict belongs to the reveal panel,
        // next to the number it is a verdict about.
        line={pickGameMasterLine("roundStart", round.id)}
      />

      <QuizQuestionCard
        key={current.orderIndex}
        question={current}
        submitting={submitting}
        onSubmit={async (optionId) => await submitAnswer(current.orderIndex, optionId)}
      />

      {state.reveal != null && (
        <QuizReveal
          correct={state.reveal.correct}
          line={gameMasterAnswerLine({
            correct: state.reveal.correct,
            // The streak the player carried INTO this question — the response reports the streak
            // after it, so a correct answer's "before" is one less, and a wrong answer broke
            // whatever the round's running best was.
            streakBefore: state.reveal.correct ? state.reveal.streak - 1 : round.bestStreak,
            seed: `${round.id}:${current.orderIndex}`,
          })}
          trueValueLabel={state.reveal.trueValueLabel}
          explanation={state.reveal.explanation}
          pointsAwarded={state.reveal.pointsAwarded}
          isLastQuestion={state.reveal.isLastQuestion}
          onNext={advance}
        />
      )}
    </div>
  );
}

export function QuizDialog(props: {
  open: boolean,
  demo: boolean,
  onOpenChange: (open: boolean) => void,
  /** Called after any write, so the banner behind the dialog reflects the new progress on close. */
  onRoundChanged: () => void,
}) {
  return (
    <DesignDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="How well do you know your users?"
      description="Every number in here is your own. No peeking at the metrics page."
      size="lg"
    >
      {/* Mounted only while open so each opening starts (or resumes) cleanly, rather than holding a
          stale round from a previous session in state. */}
      {props.open && <QuizRunner demo={props.demo} onRoundChanged={props.onRoundChanged} />}
    </DesignDialog>
  );
}
