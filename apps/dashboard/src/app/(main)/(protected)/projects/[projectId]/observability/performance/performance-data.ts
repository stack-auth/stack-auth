import { sendInternalAdminRequest } from "@/lib/hexclave-app-internals";
import type { StackAdminApp } from "@hexclave/next";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { getBucketGranularity } from "../bucket-granularity";
import { queryObservability } from "../filters";
import {
  getServicesSummaryQuery,
  parseServiceSummaryRow,
  parseServiceTimestamp,
  type ServiceSummary,
  type ServiceTimeRangeHours,
} from "../services/services-data";

export const PERFORMANCE_TIME_RANGES = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
] as const;

export const WEB_VITAL_METRICS = [
  {
    key: "lcp",
    label: "LCP",
    description: "Largest Contentful Paint",
    metricName: "hexclave.web.vitals.lcp",
    unit: "ms",
    goodThreshold: 2_500,
    needsImprovementThreshold: 4_000,
    lowerIsBetter: true,
  },
  {
    key: "fcp",
    label: "FCP",
    description: "First Contentful Paint",
    metricName: "hexclave.web.vitals.fcp",
    unit: "ms",
    goodThreshold: 1_800,
    needsImprovementThreshold: 3_000,
    lowerIsBetter: true,
  },
  {
    key: "cls",
    label: "CLS",
    description: "Cumulative Layout Shift",
    metricName: "hexclave.web.vitals.cls",
    unit: "",
    goodThreshold: 0.1,
    needsImprovementThreshold: 0.25,
    lowerIsBetter: true,
  },
  {
    key: "inp",
    label: "INP",
    description: "Interaction to Next Paint",
    metricName: "hexclave.web.vitals.inp",
    unit: "ms",
    goodThreshold: 200,
    needsImprovementThreshold: 500,
    lowerIsBetter: true,
  },
  {
    key: "ttfb",
    label: "TTFB",
    description: "Time to First Byte",
    metricName: "hexclave.web.vitals.ttfb",
    unit: "ms",
    goodThreshold: 800,
    needsImprovementThreshold: 1_800,
    lowerIsBetter: true,
  },
  {
    key: "fps",
    label: "FPS",
    description: "Visible animation smoothness",
    metricName: "hexclave.web.vitals.fps",
    unit: "frame/s",
    goodThreshold: 55,
    needsImprovementThreshold: 30,
    lowerIsBetter: false,
  },
] as const;

export type WebVitalMetricDefinition = (typeof WEB_VITAL_METRICS)[number];
export type WebVitalMetricKey = WebVitalMetricDefinition["key"];

export type WebVitalRatingLabel = "Good" | "Needs work" | "Poor" | "No data";
export type WebVitalRatingColor = "green" | "orange" | "red" | "zinc";
export type WebVitalRating = {
  label: WebVitalRatingLabel,
  color: WebVitalRatingColor,
};

/**
 * Core Web Vitals are scored at p75, not the mean. An average hides the tail
 * the user actually felt; Google's field thresholds are defined on p75, so
 * rating a mean against those thresholds would call a page "good" while a
 * quarter of views were already poor.
 */
export function webVitalRating(metric: WebVitalMetricDefinition, value: number | null): WebVitalRating {
  if (value === null) return { label: "No data", color: "zinc" };
  if (metric.lowerIsBetter) {
    if (value <= metric.goodThreshold) return { label: "Good", color: "green" };
    if (value <= metric.needsImprovementThreshold) return { label: "Needs work", color: "orange" };
    return { label: "Poor", color: "red" };
  }
  if (value >= metric.goodThreshold) return { label: "Good", color: "green" };
  if (value >= metric.needsImprovementThreshold) return { label: "Needs work", color: "orange" };
  return { label: "Poor", color: "red" };
}

export function formatWebVitalValue(metric: WebVitalMetricDefinition, value: number | null): string {
  if (value === null) return "No data";
  if (metric.key === "cls") {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3, minimumFractionDigits: 2 }).format(value);
  }
  if (metric.key === "fps") {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} ${metric.unit}`;
  }
  if (value < 1000) {
    return `${Math.round(value)} ${metric.unit}`;
  }
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`;
}

export function webVitalByKey(key: WebVitalMetricKey): WebVitalMetricDefinition {
  const metric = WEB_VITAL_METRICS.find((candidate) => candidate.key === key);
  if (metric == null) throw new Error(`Unknown web vital metric: ${key}`);
  return metric;
}

export type PerformanceTimeRangeHours = (typeof PERFORMANCE_TIME_RANGES)[number]["hours"];
export type PerformanceMetricType = "gauge" | "sum" | "histogram" | "exponential_histogram" | "summary";

