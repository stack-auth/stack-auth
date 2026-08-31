import { describe, expect, it } from "vitest";
import {
  buildCumulativeTotalUsersSeries,
  buildReturningUsersSeries,
  sumActivity,
  takeLastDays,
  toGrowthSeries,
} from "./metrics";

const point = (date: string, activity: number) => ({ date, activity });

describe("sumActivity", () => {
  it("sums activity over all points", () => {
    expect(sumActivity([point("2026-08-01", 2), point("2026-08-02", 5), point("2026-08-03", 0)])).toBe(7);
  });

  it("returns 0 for an empty series", () => {
    expect(sumActivity([])).toBe(0);
  });
});

describe("toGrowthSeries", () => {
  it("renames activity to value, preserving order and dates", () => {
    expect(toGrowthSeries([point("2026-08-01", 3), point("2026-08-02", 1)])).toEqual([
      { date: "2026-08-01", value: 3 },
      { date: "2026-08-02", value: 1 },
    ]);
  });
});

describe("buildReturningUsersSeries", () => {
  it("adds retained and reactivated per day", () => {
    const split = {
      total: [point("2026-08-01", 10), point("2026-08-02", 8)],
      new: [point("2026-08-01", 4), point("2026-08-02", 2)],
      retained: [point("2026-08-01", 5), point("2026-08-02", 3)],
      reactivated: [point("2026-08-01", 1), point("2026-08-02", 3)],
    };
    expect(buildReturningUsersSeries(split)).toEqual([
      { date: "2026-08-01", value: 6 },
      { date: "2026-08-02", value: 6 },
    ]);
  });

  it("throws when the split series have different lengths", () => {
    const split = {
      total: [],
      new: [],
      retained: [point("2026-08-01", 5)],
      reactivated: [],
    };
    expect(() => buildReturningUsersSeries(split)).toThrowError(/date-aligned/);
  });

  it("throws when the split series dates are misaligned", () => {
    const split = {
      total: [],
      new: [],
      retained: [point("2026-08-01", 5)],
      reactivated: [point("2026-08-02", 1)],
    };
    expect(() => buildReturningUsersSeries(split)).toThrowError(/share dates/);
  });
});

describe("buildCumulativeTotalUsersSeries", () => {
  it("anchors the last day at the current total and subtracts later signups going backwards", () => {
    const signups = [point("2026-08-01", 2), point("2026-08-02", 0), point("2026-08-03", 5)];
    expect(buildCumulativeTotalUsersSeries(signups, 100)).toEqual([
      { date: "2026-08-01", value: 95 },
      { date: "2026-08-02", value: 95 },
      { date: "2026-08-03", value: 100 },
    ]);
  });

  it("returns an empty series for empty signups", () => {
    expect(buildCumulativeTotalUsersSeries([], 42)).toEqual([]);
  });
});

describe("takeLastDays", () => {
  const series = [
    { date: "2026-08-01", value: 1 },
    { date: "2026-08-02", value: 2 },
    { date: "2026-08-03", value: 3 },
  ];

  it("returns the last N points", () => {
    expect(takeLastDays(series, 2)).toEqual([
      { date: "2026-08-02", value: 2 },
      { date: "2026-08-03", value: 3 },
    ]);
  });

  it("returns the full series when N equals the length", () => {
    expect(takeLastDays(series, 3)).toEqual(series);
  });

  it("throws on non-positive or non-integer day counts", () => {
    expect(() => takeLastDays(series, 0)).toThrowError(/positive integer/);
    expect(() => takeLastDays(series, -1)).toThrowError(/positive integer/);
    expect(() => takeLastDays(series, 1.5)).toThrowError(/positive integer/);
  });

  it("throws when more days are requested than the window has", () => {
    expect(() => takeLastDays(series, 4)).toThrowError(/metrics window/);
  });
});
