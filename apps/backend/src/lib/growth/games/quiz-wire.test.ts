import { describe, expect, it } from "vitest";
import {
  toAdminWireQuestion,
  toWireQuestion,
  type QuizAnswerRow,
  type QuizQuestionRow,
} from "./quiz-wire";

function question(overrides: Partial<QuizQuestionRow> = {}): QuizQuestionRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    orderIndex: 0,
    metricId: "new_users",
    factKind: "window_sum",
    questionText: "How many people signed up in the last 30 days?",
    explanation: "Signups are the top of every other number on this page.",
    options: [
      { id: "o0", label: "1,200" },
      { id: "o1", label: "420" },
      { id: "o2", label: "2,300" },
      { id: "o3", label: "5,100" },
    ],
    correctOptionId: "o0",
    trueValue: 1204.4,
    unit: "count",
    ...overrides,
  };
}

function answer(overrides: Partial<QuizAnswerRow> = {}): QuizAnswerRow {
  return {
    questionId: "11111111-1111-4111-8111-111111111111",
    optionId: "o1",
    isCorrect: false,
    pointsAwarded: 0,
    ...overrides,
  };
}

describe("toWireQuestion redaction", () => {
  it("ships no part of the answer key for an unanswered question", () => {
    // THE load-bearing assertion of this whole feature. If the answer key reaches the customer
    // before they answer, the game is pointless — and nothing about the UI would look wrong, so only
    // a test catches it. Serialized and scanned as a whole rather than field-by-field, so a future
    // field carrying the answer fails here even if nobody remembers to assert on it.
    const wire = toWireQuestion(question(), null);
    expect(wire.correct_option_id).toBeNull();
    expect(wire.explanation).toBeNull();
    expect(wire.true_value_label).toBeNull();
    expect(wire.is_correct).toBeNull();
    expect(wire.answered_option_id).toBeNull();
    const serialized = JSON.stringify(wire);
    expect(serialized).not.toContain("1,204");
    expect(serialized).not.toContain("Signups are the top");
  });

  it("still ships everything needed to render and answer the question", () => {
    const wire = toWireQuestion(question(), null);
    expect(wire.text).toContain("How many people signed up");
    expect(wire.options).toHaveLength(4);
  });

  it("reveals the answer key once an answer row exists", () => {
    const wire = toWireQuestion(question(), answer());
    expect(wire.correct_option_id).toBe("o0");
    expect(wire.answered_option_id).toBe("o1");
    expect(wire.is_correct).toBe(false);
    expect(wire.explanation).toContain("Signups are the top");
    // Rounded to a whole user: the exact stored figure is 1204.4, and a fractional person is not a
    // thing. The options were rounded harder (to two significant figures) so the truth would not
    // stand out among them; the reveal is where the real number shows up.
    expect(wire.true_value_label).toMatchInlineSnapshot(`"1,204"`);
  });

  it("keys redaction on the ANSWER row, not on anything the question knows", () => {
    // The point of moving answers into their own table: a question row carries no "answered" state
    // at all, so there is no way to have a question that thinks it was answered while the caller
    // forgot to pass the answer in. Same row, two callers, two correct outcomes.
    const shared = question();
    expect(toWireQuestion(shared, null).correct_option_id).toBeNull();
    expect(toWireQuestion(shared, answer()).correct_option_id).toBe("o0");
  });

  it("formats the revealed value by its own unit", () => {
    expect(toWireQuestion(question({ unit: "percent", trueValue: 3.14159 }), answer()).true_value_label).toMatchInlineSnapshot(`"3.1%"`);
    expect(toWireQuestion(question({ unit: "cents", trueValue: 123_456 }), answer()).true_value_label).toMatchInlineSnapshot(`"$1,235"`);
    expect(toWireQuestion(question({ unit: "seconds", trueValue: 3725 }), answer()).true_value_label).toMatchInlineSnapshot(`"1h 02m"`);
  });

  it("refuses to render a corrupted options column instead of guessing", () => {
    expect(() => toWireQuestion(question({ options: "not an array" }), null)).toThrow(/not an array/);
    expect(() => toWireQuestion(question({ options: [{ id: "o0" }] }), null)).toThrow(/not \{ id, label \}/);
  });

  it("rejects a unit that is not in the catalog vocabulary", () => {
    expect(() => toWireQuestion(question({ unit: "bananas" }), answer())).toThrow(/unknown value "bananas"/);
  });
});

describe("toAdminWireQuestion", () => {
  it("never redacts — reviewing the answer key is the point of the review step", () => {
    const wire = toAdminWireQuestion(question());
    expect(wire.correct_option_id).toBe("o0");
    expect(wire.true_value_label).toBe("1,204");
    expect(wire.explanation).toContain("Signups are the top");
  });

  it("carries no customer answer fields at all", () => {
    // Staff review a game, not a playthrough — there is no round in scope here, and a field that
    // looked like one would invite the admin card to render a customer's answer it was never given.
    const wire = toAdminWireQuestion(question());
    expect(Object.keys(wire).sort()).toMatchInlineSnapshot(`
      [
        "correct_option_id",
        "explanation",
        "fact_kind",
        "metric_id",
        "options",
        "order_index",
        "text",
        "true_value_label",
      ]
    `);
  });
});