export type PerformanceMetricCatalogEntry = {
  metric_name: string,
  metric_description: string,
  metric_unit: string,
  metric_type: PerformanceMetricType,
  aggregation_temporality: number,
  is_monotonic: boolean,
  point_count: number,
  latest_time_unix_nano: string,
  supports_numeric_aggregation: boolean,
};

export type PerformanceMetricSeriesPoint = {
  bucket_start_unix_nano: string,
  point_count: number,
  numeric_value: number | null,
  minimum_value: number | null,
  maximum_value: number | null,
  exemplar: {
    trace_id: string,
    span_id: string,
  } | null,
};

export type PerformanceMetricResponse = {
  window: {
    start_time_unix_nano: string,
    end_time_unix_nano: string,
    hours: PerformanceTimeRangeHours,
  },
  catalog: PerformanceMetricCatalogEntry[],
  selected_metric_name: string | null,
  selected_metric_type: PerformanceMetricType | null,
  series: PerformanceMetricSeriesPoint[],
  partial: {
    has_unsupported_metric_types: boolean,
    unsupported_metric_types: PerformanceMetricType[],
  },
};

const PERFORMANCE_METRIC_TYPES: readonly PerformanceMetricType[] = [
  "gauge",
  "sum",
  "histogram",
  "exponential_histogram",
  "summary",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Native metrics response field ${field} must be an object`);
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Native metrics response field ${field} must be a string`);
  return value;
}

function requiredFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Native metrics response field ${field} must be finite`);
  return value;
}

function requiredNonNegativeInteger(value: unknown, field: string): number {
  const number = requiredFiniteNumber(value, field);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Native metrics response field ${field} must be a non-negative integer`);
  return number;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Native metrics response field ${field} must be boolean`);
  return value;
}

function requiredMetricType(value: unknown, field: string): PerformanceMetricType {
  if (typeof value !== "string" || !isPerformanceMetricType(value)) {
    throw new Error(`Native metrics response field ${field} contains an unknown metric type`);
  }
  return value;
}

export function isPerformanceMetricType(value: string): value is PerformanceMetricType {
  return PERFORMANCE_METRIC_TYPES.some((metricType) => metricType === value);
}

function isPerformanceTimeRangeHours(value: number): value is PerformanceTimeRangeHours {
  return PERFORMANCE_TIME_RANGES.some((range) => range.hours === value);
}

function nullableFiniteNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  return requiredFiniteNumber(value, field);
}

function parseCatalog(value: unknown): PerformanceMetricCatalogEntry[] {
  if (!Array.isArray(value)) throw new Error("Native metrics response catalog must be an array");
  return value.map((entry, index) => {
    const record = requiredRecord(entry, `catalog[${index}]`);
    return {
      metric_name: requiredString(record.metric_name, `catalog[${index}].metric_name`),
      metric_description: requiredString(record.metric_description, `catalog[${index}].metric_description`),
      metric_unit: requiredString(record.metric_unit, `catalog[${index}].metric_unit`),
      metric_type: requiredMetricType(record.metric_type, `catalog[${index}].metric_type`),
      aggregation_temporality: requiredNonNegativeInteger(record.aggregation_temporality, `catalog[${index}].aggregation_temporality`),
      is_monotonic: requiredBoolean(record.is_monotonic, `catalog[${index}].is_monotonic`),
      point_count: requiredNonNegativeInteger(record.point_count, `catalog[${index}].point_count`),
      latest_time_unix_nano: requiredString(record.latest_time_unix_nano, `catalog[${index}].latest_time_unix_nano`),
      supports_numeric_aggregation: requiredBoolean(record.supports_numeric_aggregation, `catalog[${index}].supports_numeric_aggregation`),
    };
  });
}

function parseSeries(value: unknown): PerformanceMetricSeriesPoint[] {
  if (!Array.isArray(value)) throw new Error("Native metrics response series must be an array");
  return value.map((entry, index) => {
    const record = requiredRecord(entry, `series[${index}]`);
    const exemplarValue = record.exemplar;
    let exemplar: PerformanceMetricSeriesPoint["exemplar"] = null;
    if (exemplarValue !== null) {
      const exemplarRecord = requiredRecord(exemplarValue, `series[${index}].exemplar`);
      exemplar = {
        trace_id: requiredString(exemplarRecord.trace_id, `series[${index}].exemplar.trace_id`),
        span_id: requiredString(exemplarRecord.span_id, `series[${index}].exemplar.span_id`),
      };
    }
    return {
      bucket_start_unix_nano: requiredString(record.bucket_start_unix_nano, `series[${index}].bucket_start_unix_nano`),
      point_count: requiredNonNegativeInteger(record.point_count, `series[${index}].point_count`),
      numeric_value: nullableFiniteNumber(record.numeric_value, `series[${index}].numeric_value`),
      minimum_value: nullableFiniteNumber(record.minimum_value, `series[${index}].minimum_value`),
      maximum_value: nullableFiniteNumber(record.maximum_value, `series[${index}].maximum_value`),
      exemplar,
    };
  });
}

export function parsePerformanceMetricResponse(value: unknown): PerformanceMetricResponse {
  const response = requiredRecord(value, "response");
  const window = requiredRecord(response.window, "window");
  const hours = requiredNonNegativeInteger(window.hours, "window.hours");
  if (!isPerformanceTimeRangeHours(hours)) {
    throw new Error(`Native metrics response contains an unsupported time range: ${hours}`);
  }
  const selectedMetricName = response.selected_metric_name;
  if (selectedMetricName !== null && typeof selectedMetricName !== "string") {
    throw new Error("Native metrics response selected_metric_name must be a string or null");
  }
  const selectedMetricType = response.selected_metric_type === null
    ? null
    : requiredMetricType(response.selected_metric_type, "selected_metric_type");
  const partial = requiredRecord(response.partial, "partial");
  const unsupportedMetricTypesValue = partial.unsupported_metric_types;
  if (!Array.isArray(unsupportedMetricTypesValue)) throw new Error("Native metrics response unsupported_metric_types must be an array");
  return {
    window: {
      start_time_unix_nano: requiredString(window.start_time_unix_nano, "window.start_time_unix_nano"),
      end_time_unix_nano: requiredString(window.end_time_unix_nano, "window.end_time_unix_nano"),
      hours,
    },
    catalog: parseCatalog(response.catalog),
    selected_metric_name: selectedMetricName,
    selected_metric_type: selectedMetricType,
    series: parseSeries(response.series),
    partial: {
      has_unsupported_metric_types: requiredBoolean(partial.has_unsupported_metric_types, "partial.has_unsupported_metric_types"),
      unsupported_metric_types: unsupportedMetricTypesValue.map((entry, index) => requiredMetricType(entry, `partial.unsupported_metric_types[${index}]`)),
    },
  };
}

export async function fetchPerformanceMetrics(
  adminApp: object,
  request: {
    hours: PerformanceTimeRangeHours,
    metricName: string | null,
    /**
     * OTLP allows one metric NAME to exist with several metric types, and the
     * selector keys entries by (name, type) — so the type must be sent along
     * or selecting a non-busiest pair charts a sibling type's data. Null means
     * "resolve by name only" (the backend picks the pair with the most points).
     */
    metricType: PerformanceMetricType | null,
  },
): Promise<PerformanceMetricResponse> {
  const response = await sendInternalAdminRequest(adminApp, "/internal/analytics/metrics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hours: request.hours,
      ...(request.metricName == null ? {} : { metric_name: request.metricName }),
      ...(request.metricType == null ? {} : { metric_type: request.metricType }),
    }),
  });
  if (!response.ok) throw new Error("Native metrics could not be loaded");
  return parsePerformanceMetricResponse(await response.json());
}

export async function fetchWebVitals(
  adminApp: object,
  hours: PerformanceTimeRangeHours,
): Promise<Map<WebVitalMetricKey, PerformanceMetricResponse>> {
  const responses = await Promise.all(WEB_VITAL_METRICS.map((metric) => fetchPerformanceMetrics(adminApp, {
    hours,
    metricName: metric.metricName,
    // Web vitals are exported under exactly one type per name, so name-only
    // resolution is unambiguous here.
    metricType: null,
  })));
  const result = new Map<WebVitalMetricKey, PerformanceMetricResponse>();
  for (const [index, metric] of WEB_VITAL_METRICS.entries()) {
    result.set(metric.key, responses[index]);
  }
  return result;
}

/**
 * Native Metrics is intentionally a separate signal from the existing service
 * projection. Until a customer exports OTel Metrics, the projection is the
 * useful performance view that already has data in this dashboard. Keeping
 * this query separate prevents the UI from silently relabeling spans as OTel
 * metric streams.
 */
export async function fetchSpanPerformance(
  adminApp: StackAdminApp<false>,
  hours: ServiceTimeRangeHours,
): Promise<ServiceSummary[]> {
  const query = getServicesSummaryQuery(hours);
  const response = await queryObservability(adminApp, {
    query: query.query,
    params: query.params,
  });
  return response.result.map(parseServiceSummaryRow);
}

/**
 * Page-view spans already carry the Web Vitals snapshot, path, viewport, scroll
 * depth, and dwell time. Native Metrics only has a global average per stream —
 * no p75, no per-page breakdown, no good/needs-work/poor split, and no way to
 * keep soft-nav samples out of LCP. These queries read the span payload
 * directly so the Performance tab can answer "which pages are slow, and what
 * are people doing on them?"
 *
 * LCP/FCP/TTFB are hard-load metrics: the collector omits them on SPA
 * navigations and flags `web_vitals.soft_nav = 1`. INP/CLS/FPS describe every
 * navigation window.
 */
const PAGE_VIEW_VITALS_SQL = `
  JSONExtractUInt(data, 'web_vitals', 'soft_nav') AS soft_nav,
  if(JSONHas(data, 'web_vitals', 'lcp_ms'), JSONExtractFloat(data, 'web_vitals', 'lcp_ms'), NULL) AS lcp_ms,
  if(JSONHas(data, 'web_vitals', 'fcp_ms'), JSONExtractFloat(data, 'web_vitals', 'fcp_ms'), NULL) AS fcp_ms,
  if(JSONHas(data, 'web_vitals', 'ttfb_ms'), JSONExtractFloat(data, 'web_vitals', 'ttfb_ms'), NULL) AS ttfb_ms,
  if(JSONHas(data, 'web_vitals', 'inp_ms'), JSONExtractFloat(data, 'web_vitals', 'inp_ms'), NULL) AS inp_ms,
  if(JSONHas(data, 'web_vitals', 'cls'), JSONExtractFloat(data, 'web_vitals', 'cls'), NULL) AS cls,
  if(JSONHas(data, 'web_vitals', 'fps'), JSONExtractFloat(data, 'web_vitals', 'fps'), NULL) AS fps
