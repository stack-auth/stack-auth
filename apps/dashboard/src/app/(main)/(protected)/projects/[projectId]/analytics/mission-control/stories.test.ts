import { describe, expect, it } from "vitest";
import { formatPlaybackTime, getPlaybackStage, INCIDENT_STORIES, interpolateMetric } from "./stories";

describe("INCIDENT_STORIES", () => {
  it("provides four deterministic selectable scenarios", () => {
    expect(INCIDENT_STORIES.map((story) => story.id)).toEqual([
      "safari-webcrypto-checkout",
      "mfa-retry-storm",
      "webhook-poison-message",
      "ai-agent-wrong-refund",
    ]);
  });
});

describe("getPlaybackStage", () => {
  const story = INCIDENT_STORIES[0];

  it("selects the latest stage whose boundary has been reached", () => {
    expect(getPlaybackStage(story, 299_999)?.id).toBe("safari-impact");
    expect(getPlaybackStage(story, 300_000)?.id).toBe("safari-diagnosis");
    expect(getPlaybackStage(story, 300_001)?.id).toBe("safari-diagnosis");
  });

  it("uses the first stage before playback starts and the final stage after playback ends", () => {
    expect(getPlaybackStage(story, -1)?.id).toBe("safari-healthy");
    expect(getPlaybackStage(story, story.durationMs + 1)?.id).toBe("safari-recovery");
  });

  it("returns undefined when a story has no stages", () => {
    expect(getPlaybackStage({ ...story, stages: [] }, 0)).toBeUndefined();
  });
});

describe("interpolateMetric", () => {
  it("interpolates within the range in either direction", () => {
    expect(interpolateMetric(10, 30, 0.25)).toBe(15);
    expect(interpolateMetric(30, 10, 0.25)).toBe(25);
  });

  it("clamps progress at both boundaries", () => {
    expect(interpolateMetric(10, 30, -0.5)).toBe(10);
    expect(interpolateMetric(10, 30, 1.5)).toBe(30);
  });
});

describe("formatPlaybackTime", () => {
  it("formats elapsed milliseconds as minute playback time", () => {
    expect(formatPlaybackTime(0)).toBe("0:00");
    expect(formatPlaybackTime(65_999)).toBe("1:05");
  });

  it("clamps invalid or negative elapsed time to zero", () => {
    expect(formatPlaybackTime(-1)).toBe("0:00");
    expect(formatPlaybackTime(Number.NaN)).toBe("0:00");
  });
});
