import { describe, expect, test } from "vitest";
import { type InstalledAppsMap, isAppEnabledInInstalledApps } from "./apps-config";

describe("isAppEnabledInInstalledApps", () => {
  test("independently-enableable apps use their own enabled flag", () => {
    const installedApps: InstalledAppsMap = {
      authentication: { enabled: true },
      "agent-auth": { enabled: false },
    };

    expect(isAppEnabledInInstalledApps(installedApps, "agent-auth")).toBe(false);

    installedApps["agent-auth"] = { enabled: true };
    expect(isAppEnabledInInstalledApps(installedApps, "agent-auth")).toBe(true);
  });

  test("normal sub-apps still inherit from their parent", () => {
    const installedApps: InstalledAppsMap = {
      analytics: { enabled: true },
      "session-replays": { enabled: false },
    };

    expect(isAppEnabledInInstalledApps(installedApps, "session-replays")).toBe(true);

    installedApps.analytics = { enabled: false };
    expect(isAppEnabledInInstalledApps(installedApps, "session-replays")).toBe(false);
  });
});
