import { describe, expect, it } from "vitest";
import { longestStreak, streakBefore } from "./quiz-rounds";
import type { QuizAnswerRow, QuizQuestionRow } from "./quiz-wire";

/**
 * The streak arithmetic behind the scoring bonus, exercised directly.
 *
 * Answers now live in their own table keyed by question id, so these helpers join the two lists
 * rather than reading a column — which means a question with no answer row and a question answered
 * out of order are different shapes, and both have to be handled.
 */

function questions(count: number): QuizQuestionRow[] {
  return Array.from({ length: count }, (_, orderIndex) => ({
    id: `q${orderIndex}`,
    orderIndex,
    metricId: "new_users",
    factKind: "window_sum",
    questionText: "How many?",
    explanation: "Because.",
    options: [{ id: "o0", label: "1" }, { id: "o1", label: "2" }],
    correctOptionId: "o0",
    trueValue: 1,
    unit: "count",
  }));
}

/** `results[i]` is the verdict for question i; null means unanswered (no row at all). */
function answers(results: (boolean | null)[]): QuizAnswerRow[] {
  return results.flatMap((isCorrect, index) => isCorrect == null ? [] : [{
    questionId: `q${index}`,
    optionId: isCorrect ? "o0" : "o1",
    isCorrect,
    pointsAwarded: isCorrect ? 100 : 0,
  }]);
}

describe("streakBefore", () => {
  it("counts back only through consecutive correct answers", () => {
    expect(streakBefore(questions(4), answers([true, true, true, null]), 3)).toBe(3);
    expect(streakBefore(questions(4), answers([true, false, true, null]), 3)).toBe(1);
    expect(streakBefore(questions(4), answers([false, false, false, null]), 3)).toBe(0);
  });

  it("is zero for the first question", () => {
    expect(streakBefore(questions(1), answers([null]), 0)).toBe(0);
  });

  it("treats a question with no answer row as ending the run", () => {
    // Reachable only if answers were graded out of order, which submitQuizAnswer forbids. The
    // conservative reading is the right one: a gap means no run is in progress, so the streak is 0
    // rather than reaching back over the gap and awarding a bonus that was never earned.
    expect(streakBefore(questions(3), answers([true, null, true]), 2)).toBe(0);
  });
});

describe("longestStreak", () => {
  it("finds the best run in the round, not the last one", () => {
    expect(longestStreak(questions(5), answers([true, true, true, false, true]))).toBe(3);
    expect(longestStreak(questions(5), answers([false, true, true, true, true]))).toBe(4);
    expect(longestStreak(questions(2), answers([false, false]))).toBe(0);
    expect(longestStreak([], [])).toBe(0);
  });

  it("treats a missing answer row as breaking the run", () => {
    expect(longestStreak(questions(4), answers([true, null, true, true]))).toBe(2);
  });

  it("matches answers by question id, not by position", () => {
    // The answers list comes back ordered by when it was written, which is not the question order
    // once a round is resumed. Reversing the answer list must not change the result.
    const asked = questions(4);
    const graded = answers([true, true, false, true]);
    expect(longestStreak(asked, [...graded].reverse())).toBe(longestStreak(asked, graded));
  });
});
