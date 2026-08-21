import { describe, expect, it } from "vitest";
import { QUIZ_CELEBRATION_ACCURACY, quizAccuracyPercent, quizProgressLabel, shouldCelebrateQuizRound } from "./quiz-display";

describe("quizAccuracyPercent", () => {
  it("rounds to a whole percentage", () => {
    expect(quizAccuracyPercent(5, 8)).toMatchInlineSnapshot(`63`);
    expect(quizAccuracyPercent(8, 8)).toBe(100);
    expect(quizAccuracyPercent(0, 8)).toBe(0);
  });

  it("does not divide by zero for the (DB-forbidden) empty round", () => {
    expect(quizAccuracyPercent(0, 0)).toBe(0);
  });
});

describe("quizProgressLabel", () => {
  it("counts from one, for humans", () => {
    expect(quizProgressLabel(0, 8)).toMatchInlineSnapshot(`"Question 1 of 8"`);
    expect(quizProgressLabel(3, 8)).toMatchInlineSnapshot(`"Question 4 of 8"`);
  });

  it("does not run past the end once the last question is answered", () => {
    expect(quizProgressLabel(8, 8)).toMatchInlineSnapshot(`"Question 8 of 8"`);
  });
});

describe("shouldCelebrateQuizRound", () => {
  it("fires only above the accuracy threshold", () => {
    // Deliberately not "any correct answer" — confetti on every question turns the section into a
    // slot machine, and DESIGN-GUIDE §3.5 warns against large animated movement in dense surfaces.
    expect(shouldCelebrateQuizRound(8, 8)).toBe(true);
    expect(shouldCelebrateQuizRound(6, 8)).toBe(true);
    expect(shouldCelebrateQuizRound(5, 8)).toBe(false);
    expect(shouldCelebrateQuizRound(0, 8)).toBe(false);
  });

  it("treats the threshold as inclusive", () => {
    const questionCount = 100;
    expect(shouldCelebrateQuizRound(Math.ceil(QUIZ_CELEBRATION_ACCURACY * questionCount), questionCount)).toBe(true);
  });

  it("never celebrates an empty round", () => {
    expect(shouldCelebrateQuizRound(0, 0)).toBe(false);
  });
});
