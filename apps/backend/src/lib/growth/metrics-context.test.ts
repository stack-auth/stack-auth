import { describe, expect, it } from "vitest";
import { GROWTH_AGENT_QUERYABLE_TABLES, GROWTH_METRIC_CATALOG, type GrowthCatalogMetric } from "./metric-catalog";
import { buildGrowthMetricsContextStaticBody, GROWTH_METRIC_CORRELATION_RULES } from "./metrics-context";

// Minimal hand-built fixtures so the mapping tests don't depend on which metrics the real catalog
// happens to contain (the real catalog is additionally covered below).
const storedWithLegacyNote: GrowthCatalogMetric = {
  id: "fixture_stored_with_note",
  label: "Fixture stored",
  unit: "count",
  category: "users",
  availability: "stored",
  kind: "flow",
  timezone: "utc",
  backfillable: true,
  legacyIdNote: "Maps to the legacy `total_users` metric.",
  description: "A stored fixture metric.",
};
const storedWithoutLegacyNote: GrowthCatalogMetric = {
  id: "fixture_stored_without_note",
  label: "Fixture stored (no note)",
  unit: "percent",
  category: "email",
  availability: "stored",
  kind: "snapshot",
  timezone: "utc",
  backfillable: false,
  description: "A stored fixture metric without a legacy note.",
};
const onTheFly: GrowthCatalogMetric = {
  id: "fixture_on_the_fly",
  label: "Fixture on-the-fly",
  unit: "count",
  category: "web",
  availability: "on_the_fly",
  kind: "flow",
  timezone: "utc",
  backfillable: false,
  sqlTemplate: "SELECT count() FROM events LIMIT 1",
  description: "An on-the-fly fixture metric.",
};
const notPossible: GrowthCatalogMetric = {
  id: "fixture_not_possible",
  label: "Fixture not possible",
  unit: "count",
  category: "ads",
  availability: "not_possible",
  kind: "flow",
  timezone: "ad_account",
  backfillable: false,
  description: "A not-possible fixture metric.",
};

describe("buildGrowthMetricsContextStaticBody", () => {
  it("partitions the catalog into the three availability buckets with the frozen wire fields", () => {
    const body = buildGrowthMetricsContextStaticBody([storedWithLegacyNote, storedWithoutLegacyNote, onTheFly, notPossible]);
    expect(body.stored_metrics).toEqual([
      {
        id: "fixture_stored_with_note",
        label: "Fixture stored",
        unit: "count",
        category: "users",
        kind: "flow",
        timezone: "utc",
        backfillable: true,
        description: "A stored fixture metric.",
        legacy_id_note: "Maps to the legacy `total_users` metric.",
      },
      {
        id: "fixture_stored_without_note",
        label: "Fixture stored (no note)",
        unit: "percent",
        category: "email",
        kind: "snapshot",
        timezone: "utc",
        backfillable: false,
        description: "A stored fixture metric without a legacy note.",
        legacy_id_note: null,
      },
    ]);
    expect(body.on_the_fly_metrics).toEqual([
      {
        id: "fixture_on_the_fly",
        label: "Fixture on-the-fly",
        category: "web",
        description: "An on-the-fly fixture metric.",
        sql_template: "SELECT count() FROM events LIMIT 1",
      },
    ]);
    expect(body.not_possible).toEqual([
      {
        id: "fixture_not_possible",
        label: "Fixture not possible",
        description: "A not-possible fixture metric.",
      },
    ]);
  });

  it("throws loudly on an on_the_fly entry with no sqlTemplate instead of serving a broken template", () => {
    const broken: GrowthCatalogMetric = { ...onTheFly, sqlTemplate: undefined };
    expect(() => buildGrowthMetricsContextStaticBody([broken])).toThrowError(/sqlTemplate/);
  });

  it("serves the queryable-tables list and correlation rules verbatim", () => {
    const body = buildGrowthMetricsContextStaticBody([]);
    expect(body.queryable_tables).toEqual([...GROWTH_AGENT_QUERYABLE_TABLES]);
    expect(body.correlation_rules).toBe(GROWTH_METRIC_CORRELATION_RULES);
  });

  it("covers the entire real catalog: every entry lands in exactly one bucket", () => {
    const body = buildGrowthMetricsContextStaticBody(GROWTH_METRIC_CATALOG);
    const servedIds = [
      ...body.stored_metrics.map((metric) => metric.id),
      ...body.on_the_fly_metrics.map((metric) => metric.id),
      ...body.not_possible.map((metric) => metric.id),
    ];
    expect(servedIds.length).toBe(GROWTH_METRIC_CATALOG.length);
    expect(new Set(servedIds)).toEqual(new Set(GROWTH_METRIC_CATALOG.map((metric) => metric.id)));
  });

  it("maps legacyIdNote to legacy_id_note (string when present, null when absent) across the real catalog", () => {
    const body = buildGrowthMetricsContextStaticBody(GROWTH_METRIC_CATALOG);
    const catalogById = new Map(GROWTH_METRIC_CATALOG.map((metric) => [metric.id, metric]));
    expect(body.stored_metrics.length).toBeGreaterThan(0);
    for (const stored of body.stored_metrics) {
      const source = catalogById.get(stored.id);
      expect(source).toBeDefined();
      expect(stored.legacy_id_note).toBe(source?.legacyIdNote ?? null);
    }
    // The real catalog must exercise both branches, otherwise this test proves nothing.
    expect(body.stored_metrics.some((metric) => metric.legacy_id_note != null)).toBe(true);
    expect(body.stored_metrics.some((metric) => metric.legacy_id_note == null)).toBe(true);
  });
});

describe("GROWTH_METRIC_CORRELATION_RULES", () => {
  it("is non-empty and states both timezone bases", () => {
    expect(GROWTH_METRIC_CORRELATION_RULES.trim().length).toBeGreaterThan(0);
    expect(GROWTH_METRIC_CORRELATION_RULES).toContain("UTC");
    expect(GROWTH_METRIC_CORRELATION_RULES).toContain("LOCAL day");
    expect(GROWTH_METRIC_CORRELATION_RULES).toContain("growth_daily_ad_metrics");
  });

  it("covers units, the metric_id row shape, and schema discovery", () => {
    expect(GROWTH_METRIC_CORRELATION_RULES).toContain("cents");
    expect(GROWTH_METRIC_CORRELATION_RULES).toContain("MINOR units");
    expect(GROWTH_METRIC_CORRELATION_RULES).toContain("metric_id");
    expect(GROWTH_METRIC_CORRELATION_RULES).toContain("SHOW TABLES");
    expect(GROWTH_METRIC_CORRELATION_RULES).toContain("DESCRIBE TABLE");
  });
});
