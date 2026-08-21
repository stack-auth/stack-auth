import { urlString } from "@hexclave/shared/dist/utils/urls";
import { z } from "zod";
import { requestJson } from "../growth-api-client";
import {
  GROWTH_QUIZ_FACT_KINDS,
  GROWTH_QUIZ_ROUND_STATUSES,
  type GrowthPublishedQuiz,
  type GrowthQuizAnswerResult,
  type GrowthQuizRound,
} from "./growth-games-types";

/**
 * Typed fetchers for the CUSTOMER half of `/internal/growth/games/**`.
 *
 * Same contract as growth-api.ts: every response is parsed by a zod schema that pins the wire shape,
 * then mapped snake_case → camelCase. The schemas are the frozen contract with the backend routes —
 * a field added on one side without the other fails loudly at parse time rather than rendering as
 * `undefined`.
 *
 * There is deliberately no "generate" or "edit" fetcher here. Quizzes are authored and published by
 * Hexclave staff through growth-games-admin-api.ts; a customer can only play the published one.
 */

const optionSchema = z.object({
  id: z.string(),
  label: z.string(),
});

const questionSchema = z.object({
  order_index: z.number().int().min(0),
  metric_id: z.string(),
  fact_kind: z.enum(GROWTH_QUIZ_FACT_KINDS),
  text: z.string(),
  options: z.array(optionSchema),
  answered_option_id: z.string().nullable(),
  // Null until this question is answered — the backend redacts the answer key. A non-null value on
  // an unanswered question would be a backend bug, not something to render.
  correct_option_id: z.string().nullable(),
  is_correct: z.boolean().nullable(),
  points_awarded: z.number().int().nullable(),
  explanation: z.string().nullable(),
  true_value_label: z.string().nullable(),
});

const roundSchema = z.object({
  id: z.string(),
  game_id: z.string(),
  status: z.enum(GROWTH_QUIZ_ROUND_STATUSES),
  question_count: z.number().int(),
  answered_count: z.number().int(),
  score: z.number().int(),
  max_score: z.number().int(),
  correct_count: z.number().int(),
  best_streak: z.number().int(),
  rank_title: z.string(),
  rank_blurb: z.string(),
  created_at_millis: z.number(),
  completed_at_millis: z.number().nullable(),
  questions: z.array(questionSchema),
});

const publishedSchema = z.object({
  game: z.object({
    id: z.string(),
    game_key: z.string(),
    question_count: z.number().int(),
    metrics_as_of: z.string().nullable(),
    published_at_millis: z.number().nullable(),
  }).nullable(),
  round: z.object({
    id: z.string(),
    status: z.enum(GROWTH_QUIZ_ROUND_STATUSES),
    question_count: z.number().int(),
    answered_count: z.number().int(),
    score: z.number().int(),
    max_score: z.number().int(),
    correct_count: z.number().int(),
    rank_title: z.string(),
    completed_at_millis: z.number().nullable(),
  }).nullable(),
});

const answerResultSchema = z.object({
  correct: z.boolean(),
  correct_option_id: z.string(),
  explanation: z.string(),
  true_value_label: z.string(),
  points_awarded: z.number().int(),
  streak: z.number().int(),
  score: z.number().int(),
  answered_count: z.number().int(),
  question_count: z.number().int(),
  is_last_question: z.boolean(),
});

export function mapGrowthQuizRound(value: z.infer<typeof roundSchema>): GrowthQuizRound {
  return {
    id: value.id,
    gameId: value.game_id,
    status: value.status,
    questionCount: value.question_count,
    answeredCount: value.answered_count,
    score: value.score,
    maxScore: value.max_score,
    correctCount: value.correct_count,
    bestStreak: value.best_streak,
    rankTitle: value.rank_title,
    rankBlurb: value.rank_blurb,
    createdAtMillis: value.created_at_millis,
    completedAtMillis: value.completed_at_millis,
    questions: value.questions.map((question) => ({
      orderIndex: question.order_index,
      metricId: question.metric_id,
      factKind: question.fact_kind,
      text: question.text,
      options: question.options,
      answeredOptionId: question.answered_option_id,
      correctOptionId: question.correct_option_id,
      isCorrect: question.is_correct,
      pointsAwarded: question.points_awarded,
      explanation: question.explanation,
      trueValueLabel: question.true_value_label,
    })),
  };
}

export function mapGrowthPublishedQuiz(value: z.infer<typeof publishedSchema>): GrowthPublishedQuiz {
  return {
    game: value.game == null ? null : {
      id: value.game.id,
      gameKey: value.game.game_key,
      questionCount: value.game.question_count,
      metricsAsOf: value.game.metrics_as_of,
      publishedAtMillis: value.game.published_at_millis,
    },
    round: value.round == null ? null : {
      id: value.round.id,
      status: value.round.status,
      questionCount: value.round.question_count,
      answeredCount: value.round.answered_count,
      score: value.round.score,
      maxScore: value.round.max_score,
      correctCount: value.round.correct_count,
      rankTitle: value.round.rank_title,
      completedAtMillis: value.round.completed_at_millis,
    },
  };
}

export function mapGrowthQuizAnswerResult(value: z.infer<typeof answerResultSchema>): GrowthQuizAnswerResult {
  return {
    correct: value.correct,
    correctOptionId: value.correct_option_id,
    explanation: value.explanation,
    trueValueLabel: value.true_value_label,
    pointsAwarded: value.points_awarded,
    streak: value.streak,
    score: value.score,
    answeredCount: value.answered_count,
    questionCount: value.question_count,
    isLastQuestion: value.is_last_question,
  };
}

export async function getGrowthPublishedQuiz(app: object): Promise<GrowthPublishedQuiz> {
  return mapGrowthPublishedQuiz(publishedSchema.parse(await requestJson(app, "/games/published")));
}

export async function startGrowthQuizRound(app: object): Promise<GrowthQuizRound> {
  // Bodyless POST: no `content-type` header is sent (see growthRequestHeaders' doc comment — sending
  // one here would 400 before the request reaches the handler). Safe to call on every dialog open:
  // the backend returns the round already in progress rather than minting a second one.
  return mapGrowthQuizRound(roundSchema.parse(await requestJson(app, "/games/rounds", { method: "POST" })));
}

export async function getGrowthQuizRound(app: object, roundId: string): Promise<GrowthQuizRound> {
  return mapGrowthQuizRound(roundSchema.parse(await requestJson(app, urlString`/games/rounds/${roundId}`)));
}

export async function submitGrowthQuizAnswer(app: object, roundId: string, input: { orderIndex: number, optionId: string }): Promise<GrowthQuizAnswerResult> {
  return mapGrowthQuizAnswerResult(answerResultSchema.parse(await requestJson(app, urlString`/games/rounds/${roundId}/answers`, {
    method: "POST",
    body: JSON.stringify({ order_index: input.orderIndex, option_id: input.optionId }),
  })));
}

export async function finishGrowthQuizRound(app: object, roundId: string): Promise<GrowthQuizRound> {
  return mapGrowthQuizRound(roundSchema.parse(await requestJson(app, urlString`/games/rounds/${roundId}/finish`, { method: "POST" })));
}
