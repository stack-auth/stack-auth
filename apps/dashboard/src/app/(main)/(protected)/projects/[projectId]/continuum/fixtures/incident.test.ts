import { describe, expect, it } from "vitest";
import { formatIncidentTime, getIncidentStage, getStageIndex, INCIDENT_STORY } from "./incident";

describe("continuum incident fixtures", () => {
  it("returns the first stage at t=0", () => {
    const stage = getIncidentStage(INCIDENT_STORY, 0);
    expect(stage.id).toMatchInlineSnapshot(`"act1-ready"`);
    expect(stage.gate?.actionLabel).toMatchInlineSnapshot(`"Start Rollout"`);
  });

  it("advances through acts by offset", () => {
    expect(getIncidentStage(INCIDENT_STORY, 22_000).act).toBe(2);
    expect(getIncidentStage(INCIDENT_STORY, 40_000).act).toBe(3);
    expect(getIncidentStage(INCIDENT_STORY, 95_000).act).toBe(4);
    expect(getIncidentStage(INCIDENT_STORY, 130_000).act).toBe(5);
  });

  it("formats playback time", () => {
    expect(formatIncidentTime(0)).toMatchInlineSnapshot(`"0:00"`);
    expect(formatIncidentTime(65_000)).toMatchInlineSnapshot(`"1:05"`);
  });

  it("resolves stage index for scrubber", () => {
    expect(getStageIndex(INCIDENT_STORY, 0)).toBe(0);
    expect(getStageIndex(INCIDENT_STORY, 40_000)).toBe(3);
  });

  it("closing card protects the demo ARR number", () => {
    expect(INCIDENT_STORY.closingCard.protectedArrUsd).toMatchInlineSnapshot(`184000`);
    expect(INCIDENT_STORY.closingCard.avoidedDowntimeMinutes).toMatchInlineSnapshot(`47`);
  });
});
