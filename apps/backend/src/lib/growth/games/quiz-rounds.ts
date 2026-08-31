import type { Tenancy } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { isUuid } from "@hexclave/shared/dist/utils/uuids";
import { GROWTH_QUIZ_GAME_KEY } from "./quiz-games";
import { maxQuizScore, quizRankFor, scoreQuizAnswer } from "./quiz-scoring";
import {
  readOptions,
  toWireGame,
  toWireRound,
  trueValueLabelOf,
  type QuizAnswerRow,
  type QuizQuestionRow,
} from "./quiz-wire";

/**
 * The CUSTOMER side of Growth games: playing the quiz staff published for this project.
 *
 * A customer can never generate or edit a game — every write here is scoped to their own round, and
 * the questions are read-only. The answer key is redacted by `toWireQuestion` in quiz-wire.ts until
 * the question has been answered.
 */

/** Rounds are per-game; a customer replays by starting a new round of the same published game. */
async function findPublishedGame(tenancy: Tenancy) {
  return await globalPrismaClient.growthQuizGame.findFirst({
    where: {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      gameKey: GROWTH_QUIZ_GAME_KEY,
      status: "published",
    },
  });
}

async function loadQuestions(gameId: string): Promise<QuizQuestionRow[]> {
  return await globalPrismaClient.growthQuizQuestion.findMany({
    where: { gameId },
    orderBy: { orderIndex: "asc" },
  });
}

async function loadAnswers(roundId: string): Promise<QuizAnswerRow[]> {
  return await globalPrismaClient.growthQuizAnswer.findMany({
    where: { roundId },
    orderBy: { answeredAt: "asc" },
  });
}

/**
 * What the banner above the customer's insights section renders.
 *
 * Returns the published game (if any) plus their most recent round, so the banner can distinguish
 * three states that look nothing alike: nothing published, a quiz waiting to be played, and a quiz
 * already finished. `game: null` is a normal, common answer — most projects have no published quiz,
 * and the banner renders nothing at all in that case.
 */
