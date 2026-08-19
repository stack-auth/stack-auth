import { describe, expect, it } from "vitest";
import { getGrowthComputeMetricsTickerFrame } from "./growth-compute-metrics-ticker";

const LABELS = ["Total users", "New users", "Daily active users", "Revenue", "Page views"];

describe("getGrowthComputeMetricsTickerFrame", () => {
  it("returns null for an empty label list and for nonsensical inputs", () => {
    expect(getGrowthComputeMetricsTickerFrame([], 0, 3)).toBeNull();
    expect(getGrowthComputeMetricsTickerFrame(LABELS, -1, 3)).toBeNull();
    expect(getGrowthComputeMetricsTickerFrame(LABELS, 0, -1)).toBeNull();
  });

  it("starts at the first label with nothing done", () => {
    expect(getGrowthComputeMetricsTickerFrame(LABELS, 0, 3)).toEqual({ done: [], current: "Total users" });
  });

  it("grows the done window until it hits the cap, then slides it", () => {
    expect(getGrowthComputeMetricsTickerFrame(LABELS, 1, 3)).toEqual({ done: ["Total users"], current: "New users" });
    expect(getGrowthComputeMetricsTickerFrame(LABELS, 2, 3)).toEqual({ done: ["Total users", "New users"], current: "Daily active users" });
    expect(getGrowthComputeMetricsTickerFrame(LABELS, 3, 3)).toEqual({ done: ["Total users", "New users", "Daily active users"], current: "Revenue" });
    // The window is capped: the oldest done label falls off.
    expect(getGrowthComputeMetricsTickerFrame(LABELS, 4, 3)).toEqual({ done: ["New users", "Daily active users", "Revenue"], current: "Page views" });
  });

  it("loops back to a fresh pass once the list is exhausted", () => {
    expect(getGrowthComputeMetricsTickerFrame(LABELS, 5, 3)).toEqual({ done: [], current: "Total users" });
    expect(getGrowthComputeMetricsTickerFrame(LABELS, 6, 3)).toEqual({ done: ["Total users"], current: "New users" });
    // Many passes later the frame is identical — the sequence is a pure function of tick.
    expect(getGrowthComputeMetricsTickerFrame(LABELS, 5 * 7 + 2, 3)).toEqual(getGrowthComputeMetricsTickerFrame(LABELS, 2, 3));
  });

  it("respects a zero done-window", () => {
    expect(getGrowthComputeMetricsTickerFrame(LABELS, 3, 0)).toEqual({ done: [], current: "Revenue" });
  });

  it("handles a single-label list without ever showing it as done", () => {
    expect(getGrowthComputeMetricsTickerFrame(["Total users"], 0, 3)).toEqual({ done: [], current: "Total users" });
    expect(getGrowthComputeMetricsTickerFrame(["Total users"], 41, 3)).toEqual({ done: [], current: "Total users" });
  });
});
