import { describe, expect, it } from "vitest";
import { getTvSourceStatePresentation } from "./screen-registry";

describe("TV source-state presentation policy", () => {
  it("renders data-bearing states through the screen content", () => {
    expect([
      getTvSourceStatePresentation("ready"),
      getTvSourceStatePresentation("insufficient-data"),
      getTvSourceStatePresentation("stale"),
    ]).toEqual([
      { type: "content" },
      { type: "content" },
      { type: "content" },
    ]);
  });

  it("owns the shared terminal-state copy", () => {
    expect([
      getTvSourceStatePresentation("empty"),
      getTvSourceStatePresentation("unavailable"),
      getTvSourceStatePresentation("error"),
    ]).toMatchInlineSnapshot(`
      [
        {
          "detail": "TV Mode will display this screen when qualifying activity arrives.",
          "eyebrow": "Waiting for activity",
          "message": "There is no qualifying activity in this reporting window.",
          "status": "empty",
          "type": "terminal",
        },
        {
          "detail": "Configure the required app to enable this screen.",
          "eyebrow": "Source unavailable",
          "message": "The required Hexclave app is not enabled for this profile.",
          "status": "unavailable",
          "type": "terminal",
        },
        {
          "detail": "TV Mode will retry this source automatically.",
          "eyebrow": "Source error",
          "message": "This source could not be measured. The rest of the presentation will continue.",
          "status": "error",
          "type": "terminal",
        },
      ]
    `);
  });
});
