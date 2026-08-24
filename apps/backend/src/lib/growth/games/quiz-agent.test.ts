import { describe, expect, it } from "vitest";
import { authoredQuestionLeaksAnswer, parseQuizAuthoringResponse } from "./quiz-agent";
import type { QuizFact } from "./quiz-facts";

function fact(overrides: Partial<QuizFact> = {}): QuizFact {
  return {
    factId: "new_users:window_sum",
    metricId: "new_users",
    metricLabel: "New users",
    metricDescription: "Non-anonymous users who signed up on that UTC day.",
    kind: "window_sum",
    unit: "count",
    trueValue: 1204,
    options: [
      { id: "o0", label: "1,200" },
      { id: "o1", label: "420" },
      { id: "o2", label: "2,300" },
      { id: "o3", label: "5,100" },
    ],
    correctOptionId: "o0",
    templateText: "How many?",
    templateExplanation: "Because.",
    ...overrides,
  };
}

function response(entries: unknown[]): unknown {
  return { questions: entries };
}

describe("parseQuizAuthoringResponse", () => {
  const facts = [fact(), fact({ factId: "dau:peak_weekday", kind: "peak_weekday" })];
  const good = [
    { fact_id: "new_users:window_sum", text: "How many people signed up last month?", explanation: "Signups drive everything downstream." },
    { fact_id: "dau:peak_weekday", text: "Which weekday is busiest?", explanation: "Tells you when a launch will be seen." },
  ];

  it("accepts a response covering every fact", () => {
    const parsed = parseQuizAuthoringResponse(response(good), facts);
    expect(parsed?.size).toBe(2);
    expect(parsed?.get("dau:peak_weekday")?.text).toBe("Which weekday is busiest?");
  });

  it("rejects partial coverage rather than merging with template text", () => {
    // A half-authored round would record one textSource that is true of neither half, and would
    // visibly change voice mid-round.
    expect(parseQuizAuthoringResponse(response([good[0]]), facts)).toBeNull();
  });

  it("rejects an invented fact id", () => {
    expect(parseQuizAuthoringResponse(response([good[0], { ...good[1], fact_id: "made_up:kind" }]), facts)).toBeNull();
  });

  it("rejects a duplicated fact id", () => {
    expect(parseQuizAuthoringResponse(response([good[0], good[0]]), facts)).toBeNull();
  });

  it("rejects empty or missing strings", () => {
    expect(parseQuizAuthoringResponse(response([{ ...good[0], text: "   " }, good[1]]), facts)).toBeNull();
    expect(parseQuizAuthoringResponse(response([{ fact_id: good[0].fact_id, text: "ok" }, good[1]]), facts)).toBeNull();
  });

  it("rejects an over-long question that would overflow the card", () => {
    expect(parseQuizAuthoringResponse(response([{ ...good[0], text: "x".repeat(401) }, good[1]]), facts)).toBeNull();
  });

  it("rejects a body that is not the expected envelope", () => {
    expect(parseQuizAuthoringResponse(null, facts)).toBeNull();
    expect(parseQuizAuthoringResponse("[]", facts)).toBeNull();
    expect(parseQuizAuthoringResponse({ questions: "nope" }, facts)).toBeNull();
    expect(parseQuizAuthoringResponse(response(["not an object"]), facts)).toBeNull();
  });
});

describe("authoredQuestionLeaksAnswer", () => {
  it("passes a question with no numbers in it", () => {
    expect(authoredQuestionLeaksAnswer("How many people signed up last month?", fact())).toBe(false);
  });

  it("passes a question whose numbers are unrelated to the options", () => {
    expect(authoredQuestionLeaksAnswer("Over the last 30 days, how many signed up?", fact())).toBe(false);
  });

  it("catches a question that states the correct answer", () => {
    expect(authoredQuestionLeaksAnswer("You had 1,200 signups — how many was that?", fact())).toBe(true);
  });

  it("catches a question that names a distractor", () => {
    // Naming a wrong option is just as damaging: it collapses the choice from four to three.
    expect(authoredQuestionLeaksAnswer("Was it more or less than 5,100?", fact())).toBe(true);
  });

  it("sees through separators and trailing zeroes", () => {
    expect(authoredQuestionLeaksAnswer("Roughly 1200 of them?", fact())).toBe(true);
  });

  it("catches a leaked currency figure", () => {
    const cents = fact({
      unit: "cents",
      options: [{ id: "o0", label: "$1,240" }, { id: "o1", label: "$430" }, { id: "o2", label: "$2,300" }, { id: "o3", label: "$5,100" }],
    });
    expect(authoredQuestionLeaksAnswer("Did you clear $1,240 last month?", cents)).toBe(true);
  });
});

describe("authoredQuestionLeaksAnswer on staff edits", () => {
  // The same check guards the review surface: updateQuizQuestion runs a reviewer's rewritten prompt
  // through it before storing. A person can paste the answer in more easily than a model can, since
  // the admin card shows them the answer key while they type.
  const options = fact().options;

  it("accepts a reviewer's rewrite that names no figure", () => {
    expect(authoredQuestionLeaksAnswer("Go on then — how many signed up last month?", { options })).toBe(false);
  });

  it("rejects a reviewer's rewrite that pastes the answer in", () => {
    expect(authoredQuestionLeaksAnswer("Was it 1,200 signups last month?", { options })).toBe(true);
  });

  it("takes only the options, so a stored question row can be checked without a fact", () => {
    // The signature is deliberately narrow: a stored GrowthQuizQuestion is not a QuizFact, and
    // reconstructing one just to run this check would mean rebuilding data the row already has.
    expect(authoredQuestionLeaksAnswer("Plain question?", { options: [] })).toBe(false);
  });
});
