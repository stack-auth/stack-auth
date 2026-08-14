import { describe, expect, it } from "vitest";
import { assertGrowthAdminActionTransition } from "./admin-state";

describe("Growth admin action transitions", () => {
  it.each([
    ["proposed", "proposed"],
    ["proposed", "active"],
    ["proposed", "dismissed"],
    ["active", "active"],
    ["active", "dismissed"],
    ["completed", "completed"],
    ["dismissed", "dismissed"],
  ])("allows %s -> %s", (current, requested) => {
    expect(assertGrowthAdminActionTransition(current, requested)).toBe(requested);
  });

  it.each([
    ["proposed", "completed"],
    ["active", "completed"],
    ["active", "proposed"],
    ["completed", "active"],
    ["dismissed", "active"],
  ])("rejects %s -> %s", (current, requested) => {
    expect(() => assertGrowthAdminActionTransition(current, requested)).toThrow();
  });
});
