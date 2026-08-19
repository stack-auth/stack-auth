import { describe, expect, it } from "vitest";
import { getGrowthDemoPhase, isGrowthDemoMode, isGrowthDemoModeAvailable } from "./growth-mode";

describe("isGrowthDemoModeAvailable", () => {
  it("is available in the internal project only", () => {
    expect(isGrowthDemoModeAvailable("internal")).toBe(true);
    expect(isGrowthDemoModeAvailable("some-customer-project")).toBe(false);
  });
});

describe("isGrowthDemoMode", () => {
  it("defaults first internal visits to the demo workspace", () => {
    expect(isGrowthDemoMode("internal", null)).toBe(true);
  });

  it("uses live mode only when it is explicitly requested internally", () => {
    expect(isGrowthDemoMode("internal", "true")).toBe(true);
    expect(isGrowthDemoMode("internal", "false")).toBe(false);
  });

  it("never enables demo mode for customer projects, even with an explicit query param", () => {
    expect(isGrowthDemoMode("some-customer-project", null)).toBe(false);
    expect(isGrowthDemoMode("some-customer-project", "true")).toBe(false);
  });
});

describe("getGrowthDemoPhase", () => {
  it("selects the requested phase internally", () => {
    expect(getGrowthDemoPhase("internal", "analyzing")).toBe("analyzing");
    expect(getGrowthDemoPhase("internal", "not-onboarded")).toBe("not-onboarded");
  });

  it("falls back to steady-state for unknown or missing values", () => {
    expect(getGrowthDemoPhase("internal", null)).toBe("steady-state");
    expect(getGrowthDemoPhase("internal", "nonsense")).toBe("steady-state");
  });

  it("ignores the param entirely outside the internal project", () => {
    expect(getGrowthDemoPhase("some-customer-project", "analyzing")).toBe("steady-state");
  });
});
