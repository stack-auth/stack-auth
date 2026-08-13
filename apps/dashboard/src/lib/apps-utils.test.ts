import { describe, expect, it } from "vitest";
import { getAppEnableConfigUpdate, getEnabledAppIds, getEnabledNavigableAppIds } from "./apps-utils";

describe("app enablement", () => {
  it("enables Warehouse and Observability independently as top-level apps", () => {
    const installed = {
      analytics: { enabled: true },
      warehouse: { enabled: true },
      observability: { enabled: true },
    };
    expect(getEnabledAppIds({ analytics: { enabled: true } })).not.toContain("observability");
    expect(getEnabledAppIds({ analytics: { enabled: true } })).not.toContain("warehouse");
    expect(getEnabledAppIds(installed)).toContain("observability");
    expect(getEnabledAppIds(installed)).toContain("warehouse");
    expect(getEnabledNavigableAppIds(installed)).toEqual([
      "analytics",
      "observability",
      "warehouse",
    ]);
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
