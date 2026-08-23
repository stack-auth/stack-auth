import { describe, expect, it } from "vitest";
import { shouldBeatPhaseNow } from "#lib/heartbeat.ts";

describe("phase heartbeat throttling", () => {
  it("beats on the first progress event of a session", () => {
    expect(shouldBeatPhaseNow(null, 5_000)).toBe(true);
  });

  it("skips progress events that arrive within the throttle window", () => {
    expect(shouldBeatPhaseNow(5_000, 5_001)).toBe(false);
    expect(shouldBeatPhaseNow(5_000, 64_999)).toBe(false);
  });

  it("beats again once the window has elapsed, well inside the backend's 15 minute reap window", () => {
    expect(shouldBeatPhaseNow(5_000, 65_000)).toBe(true);
    expect(shouldBeatPhaseNow(5_000, 900_000)).toBe(true);
  });
});
