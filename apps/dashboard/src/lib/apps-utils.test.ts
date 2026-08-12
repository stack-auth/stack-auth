import { describe, expect, it } from "vitest";

import { getAppEnableConfigUpdate } from "./apps-utils";

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
