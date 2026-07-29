import { describe, expect, it } from "vitest";
import { formatReplayDuration } from "./replay-list-formatting";

describe("replay list formatting", () => {
  it("formats long and invalid durations safely", () => {
    expect(formatReplayDuration(3_661_000)).toBe("1h 1m");
    expect(formatReplayDuration(-1)).toBe("—");
  });
});
