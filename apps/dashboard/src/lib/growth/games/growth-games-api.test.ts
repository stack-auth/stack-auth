import { describe, expect, it } from "vitest";
import { mapGrowthPublishedQuiz, mapGrowthQuizAnswerResult, mapGrowthQuizRound } from "./growth-games-api";
import { GROWTH_QUIZ_GAME_KEY } from "./growth-games-types";

const wireQuestion = {
  order_index: 0,
  metric_id: "new_users",
  fact_kind: "window_sum" as const,
  text: "How many signed up?",
  options: [{ id: "o0", label: "1,200" }, { id: "o1", label: "420" }],
  answered_option_id: null,
  correct_option_id: null,
  is_correct: null,
  points_awarded: null,
  explanation: null,
  true_value_label: null,
};

const wireRound = {
  id: "round-1",
  game_id: "game-1",
  status: "ready" as const,
  question_count: 2,
  answered_count: 1,
  score: 100,
  max_score: 225,
  correct_count: 1,
  best_streak: 1,
  rank_title: "Pattern Spotter",
  rank_blurb: "Solid instincts.",
  created_at_millis: 1_700_000_000_000,
  completed_at_millis: null,
  questions: [
    { ...wireQuestion, order_index: 0, answered_option_id: "o0", correct_option_id: "o0", is_correct: true, points_awarded: 100, explanation: "Because.", true_value_label: "1,204" },
    { ...wireQuestion, order_index: 1 },
  ],
};

describe("mapGrowthQuizRound", () => {
  it("maps the wire body to the domain shape", () => {
    const round = mapGrowthQuizRound(wireRound);
    expect(round.id).toBe("round-1");
    expect(round.gameId).toBe("game-1");
    expect(round.answeredCount).toBe(1);
    expect(round.rankBlurb).toBe("Solid instincts.");
    expect(round.questions).toHaveLength(2);
  });

  it("carries the answer key through for graded questions and null for ungraded ones", () => {
    // The nulls are the backend's redaction showing up on this side; a component that renders them
    // must handle null rather than assume a value is present before the answer.
    const round = mapGrowthQuizRound(wireRound);
    expect(round.questions[0].correctOptionId).toBe("o0");
    expect(round.questions[0].trueValueLabel).toBe("1,204");
    expect(round.questions[1].correctOptionId).toBeNull();
    expect(round.questions[1].explanation).toBeNull();
    expect(round.questions[1].trueValueLabel).toBeNull();
  });
});

describe("mapGrowthPublishedQuiz", () => {
  it("maps a published game with a round in progress", () => {
    const published = mapGrowthPublishedQuiz({
      game: { id: "game-1", game_key: GROWTH_QUIZ_GAME_KEY, question_count: 8, metrics_as_of: "2026-08-03", published_at_millis: 1_700_000_000_000 },
      round: { id: "round-1", status: "ready", question_count: 8, answered_count: 3, score: 350, max_score: 1350, correct_count: 3, rank_title: "Pattern Spotter", completed_at_millis: null },
    });
    expect(published.game?.gameKey).toBe(GROWTH_QUIZ_GAME_KEY);
    expect(published.round?.answeredCount).toBe(3);
  });

  it("maps 'nothing published' — the common case, where the banner renders nothing at all", () => {
    const published = mapGrowthPublishedQuiz({ game: null, round: null });
    expect(published).toMatchInlineSnapshot(`
      {
        "game": null,
        "round": null,
      }
    `);
  });

  it("maps a published game nobody has played yet", () => {
    const published = mapGrowthPublishedQuiz({
      game: { id: "game-1", game_key: GROWTH_QUIZ_GAME_KEY, question_count: 8, metrics_as_of: null, published_at_millis: null },
      round: null,
    });
    expect(published.game?.questionCount).toBe(8);
    expect(published.round).toBeNull();
  });
});

describe("mapGrowthQuizAnswerResult", () => {
  it("maps the reveal", () => {
    const result = mapGrowthQuizAnswerResult({
      correct: false,
      correct_option_id: "o1",
      explanation: "Signup rate is the cheapest number to move.",
      true_value_label: "3.1%",
      points_awarded: 0,
      streak: 0,
      score: 200,
      answered_count: 3,
      question_count: 8,
      is_last_question: false,
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "answeredCount": 3,
        "correct": false,
        "correctOptionId": "o1",
        "explanation": "Signup rate is the cheapest number to move.",
        "isLastQuestion": false,
        "pointsAwarded": 0,
        "questionCount": 8,
        "score": 200,
        "streak": 0,
        "trueValueLabel": "3.1%",
      }
    `);
  });
});
