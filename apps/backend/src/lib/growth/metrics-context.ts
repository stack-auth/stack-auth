import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { GROWTH_AGENT_QUERYABLE_TABLES, type GrowthCatalogMetric } from "./metric-catalog";

/**
 * Serialization layer for the growth-agent metrics-context route: turns the catalog
 * (lib/growth/metric-catalog.ts) into the snake_case wire shape the agent consumes, plus the
 * markdown correlation rules and the per-tenancy freshness read. Kept out of the route file so the
 * pure catalog-to-wire mapping is unit-testable without route plumbing.
 */

/**
 * The ONE place the metric-correlation rules live. Served verbatim to the agent as markdown; the
 * agent-side tool descriptions and instructions only point here instead of restating the rules, so
 * a rule change is a one-file edit.
 */
export const GROWTH_METRIC_CORRELATION_RULES = `
# Rules for correlating growth metrics

- **Two different timezone bases.** Every product metric in \`growth_daily_metrics\` is bucketed by
  UTC day. \`growth_daily_ad_metrics.date\` is the AD ACCOUNT's LOCAL day exactly as the ad platform
  reports it — it is never converted to UTC (the \`account_timezone\` column carries the account's
  IANA timezone). A JOIN on \`date\` across the two tables is therefore only approximate: rows can be
  misaligned by up to plus-or-minus 1 day. Prefer multi-day windows over single-day comparisons, and
  ALWAYS state the timezone basis when reporting correlated numbers (e.g. "spend for 4 Aug in the
  account's timezone vs. signups for 4 Aug UTC").
- **Units and currencies are not interchangeable.** \`revenue_cents\` (and every other \`cents\`
  metric) is in cents. \`spend_minor\` is in the ad account currency's MINOR units, whose decimal
  offset varies by currency (some currencies have 0 decimal places). Never combine or ratio amounts
  in different currencies (e.g. revenue over spend) without explicitly saying which currencies are
  involved and that they differ.
- **One row per (metric_id, date).** \`growth_daily_metrics\` stores every metric as narrow rows
  keyed by (\`metric_id\`, \`date\`) with a single \`value\` — always filter or GROUP BY
  \`metric_id\`, otherwise you are aggregating unrelated metrics together. A missing row means "this
  metric could not be computed for that day", never 0.
- **Discover schemas before querying.** Run \`SHOW TABLES\` and \`DESCRIBE TABLE <name>\` first; the
  column comments are the authoritative documentation of each column's semantics.
`.trim();

export type GrowthMetricsContextStaticBody = {
  stored_metrics: {
    id: string,
    label: string,
    unit: GrowthCatalogMetric["unit"],
    category: GrowthCatalogMetric["category"],
    kind: GrowthCatalogMetric["kind"],
    timezone: GrowthCatalogMetric["timezone"],
    backfillable: boolean,
    description: string,
    legacy_id_note: string | null,
  }[],
  on_the_fly_metrics: {
    id: string,
    label: string,
    category: GrowthCatalogMetric["category"],
    description: string,
    sql_template: string,
  }[],
  not_possible: {
    id: string,
    label: string,
    description: string,
  }[],
  queryable_tables: string[],
  correlation_rules: string,
};

/**
 * PURE: catalog → the static (tenancy-independent) part of the metrics-context body. Every catalog
 * entry lands in exactly one of the three availability buckets, so the union of the three lists
 * always covers the whole catalog.
 */
export function buildGrowthMetricsContextStaticBody(catalog: readonly GrowthCatalogMetric[]): GrowthMetricsContextStaticBody {
  return {
    stored_metrics: catalog.filter((metric) => metric.availability === "stored").map((metric) => ({
      id: metric.id,
      label: metric.label,
      unit: metric.unit,
      category: metric.category,
      kind: metric.kind,
      timezone: metric.timezone,
      backfillable: metric.backfillable,
      description: metric.description,
      legacy_id_note: metric.legacyIdNote ?? null,
    })),
    on_the_fly_metrics: catalog.filter((metric) => metric.availability === "on_the_fly").map((metric) => ({
      id: metric.id,
      label: metric.label,
      category: metric.category,
      description: metric.description,
      sql_template: metric.sqlTemplate ?? throwErr(new HexclaveAssertionError(
        "on_the_fly catalog metric has no sqlTemplate — metric-catalog.test.ts enforces that every on_the_fly entry ships one.",
        { metricId: metric.id },
      )),
    })),
    not_possible: catalog.filter((metric) => metric.availability === "not_possible").map((metric) => ({
      id: metric.id,
      label: metric.label,
      description: metric.description,
    })),
    queryable_tables: [...GROWTH_AGENT_QUERYABLE_TABLES],
    correlation_rules: GROWTH_METRIC_CORRELATION_RULES,
  };
}

export type GrowthMetricFreshness = {
  latest_stored_date: string | null,
  earliest_stored_date: string | null,
  ad_metrics_present: boolean,
};

/**
 * One cheap aggregate per stored table, so the agent knows how much history growth_daily_metrics
 * actually holds before writing date-ranged SQL. Deliberately no FINAL: ReplacingMergeTree
 * duplicates never change min/max of a keyed column or count()-emptiness, and skipping FINAL keeps
 * both reads index-only-cheap (same reasoning as the backfill guard in metric-store.ts).
 */
export async function loadGrowthMetricFreshness(projectId: string, branchId: string): Promise<GrowthMetricFreshness> {
  const clickhouseClient = getClickhouseAdminClient();
  const queryParams = { projectId, branchId };
  const [storedRows, adRows] = await Promise.all([
    clickhouseClient.query({
      query: `
        SELECT count() AS cnt, min(date) AS earliest, max(date) AS latest
        FROM analytics_internal.growth_daily_metrics
        WHERE project_id = {projectId:String}
          AND branch_id = {branchId:String}
      `,
      query_params: queryParams,
      format: "JSONEachRow",
    }).then(async (result) => await result.json() as { cnt: string | number, earliest: string, latest: string }[]),
    clickhouseClient.query({
      query: `
        SELECT count() AS cnt
        FROM analytics_internal.growth_daily_ad_metrics
        WHERE project_id = {projectId:String}
          AND branch_id = {branchId:String}
      `,
      query_params: queryParams,
      format: "JSONEachRow",
    }).then(async (result) => await result.json() as { cnt: string | number }[]),
  ]);
  const stored = storedRows[0] ?? throwErr(new HexclaveAssertionError(
    "ClickHouse returned no row for the growth_daily_metrics freshness aggregate — an aggregation without GROUP BY always yields exactly one row.",
    { projectId, branchId },
  ));
  const ad = adRows[0] ?? throwErr(new HexclaveAssertionError(
    "ClickHouse returned no row for the growth_daily_ad_metrics freshness aggregate — an aggregation without GROUP BY always yields exactly one row.",
    { projectId, branchId },
  ));
  // min/max over zero rows yield the Date epoch ('1970-01-01'), not NULL, so the emptiness signal
  // must come from count() rather than from the dates themselves.
  const hasStoredRows = Number(stored.cnt) > 0;
  return {
    latest_stored_date: hasStoredRows ? stored.latest : null,
    earliest_stored_date: hasStoredRows ? stored.earliest : null,
    ad_metrics_present: Number(ad.cnt) > 0,
  };
}
