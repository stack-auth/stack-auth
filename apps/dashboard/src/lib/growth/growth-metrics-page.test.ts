import { describe, expect, it } from "vitest";
import { formatGrowthAdSpend, formatGrowthMetricValue } from "./growth-format";
import {
  buildGrowthDemoMetricsOverview,
  computeGrowthOverviewDeltaPercent,
  formatGrowthMetricDayTick,
  groupGrowthMetricsByCategory,
  summarizeGrowthMetric,
} from "./growth-metrics-page";
import { GROWTH_CATALOG_METRIC_CATEGORIES, type GrowthMetricPoint, type GrowthMetricsOverviewMetric } from "./growth-types";

const DAY_MILLIS = 24 * 60 * 60 * 1000;
// A fixed demo anchor (2026-08-04T12:00:00Z); tests never use the real clock.
const NOW_MILLIS = Date.UTC(2026, 7, 4, 12);

function dayKey(daysAgo: number): string {
  return new Date(NOW_MILLIS - daysAgo * DAY_MILLIS).toISOString().slice(0, 10);
}

function flowSeries(days: number, value: (daysAgo: number) => number): GrowthMetricPoint[] {
  const series: GrowthMetricPoint[] = [];
  for (let daysAgo = days - 1; daysAgo >= 0; daysAgo--) {
    series.push({ date: dayKey(daysAgo), value: value(daysAgo) });
  }
  return series;
}

function metricFixture(overrides: Partial<GrowthMetricsOverviewMetric> = {}): GrowthMetricsOverviewMetric {
  const series = overrides.series ?? [];
  return {
    id: "new_users",
    label: "New users",
    unit: "count",
    category: "users",
    kind: "flow",
    description: "Users who signed up that day.",
    latest: series.length === 0 ? null : series[series.length - 1],
    series,
    ...overrides,
  };
}

describe("formatGrowthMetricValue", () => {
  it("formats counts with thousands separators and no decimals", () => {
    expect(formatGrowthMetricValue(1234567, "count")).toBe("1,234,567");
    expect(formatGrowthMetricValue(0, "count")).toBe("0");
  });

  it("formats cents as USD currency", () => {
    expect(formatGrowthMetricValue(41250, "cents")).toBe("$412.50");
    expect(formatGrowthMetricValue(920000, "cents")).toBe("$9,200.00");
  });

  it("formats percents with one decimal place", () => {
    expect(formatGrowthMetricValue(98.437, "percent")).toBe("98.4%");
    expect(formatGrowthMetricValue(0, "percent")).toBe("0.0%");
  });

  it("formats seconds as human durations", () => {
    expect(formatGrowthMetricValue(42, "seconds")).toBe("42s");
    expect(formatGrowthMetricValue(320, "seconds")).toBe("5m 20s");
    expect(formatGrowthMetricValue(3900, "seconds")).toBe("1h 05m");
  });

  it("refuses minor_units (they need the per-account currency)", () => {
    expect(() => formatGrowthMetricValue(100, "minor_units")).toThrow(/formatGrowthAdSpend/);
  });
});

describe("formatGrowthAdSpend", () => {
  it("converts minor units using the currency's own decimal count", () => {
    expect(formatGrowthAdSpend(250075, "USD")).toBe("$2,500.75");
    // JPY has zero minor-unit decimals, so the value passes through unscaled.
    expect(formatGrowthAdSpend(250075, "JPY")).toBe("¥250,075");
  });

  it("falls back to a labeled raw number when the currency is missing or malformed", () => {
    expect(formatGrowthAdSpend(1234, "")).toBe("1,234 (minor units)");
    expect(formatGrowthAdSpend(1234, "US")).toBe("1,234 (minor units)");
  });
});

describe("groupGrowthMetricsByCategory", () => {
  it("groups in canonical category order and omits empty categories", () => {
    const metrics = [
      metricFixture({ id: "revenue_cents", category: "revenue" }),
      metricFixture({ id: "new_users", category: "users" }),
      metricFixture({ id: "total_users", category: "users" }),
    ];
    const groups = groupGrowthMetricsByCategory(metrics);
    expect([...groups.keys()]).toEqual(["users", "revenue"]);
    expect(groups.get("users")?.map((metric) => metric.id)).toEqual(["new_users", "total_users"]);
  });
});

