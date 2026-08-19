/**
 * Presentation-side helpers for a quiz round.
 *
 * Scoring itself is authoritative on the backend (lib/growth/games/quiz-scoring.ts) — the dashboard
 * renders the score the server returns and never computes its own total. What lives here is only
 * what the server does not send: accuracy formatting and progress arithmetic.
 */

/** `correctCount / questionCount` as a whole percentage. `questionCount` of 0 cannot happen (the DB forbids it), but is handled rather than dividing by zero. */
export function quizAccuracyPercent(correctCount: number, questionCount: number): number {
  return questionCount === 0 ? 0 : Math.round((correctCount / questionCount) * 100);
}

/** "Question 3 of 8" — the header's position readout, 1-based for humans. */
export function quizProgressLabel(answeredCount: number, questionCount: number): string {
  return `Question ${Math.min(answeredCount + 1, questionCount)} of ${questionCount}`;
}

/**
 * Whether the end-of-round celebration should fire. Deliberately not "any correct answer": confetti
 * on every question is the difference between a game and a slot machine, and DESIGN-GUIDE §3.5 warns
 * against large animated movement in dense surfaces. Two thirds right is a real result.
 */
export const QUIZ_CELEBRATION_ACCURACY = 0.67;

export function shouldCelebrateQuizRound(correctCount: number, questionCount: number): boolean {
  return questionCount > 0 && correctCount / questionCount >= QUIZ_CELEBRATION_ACCURACY;
}
