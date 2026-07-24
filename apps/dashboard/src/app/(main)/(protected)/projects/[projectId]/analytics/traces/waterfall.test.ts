import { describe, expect, it } from "vitest";
import { shouldShowCollapseControl } from "./waterfall";

describe("shouldShowCollapseControl", () => {
  it("only exposes collapse controls when the active mode honors collapsed state", () => {
    expect(shouldShowCollapseControl("signal", true)).toBe(false);
    expect(shouldShowCollapseControl("all", true)).toBe(true);
    expect(shouldShowCollapseControl("all", false)).toBe(false);
  });
});
