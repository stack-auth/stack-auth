import { describe, expect, it } from "vitest";
import { getGtmSuggestionHref, isGtmDemoMode, isGtmDemoModeAvailable } from "./gtm-mode";

describe("isGtmDemoModeAvailable", () => {
  it("is available in the internal project only", () => {
    expect(isGtmDemoModeAvailable("internal")).toBe(true);
    expect(isGtmDemoModeAvailable("some-customer-project")).toBe(false);
  });
});

describe("isGtmDemoMode", () => {
  it("defaults first internal visits to the demo workspace", () => {
    expect(isGtmDemoMode("internal", null)).toBe(true);
  });

  it("uses live mode only when it is explicitly requested internally", () => {
    expect(isGtmDemoMode("internal", "true")).toBe(true);
    expect(isGtmDemoMode("internal", "false")).toBe(false);
  });

  it("never enables demo mode for customer projects, even with an explicit query param", () => {
    expect(isGtmDemoMode("some-customer-project", null)).toBe(false);
    expect(isGtmDemoMode("some-customer-project", "true")).toBe(false);
    expect(isGtmDemoMode("some-customer-project", "false")).toBe(false);
  });
});

describe("getGtmSuggestionHref", () => {
  it("links internal demo suggestions to the demo timeline", () => {
    expect(getGtmSuggestionHref("internal", "insights", "demo-insight", true))
      .toBe("/projects/internal/gtm/insights/demo-insight?demo=true");
    expect(getGtmSuggestionHref("internal", "actions", "demo-action", true))
      .toBe("/projects/internal/gtm/actions/demo-action?demo=true");
  });

  it("does not expose timeline links from the internal live workspace", () => {
    expect(getGtmSuggestionHref("internal", "insights", "live-insight", false)).toBeNull();
  });

  it("keeps customer timeline links free of the internal demo parameter", () => {
    expect(getGtmSuggestionHref("customer-project", "actions", "customer-action", false))
      .toBe("/projects/customer-project/gtm/actions/customer-action");
  });
});
