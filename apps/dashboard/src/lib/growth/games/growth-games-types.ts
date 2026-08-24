/**
 * Domain types for Growth games.
 *
 * Wire bodies are snake_case and are mapped to these camelCase shapes in growth-games-api.ts (the
 * customer surface) and growth-games-admin-api.ts (the staff review surface), the same split
 * growth-types.ts / growth-api.ts uses for the rest of the app.
 */

/** Must match GROWTH_QUIZ_GAME_KEY in apps/backend/src/lib/growth/games/quiz-games.ts. */
export const GROWTH_QUIZ_GAME_KEY = "know_your_users";

export const GROWTH_QUIZ_GAME_STATUSES = ["generating", "draft", "published", "archived", "failed"] as const;
export type GrowthQuizGameStatus = typeof GROWTH_QUIZ_GAME_STATUSES[number];

export const GROWTH_QUIZ_ROUND_STATUSES = ["ready", "completed", "abandoned"] as const;
export type GrowthQuizRoundStatus = typeof GROWTH_QUIZ_ROUND_STATUSES[number];

export const GROWTH_QUIZ_TEXT_SOURCES = ["agent", "template"] as const;
export type GrowthQuizTextSource = typeof GROWTH_QUIZ_TEXT_SOURCES[number];

export const GROWTH_QUIZ_FACT_KINDS = [
  "latest_value",
  "window_sum",
  "window_change_pct",
  "peak_weekday",
  "rank_among",
  "ratio",
] as const;
export type GrowthQuizFactKind = typeof GROWTH_QUIZ_FACT_KINDS[number];

export type GrowthQuizOption = {
  id: string,
  label: string,
};

// ─── Customer surface ────────────────────────────────────────────────────────

/**
 * One question as the CUSTOMER sees it.
 *
 * `correctOptionId`, `explanation`, and `trueValueLabel` are null until the question has been
 * answered — the backend redacts them (see toWireQuestion in lib/growth/games/quiz-wire.ts). They
 * are typed nullable here rather than split into two types so the reveal can be rendered from the
 * same object the question was rendered from; a component that reads them must handle null.
 */
export type GrowthQuizQuestion = {
  orderIndex: number,
  metricId: string,
  factKind: GrowthQuizFactKind,
  text: string,
  options: GrowthQuizOption[],
  answeredOptionId: string | null,
  correctOptionId: string | null,
  isCorrect: boolean | null,
  pointsAwarded: number | null,
  explanation: string | null,
  trueValueLabel: string | null,
};

export type GrowthQuizRound = {
  id: string,
  gameId: string,
  status: GrowthQuizRoundStatus,
  questionCount: number,
  answeredCount: number,
  score: number,
  maxScore: number,
  correctCount: number,
  bestStreak: number,
  rankTitle: string,
  rankBlurb: string,
  createdAtMillis: number,
  completedAtMillis: number | null,
  questions: GrowthQuizQuestion[],
};

/** What the banner above the insights section renders. `game: null` means render nothing at all. */
export type GrowthPublishedQuiz = {
  game: {
    id: string,
    gameKey: string,
    questionCount: number,
    metricsAsOf: string | null,
    publishedAtMillis: number | null,
  } | null,
  round: {
    id: string,
    status: GrowthQuizRoundStatus,
    questionCount: number,
    answeredCount: number,
    score: number,
    maxScore: number,
    correctCount: number,
    rankTitle: string,
    completedAtMillis: number | null,
  } | null,
};

/** The graded response to one answer. The only customer payload that ever carries a correct option id. */
export type GrowthQuizAnswerResult = {
  correct: boolean,
  correctOptionId: string,
  explanation: string,
  trueValueLabel: string,
  pointsAwarded: number,
  streak: number,
  score: number,
  answeredCount: number,
  questionCount: number,
  isLastQuestion: boolean,
};

// ─── Staff review surface ────────────────────────────────────────────────────

/**
 * One question as STAFF sees it during review: never redacted, because a reviewer who cannot see
 * which option is correct cannot tell whether the question is any good.
 *
 * `text` and `explanation` are the only editable fields. The options, the correct one, and the true
 * value are computed from real metric rows and have no write path at all.
 */
export type GrowthQuizAdminQuestion = {
  orderIndex: number,
  metricId: string,
  factKind: GrowthQuizFactKind,
  text: string,
  explanation: string,
  options: GrowthQuizOption[],
  correctOptionId: string,
  trueValueLabel: string,
};

export type GrowthQuizAdminGame = {
  id: string,
  gameKey: string,
  status: GrowthQuizGameStatus,
  textSource: GrowthQuizTextSource,
  questionCount: number,
  metricsAsOf: string | null,
  generationError: string | null,
  publishedAtMillis: number | null,
  createdAtMillis: number,
  questions: GrowthQuizAdminQuestion[],
};

/** One customer playthrough, as staff sees it: the score plus which questions they got wrong. */
export type GrowthQuizAdminResult = {
  id: string,
  gameId: string,
  status: GrowthQuizRoundStatus,
  questionCount: number,
  score: number,
  maxScore: number,
  correctCount: number,
  bestStreak: number,
  rankTitle: string,
  createdAtMillis: number,
  completedAtMillis: number | null,
  answers: {
    orderIndex: number,
    metricId: string,
    answered: boolean,
    isCorrect: boolean | null,
  }[],
};

export type GrowthQuizAdminBody = {
  draft: GrowthQuizAdminGame | null,
  published: GrowthQuizAdminGame | null,
  results: GrowthQuizAdminResult[],
};
