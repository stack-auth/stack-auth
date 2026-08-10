import { sendInternalAdminRequest } from "@/lib/hexclave-app-internals";
import type { StackAdminApp } from "@hexclave/next";
import { queryObservability } from "../filters";
import {
  getServicesSummaryQuery,
  parseServiceSummaryRow,
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

function isPerformanceMetricType(value: string): value is PerformanceMetricType {
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
  request: { hours: PerformanceTimeRangeHours, metricName: string | null },
): Promise<PerformanceMetricResponse> {
  const response = await sendInternalAdminRequest(adminApp, "/internal/analytics/metrics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hours: request.hours, ...(request.metricName == null ? {} : { metric_name: request.metricName }) }),
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
