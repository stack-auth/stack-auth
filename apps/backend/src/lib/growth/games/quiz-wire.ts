import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { formatQuizValue, QUIZ_VALUE_UNITS, type QuizFactOption, type QuizValueUnit } from "./quiz-facts";
import { maxQuizScore, quizRankFor } from "./quiz-scoring";

/**
 * The wire mapping for growth quiz games, questions, and rounds — and, more importantly, the single
 * place a stored question is allowed to become a customer-facing object.
 *
 * THE REDACTION BOUNDARY lives in `toWireQuestion`. `correctOptionId`, `trueValue`, and
 * `explanation` are the answer key; a customer must not see them until they have committed to an
 * answer, and a leak there would be completely invisible from the UI. Staff reviewing a draft go
 * through `toAdminWireQuestion` instead, which never redacts — reviewing the answer key is the
 * entire point of the review step.
 *
 * Both live here rather than next to their callers so the two functions sit side by side: the risk
 * is not that someone writes a bad redaction, it is that someone reaches for the admin one from a
 * customer route.
 */

// Structural row types rather than Prisma's generated model types, matching the convention in
// briefs.ts: they keep this module decoupled from the generated namespace and document exactly which
// columns the wire mapping reads.
export type QuizGameRow = {
  id: string,
  gameKey: string,
  status: string,
  textSource: string,
  questionCount: number,
  metricsAsOf: string | null,
  generationError: string | null,
  publishedAt: Date | null,
  createdAt: Date,
};

export type QuizQuestionRow = {
  id: string,
  orderIndex: number,
  metricId: string,
  factKind: string,
  questionText: string,
  explanation: string,
  options: unknown,
  correctOptionId: string,
  trueValue: number,
  unit: string,
};

export type QuizAnswerRow = {
  questionId: string,
  optionId: string,
  isCorrect: boolean,
  pointsAwarded: number,
};

export type QuizRoundRow = {
  id: string,
  gameId: string,
  status: string,
  score: number,
  correctCount: number,
  bestStreak: number,
  createdAt: Date,
  completedAt: Date | null,
};

/**
 * The `options` column is JSON, so Prisma types it as `unknown`. It is only ever written by
 * `buildQuizFacts`, so a shape mismatch means the column was corrupted out-of-band — an assertion,
 * not a user-facing error.
 */
export function readOptions(value: unknown, questionId: string): QuizFactOption[] {
  if (!Array.isArray(value)) {
    throw new HexclaveAssertionError(`GrowthQuizQuestion.options is not an array — it is only ever written by buildQuizFacts, so this row was corrupted.`, { questionId });
  }
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || typeof (entry as { id?: unknown }).id !== "string" || typeof (entry as { label?: unknown }).label !== "string") {
      throw new HexclaveAssertionError(`GrowthQuizQuestion.options contains an entry that is not { id, label }.`, { questionId });
    }
    return { id: (entry as { id: string }).id, label: (entry as { label: string }).label };
  });
}

/**
 * Narrows the stored `unit` string back into the catalog's vocabulary. The column is only ever
 * written from a catalog entry, so an unknown value means the row was corrupted out-of-band —
 * an assertion rather than a user-facing error, same as assertBriefStatus in briefs.ts.
 */
function assertQuizUnit(value: string): QuizValueUnit {
  return QUIZ_VALUE_UNITS.find((candidate) => candidate === value)
    ?? throwErr(new HexclaveAssertionError(`GrowthQuizQuestion.unit contained an unknown value "${value}" — units are only ever written from the metric catalog, so this should be impossible.`, { value }));
}

/**
 * The reveal shows the *exact* figure, unlike the options which are deliberately rounded to keep the
 * truth from standing out. Counts and cents are still shown whole — a fractional user does not exist.
 */