`;

const HARD_LOAD_LCP_SQL = "lcp_ms IS NOT NULL AND soft_nav != 1";
const HARD_LOAD_FCP_SQL = "fcp_ms IS NOT NULL AND soft_nav != 1";
const HARD_LOAD_TTFB_SQL = "ttfb_ms IS NOT NULL AND soft_nav != 1";

function p75IfSql(column: string, predicate: string): string {
  return `if(countIf(${predicate}) = 0, NULL, round(quantileTDigestIf(0.75)(${column}, ${predicate}), 4))`;
}

function assertPerformanceTimeRange(hours: number): asserts hours is PerformanceTimeRangeHours {
  if (!isPerformanceTimeRangeHours(hours)) {
    throw new Error(`Unsupported performance time range: ${hours}`);
  }
}

export const MAX_PERFORMANCE_PAGES = 100;
export const MAX_PERFORMANCE_BEHAVIOR_PATHS = 200;
/** Below this many samples a p75 is too noisy to call a page "slow". */
export const MIN_VITAL_INSIGHT_SAMPLES = 8;
export const MIN_FRICTION_CLICKS = 12;
export const MIN_SHALLOW_VIEWS = 20;

export type VitalDistribution = {
  p75: number | null,
  samples: number,
  good: number,
  needsWork: number,
  poor: number,
};

export type PerformanceVitalsOverview = {
  pageViews: number,
  users: number,
  softNavViews: number,
  avgTimeOnPageMs: number | null,
  avgScrollRatio: number | null,
  lcp: VitalDistribution,
  lcpP75Mobile: number | null,
  lcpP75Desktop: number | null,
  fcp: VitalDistribution,
  ttfb: VitalDistribution,
  inp: VitalDistribution,
  cls: VitalDistribution,
  fps: VitalDistribution,
};

export type PageBehavior = {
  clicks: number,
  rageClicks: number,
  deadClicks: number,
  formSubmits: number,
  outboundClicks: number,
};

export type PagePerformance = {
  path: string,
  views: number,
  users: number,
  softNavViews: number,
  lcpP75: number | null,
  lcpSamples: number,
  inpP75: number | null,
  inpSamples: number,
  clsP75: number | null,
  clsSamples: number,
  avgTimeOnPageMs: number | null,
  avgScrollRatio: number | null,
} & PageBehavior;

export type PerformanceTimelineBucket = {
  bucketMs: number,
  views: number,
  lcpP75: number | null,
  inpP75: number | null,
};

export type PageInsightKind = "slow-lcp" | "slow-inp" | "rage" | "dead-clicks" | "shallow";

export type PageInsight = {
  kind: PageInsightKind,
  page: PagePerformance,
};

export function getPerformanceVitalsOverviewQuery(hours: number): {
  query: string,
  params: Record<string, number>,
} {
  assertPerformanceTimeRange(hours);
  return {
    query: `
/* performance:vitals-overview */
WITH
  now64(3) AS range_end,
  range_end - INTERVAL {hours:UInt32} HOUR AS range_start,
  page_views AS (
    SELECT
      started_at,
      ended_at,
      user_id,
      JSONExtractString(data, 'entry_type') AS entry_type,
      JSONExtractUInt(data, 'viewport_width') AS viewport_width,
      if(JSONHas(data, 'scroll_depth_ratio'), JSONExtractFloat(data, 'scroll_depth_ratio'), NULL) AS scroll_depth_ratio,
      ${PAGE_VIEW_VITALS_SQL}
    FROM default.spans
    WHERE span_type = '$page-view'
      AND started_at >= range_start
      AND started_at < range_end
  )
