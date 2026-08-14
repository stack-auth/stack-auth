import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { describe, expect, it } from "vitest";
import { GROWTH_DEMO_NOW_MILLIS, buildGrowthDemoActions } from "@/lib/growth/growth-demo-data";
import type { GrowthMetricPoint } from "@/lib/growth/growth-types";
import {
  buildGrowthDemoActionMetrics,
  computeDeltaPercent,
  mergeMetricSeries,
  sumMetricSeries,
} from "./metric-comparison-data";

const NOW = GROWTH_DEMO_NOW_MILLIS;

function points(values: [string, number][]): GrowthMetricPoint[] {
  return values.map(([date, value]) => ({ date, value }));
}

describe("computeDeltaPercent", () => {
  it("computes a one-decimal percentage change", () => {
    expect(computeDeltaPercent(110, 100)).toBe(10);
    expect(computeDeltaPercent(90, 100)).toBe(-10);
    expect(computeDeltaPercent(1, 3)).toBe(-66.7);
  });

  it("treats zero → zero as a true 0% change", () => {
    expect(computeDeltaPercent(0, 0)).toBe(0);
  });

  it("returns null (not computable) for a zero baseline with a non-zero current value", () => {
    expect(computeDeltaPercent(5, 0)).toBeNull();
  });

  it("returns null for non-finite inputs", () => {
    expect(computeDeltaPercent(NaN, 100)).toBeNull();
    expect(computeDeltaPercent(100, Infinity)).toBeNull();
  });
});

describe("sumMetricSeries", () => {
  it("sums point values (empty series sums to 0)", () => {
    expect(sumMetricSeries(points([["2026-08-01", 3], ["2026-08-02", 4]]))).toBe(7);
    expect(sumMetricSeries([])).toBe(0);
  });
});

describe("mergeMetricSeries", () => {
  it("merges disjoint windows onto one sorted date axis with nulls for the missing side", () => {
    const rows = mergeMetricSeries(
      points([["2026-08-02", 2], ["2026-08-01", 1]]),
      points([["2026-08-03", 3], ["2026-08-04", 4]]),
    );
    expect(rows).toEqual([
      { date: "2026-08-01", baseline: 1, current: null },
      { date: "2026-08-02", baseline: 2, current: null },
      { date: "2026-08-03", baseline: null, current: 3 },
      { date: "2026-08-04", baseline: null, current: 4 },
    ]);
  });

  it("merges an overlapping date into a single row carrying both values", () => {
    const rows = mergeMetricSeries(points([["2026-08-01", 1]]), points([["2026-08-01", 9]]));
    expect(rows).toEqual([{ date: "2026-08-01", baseline: 1, current: 9 }]);
  });

  it("handles one side being empty", () => {
    expect(mergeMetricSeries(points([["2026-08-01", 1]]), [])).toEqual([
      { date: "2026-08-01", baseline: 1, current: null },
    ]);
  });
});

describe("buildGrowthDemoActionMetrics", () => {
  const actions = buildGrowthDemoActions(NOW);
  const proposedAction = actions.find((action) => action.status === "proposed")
    ?? throwErr("Demo fixtures must include a proposed action.");
  const activeAction = actions.find((action) => action.status === "active")
    ?? throwErr("Demo fixtures must include an active action.");

  it("is deterministic for a fixed now", () => {
    for (const action of actions) {
      expect(buildGrowthDemoActionMetrics(action, NOW)).toEqual(buildGrowthDemoActionMetrics(action, NOW));
    }
  });

  it("produces one series per watched metric with a full before window", () => {
    for (const action of actions) {
      const series = buildGrowthDemoActionMetrics(action, NOW);
      expect(series.map((s) => s.metricId)).toEqual(action.watchedMetrics.map((m) => m.metricId));
      for (const [index, s] of series.entries()) {
        expect(s.windowDays).toBe(action.watchedMetrics[index].windowDays);
        expect(s.before).toHaveLength(s.windowDays);
      }
    }
  });

  it("keeps unactivated actions before-only with no after capture timestamp", () => {
    for (const series of buildGrowthDemoActionMetrics(proposedAction, NOW)) {
      expect(series.after).toEqual([]);
      expect(series.afterCapturedAtMillis).toBeNull();
      expect(series.beforeCapturedAtMillis).toBe(NOW);
    }
  });

  it("gives activated actions an after window covering only the days elapsed since activation", () => {
    const activatedAt = activeAction.activatedAtMillis ?? throwErr("Active demo actions must carry an activation time.");
    const elapsedDays = Math.floor((NOW - activatedAt) / (24 * 60 * 60 * 1000));
    for (const series of buildGrowthDemoActionMetrics(activeAction, NOW)) {
      expect(series.after.length).toBe(Math.min(series.windowDays, elapsedDays));
      expect(series.after.length).toBeGreaterThan(0);
      expect(series.afterCapturedAtMillis).toBe(NOW);
      expect(series.beforeCapturedAtMillis).toBe(activatedAt);
    }
  });

  it("emits sorted ISO dates and finite non-negative values, with before strictly preceding after", () => {
    for (const action of actions) {
      for (const series of buildGrowthDemoActionMetrics(action, NOW)) {
        for (const window of [series.before, series.after]) {
          for (const point of window) {
            expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(Number.isFinite(point.value)).toBe(true);
            expect(point.value).toBeGreaterThanOrEqual(0);
          }
          const dates = window.map((point) => point.date);
          expect([...dates].sort()).toEqual(dates);
        }
        if (series.before.length > 0 && series.after.length > 0) {
          expect(series.before[series.before.length - 1].date < series.after[0].date).toBe(true);
        }
      }
    }
  });
});
