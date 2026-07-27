import { describe, expect, it } from "vitest";
import { createTvFixtureSnapshot, getTvProfileFixture } from "@/lib/tv-mode/fixtures";
import { getNextTvScreenIndex, selectTvPresentationView } from "./presentation-controller";

function getProfile() {
  const profile = getTvProfileFixture("company-pulse");
  if (profile == null) throw new Error("Fixture profile is missing");
  return profile;
}

describe("TV presentation controller", () => {
  it("cycles screen indices deterministically", () => {
    expect([
      getNextTvScreenIndex(0, 4),
      getNextTvScreenIndex(3, 4),
      getNextTvScreenIndex(0, 0),
    ]).toMatchInlineSnapshot(`
      [
        1,
        0,
        0,
      ]
    `);
  });

  it("prioritizes a persistent takeover over the playlist", () => {
    const snapshot = createTvFixtureSnapshot("project-fixture", getProfile(), "critical-takeover");
    expect(selectTvPresentationView(snapshot, 2, false)).toMatchInlineSnapshot(`
      {
        "presentedEvent": {
          "decision": {
            "displayForSeconds": null,
            "eventId": "fixture-email-delivery-degradation",
            "preemptible": false,
            "priority": 3,
            "treatment": "persistent-takeover",
          },
          "event": {
            "id": "fixture-email-delivery-degradation",
            "kind": "incident",
            "metricLabel": "Delivery rate",
            "metricValue": "82.4%",
            "severity": "critical",
            "sourceLabel": "Hexclave email",
            "startedAt": "2026-07-23T14:28:00.000Z",
            "summary": "Delivery failures are above the configured threshold.",
            "title": "Email delivery degraded",
            "type": "email-delivery-degradation",
          },
        },
        "type": "takeover",
      }
    `);
  });

  it("returns to the playlist after a temporary takeover is dismissed", () => {
    const snapshot = createTvFixtureSnapshot("project-fixture", getProfile(), "temporary-takeover");
    expect(selectTvPresentationView(snapshot, 2, true)).toEqual({ type: "screen", screenIndex: 2 });
  });

  it("surfaces fatal snapshot failures before all presentation content", () => {
    const snapshot = createTvFixtureSnapshot("project-fixture", getProfile(), "error");
    expect(selectTvPresentationView(snapshot, 0, false)).toEqual({
      type: "fatal-error",
      message: "The presentation snapshot could not be prepared.",
    });
  });
});