SELECT
  count() AS page_views,
  uniqCombined64If(user_id, user_id IS NOT NULL AND user_id != '') AS users,
  countIf(entry_type IN ('push', 'replace', 'pop')) AS soft_nav_views,
  if(
    countIf(ended_at IS NOT NULL AND ended_at > started_at) = 0,
    NULL,
    round(avgIf(dateDiff('millisecond', started_at, ended_at), ended_at IS NOT NULL AND ended_at > started_at), 2)
  ) AS avg_time_on_page_ms,
  if(countIf(scroll_depth_ratio IS NOT NULL) = 0, NULL, round(avg(scroll_depth_ratio), 3)) AS avg_scroll_ratio,
  countIf(${HARD_LOAD_LCP_SQL}) AS lcp_samples,
  ${p75IfSql("lcp_ms", HARD_LOAD_LCP_SQL)} AS lcp_p75,
  countIf(${HARD_LOAD_LCP_SQL} AND lcp_ms <= 2500) AS lcp_good,
  countIf(${HARD_LOAD_LCP_SQL} AND lcp_ms > 2500 AND lcp_ms <= 4000) AS lcp_needs_work,
  countIf(${HARD_LOAD_LCP_SQL} AND lcp_ms > 4000) AS lcp_poor,
  ${p75IfSql("lcp_ms", `${HARD_LOAD_LCP_SQL} AND viewport_width > 0 AND viewport_width < 768`)} AS lcp_p75_mobile,
  ${p75IfSql("lcp_ms", `${HARD_LOAD_LCP_SQL} AND viewport_width >= 768`)} AS lcp_p75_desktop,
  countIf(${HARD_LOAD_FCP_SQL}) AS fcp_samples,
  ${p75IfSql("fcp_ms", HARD_LOAD_FCP_SQL)} AS fcp_p75,
  countIf(${HARD_LOAD_FCP_SQL} AND fcp_ms <= 1800) AS fcp_good,
  countIf(${HARD_LOAD_FCP_SQL} AND fcp_ms > 1800 AND fcp_ms <= 3000) AS fcp_needs_work,
  countIf(${HARD_LOAD_FCP_SQL} AND fcp_ms > 3000) AS fcp_poor,
  countIf(${HARD_LOAD_TTFB_SQL}) AS ttfb_samples,
  ${p75IfSql("ttfb_ms", HARD_LOAD_TTFB_SQL)} AS ttfb_p75,
  countIf(${HARD_LOAD_TTFB_SQL} AND ttfb_ms <= 800) AS ttfb_good,
  countIf(${HARD_LOAD_TTFB_SQL} AND ttfb_ms > 800 AND ttfb_ms <= 1800) AS ttfb_needs_work,
  countIf(${HARD_LOAD_TTFB_SQL} AND ttfb_ms > 1800) AS ttfb_poor,
  countIf(inp_ms IS NOT NULL) AS inp_samples,
  ${p75IfSql("inp_ms", "inp_ms IS NOT NULL")} AS inp_p75,
  countIf(inp_ms IS NOT NULL AND inp_ms <= 200) AS inp_good,
  countIf(inp_ms IS NOT NULL AND inp_ms > 200 AND inp_ms <= 500) AS inp_needs_work,
  countIf(inp_ms IS NOT NULL AND inp_ms > 500) AS inp_poor,
  countIf(cls IS NOT NULL) AS cls_samples,
  ${p75IfSql("cls", "cls IS NOT NULL")} AS cls_p75,
  countIf(cls IS NOT NULL AND cls <= 0.1) AS cls_good,
  countIf(cls IS NOT NULL AND cls > 0.1 AND cls <= 0.25) AS cls_needs_work,
  countIf(cls IS NOT NULL AND cls > 0.25) AS cls_poor,
  countIf(fps IS NOT NULL) AS fps_samples,
  ${p75IfSql("fps", "fps IS NOT NULL")} AS fps_p75,
  countIf(fps IS NOT NULL AND fps >= 55) AS fps_good,
  countIf(fps IS NOT NULL AND fps >= 30 AND fps < 55) AS fps_needs_work,
  countIf(fps IS NOT NULL AND fps < 30) AS fps_poor
FROM page_views
`,
    params: { hours },
  };
}

export function getPerformancePagesQuery(hours: number): {
  query: string,
  params: Record<string, number>,
} {
  assertPerformanceTimeRange(hours);
  return {
    query: `
/* performance:pages */
WITH
  now64(3) AS range_end,
  range_end - INTERVAL {hours:UInt32} HOUR AS range_start
