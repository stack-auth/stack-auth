import { ALL_APPS } from "../apps/apps-config";
import { applyOrganizationDefaults } from "./schema";
import { expect, test } from "vitest";

test("agent-auth is absent from default installed apps", () => {
  const defaults = applyOrganizationDefaults({});

  expect(Object.keys(defaults.apps.installed)).not.toContain("agent-auth");
});

test("agent-auth stays explicitly enableable", () => {
  const defaults = applyOrganizationDefaults({
    apps: {
      installed: {
        "agent-auth": {
          enabled: true,
        },
      },
    },
  });

  expect(defaults.apps.installed["agent-auth"].enabled).toBe(true);
  expect(ALL_APPS["agent-auth"].independentlyEnableable).toBe(true);
});
