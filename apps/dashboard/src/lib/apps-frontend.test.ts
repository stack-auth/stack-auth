import { describe, expect, it } from "vitest";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import {
  ALL_APPS_FRONTEND,
  DUMMY_ORIGIN,
  getItemPath,
  testItemPath,
} from "./apps-frontend";

describe("TV Mode navigation matching", () => {
  const projectId = "project-fixture";
  const app = ALL_APPS_FRONTEND["tv-mode"];
  const profilesItem = app.navigationItems.at(0)
    ?? throwErr("TV Mode navigation must include a profiles item");
  const displaysItem = app.navigationItems.at(1)
    ?? throwErr("TV Mode navigation must include a displays item");

  function matches(path: string) {
    const url = new URL(path, DUMMY_ORIGIN);
    return {
      profiles: testItemPath(projectId, app, profilesItem, url),
      displays: testItemPath(projectId, app, displaysItem, url),
    };
  }

  it("keeps profile and display active states mutually exclusive", () => {
    expect({
      profilesIndex: matches(`/projects/${projectId}/tv-mode`),
      profilesRoutePrefix: matches(`/projects/${projectId}/tv-mode/profiles`),
      profileDetail: matches(`/projects/${projectId}/tv-mode/profiles/company-pulse`),
      displays: matches(`/projects/${projectId}/tv-mode/displays`),
      presentation: matches(`/projects/${projectId}/tv-mode/present/company-pulse`),
    }).toMatchInlineSnapshot(`
      {
        "displays": {
          "displays": true,
          "profiles": false,
        },
        "presentation": {
          "displays": false,
          "profiles": false,
        },
        "profileDetail": {
          "displays": false,
          "profiles": true,
        },
        "profilesIndex": {
          "displays": false,
          "profiles": true,
        },
        "profilesRoutePrefix": {
          "displays": false,
          "profiles": true,
        },
      }
    `);
  });

  it("builds project-scoped profile and display destinations without a profile id", () => {
    expect(app.navigationItems.map((item) => ({
      displayName: item.displayName,
      pathname: new URL(getItemPath(projectId, app, item), DUMMY_ORIGIN).pathname,
    }))).toEqual([
      { displayName: "Profiles", pathname: `/projects/${projectId}/tv-mode/` },
      { displayName: "Displays", pathname: `/projects/${projectId}/tv-mode/displays` },
    ]);
  });
});
