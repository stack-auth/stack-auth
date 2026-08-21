import { describe, expect, it } from "vitest";
import { normalizeGrowthOverviewLimit } from "./overview";

describe("Growth overview bounds", () => {
  it("uses the bounded default", () => {
    expect(normalizeGrowthOverviewLimit()).toBe(24);
  });

  it("clamps limits at both endpoint bounds", () => {
    expect(normalizeGrowthOverviewLimit(0)).toBe(1);
    expect(normalizeGrowthOverviewLimit(500)).toBe(50);
  });
});
