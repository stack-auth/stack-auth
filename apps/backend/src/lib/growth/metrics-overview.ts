import { getClickhouseAdminClient } from "@/lib/clickhouse";
import type { Tenancy } from "@/lib/tenancies";
import { GROWTH_METRIC_CATALOG, type GrowthCatalogMetric } from "./metric-catalog";

/**
 * Read path for the dashboard's Growth "Metrics" page: the last N days of the wide per-day metric
 * store (`analytics_internal.growth_daily_metrics` / `growth_daily_ad_metrics`, written by
 * metric-store.ts), joined against the catalog vocabulary (metric-catalog.ts) into one snake_case
 * body. Kept out of the route file so the catalog-join/mapping layer is unit-testable without
 * ClickHouse or route plumbing (same split as metrics-context.ts).
 */

export const GROWTH_METRICS_OVERVIEW_WINDOW_DAYS = 90;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export type GrowthMetricsOverviewPoint = {
  date: string, // YYYY-MM-DD
  value: number,
};

export type GrowthMetricsOverviewMetric = {
  id: string,
  label: string,
  unit: GrowthCatalogMetric["unit"],
  category: GrowthCatalogMetric["category"],
  kind: GrowthCatalogMetric["kind"],
  description: string,
  latest: GrowthMetricsOverviewPoint | null,
  series: GrowthMetricsOverviewPoint[],
};

export type GrowthMetricsOverviewAdAccount = {
  account_id: string,
  account_timezone: string,
  currency: string,
  series: {
    date: string, // YYYY-MM-DD, the AD ACCOUNT's local day — see growth_daily_ad_metrics DDL
    spend_minor: number,
    impressions: number,
    clicks: number,
  }[],
};

export type GrowthMetricsOverviewBody = {
  window_days: number,
  latest_stored_date: string | null,
  metrics: GrowthMetricsOverviewMetric[],
  ad_accounts: GrowthMetricsOverviewAdAccount[],
};

/** One raw row of growth_daily_metrics, after numeric coercion (ClickHouse quotes 64-bit ints in JSON). */
export type GrowthMetricsOverviewMetricRow = {
  metric_id: string,
  date: string,
  value: number,
};

/** One raw row of growth_daily_ad_metrics, after numeric coercion. */
export type GrowthMetricsOverviewAdRow = {
  account_id: string,
  account_timezone: string,
  currency: string,
  date: string,
  spend_minor: number,
  impressions: number,
  clicks: number,
};

// ISO date keys sort lexicographically, so string comparison is a correct date ordering.
function compareDayKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * PURE: catalog + raw store rows → the metrics-overview wire body.
 *
 * - `metrics` covers EVERY `availability === "stored"` catalog entry except the ads ones (ads data
 *   rides in `ad_accounts` instead — its dates are account-local, not UTC, so mixing it into the
 *   UTC-dayed product metrics would invite bogus day-level comparisons). Entries with no rows still
 *   appear with `latest: null, series: []`: the page needs the full vocabulary to render meaningful
 *   per-metric empty states instead of silently hiding metrics that haven't produced data yet.
 * - Rows whose metric_id is not in the catalog are dropped: the catalog is the vocabulary contract,
 *   and rendering an id the dashboard has no label/unit for would just show raw internals.
 * - `latest_stored_date` is derived from the product-metric rows only — it drives the page's
 *   "has the rollup ever run" empty state, and ad rows can exist independently of the rollup.
 */
