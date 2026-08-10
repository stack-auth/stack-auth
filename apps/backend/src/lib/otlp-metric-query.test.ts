import {
  buildOtlpMetricCatalogQuery,
  buildOtlpMetricSeriesQuery,
  getOtlpMetricBucketNanoseconds,
  parseOtlpMetricCatalogRows,
  parseOtlpMetricQueryHours,
  parseOtlpMetricSeriesRows,
  parseOtlpMetricUint64,
} from "./otlp-metric-query";
import { describe, expect, it } from "vitest";

describe("OTLP metric query contract", () => {
  it("keeps the public time-range allowlist explicit", () => {
    expect(parseOtlpMetricQueryHours(undefined)).toBe(24);
    expect(parseOtlpMetricQueryHours(1)).toBe(1);
    expect(parseOtlpMetricQueryHours(720)).toBe(720);
    expect(() => parseOtlpMetricQueryHours(2)).toThrow("hours must be one of 1, 24, 168, 720");
  });

  it("uses bounded bucket widths for every supported range", () => {
    expect(getOtlpMetricBucketNanoseconds(1)).toBe(300_000_000_000n);
    expect(getOtlpMetricBucketNanoseconds(24)).toBe(3_600_000_000_000n);
    expect(getOtlpMetricBucketNanoseconds(168)).toBe(21_600_000_000_000n);
    expect(getOtlpMetricBucketNanoseconds(720)).toBe(86_400_000_000_000n);
  });

  it("makes tenant scoping and canonical replacement explicit in both queries", () => {
    expect(buildOtlpMetricCatalogQuery(24)).toContain("FROM analytics_internal.otel_metrics FINAL");
    expect(buildOtlpMetricCatalogQuery(24)).toContain("project_id = {projectId:String}");
    expect(buildOtlpMetricCatalogQuery(24)).toContain("branch_id = {branchId:String}");
    expect(buildOtlpMetricCatalogQuery(24)).toContain("toString(max(time_unix_nano)) AS latest_time_unix_nano");
    expect(buildOtlpMetricSeriesQuery(24)).toContain("m.metric_name = {metricName:String}");
    expect(buildOtlpMetricSeriesQuery(24)).toContain("m.metric_type = {metricType:String}");
    expect(buildOtlpMetricSeriesQuery(24)).toContain("toString(bucket_start_unix_nano_value) AS bucket_start_unix_nano");
    expect(buildOtlpMetricSeriesQuery(24)).toContain("bucketNanoseconds:UInt64");
  });

  it("preserves large UInt64 timestamps serialized as strings", () => {
    const timestamp = "18446744073709551615";
    expect(parseOtlpMetricUint64(timestamp, "time_unix_nano")).toBe(timestamp);
    expect(() => parseOtlpMetricUint64(Number.MAX_SAFE_INTEGER + 1, "time_unix_nano")).toThrow("unsafe");
  });

  it("marks histogram and summary catalog entries as numerically aggregatable", () => {
    const catalog = parseOtlpMetricCatalogRows([
      {
        metric_name: "http.server.duration",
        metric_description: "Request duration",
        metric_unit: "ms",
        metric_type: "histogram",
        aggregation_temporality: 2,
        is_monotonic: 0,
        point_count: "3",
        latest_time_unix_nano: "1720000000000000000",
      },
      {
        metric_name: "queue.depth",
        metric_description: "Queue depth",
        metric_unit: "{items}",
        metric_type: "gauge",
        aggregation_temporality: 0,
        is_monotonic: 0,
        point_count: 4,
        latest_time_unix_nano: "1720000000000000001",
      },
    ]);

    expect(catalog.map((entry) => [entry.metric_type, entry.supports_numeric_aggregation])).toEqual([
      ["histogram", true],
      ["gauge", true],
    ]);
  });

  it("preserves exemplar identity and null numeric state in series rows", () => {
    expect(parseOtlpMetricSeriesRows([
      {
        bucket_start_unix_nano: "1720000000000000000",
        point_count: "2",
        numeric_value: null,
        minimum_value: null,
        maximum_value: null,
        exemplar_trace_id: "0123456789abcdef0123456789abcdef",
        exemplar_span_id: "0123456789abcdef",
      },
    ])).toEqual([
      {
        bucket_start_unix_nano: "1720000000000000000",
        point_count: 2,
        numeric_value: null,
        minimum_value: null,
        maximum_value: null,
        exemplar: {
          trace_id: "0123456789abcdef0123456789abcdef",
          span_id: "0123456789abcdef",
        },
      },
    ]);
  });
});