SELECT
  JSONExtractString(data, 'path') AS path,
  count() AS views,
  uniqCombined64If(user_id, user_id IS NOT NULL AND user_id != '') AS users,
  countIf(JSONExtractString(data, 'entry_type') IN ('push', 'replace', 'pop')) AS soft_nav_views,
  countIf(${HARD_LOAD_LCP_SQL}) AS lcp_samples,
  ${p75IfSql("lcp_ms", HARD_LOAD_LCP_SQL)} AS lcp_p75,
  countIf(inp_ms IS NOT NULL) AS inp_samples,
  ${p75IfSql("inp_ms", "inp_ms IS NOT NULL")} AS inp_p75,
  countIf(cls IS NOT NULL) AS cls_samples,
  ${p75IfSql("cls", "cls IS NOT NULL")} AS cls_p75,
  if(
    countIf(ended_at IS NOT NULL AND ended_at > started_at) = 0,
    NULL,
    round(avgIf(dateDiff('millisecond', started_at, ended_at), ended_at IS NOT NULL AND ended_at > started_at), 2)
  ) AS avg_time_on_page_ms,
  if(countIf(JSONHas(data, 'scroll_depth_ratio')) = 0, NULL, round(avgIf(JSONExtractFloat(data, 'scroll_depth_ratio'), JSONHas(data, 'scroll_depth_ratio')), 3)) AS avg_scroll_ratio
FROM (
  SELECT
    started_at,
    ended_at,
    user_id,
    data,
    ${PAGE_VIEW_VITALS_SQL}
  FROM default.spans
  WHERE span_type = '$page-view'
    AND started_at >= range_start
    AND started_at < range_end
    AND JSONExtractString(data, 'path') != ''
)
GROUP BY path
ORDER BY views DESC, path ASC
LIMIT ${MAX_PERFORMANCE_PAGES}
`,
    params: { hours },
  };
}

export function getPerformanceBehaviorQuery(hours: number): {
  query: string,
  params: Record<string, number>,
} {
  assertPerformanceTimeRange(hours);
  return {
    query: `
/* performance:behavior */
WITH
  now64(3) AS range_end,
  range_end - INTERVAL {hours:UInt32} HOUR AS range_start
SELECT
  JSONExtractString(toString(data), 'path') AS path,
  countIf(event_type = '$click') AS clicks,
  countIf(event_type = '$click' AND JSONExtractUInt(toString(data), 'rage') = 1) AS rage_clicks,
  countIf(event_type = '$click' AND JSONExtractUInt(toString(data), 'dead') = 1) AS dead_clicks,
  countIf(event_type = '$form-submit') AS form_submits,
  countIf(event_type = '$click' AND JSONExtractUInt(toString(data), 'outbound') = 1) AS outbound_clicks
FROM default.events
WHERE event_at >= range_start
  AND event_at < range_end
  AND event_type IN ('$click', '$form-submit')
  AND JSONExtractString(toString(data), 'path') != ''
GROUP BY path
ORDER BY rage_clicks DESC, dead_clicks DESC, clicks DESC, path ASC
LIMIT ${MAX_PERFORMANCE_BEHAVIOR_PATHS}
`,
    params: { hours },
  };
}

export function getPerformanceTimelineQuery(hours: number): {
  query: string,
  params: Record<string, number>,
} {
  assertPerformanceTimeRange(hours);
  const granularity = getBucketGranularity(hours);
  return {
    query: `
/* performance:timeline */
WITH
  toStartOfInterval(now64(3), ${granularity.stepSql}) AS current_bucket_start,
  current_bucket_start - ${granularity.historySql} AS range_start,
  current_bucket_start + ${granularity.stepSql} AS range_end
SELECT
  toStartOfInterval(started_at, ${granularity.stepSql}) AS bucket_start,
  count() AS views,
  ${p75IfSql("lcp_ms", HARD_LOAD_LCP_SQL)} AS lcp_p75,
  ${p75IfSql("inp_ms", "inp_ms IS NOT NULL")} AS inp_p75