export function buildGrowthMetricsOverviewBody(
  catalog: readonly GrowthCatalogMetric[],
  metricRows: GrowthMetricsOverviewMetricRow[],
  adRows: GrowthMetricsOverviewAdRow[],
): GrowthMetricsOverviewBody {
  const seriesByMetricId = new Map<string, GrowthMetricsOverviewPoint[]>();
  for (const row of metricRows) {
    const series = seriesByMetricId.get(row.metric_id) ?? [];
    series.push({ date: row.date, value: row.value });
    seriesByMetricId.set(row.metric_id, series);
  }
  // Sorted here rather than trusting the query's ORDER BY, so the builder stays correct on any
  // input ordering (it's pure — tests and future callers shouldn't have to know the SQL's contract).
  for (const series of seriesByMetricId.values()) {
    series.sort((a, b) => compareDayKeys(a.date, b.date));
  }

  const metrics: GrowthMetricsOverviewMetric[] = catalog
    .filter((entry) => entry.availability === "stored" && entry.category !== "ads")
    .map((entry) => {
      const series = seriesByMetricId.get(entry.id) ?? [];
      return {
        id: entry.id,
        label: entry.label,
        unit: entry.unit,
        category: entry.category,
        kind: entry.kind,
        description: entry.description,
        latest: series.length === 0 ? null : series[series.length - 1],
        series,
      };
    });

  let latestStoredDate: string | null = null;
  for (const metric of metrics) {
    if (metric.latest != null && (latestStoredDate == null || compareDayKeys(metric.latest.date, latestStoredDate) > 0)) {
      latestStoredDate = metric.latest.date;
    }
  }

  const adAccountsById = new Map<string, GrowthMetricsOverviewAdAccount>();
  for (const row of adRows) {
    const account = adAccountsById.get(row.account_id) ?? {
      account_id: row.account_id,
      account_timezone: row.account_timezone,
      currency: row.currency,
      series: [],
    };
    // Timezone/currency are constant per account in practice; taking the latest row's values means
    // that if a platform ever reports a corrected timezone/currency, the newest wins.
    account.account_timezone = row.account_timezone;
    account.currency = row.currency;
    account.series.push({ date: row.date, spend_minor: row.spend_minor, impressions: row.impressions, clicks: row.clicks });
    adAccountsById.set(row.account_id, account);
  }
  const adAccounts = [...adAccountsById.values()].sort((a, b) => a.account_id < b.account_id ? -1 : a.account_id > b.account_id ? 1 : 0);
  for (const account of adAccounts) {
    account.series.sort((a, b) => compareDayKeys(a.date, b.date));
  }

  return {
    window_days: GROWTH_METRICS_OVERVIEW_WINDOW_DAYS,
    latest_stored_date: latestStoredDate,
    metrics,
    ad_accounts: adAccounts,
  };
}

/**
 * Loads the two store tables and builds the wire body. ClickHouse errors deliberately propagate
 * (→ 500): fabricating an empty body on infrastructure failure would render as "no data yet",
 * which is a lie the admin reader can't distinguish from the real empty state.
 */
export async function getGrowthMetricsOverviewBody(tenancy: Tenancy, now: Date): Promise<GrowthMetricsOverviewBody> {
  const projectId = tenancy.project.id;
  const branchId = tenancy.branchId;
  // Inclusive window of GROWTH_METRICS_OVERVIEW_WINDOW_DAYS UTC days ending today: today plus the
  // 89 days before it. growth_daily_ad_metrics dates are account-local rather than UTC, so its
  // window boundary is off by up to ±1 local day — irrelevant at a 90-day granularity.
  const since = new Date(now.getTime() - (GROWTH_METRICS_OVERVIEW_WINDOW_DAYS - 1) * ONE_DAY_MS)
    .toISOString().split("T")[0];
  const clickhouseClient = getClickhouseAdminClient();
  const queryParams = { projectId, branchId, since };

  const [metricRows, adRows] = await Promise.all([
    clickhouseClient.query({
      query: `
        SELECT date, metric_id, value
        FROM analytics_internal.growth_daily_metrics FINAL
        WHERE project_id = {projectId:String}
          AND branch_id = {branchId:String}
          AND date >= {since:Date}
        ORDER BY date
      `,
      query_params: queryParams,
      format: "JSONEachRow",
    }).then(async (result) => await result.json() as { date: string, metric_id: string, value: number }[]),
    clickhouseClient.query({
      query: `
        SELECT date, account_id, account_timezone, currency, spend_minor, impressions, clicks
        FROM analytics_internal.growth_daily_ad_metrics FINAL
        WHERE project_id = {projectId:String}
          AND branch_id = {branchId:String}
          AND date >= {since:Date}
        ORDER BY account_id, date
      `,
      query_params: queryParams,
      format: "JSONEachRow",
      // Int64 columns come back as JSON strings by default (output_format_json_quote_64bit_integers);
      // coerced with Number() below, same as the freshness/backfill reads in this directory.
    }).then(async (result) => await result.json() as { date: string, account_id: string, account_timezone: string, currency: string, spend_minor: string | number, impressions: string | number, clicks: string | number }[]),
  ]);

  return buildGrowthMetricsOverviewBody(
    GROWTH_METRIC_CATALOG,
    metricRows.map((row) => ({ metric_id: row.metric_id, date: row.date, value: Number(row.value) })),
    adRows.map((row) => ({
      account_id: row.account_id,
      account_timezone: row.account_timezone,
      currency: row.currency,
      date: row.date,
      spend_minor: Number(row.spend_minor),
      impressions: Number(row.impressions),
      clicks: Number(row.clicks),
    })),
  );
}
