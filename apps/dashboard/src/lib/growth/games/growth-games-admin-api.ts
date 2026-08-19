import { urlString } from "@hexclave/shared/dist/utils/urls";
import { z } from "zod";
import { requestGrowthAdminJson } from "../growth-api";
import {
  GROWTH_QUIZ_FACT_KINDS,
  GROWTH_QUIZ_GAME_STATUSES,
  GROWTH_QUIZ_ROUND_STATUSES,
  GROWTH_QUIZ_TEXT_SOURCES,
  type GrowthQuizAdminBody,
} from "./growth-games-types";

/**
 * Typed fetchers for `/internal/growth/admin/games/**` — the Hexclave-staff review surface.
 *
 * Unlike the customer fetchers in growth-games-api.ts, these carry the target project explicitly
 * (`target_project_id` in the body, `project_id` in the query): the credential is always the
 * internal project's, so the server has no way to infer whose quiz is being edited.
 *
 * Every mutation returns the WHOLE admin body rather than the thing it changed, so the card
 * re-renders from one authoritative snapshot instead of patching local state and drifting.
 */

const adminOptionSchema = z.object({ id: z.string(), label: z.string() });

// Note what the staff schema has that the customer's does not: correct_option_id and
// true_value_label. Reviewing the answer key is the entire point of the review step.
const adminQuestionSchema = z.object({
  order_index: z.number().int().min(0),
  metric_id: z.string(),
  fact_kind: z.enum(GROWTH_QUIZ_FACT_KINDS),
  text: z.string(),
  explanation: z.string(),
  options: z.array(adminOptionSchema),
  correct_option_id: z.string(),
  true_value_label: z.string(),
});

const adminGameSchema = z.object({
  id: z.string(),
  game_key: z.string(),
  status: z.enum(GROWTH_QUIZ_GAME_STATUSES),
  text_source: z.enum(GROWTH_QUIZ_TEXT_SOURCES),
  question_count: z.number().int(),
  metrics_as_of: z.string().nullable(),
  generation_error: z.string().nullable(),
  published_at_millis: z.number().nullable(),
  created_at_millis: z.number(),
  questions: z.array(adminQuestionSchema),
});

const adminResultSchema = z.object({
  id: z.string(),
  game_id: z.string(),
  status: z.enum(GROWTH_QUIZ_ROUND_STATUSES),
  question_count: z.number().int(),
  score: z.number().int(),
  max_score: z.number().int(),
  correct_count: z.number().int(),
  best_streak: z.number().int(),
  rank_title: z.string(),
  created_at_millis: z.number(),
  completed_at_millis: z.number().nullable(),
  answers: z.array(z.object({
    order_index: z.number().int().min(0),
    metric_id: z.string(),
    answered: z.boolean(),
    is_correct: z.boolean().nullable(),
  })),
});

const adminBodySchema = z.object({
  draft: adminGameSchema.nullable(),
  published: adminGameSchema.nullable(),
  results: z.array(adminResultSchema),
});

export function mapGrowthQuizAdminBody(value: z.infer<typeof adminBodySchema>): GrowthQuizAdminBody {
  const mapGame = (game: z.infer<typeof adminGameSchema>) => ({
    id: game.id,
    gameKey: game.game_key,
    status: game.status,
    textSource: game.text_source,
    questionCount: game.question_count,
    metricsAsOf: game.metrics_as_of,
    generationError: game.generation_error,
    publishedAtMillis: game.published_at_millis,
    createdAtMillis: game.created_at_millis,
    questions: game.questions.map((question) => ({
      orderIndex: question.order_index,
      metricId: question.metric_id,
      factKind: question.fact_kind,
      text: question.text,
      explanation: question.explanation,
      options: question.options,
      correctOptionId: question.correct_option_id,
      trueValueLabel: question.true_value_label,
    })),
  });

  return {
    draft: value.draft == null ? null : mapGame(value.draft),
    published: value.published == null ? null : mapGame(value.published),
    results: value.results.map((result) => ({
      id: result.id,
      gameId: result.game_id,
      status: result.status,
      questionCount: result.question_count,
      score: result.score,
      maxScore: result.max_score,
      correctCount: result.correct_count,
      bestStreak: result.best_streak,
      rankTitle: result.rank_title,
      createdAtMillis: result.created_at_millis,
      completedAtMillis: result.completed_at_millis,
      answers: result.answers.map((answer) => ({
        orderIndex: answer.order_index,
        metricId: answer.metric_id,
        answered: answer.answered,
        isCorrect: answer.is_correct,
      })),
    })),
  };
}

async function adminBody(promise: Promise<unknown>): Promise<GrowthQuizAdminBody> {
  return mapGrowthQuizAdminBody(adminBodySchema.parse(await promise));
}

export async function getGrowthQuizAdmin(app: object, projectId: string): Promise<GrowthQuizAdminBody> {
  return await adminBody(requestGrowthAdminJson(app, urlString`/games?project_id=${projectId}`));
}

export async function generateGrowthQuiz(app: object, projectId: string): Promise<GrowthQuizAdminBody> {
  return await adminBody(requestGrowthAdminJson(app, "/games/generate", {
    method: "POST",
    body: JSON.stringify({ target_project_id: projectId }),
  }));
}

export async function publishGrowthQuiz(app: object, projectId: string, gameId: string): Promise<GrowthQuizAdminBody> {
  return await adminBody(requestGrowthAdminJson(app, urlString`/games/${gameId}`, {
    method: "PATCH",
    body: JSON.stringify({ target_project_id: projectId, action: "publish" }),
  }));
}

export async function archiveGrowthQuiz(app: object, projectId: string, gameId: string): Promise<GrowthQuizAdminBody> {
  return await adminBody(requestGrowthAdminJson(app, urlString`/games/${gameId}`, {
    method: "PATCH",
    body: JSON.stringify({ target_project_id: projectId, action: "archive" }),
  }));
}

export async function updateGrowthQuizQuestion(app: object, projectId: string, gameId: string, orderIndex: number, input: { text: string, explanation: string }): Promise<GrowthQuizAdminBody> {
  return await adminBody(requestGrowthAdminJson(app, urlString`/games/${gameId}/questions/${String(orderIndex)}`, {
    method: "PATCH",
    body: JSON.stringify({ target_project_id: projectId, text: input.text, explanation: input.explanation }),
  }));
}

export async function removeGrowthQuizQuestion(app: object, projectId: string, gameId: string, orderIndex: number): Promise<GrowthQuizAdminBody> {
  return await adminBody(requestGrowthAdminJson(app, urlString`/games/${gameId}/questions/${String(orderIndex)}`, {
    method: "DELETE",
    body: JSON.stringify({ target_project_id: projectId }),
  }));
}
