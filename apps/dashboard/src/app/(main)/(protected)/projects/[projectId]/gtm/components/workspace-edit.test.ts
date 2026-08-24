import { describe, expect, it } from "vitest";
import { editableActionStatuses, isSubmittableCategoryScore } from "./workspace-edit";

describe("isSubmittableCategoryScore", () => {
  it("accepts whole numbers across the full range", () => {
    expect(["0", "50", "100"].map(isSubmittableCategoryScore)).toMatchInlineSnapshot(`
      [
        true,
        true,
        true,
      ]
    `);
  });

  it("rejects blanks, non-numbers, fractions and out-of-range scores", () => {
    expect(["", " ", "abc", "3.7", "-5", "101"].map(isSubmittableCategoryScore)).toMatchInlineSnapshot(`
      [
        false,
        false,
        false,
        false,
        false,
        false,
      ]
    `);
  });
});

describe("editableActionStatuses", () => {
  it("lets a proposal be activated or dismissed, but never completed", () => {
    expect(editableActionStatuses("proposed")).toMatchInlineSnapshot(`
      [
        "proposed",
        "active",
        "dismissed",
      ]
    `);
  });

  it("only lets an active action be dismissed", () => {
    expect(editableActionStatuses("active")).toMatchInlineSnapshot(`
      [
        "active",
        "dismissed",
      ]
    `);
  });

  it("keeps terminal states terminal", () => {
    expect(editableActionStatuses("completed")).toMatchInlineSnapshot(`
      [
        "completed",
      ]
    `);
    expect(editableActionStatuses("dismissed")).toMatchInlineSnapshot(`
      [
        "dismissed",
      ]
    `);
  });
});