describe("computeGrowthOverviewDeltaPercent", () => {
  it("matches the canonical null semantics (zero baseline, non-finite inputs)", () => {
    expect(computeGrowthOverviewDeltaPercent(110, 100)).toBe(10);
    expect(computeGrowthOverviewDeltaPercent(90, 100)).toBe(-10);
    expect(computeGrowthOverviewDeltaPercent(0, 0)).toBe(0);
    expect(computeGrowthOverviewDeltaPercent(5, 0)).toBeNull();
    expect(computeGrowthOverviewDeltaPercent(Number.NaN, 100)).toBeNull();
    expect(computeGrowthOverviewDeltaPercent(100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("summarizeGrowthMetric", () => {
  it("returns null for an empty series", () => {
    expect(summarizeGrowthMetric(metricFixture({ series: [] }))).toBeNull();
  });

  it("sums count flows over the last 30 days and compares against the prior 30", () => {
    // 60 days: prior window is all 1s, current window all 2s → +100%.
    const series = flowSeries(60, (daysAgo) => (daysAgo >= 30 ? 1 : 2));
    const summary = summarizeGrowthMetric(metricFixture({ series }));
    expect(summary).toEqual({
      primaryValue: 60,
      delta: 100,
      label: "Last 30 days",
      comparisonLabel: "vs the 30 days before",
    });
  });

  it("averages percent flows instead of summing them", () => {
    const series = flowSeries(60, (daysAgo) => (daysAgo >= 30 ? 40 : 50));
    const summary = summarizeGrowthMetric(metricFixture({ unit: "percent", series }));
    expect(summary?.primaryValue).toBe(50);
    expect(summary?.delta).toBe(25);
    expect(summary?.label).toBe("Last 30 days (avg)");
  });

  it("averages seconds flows instead of summing them", () => {
    const series = flowSeries(60, () => 120);
    const summary = summarizeGrowthMetric(metricFixture({ unit: "seconds", series }));
    expect(summary?.primaryValue).toBe(120);
    expect(summary?.delta).toBe(0);
  });

  it("reports a null flow delta when there is no prior-window data", () => {
    const series = flowSeries(10, () => 3);
    const summary = summarizeGrowthMetric(metricFixture({ series }));
    expect(summary?.primaryValue).toBe(30);
    expect(summary?.delta).toBeNull();
  });

  it("anchors the flow windows at the series' own latest day, not today", () => {
    // Series ends 40 days ago; a "today"-anchored window would be empty and the delta bogus.
    const series: GrowthMetricPoint[] = [];
    for (let daysAgo = 99; daysAgo >= 40; daysAgo--) {
      series.push({ date: dayKey(daysAgo), value: daysAgo >= 70 ? 1 : 2 });
    }
    const summary = summarizeGrowthMetric(metricFixture({ series }));
    expect(summary?.primaryValue).toBe(60);
    expect(summary?.delta).toBe(100);
  });

  it("compares snapshots against the newest point at least 30 days older", () => {
    const series = flowSeries(45, (daysAgo) => 1000 + (44 - daysAgo) * 10);
    const summary = summarizeGrowthMetric(metricFixture({ kind: "snapshot", series }));
    expect(summary?.primaryValue).toBe(1440);
    // Baseline is the point exactly 30 days before the anchor: 1000 + 14*10 = 1140.
    expect(summary?.delta).toBe(Number((((1440 - 1140) / 1140) * 100).toFixed(1)));
    expect(summary?.label).toBe("Current");
    expect(summary?.comparisonLabel).toBe(`as of ${dayKey(0)} · vs 30 days ago`);
  });

  it("reports a null snapshot delta when the history is shorter than 30 days", () => {
    const series = flowSeries(20, () => 500);
    const summary = summarizeGrowthMetric(metricFixture({ kind: "snapshot", series }));
    expect(summary?.primaryValue).toBe(500);
    expect(summary?.delta).toBeNull();
  });

  it("throws on malformed series dates instead of computing garbage", () => {
    expect(() => summarizeGrowthMetric(metricFixture({ series: [{ date: "08/04/2026", value: 1 }] }))).toThrow(/ISO day keys/);
  });
});

describe("formatGrowthMetricDayTick", () => {
  it("renders day keys as short month-day ticks and passes other strings through", () => {
    expect(formatGrowthMetricDayTick("2026-08-04")).toBe("Aug 4");
    expect(formatGrowthMetricDayTick("2026-01-31")).toBe("Jan 31");
    expect(formatGrowthMetricDayTick("not-a-date")).toBe("not-a-date");
  });
});

describe("buildGrowthDemoMetricsOverview", () => {
  const overview = buildGrowthDemoMetricsOverview(NOW_MILLIS);

  it("is deterministic for a fixed now", () => {
    expect(buildGrowthDemoMetricsOverview(NOW_MILLIS)).toEqual(overview);
  });

  it("covers every category of the wire vocabulary", () => {
    const covered = new Set(overview.metrics.map((metric) => metric.category));
    for (const category of GROWTH_CATALOG_METRIC_CATEGORIES) {
      expect(covered.has(category)).toBe(true);
    }
  });

  it("keeps latest consistent with the series and dates inside the window", () => {
    expect(overview.windowDays).toBe(90);
    expect(overview.latestStoredDate).toBe(dayKey(0));
    for (const metric of overview.metrics) {
      if (metric.series.length === 0) {
        expect(metric.latest).toBeNull();
        continue;
      }
      expect(metric.latest).toEqual(metric.series[metric.series.length - 1]);
      expect(metric.series.length).toBeLessThanOrEqual(90);
      const dates = metric.series.map((point) => point.date);
      expect([...dates].sort()).toEqual(dates);
    }
  });

  it("includes at least one empty series so the per-metric empty state is demoable", () => {
    expect(overview.metrics.some((metric) => metric.series.length === 0)).toBe(true);
  });

  it("ships one demo ad account with a non-UTC timezone and 90 days of correlated data", () => {
    expect(overview.adAccounts).toHaveLength(1);
    const account = overview.adAccounts[0];
    expect(account.accountTimezone).toBe("America/Los_Angeles");
    expect(account.currency).toBe("USD");
    expect(account.series).toHaveLength(90);
    for (const point of account.series) {
      expect(point.spendMinor).toBeGreaterThan(0);
      expect(point.impressions).toBeGreaterThan(point.clicks);
    }
  });
});
