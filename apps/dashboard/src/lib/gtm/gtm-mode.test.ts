import { describe, expect, it } from "vitest";
import { isGtmDemoMode } from "./gtm-mode";

describe("isGtmDemoMode", () => {
  it("defaults first visits to the demo workspace", () => {
    expect(isGtmDemoMode(null)).toBe(true);
  });

  it("uses live mode only when it is explicitly requested", () => {
    expect(isGtmDemoMode("true")).toBe(true);
    expect(isGtmDemoMode("false")).toBe(false);
  });
});
