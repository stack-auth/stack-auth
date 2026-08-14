import { describe, expect, it } from "vitest";
import { maxQuizScore, QUIZ_BASE_POINTS, QUIZ_MAX_STREAK_BONUS, QUIZ_RANKS, quizRankFor, scoreQuizAnswer } from "./quiz-scoring";

describe("scoreQuizAnswer", () => {
  it("awards nothing for a wrong answer, regardless of the streak it breaks", () => {
    // Never negative: the game is meant to teach someone their own numbers, and a running total that
    // goes down reads as punishment for playing.
    expect(scoreQuizAnswer({ isCorrect: false, streakBeforeAnswer: 0 })).toBe(0);
    expect(scoreQuizAnswer({ isCorrect: false, streakBeforeAnswer: 7 })).toBe(0);
  });

  it("adds a growing streak bonus, capped", () => {
    expect(scoreQuizAnswer({ isCorrect: true, streakBeforeAnswer: 0 })).toBe(QUIZ_BASE_POINTS);
    expect(scoreQuizAnswer({ isCorrect: true, streakBeforeAnswer: 1 })).toMatchInlineSnapshot(`125`);
    expect(scoreQuizAnswer({ isCorrect: true, streakBeforeAnswer: 2 })).toMatchInlineSnapshot(`150`);
    expect(scoreQuizAnswer({ isCorrect: true, streakBeforeAnswer: 4 })).toBe(QUIZ_BASE_POINTS + QUIZ_MAX_STREAK_BONUS);
    // Capped, so a very long round cannot make the last questions worth an order of magnitude more
    // than the first ones.
    expect(scoreQuizAnswer({ isCorrect: true, streakBeforeAnswer: 40 })).toBe(QUIZ_BASE_POINTS + QUIZ_MAX_STREAK_BONUS);
  });
});

describe("maxQuizScore", () => {
  it("is the score of a flawless round", () => {
    expect(maxQuizScore(8)).toMatchInlineSnapshot(`1350`);
    expect(maxQuizScore(1)).toBe(QUIZ_BASE_POINTS);
    expect(maxQuizScore(0)).toBe(0);
  });

  it("agrees with summing the per-answer scores", () => {
    let total = 0;
    for (let index = 0; index < 8; index++) total += scoreQuizAnswer({ isCorrect: true, streakBeforeAnswer: index });
    expect(maxQuizScore(8)).toBe(total);
  });
});

describe("quizRankFor", () => {
  it("maps accuracy bands to ranks", () => {
    expect(quizRankFor(8, 8).title).toMatchInlineSnapshot(`"Mind Reader"`);
    expect(quizRankFor(7, 8).title).toMatchInlineSnapshot(`"Data Whisperer"`);
    expect(quizRankFor(5, 8).title).toMatchInlineSnapshot(`"Pattern Spotter"`);
    expect(quizRankFor(4, 8).title).toMatchInlineSnapshot(`"Rough Sketcher"`);
    expect(quizRankFor(0, 8).title).toMatchInlineSnapshot(`"Optimist"`);
  });

  it("always resolves a rank, including for the unreachable zero-question round", () => {
    // questionCount 0 is forbidden by the DB CHECK, so this only guards the division rather than a
    // real state — but a rank lookup that could return undefined would be a crash on the scoreboard.
    expect(quizRankFor(0, 0).title).toBe(QUIZ_RANKS[QUIZ_RANKS.length - 1].title);
    for (let correct = 0; correct <= 8; correct++) {
      expect(quizRankFor(correct, 8).title.length).toBeGreaterThan(0);
    }
  });
});