export function trueValueLabelOf(question: { trueValue: number, unit: string }): string {
  const unit = assertQuizUnit(question.unit);
  const value = unit === "count" || unit === "cents" ? Math.round(question.trueValue) : question.trueValue;
  return formatQuizValue(value, unit);
}

/**
 * CUSTOMER-FACING. An unanswered question ships its prompt and its options and nothing else; the
 * answer key appears only once `answer` is non-null, which is to say once the player has committed.
 *
 * `answer` being the existence of a GrowthQuizAnswer row — rather than a nullable column on the
 * question — is what makes this safe by construction: there is no state where the question row
 * "knows" it was answered but the caller forgot to pass the answer in.
 */
export function toWireQuestion(question: QuizQuestionRow, answer: QuizAnswerRow | null) {
  return {
    order_index: question.orderIndex,
    metric_id: question.metricId,
    fact_kind: question.factKind,
    text: question.questionText,
    options: readOptions(question.options, question.id),
    answered_option_id: answer?.optionId ?? null,
    // Everything below is null until this question has been answered. Never widen this without
    // updating quiz-wire.test.ts, which asserts the un-answered payload contains no answer key at all.
    correct_option_id: answer == null ? null : question.correctOptionId,
    is_correct: answer?.isCorrect ?? null,
    points_awarded: answer?.pointsAwarded ?? null,
    explanation: answer == null ? null : question.explanation,
    true_value_label: answer == null ? null : trueValueLabelOf(question),
  };
}

/**
 * STAFF-FACING. Never redacted: this is the review surface, and a reviewer who cannot see which
 * option is correct cannot tell whether the question is any good.
 *
 * Only reachable from the platform-admin routes under internal/growth/admin/games/**.
 */
export function toAdminWireQuestion(question: QuizQuestionRow) {
  return {
    order_index: question.orderIndex,
    metric_id: question.metricId,
    fact_kind: question.factKind,
    text: question.questionText,
    explanation: question.explanation,
    options: readOptions(question.options, question.id),
    correct_option_id: question.correctOptionId,
    true_value_label: trueValueLabelOf(question),
  };
}

export function toWireGame(game: QuizGameRow) {
  return {
    id: game.id,
    game_key: game.gameKey,
    status: game.status,
    text_source: game.textSource,
    question_count: game.questionCount,
    metrics_as_of: game.metricsAsOf,
    generation_error: game.generationError,
    published_at_millis: game.publishedAt == null ? null : game.publishedAt.getTime(),
    created_at_millis: game.createdAt.getTime(),
  };
}

export function toWireRound(round: QuizRoundRow, questions: QuizQuestionRow[], answers: QuizAnswerRow[]) {
  const answersByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]));
  const rank = quizRankFor(round.correctCount, questions.length);
  return {
    id: round.id,
    game_id: round.gameId,
    status: round.status,
    question_count: questions.length,
    answered_count: answers.length,
    score: round.score,
    max_score: maxQuizScore(questions.length),
    correct_count: round.correctCount,
    best_streak: round.bestStreak,
    rank_title: rank.title,
    rank_blurb: rank.blurb,
    created_at_millis: round.createdAt.getTime(),
    completed_at_millis: round.completedAt == null ? null : round.completedAt.getTime(),
    questions: questions.map((question) => toWireQuestion(question, answersByQuestionId.get(question.id) ?? null)),
  };
}

/** Round summary for the admin results block — no questions, so no answer key can ride along. */
export function toWireRoundSummary(round: QuizRoundRow, questionCount: number) {
  const rank = quizRankFor(round.correctCount, questionCount);
  return {
    id: round.id,
    game_id: round.gameId,
    status: round.status,
    question_count: questionCount,
    score: round.score,
    max_score: maxQuizScore(questionCount),
    correct_count: round.correctCount,
    best_streak: round.bestStreak,
    rank_title: rank.title,
    created_at_millis: round.createdAt.getTime(),
    completed_at_millis: round.completedAt == null ? null : round.completedAt.getTime(),
  };
}
