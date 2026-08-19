import { describe, expect, it } from "vitest";
import { assertGrowthCategory, assertGrowthCategoryScore, GROWTH_CATEGORIES, GROWTH_NOTE_KIND, normalizeGrowthTags, normalizeStoredGrowthCategory } from "./categories";

describe("Growth categories", () => {
  it("accepts every configured category and rejects unknown values", () => {
    for (const category of GROWTH_CATEGORIES) expect(assertGrowthCategory(category)).toBe(category);
    expect(() => assertGrowthCategory("general")).toThrow(/Unknown growth category/);
  });

  it("maps the previous taxonomy into the five-stage journey on reads", () => {
    expect(normalizeStoredGrowthCategory("engagement")).toBe("product");
    expect(normalizeStoredGrowthCategory("acquisition")).toBe("reach");
    expect(normalizeStoredGrowthCategory("content")).toBe("reach");
    expect(normalizeStoredGrowthCategory("ads")).toBe("reach");
    expect(normalizeStoredGrowthCategory("activation")).toBe("conversion");
    expect(normalizeStoredGrowthCategory("unknown")).toBeNull();
  });

  it("normalizes and de-duplicates tags without changing their order", () => {
    expect(normalizeGrowthTags(["Paid Acquisition", "seo", "paid-acquisition"]))
      .toEqual(["paid-acquisition", "seo"]);
  });

  it("rejects malformed and excessive tags", () => {
    expect(() => normalizeGrowthTags(["not/valid"])).toThrow(/Invalid growth tag/);
    expect(() => normalizeGrowthTags(Array.from({ length: 11 }, (_, index) => `tag-${index}`))).toThrow(/at most 10/);
  });

  it("accepts whole-number scores across the full range and rejects everything else", () => {
    for (const score of [0, 1, 50, 99, 100]) expect(assertGrowthCategoryScore(score)).toBe(score);
    for (const score of [-1, 101, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertGrowthCategoryScore(score)).toThrow(/score must be an integer from 0 to 100/);
    }
  });

  it("pins the note kind", () => {
    // The overview's findings-vs-notes lane split keys on this exact string, and pre-existing
    // admin-authored notes were written with it — changing it silently empties the Notes lane and
    // dumps every historical note into Findings.
    expect(GROWTH_NOTE_KIND).toBe("note");
  });
});
