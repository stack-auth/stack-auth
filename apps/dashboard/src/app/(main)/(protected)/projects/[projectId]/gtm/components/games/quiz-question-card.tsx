"use client";

import { DesignButton, DesignChoiceChip, type DesignChoiceChipState } from "@/components/design-components";
import { cn } from "@/components/ui";
import type { GrowthQuizQuestion } from "@/lib/growth/games/growth-games-types";
import { useReducedMotion } from "motion/react";
import { useState } from "react";

/**
 * One question, in either of its two states: awaiting an answer (options selectable, "Lock it in"
 * enabled once something is picked) or graded (options frozen, right and wrong marked).
 *
 * The graded state is driven entirely by `question.correctOptionId`, which the backend only sends
 * once this question has been answered — before that it is null and there is nothing here that could
 * reveal the answer even if someone read the DOM.
 */
export function QuizQuestionCard(props: {
  question: GrowthQuizQuestion,
  /** Set while the answer is in flight, so the options can't be changed mid-submit. */
  submitting: boolean,
  onSubmit: (optionId: string) => Promise<void>,
}) {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  const graded = props.question.answeredOptionId != null;
  const answeredWrong = graded && props.question.isCorrect === false;

  const stateFor = (optionId: string): DesignChoiceChipState => {
    if (!graded) return "neutral";
    if (optionId === props.question.correctOptionId) return "correct";
    return optionId === props.question.answeredOptionId ? "incorrect" : "neutral";
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-foreground/[0.08] bg-foreground/[0.02] p-4",
        // A short shake on a wrong answer. Non-essential motion, so it is skipped entirely under
        // prefers-reduced-motion — the red ring and the X marker carry the same information.
        answeredWrong && !reduceMotion && "animate-quiz-shake",
      )}
    >
      <p className="text-sm font-medium">{props.question.text}</p>
      <div className="mt-3 flex flex-col gap-1.5">
        {props.question.options.map((option) => (
          <DesignChoiceChip
            key={option.id}
            label={option.label}
            selected={graded ? option.id === props.question.answeredOptionId : option.id === selectedOptionId}
            interactive={!graded}
            disabled={props.submitting}
            state={stateFor(option.id)}
            onToggle={() => setSelectedOptionId(option.id)}
          />
        ))}
      </div>
      {!graded && (
        <div className="mt-3 flex justify-end">
          <DesignButton
            size="sm"
            disabled={selectedOptionId == null}
            onClick={async () => {
              // `disabled` above already prevents this, but the callback is async and the button
              // owns its own loading state — re-checking keeps the non-null assertion off the path.
              if (selectedOptionId == null) return;
              await props.onSubmit(selectedOptionId);
            }}
          >
            Lock it in
          </DesignButton>
        </div>
      )}
    </div>
  );
}
