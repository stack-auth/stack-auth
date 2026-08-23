import { describe, expect, test } from "vitest";
import { hasUnsavedEdits, seedKeyOf, type Seed } from "./category-page-card";

function seed(overrides: Partial<Seed> = {}): Seed {
  return {
    key: seedKeyOf("conversion", { id: "draft-1", updatedAtMillis: 1_000 }, null),
    mdx: "## Where signups are lost",
    dataJson: "[]",
    draftUpdatedAtMillis: 1_000,
    ...overrides,
  };
}

describe("seedKeyOf", () => {
  test("changes when a slot's version is replaced or re-saved", () => {
    const empty = seedKeyOf("conversion", null, null);
    const drafted = seedKeyOf("conversion", { id: "draft-1", updatedAtMillis: 1_000 }, null);
    const resaved = seedKeyOf("conversion", { id: "draft-1", updatedAtMillis: 2_000 }, null);
    const published = seedKeyOf("conversion", { id: "draft-1", updatedAtMillis: 2_000 }, { id: "live-1", updatedAtMillis: 2_000 });

    expect(new Set([empty, drafted, resaved, published]).size).toBe(4);
    // Same stored state, so an unrelated refresh must not look like someone else's edit.
    expect(seedKeyOf("conversion", { id: "draft-1", updatedAtMillis: 1_000 }, null)).toBe(drafted);
    expect(seedKeyOf("retention", { id: "draft-1", updatedAtMillis: 1_000 }, null)).not.toBe(drafted);
  });
});

describe("hasUnsavedEdits", () => {
  test("keeps text typed while a save is in flight from being treated as saved", () => {
    const current = seed();

    expect(hasUnsavedEdits(current, { mdx: current.mdx, dataJson: current.dataJson })).toBe(false);
    expect(hasUnsavedEdits(current, { mdx: `${current.mdx}\n\nand also this`, dataJson: current.dataJson })).toBe(true);
    expect(hasUnsavedEdits(current, { mdx: current.mdx, dataJson: "[{}]" })).toBe(true);
    // Nothing has been seeded yet, so the editor's starting blank cannot be an unsaved edit.
    expect(hasUnsavedEdits(null, { mdx: "", dataJson: "[]" })).toBe(false);
  });
});
