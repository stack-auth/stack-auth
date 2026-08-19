import { describe, expect, it } from "vitest";
import { formatGrowthBriefDateHeadline, formatGrowthRelativeTime, formatGrowthThreshold, getGrowthMetricLabel } from "./growth-format";
import { GROWTH_METRIC_IDS } from "./growth-types";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = new Date("2026-08-04T12:00:00.000Z").getTime();

describe("getGrowthMetricLabel", () => {
  it("covers every metric id with a non-empty label", () => {
    for (const metricId of GROWTH_METRIC_IDS) {
      expect(getGrowthMetricLabel(metricId).length).toBeGreaterThan(0);
    }
  });

  it("labels revenue", () => {
    expect(getGrowthMetricLabel("revenue")).toMatchInlineSnapshot(`"Revenue"`);
  });
});

describe("formatGrowthRelativeTime", () => {
  it("collapses sub-minute differences to just now", () => {
    expect(formatGrowthRelativeTime(NOW + 30_000, NOW)).toMatchInlineSnapshot(`"just now"`);
    expect(formatGrowthRelativeTime(NOW - 59_000, NOW)).toMatchInlineSnapshot(`"just now"`);
  });

  it("formats future times", () => {
    expect(formatGrowthRelativeTime(NOW + 5 * MINUTE, NOW)).toMatchInlineSnapshot(`"in 5 minutes"`);
    expect(formatGrowthRelativeTime(NOW + HOUR, NOW)).toMatchInlineSnapshot(`"in 1 hour"`);
    expect(formatGrowthRelativeTime(NOW + 12 * HOUR, NOW)).toMatchInlineSnapshot(`"in 12 hours"`);
    expect(formatGrowthRelativeTime(NOW + 2 * DAY, NOW)).toMatchInlineSnapshot(`"in 2 days"`);
    expect(formatGrowthRelativeTime(NOW + 20 * DAY, NOW)).toMatchInlineSnapshot(`"in 20 days"`);
  });

  it("formats past times", () => {
    expect(formatGrowthRelativeTime(NOW - MINUTE, NOW)).toMatchInlineSnapshot(`"1 minute ago"`);
    expect(formatGrowthRelativeTime(NOW - 5 * HOUR, NOW)).toMatchInlineSnapshot(`"5 hours ago"`);
    expect(formatGrowthRelativeTime(NOW - 5 * DAY, NOW)).toMatchInlineSnapshot(`"5 days ago"`);
  });

  it("rounds to the nearest unit", () => {
    expect(formatGrowthRelativeTime(NOW + 90 * MINUTE, NOW)).toMatchInlineSnapshot(`"in 2 hours"`);
    expect(formatGrowthRelativeTime(NOW - 36 * HOUR, NOW)).toMatchInlineSnapshot(`"2 days ago"`);
  });
});

describe("formatGrowthBriefDateHeadline", () => {
  it("formats an ISO day key in UTC", () => {
    expect(formatGrowthBriefDateHeadline("2026-08-04")).toMatchInlineSnapshot(`"Tuesday, August 4, 2026"`);
    expect(formatGrowthBriefDateHeadline("2026-01-01")).toMatchInlineSnapshot(`"Thursday, January 1, 2026"`);
    expect(formatGrowthBriefDateHeadline("2024-02-29")).toMatchInlineSnapshot(`"Thursday, February 29, 2024"`);
    expect(formatGrowthBriefDateHeadline("2026-12-31")).toMatchInlineSnapshot(`"Thursday, December 31, 2026"`);
  });

  it("throws on anything that is not an ISO day key", () => {
    expect(() => formatGrowthBriefDateHeadline("2026-8-4")).toThrow();
    expect(() => formatGrowthBriefDateHeadline("2026-08-04T00:00:00Z")).toThrow();
    expect(() => formatGrowthBriefDateHeadline("")).toThrow();
  });
});

describe("formatGrowthThreshold", () => {
  it("groups thousands", () => {
    expect(formatGrowthThreshold(5000)).toMatchInlineSnapshot(`"5,000"`);
    expect(formatGrowthThreshold(100)).toMatchInlineSnapshot(`"100"`);
    expect(formatGrowthThreshold(5000000)).toMatchInlineSnapshot(`"5,000,000"`);
  });
});
