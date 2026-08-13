import { describe, expect, it } from "vitest";
import { ALL_APPS } from "@hexclave/shared/dist/apps/apps-config";

import { getAppEnableConfigUpdate, getAppIdsForListing } from "./apps-utils";

describe("getAppIdsForListing", () => {
  it("hides alpha apps unless they are enabled", () => {
    const alphaAppIds = Object.entries(ALL_APPS)
      .filter(([, app]) => app.stage === "alpha")
      .map(([appId]) => appId);

    expect(getAppIdsForListing()).not.toEqual(expect.arrayContaining(alphaAppIds));
    expect(getAppIdsForListing(["support"])).toContain("support");
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
