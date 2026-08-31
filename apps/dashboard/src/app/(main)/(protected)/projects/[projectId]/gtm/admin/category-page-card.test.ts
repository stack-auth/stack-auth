import { describe, expect, test } from "vitest";
import { expectedDraftUpdatedAtMillis, hasUnsavedEdits, isSupersededByStored, seedKeyOf, shouldSeedFromStored, type Seed } from "./category-page-card";

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
    expect(hasUnsavedEdits(null, { mdx: "", dataJson: "[]" })).toBe(false);
  });
});

describe("shouldSeedFromStored", () => {
  const stored = seedKeyOf("conversion", { id: "draft-1", updatedAtMillis: 2_000 }, null);
  const previous = seedKeyOf("conversion", { id: "draft-1", updatedAtMillis: 1_000 }, null);

  test("fills the editor from a stored version it is not based on", () => {
    expect(shouldSeedFromStored({ storedKey: stored, seededKey: previous, dirty: false, mutating: false })).toBe(true);
    expect(shouldSeedFromStored({ storedKey: stored, seededKey: stored, dirty: false, mutating: false })).toBe(false);
    expect(shouldSeedFromStored({ storedKey: null, seededKey: null, dirty: false, mutating: false })).toBe(false);
  });

  test("leaves unsaved edits alone", () => {
    expect(shouldSeedFromStored({ storedKey: stored, seededKey: previous, dirty: true, mutating: false })).toBe(false);
  });

  test("ignores the pre-mutation version while a save is in flight", () => {
    expect(shouldSeedFromStored({ storedKey: previous, seededKey: stored, dirty: false, mutating: true })).toBe(false);
    expect(shouldSeedFromStored({ storedKey: previous, seededKey: stored, dirty: false, mutating: false })).toBe(true);
  });
});

describe("isSupersededByStored", () => {
  const stored = seedKeyOf("conversion", { id: "draft-1", updatedAtMillis: 2_000 }, null);
  const previous = seedKeyOf("conversion", { id: "draft-1", updatedAtMillis: 1_000 }, null);

  test("warns only about a stored version that is really someone else's", () => {
    expect(isSupersededByStored({ storedKey: stored, seededKey: previous, dirty: true, mutating: false })).toBe(true);
    expect(isSupersededByStored({ storedKey: stored, seededKey: previous, dirty: false, mutating: false })).toBe(false);
    expect(isSupersededByStored({ storedKey: previous, seededKey: stored, dirty: true, mutating: true })).toBe(false);
  });
});

describe("expectedDraftUpdatedAtMillis", () => {
  test("keeps a seed's null timestamp instead of the refreshed draft's", () => {
    const fromNoDraft = seed({ key: seedKeyOf("conversion", null, null), draftUpdatedAtMillis: null });

    expect(expectedDraftUpdatedAtMillis(fromNoDraft, { updatedAtMillis: 5_000 })).toBe(null);
    expect(expectedDraftUpdatedAtMillis(seed({ draftUpdatedAtMillis: 1_000 }), { updatedAtMillis: 5_000 })).toBe(1_000);
  });

  test("falls back to the loaded draft only when nothing has been seeded", () => {
    expect(expectedDraftUpdatedAtMillis(null, { updatedAtMillis: 5_000 })).toBe(5_000);
    expect(expectedDraftUpdatedAtMillis(null, null)).toBe(null);
  });
});
