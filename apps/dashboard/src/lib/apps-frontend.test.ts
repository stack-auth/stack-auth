import { describe, expect, it } from "vitest";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import {
  ALL_APPS_FRONTEND,
  DUMMY_ORIGIN,
  testItemPath,
} from "./apps-frontend";

describe("TV Mode navigation matching", () => {
  const projectId = "project-fixture";
  const app = ALL_APPS_FRONTEND["tv-mode"];
  const overviewItem = app.navigationItems.at(0)
    ?? throwErr("TV Mode navigation must include an overview item");
  const profilesItem = app.navigationItems.at(1)
    ?? throwErr("TV Mode navigation must include a profiles item");

  function matches(path: string) {
    const url = new URL(path, DUMMY_ORIGIN);
    return {
      overview: testItemPath(projectId, app, overviewItem, url),
      profiles: testItemPath(projectId, app, profilesItem, url),
    };
  }

  it("keeps overview and profile active states mutually exclusive", () => {
    expect({
      overview: matches(`/projects/${projectId}/tv-mode`),
      profilesIndex: matches(`/projects/${projectId}/tv-mode/profiles`),
      profileDetail: matches(`/projects/${projectId}/tv-mode/profiles/company-pulse`),
      presentation: matches(`/projects/${projectId}/tv-mode/present/company-pulse`),
    }).toMatchInlineSnapshot(`
      {
        "overview": {
          "overview": true,
          "profiles": false,
        },
        "presentation": {
          "overview": false,
          "profiles": false,
        },
        "profileDetail": {
          "overview": false,
          "profiles": true,
        },
        "profilesIndex": {
          "overview": false,
          "profiles": true,
        },
      }
    `);
  });
});
