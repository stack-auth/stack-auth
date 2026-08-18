/**
 * PURE: the scoring rules for a growth quiz round.
 *
 * Lives on the backend because scoring is authoritative — the dashboard renders the score the
 * server returns rather than computing its own, so a tampered client cannot invent a total. The
 * dashboard has its own copy of the *presentation* half (rank titles), and quiz-scoring.test.ts on
 * each side pins the shared constants so the two cannot drift apart unnoticed.
 */

/** Points for a correct answer before any streak bonus. */
export const QUIZ_BASE_POINTS = 100;
/** Extra points per consecutive correct answer beyond the first, capped by QUIZ_MAX_STREAK_BONUS. */
export const QUIZ_STREAK_BONUS_STEP = 25;
export const QUIZ_MAX_STREAK_BONUS = 100;

/**
 * Points for one answer. A wrong answer scores zero rather than subtracting: the game is meant to
 * teach someone their own numbers, and a negative running total reads as punishment for playing.
 */
export function scoreQuizAnswer(input: { isCorrect: boolean, streakBeforeAnswer: number }): number {
  if (!input.isCorrect) return 0;
  const bonus = Math.min(input.streakBeforeAnswer * QUIZ_STREAK_BONUS_STEP, QUIZ_MAX_STREAK_BONUS);
  return QUIZ_BASE_POINTS + bonus;
}

/** The best score a round of this length can produce. Used to render "1,150 / 1,400". */
export function maxQuizScore(questionCount: number): number {
  let total = 0;
  for (let index = 0; index < questionCount; index++) {
    total += scoreQuizAnswer({ isCorrect: true, streakBeforeAnswer: index });
  }
  return total;
}

export const QUIZ_RANKS = [
  { minAccuracy: 1, title: "Mind Reader", blurb: "A perfect round. You know these numbers cold." },
  { minAccuracy: 0.8, title: "Data Whisperer", blurb: "You live in this dashboard, and it shows." },
  { minAccuracy: 0.6, title: "Pattern Spotter", blurb: "Solid instincts. The details are where you slipped." },
  { minAccuracy: 0.4, title: "Rough Sketcher", blurb: "You know the shape of your product, not the size of it." },
  { minAccuracy: 0, title: "Optimist", blurb: "Worth a look at your metrics page before the next round." },
] as const;

export type QuizRank = { title: string, blurb: string };

/** `correctCount / questionCount` → the round's rank. `questionCount` of 0 is unreachable (the DB CHECK forbids it). */
export function quizRankFor(correctCount: number, questionCount: number): QuizRank {
  const accuracy = questionCount === 0 ? 0 : correctCount / questionCount;
  // QUIZ_RANKS is ordered high-to-low and its last entry has minAccuracy 0, so some entry always
  // matches — the non-null assertion the `find` API would otherwise need is avoided by construction.
  const rank = QUIZ_RANKS.find((entry) => accuracy >= entry.minAccuracy) ?? QUIZ_RANKS[QUIZ_RANKS.length - 1];
  return { title: rank.title, blurb: rank.blurb };
}