FROM (
  SELECT
    started_at,
    ${PAGE_VIEW_VITALS_SQL}
  FROM default.spans
  WHERE span_type = '$page-view'
    AND started_at >= range_start
    AND started_at < range_end
)
GROUP BY bucket_start
ORDER BY bucket_start ASC
`,
    params: { hours },
  };
}

function requiredRowNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`Performance ${key} must be a finite number`);
}

function optionalRowNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    if (value === "" || value.toLowerCase() === "nan") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  throw new Error(`Performance ${key} must be a finite number or null`);
}

function requiredRowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`Performance ${key} must be a non-empty string`);
  }
  return value;
}

function parseDistribution(
  row: Record<string, unknown>,
  prefix: string,
): VitalDistribution {
  return {
    p75: optionalRowNumber(row, `${prefix}_p75`),
    samples: requiredRowNumber(row, `${prefix}_samples`),
    good: requiredRowNumber(row, `${prefix}_good`),
    needsWork: requiredRowNumber(row, `${prefix}_needs_work`),
    poor: requiredRowNumber(row, `${prefix}_poor`),
  };
}

export function parsePerformanceVitalsOverviewRow(row: Record<string, unknown>): PerformanceVitalsOverview {
  return {
    pageViews: requiredRowNumber(row, "page_views"),
    users: requiredRowNumber(row, "users"),
    softNavViews: requiredRowNumber(row, "soft_nav_views"),
    avgTimeOnPageMs: optionalRowNumber(row, "avg_time_on_page_ms"),
    avgScrollRatio: optionalRowNumber(row, "avg_scroll_ratio"),
    lcp: parseDistribution(row, "lcp"),
    lcpP75Mobile: optionalRowNumber(row, "lcp_p75_mobile"),
    lcpP75Desktop: optionalRowNumber(row, "lcp_p75_desktop"),
    fcp: parseDistribution(row, "fcp"),
    ttfb: parseDistribution(row, "ttfb"),
    inp: parseDistribution(row, "inp"),
    cls: parseDistribution(row, "cls"),
    fps: parseDistribution(row, "fps"),
  };
}

export function parsePerformancePageRow(row: Record<string, unknown>): Omit<PagePerformance, keyof PageBehavior> {
  return {
    path: requiredRowString(row, "path"),
    views: requiredRowNumber(row, "views"),
    users: requiredRowNumber(row, "users"),
    softNavViews: requiredRowNumber(row, "soft_nav_views"),
    lcpP75: optionalRowNumber(row, "lcp_p75"),
    lcpSamples: requiredRowNumber(row, "lcp_samples"),
    inpP75: optionalRowNumber(row, "inp_p75"),
    inpSamples: requiredRowNumber(row, "inp_samples"),
    clsP75: optionalRowNumber(row, "cls_p75"),
    clsSamples: requiredRowNumber(row, "cls_samples"),
    avgTimeOnPageMs: optionalRowNumber(row, "avg_time_on_page_ms"),
    avgScrollRatio: optionalRowNumber(row, "avg_scroll_ratio"),
  };
}

export function parsePerformanceBehaviorRow(row: Record<string, unknown>): { path: string } & PageBehavior {
  return {
    path: requiredRowString(row, "path"),
    clicks: requiredRowNumber(row, "clicks"),
    rageClicks: requiredRowNumber(row, "rage_clicks"),
    deadClicks: requiredRowNumber(row, "dead_clicks"),
    formSubmits: requiredRowNumber(row, "form_submits"),
    outboundClicks: requiredRowNumber(row, "outbound_clicks"),
  };
}

const EMPTY_BEHAVIOR: PageBehavior = {
  clicks: 0,
  rageClicks: 0,
  deadClicks: 0,
  formSubmits: 0,
  outboundClicks: 0,
};

export function mergePagePerformance(
  pages: readonly Omit<PagePerformance, keyof PageBehavior>[],
  behaviors: readonly ({ path: string } & PageBehavior)[],
): PagePerformance[] {
  const behaviorByPath = new Map(behaviors.map((row) => [row.path, row]));
  return pages.map((page) => {
    const behavior = behaviorByPath.get(page.path);
    return {
      ...page,
      clicks: behavior?.clicks ?? EMPTY_BEHAVIOR.clicks,
      rageClicks: behavior?.rageClicks ?? EMPTY_BEHAVIOR.rageClicks,
      deadClicks: behavior?.deadClicks ?? EMPTY_BEHAVIOR.deadClicks,
      formSubmits: behavior?.formSubmits ?? EMPTY_BEHAVIOR.formSubmits,
      outboundClicks: behavior?.outboundClicks ?? EMPTY_BEHAVIOR.outboundClicks,
    };
  });
}

export function sumPageBehavior(pages: readonly PagePerformance[]): PageBehavior {
  return pages.reduce<PageBehavior>((totals, page) => ({
    clicks: totals.clicks + page.clicks,
    rageClicks: totals.rageClicks + page.rageClicks,
    deadClicks: totals.deadClicks + page.deadClicks,
    formSubmits: totals.formSubmits + page.formSubmits,
    outboundClicks: totals.outboundClicks + page.outboundClicks,
  }), { ...EMPTY_BEHAVIOR });
}

export function buildPerformanceTimeline(
  rows: readonly Record<string, unknown>[],
  hours: PerformanceTimeRangeHours,
  nowMs: number,
): PerformanceTimelineBucket[] {
  const granularity = getBucketGranularity(hours);
  const latestBucketMs = Math.floor(nowMs / granularity.stepMs) * granularity.stepMs;
  const earliestBucketMs = latestBucketMs - (granularity.bucketCount - 1) * granularity.stepMs;
  const buckets: PerformanceTimelineBucket[] = Array.from({ length: granularity.bucketCount }, (_unused, index) => ({
    bucketMs: earliestBucketMs + index * granularity.stepMs,
    views: 0,
    lcpP75: null,
    inpP75: null,
  }));

  for (const row of rows) {
    const bucketMs = parseServiceTimestamp(requiredRowString(row, "bucket_start")).getTime();
    if (bucketMs < earliestBucketMs || bucketMs > latestBucketMs) continue;
    const index = (bucketMs - earliestBucketMs) / granularity.stepMs;
    if (!Number.isInteger(index)) {
      throw new Error(`Performance timeline bucket ${bucketMs} is not aligned to the ${granularity.label} grid`);
    }
    const bucket = buckets[index];
    bucket.views += requiredRowNumber(row, "views");
    bucket.lcpP75 = optionalRowNumber(row, "lcp_p75");
    bucket.inpP75 = optionalRowNumber(row, "inp_p75");
  }
  return buckets;
}

export function deadClickRate(page: PageBehavior): number | null {
  if (page.clicks === 0) return null;
  return page.deadClicks / page.clicks;
}

/**
 * Picks at most one insight per kind so the strip does not collapse into
 * "three slow pages". A page can still appear twice if it is both slow and
 * frustrating — that combination is the thing worth interrupting for.
 */
export function rankPageInsights(pages: readonly PagePerformance[]): PageInsight[] {
  const insights: PageInsight[] = [];

  const slowLcpPages = [...pages]
    .filter((page) => page.lcpSamples >= MIN_VITAL_INSIGHT_SAMPLES && page.lcpP75 != null && page.lcpP75 > 2500)
    .sort((left, right) => (right.lcpP75 ?? 0) - (left.lcpP75 ?? 0) || stringCompare(left.path, right.path));
  if (slowLcpPages.length > 0) insights.push({ kind: "slow-lcp", page: slowLcpPages[0] });

  const slowInpPages = [...pages]
    .filter((page) => page.inpSamples >= MIN_VITAL_INSIGHT_SAMPLES && page.inpP75 != null && page.inpP75 > 200)
    .sort((left, right) => (right.inpP75 ?? 0) - (left.inpP75 ?? 0) || stringCompare(left.path, right.path));
  if (slowInpPages.length > 0) insights.push({ kind: "slow-inp", page: slowInpPages[0] });

  const ragePages = [...pages]
    .filter((page) => page.rageClicks >= 3)
    .sort((left, right) => right.rageClicks - left.rageClicks || stringCompare(left.path, right.path));
  if (ragePages.length > 0) insights.push({ kind: "rage", page: ragePages[0] });

  const deadPages = [...pages]
    .filter((page) => page.clicks >= MIN_FRICTION_CLICKS && (deadClickRate(page) ?? 0) >= 0.08)
    .sort((left, right) => (deadClickRate(right) ?? 0) - (deadClickRate(left) ?? 0) || stringCompare(left.path, right.path));
  if (deadPages.length > 0) insights.push({ kind: "dead-clicks", page: deadPages[0] });

  const shallowPages = [...pages]
    .filter((page) => (
      page.views >= MIN_SHALLOW_VIEWS
      && page.avgScrollRatio != null
      && page.avgScrollRatio < 0.25
      && page.avgTimeOnPageMs != null
      && page.avgTimeOnPageMs < 8_000
    ))
    .sort((left, right) => right.views - left.views || stringCompare(left.path, right.path));
  if (shallowPages.length > 0) insights.push({ kind: "shallow", page: shallowPages[0] });

  return insights.slice(0, 3);
}

export async function fetchPerformancePageModel(
  adminApp: StackAdminApp<false>,
  hours: PerformanceTimeRangeHours,
  nowMs: number,
): Promise<{
  overview: PerformanceVitalsOverview,
  pages: PagePerformance[],
  timeline: PerformanceTimelineBucket[],
}> {
  const overviewQuery = getPerformanceVitalsOverviewQuery(hours);
  const pagesQuery = getPerformancePagesQuery(hours);
  const behaviorQuery = getPerformanceBehaviorQuery(hours);
  const timelineQuery = getPerformanceTimelineQuery(hours);
  const [overviewResponse, pagesResponse, behaviorResponse, timelineResponse] = await Promise.all([
    queryObservability(adminApp, { query: overviewQuery.query, params: overviewQuery.params }),
    queryObservability(adminApp, { query: pagesQuery.query, params: pagesQuery.params }),
    queryObservability(adminApp, { query: behaviorQuery.query, params: behaviorQuery.params }),
    queryObservability(adminApp, { query: timelineQuery.query, params: timelineQuery.params }),
  ]);
  if (overviewResponse.result.length === 0) {
    throw new Error("Performance vitals overview query returned no row");
  }
  return {
    overview: parsePerformanceVitalsOverviewRow(overviewResponse.result[0]),
    pages: mergePagePerformance(
      pagesResponse.result.map(parsePerformancePageRow),
      behaviorResponse.result.map(parsePerformanceBehaviorRow),
    ),
    timeline: buildPerformanceTimeline(timelineResponse.result, hours, nowMs),
  };
}