export async function getPublishedQuizBody(tenancy: Tenancy) {
  const game = await findPublishedGame(tenancy);
  if (game == null) return { game: null, round: null };

  const round = await globalPrismaClient.growthQuizRound.findFirst({
    where: { gameId: game.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const questions = await loadQuestions(game.id);

  return {
    game: toWireGame(game),
    round: round == null ? null : {
      id: round.id,
      status: round.status,
      question_count: questions.length,
      answered_count: await globalPrismaClient.growthQuizAnswer.count({ where: { roundId: round.id } }),
      score: round.score,
      max_score: maxQuizScore(questions.length),
      correct_count: round.correctCount,
      rank_title: quizRankFor(round.correctCount, questions.length).title,
      completed_at_millis: round.completedAt == null ? null : round.completedAt.getTime(),
    },
  };
}

async function requireRoundInTenancy(tenancy: Tenancy, roundId: string) {
  // A non-UUID id can never match a row, but Prisma would turn it into a Postgres cast error (a 500)
  // instead of a clean miss — so pre-check and 404 early. Same 404 whether the round doesn't exist or
  // belongs to another project, so ids from other projects can't be probed.
  if (!isUuid(roundId)) throw new StatusError(404, "Round not found.");
  const round = await globalPrismaClient.growthQuizRound.findFirst({
    where: { id: roundId, projectId: tenancy.project.id, branchId: tenancy.branchId },
  });
  if (round == null) throw new StatusError(404, "Round not found.");
  return round;
}

/**
 * Starts a round of the published game, or hands back the one already in progress.
 *
 * Resuming rather than refusing is deliberate: the customer's only entry point is a banner, and a
 * "you already have a round open" error there would strand them on a half-finished round with no
 * page to return to.
 */
export async function startQuizRound(tenancy: Tenancy, options: {
  playedByUserId: string | null,
}) {
  const game = await findPublishedGame(tenancy);
  if (game == null) throw new StatusError(409, "There's no quiz published for this project right now.");

  const live = await globalPrismaClient.growthQuizRound.findFirst({
    where: { gameId: game.id, status: "ready" },
  });
  if (live != null) return await getQuizRoundBody(tenancy, live.id);

  let round;
  try {
    round = await globalPrismaClient.growthQuizRound.create({
      data: {
        gameId: game.id,
        projectId: tenancy.project.id,
        branchId: tenancy.branchId,
        status: "ready",
        playedByUserId: options.playedByUserId,
      },
    });
  } catch (error) {
    // Two tabs raced past the read above; the unique index is the real guard, so fall through to the
    // round the other one created rather than showing an error for something that worked.
    if (isUniqueViolation(error)) {
      const existing = await globalPrismaClient.growthQuizRound.findFirst({ where: { gameId: game.id, status: "ready" } });
      if (existing != null) return await getQuizRoundBody(tenancy, existing.id);
    }
    throw error;
  }

  return toWireRound(round, await loadQuestions(game.id), []);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

export async function getQuizRoundBody(tenancy: Tenancy, roundId: string) {
  const round = await requireRoundInTenancy(tenancy, roundId);
  return toWireRound(round, await loadQuestions(round.gameId), await loadAnswers(round.id));
}

// ─── Grading ─────────────────────────────────────────────────────────────────

/** Consecutive correct answers immediately before `orderIndex`. Drives the streak bonus. Exported for its unit test. */
export function streakBefore(questions: readonly QuizQuestionRow[], answers: readonly QuizAnswerRow[], orderIndex: number): number {
  const answersByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]));
  let streak = 0;
  // Clamped rather than trusting orderIndex to be in range: it comes from a request body, and
  // walking off the end of the array would read undefined as "not correct" and quietly return 0
  // instead of the streak the player actually earned.
  for (let index = Math.min(orderIndex, questions.length) - 1; index >= 0; index--) {
    if (answersByQuestionId.get(questions[index].id)?.isCorrect !== true) break;
    streak++;
  }
  return streak;
}

export function longestStreak(questions: readonly QuizQuestionRow[], answers: readonly QuizAnswerRow[]): number {
  const answersByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]));
  let best = 0;
  let current = 0;
  for (const question of questions) {
    current = answersByQuestionId.get(question.id)?.isCorrect === true ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

export type QuizAnswerResult = {
  correct: boolean,
  correct_option_id: string,
  explanation: string,
  true_value_label: string,
  points_awarded: number,
  streak: number,
  score: number,
  answered_count: number,
  question_count: number,
  is_last_question: boolean,
};

/**
 * Grades one answer.
 *
 * Two rules are enforced by the write itself rather than by a pre-check, because a pre-check would
 * be a TOCTOU race on a double-clicked button: the answer row's unique (roundId, questionId) index
 * makes a question single-use, and the round's totals are RECOMPUTED from all its answer rows rather
 * than incremented. That makes the score a function of the stored answers, so a retry or a
 * concurrent request cannot double-count a point.
 */
export async function submitQuizAnswer(tenancy: Tenancy, roundId: string, input: {
  orderIndex: number,
  optionId: string,
  now: Date,
}): Promise<QuizAnswerResult> {
  const round = await requireRoundInTenancy(tenancy, roundId);
  if (round.status !== "ready") {
    throw new StatusError(409, round.status === "completed" ? "This round is already finished." : "This round is not playable.");
  }

  const questions = await loadQuestions(round.gameId);
  const question = questions.find((candidate) => candidate.orderIndex === input.orderIndex);
  if (question == null) throw new StatusError(404, "Question not found.");

  const options = readOptions(question.options, question.id);
  if (!options.some((option) => option.id === input.optionId)) {
    throw new StatusError(400, "That answer is not one of this question's options.");
  }

  const existingAnswers = await loadAnswers(round.id);
  // Questions must be answered in order. Without this, a client could skip to the last question,
  // answer it, and collect a streak bonus it never earned — and the resume path assumes "answered
  // count" and "current question index" are the same number.
  if (input.orderIndex !== existingAnswers.length) {
    const alreadyAnswered = existingAnswers.some((answer) => answer.questionId === question.id);
    throw new StatusError(409, alreadyAnswered ? "You've already answered that question." : "Answer the questions in order.");
  }

  const isCorrect = input.optionId === question.correctOptionId;
  const pointsAwarded = scoreQuizAnswer({ isCorrect, streakBeforeAnswer: streakBefore(questions, existingAnswers, input.orderIndex) });

  try {
    await globalPrismaClient.growthQuizAnswer.create({
      data: {
        roundId: round.id,
        questionId: question.id,
        optionId: input.optionId,
        isCorrect,
        pointsAwarded,
        answeredAt: input.now,
      },
    });
  } catch (error) {
    // Someone else's request got there first between the read above and this write.
    if (isUniqueViolation(error)) throw new StatusError(409, "You've already answered that question.");
    throw error;
  }

  const graded = await loadAnswers(round.id);
  const correctCount = graded.filter((answer) => answer.isCorrect).length;
  const score = graded.reduce((total, answer) => total + answer.pointsAwarded, 0);
  const updatedRound = await globalPrismaClient.growthQuizRound.update({
    where: { id: round.id },
    data: { score, correctCount, bestStreak: longestStreak(questions, graded) },
  });

  return {
    correct: isCorrect,
    correct_option_id: question.correctOptionId,
    explanation: question.explanation,
    // Same helper the round body's reveal uses, so the figure a player sees here and the one they
    // see in the recap are formatted identically.
    true_value_label: trueValueLabelOf(question),
    points_awarded: pointsAwarded,
    streak: streakBefore(questions, graded, input.orderIndex) + (isCorrect ? 1 : 0),
    score: updatedRound.score,
    answered_count: graded.length,
    question_count: questions.length,
    is_last_question: graded.length >= questions.length,
  };
}

/**
 * Marks a round finished. Idempotent — a re-submitted "finish" returns the same body rather than
 * moving `completedAt`, so a retried request never rewrites history.
 */
export async function finishQuizRound(tenancy: Tenancy, roundId: string, now: Date) {
  const round = await requireRoundInTenancy(tenancy, roundId);
  const questions = await loadQuestions(round.gameId);
  if (round.status === "completed") {
    return toWireRound(round, questions, await loadAnswers(round.id));
  }
  if (round.status !== "ready") throw new StatusError(409, "This round is not playable.");

  const answers = await loadAnswers(round.id);
  if (answers.length < questions.length) {
    throw new StatusError(409, "Answer every question before finishing the round.");
  }
  const finished = await globalPrismaClient.growthQuizRound.update({
    where: { id: round.id },
    data: { status: "completed", completedAt: now },
  });
  return toWireRound(finished, questions, answers);
}
