import { describe, expect, it } from "vitest";
import { getAppEnableConfigUpdate, getEnabledAppIds, getEnabledNavigableAppIds } from "./apps-utils";

describe("nested app enablement", () => {
  it("inherits Observability enablement without adding a duplicate top-level entry", () => {
    const installed = { analytics: { enabled: true } };
    expect(getEnabledAppIds(installed)).toContain("observability");
    expect(getEnabledNavigableAppIds(installed)).toContain("analytics");
    expect(getEnabledNavigableAppIds(installed)).not.toContain("observability");
  });
});

describe("getAppEnableConfigUpdate", () => {
  it("enables recursively recommended apps", () => {
    expect(getAppEnableConfigUpdate("teams")).toEqual({
      "apps.installed.teams.enabled": true,
      "apps.installed.authentication.enabled": true,
      "apps.installed.emails.enabled": true,
    });
  });

  it("does not add unrelated apps", () => {
    expect(getAppEnableConfigUpdate("analytics")).toEqual({
      "apps.installed.analytics.enabled": true,
    });
  });
});
