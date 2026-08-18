import { describe, expect, it } from "vitest";
import { GROWTH_METRIC_CATALOG } from "./metric-catalog";
import {
  buildGrowthMetricsOverviewBody,
  GROWTH_METRICS_OVERVIEW_WINDOW_DAYS,
  type GrowthMetricsOverviewAdRow,
  type GrowthMetricsOverviewMetricRow,
} from "./metrics-overview";

const metricRow = (metricId: string, date: string, value: number): GrowthMetricsOverviewMetricRow => ({
  metric_id: metricId,
  date,
  value,
});

const adRow = (accountId: string, date: string, overrides: Partial<GrowthMetricsOverviewAdRow> = {}): GrowthMetricsOverviewAdRow => ({
  account_id: accountId,
  account_timezone: "America/Los_Angeles",
  currency: "USD",
  date,
  spend_minor: 1000,
  impressions: 5000,
  clicks: 120,
  ...overrides,
});

describe("buildGrowthMetricsOverviewBody", () => {
  it("includes every stored non-ads catalog entry, even without rows", () => {
    const body = buildGrowthMetricsOverviewBody(GROWTH_METRIC_CATALOG, [], []);
    const expectedIds = GROWTH_METRIC_CATALOG
      .filter((entry) => entry.availability === "stored" && entry.category !== "ads")
      .map((entry) => entry.id);
    expect(body.metrics.map((metric) => metric.id)).toEqual(expectedIds);
    for (const metric of body.metrics) {
      expect(metric.latest).toBeNull();
      expect(metric.series).toEqual([]);
    }
    expect(body.window_days).toBe(GROWTH_METRICS_OVERVIEW_WINDOW_DAYS);
    expect(body.latest_stored_date).toBeNull();
    expect(body.ad_accounts).toEqual([]);
  });

  it("never includes the ads catalog entries in metrics (ads data rides in ad_accounts)", () => {
    const body = buildGrowthMetricsOverviewBody(GROWTH_METRIC_CATALOG, [
      // Even if someone wrote ads ids into growth_daily_metrics, they must not surface as product metrics.
      metricRow("ad_spend_minor", "2026-08-01", 123),
    ], [adRow("act_1", "2026-08-01")]);
    const ids = new Set(body.metrics.map((metric) => metric.id));
    expect(ids.has("ad_spend_minor")).toBe(false);
    expect(ids.has("ad_impressions")).toBe(false);
    expect(ids.has("ad_clicks")).toBe(false);
  });

  it("never includes on_the_fly or not_possible catalog entries", () => {
    const body = buildGrowthMetricsOverviewBody(GROWTH_METRIC_CATALOG, [], []);
    const nonStoredIds = GROWTH_METRIC_CATALOG
      .filter((entry) => entry.availability !== "stored")
      .map((entry) => entry.id);
    const ids = new Set(body.metrics.map((metric) => metric.id));
    for (const id of nonStoredIds) {
      expect(ids.has(id)).toBe(false);
    }
  });

  it("joins rows onto the catalog vocabulary with label/unit/kind/description", () => {
    const body = buildGrowthMetricsOverviewBody(GROWTH_METRIC_CATALOG, [
      metricRow("new_users", "2026-08-01", 4),
      metricRow("new_users", "2026-08-02", 7),
    ], []);
    const newUsers = body.metrics.find((metric) => metric.id === "new_users");
    expect(newUsers).toMatchObject({
      label: "New users",
      unit: "count",
      category: "users",
      kind: "flow",
    });
    expect(newUsers?.description.length).toBeGreaterThan(0);
    expect(newUsers?.series).toEqual([
      { date: "2026-08-01", value: 4 },
      { date: "2026-08-02", value: 7 },
    ]);
    expect(newUsers?.latest).toEqual({ date: "2026-08-02", value: 7 });
  });

  it("sorts series by date and picks the max date as latest, regardless of input order", () => {
    const body = buildGrowthMetricsOverviewBody(GROWTH_METRIC_CATALOG, [
      metricRow("dau", "2026-08-03", 30),
      metricRow("dau", "2026-08-01", 10),
      metricRow("dau", "2026-08-02", 20),
    ], []);
    const dau = body.metrics.find((metric) => metric.id === "dau");
    expect(dau?.series.map((point) => point.date)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(dau?.latest).toEqual({ date: "2026-08-03", value: 30 });
  });

  it("drops rows whose metric_id is not in the catalog", () => {
    const body = buildGrowthMetricsOverviewBody(GROWTH_METRIC_CATALOG, [
      metricRow("some_future_metric", "2026-08-01", 1),
      metricRow("new_users", "2026-08-01", 2),
    ], []);
    expect(body.metrics.some((metric) => metric.id === "some_future_metric")).toBe(false);
    expect(body.metrics.find((metric) => metric.id === "new_users")?.series).toHaveLength(1);
  });

  it("derives latest_stored_date from the max product-metric date only", () => {
    const body = buildGrowthMetricsOverviewBody(GROWTH_METRIC_CATALOG, [
      metricRow("new_users", "2026-08-01", 2),
      metricRow("dau", "2026-08-03", 9),
    ], [
      // An ad row NEWER than every product row must not move latest_stored_date: it is the
      // rollup-freshness signal, and ad rows are written by a separate pipeline.
      adRow("act_1", "2026-08-05"),
    ]);
    expect(body.latest_stored_date).toBe("2026-08-03");
  });

  it("groups ad rows per account with sorted series and per-account timezone/currency", () => {
    const body = buildGrowthMetricsOverviewBody(GROWTH_METRIC_CATALOG, [], [
      adRow("act_b", "2026-08-02", { spend_minor: 200, currency: "EUR", account_timezone: "Europe/Berlin" }),
      adRow("act_a", "2026-08-02", { spend_minor: 50 }),
      adRow("act_b", "2026-08-01", { spend_minor: 100, currency: "EUR", account_timezone: "Europe/Berlin" }),
    ]);
    expect(body.ad_accounts.map((account) => account.account_id)).toEqual(["act_a", "act_b"]);
    const actB = body.ad_accounts[1];
    expect(actB.currency).toBe("EUR");
    expect(actB.account_timezone).toBe("Europe/Berlin");
    expect(actB.series.map((point) => point.date)).toEqual(["2026-08-01", "2026-08-02"]);
    expect(actB.series.map((point) => point.spend_minor)).toEqual([100, 200]);
  });
});
