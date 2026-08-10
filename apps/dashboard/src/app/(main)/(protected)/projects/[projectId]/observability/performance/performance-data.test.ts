import { describe, expect, it, vi } from "vitest";

const { sendInternalAdminRequestMock } = vi.hoisted(() => ({
  sendInternalAdminRequestMock: vi.fn(),
}));

vi.mock("@/lib/hexclave-app-internals", () => ({
  sendInternalAdminRequest: sendInternalAdminRequestMock,
}));

import { fetchPerformanceMetrics, fetchWebVitals, parsePerformanceMetricResponse, WEB_VITAL_METRICS } from "./performance-data";

function responseBody() {
  return {
    window: {
      start_time_unix_nano: "1720000000000000000",
      end_time_unix_nano: "1720003600000000000",
      hours: 1,
    },
    catalog: [{
      metric_name: "queue.depth",
      metric_description: "Queue depth",
      metric_unit: "{items}",
      metric_type: "gauge",
      aggregation_temporality: 0,
      is_monotonic: false,
      point_count: 2,
      latest_time_unix_nano: "1720003599000000000",
      supports_numeric_aggregation: true,
    }],
    selected_metric_name: "queue.depth",
    selected_metric_type: "gauge",
    series: [{
      bucket_start_unix_nano: "1720003500000000000",
      point_count: 2,
      numeric_value: 4.5,
      minimum_value: 3,
      maximum_value: 6,
      exemplar: {
        trace_id: "0123456789abcdef0123456789abcdef",
        span_id: "0123456789abcdef",
      },
    }],
    partial: {
      has_unsupported_metric_types: false,
      unsupported_metric_types: [],
    },
  };
}

describe("performance metrics data contract", () => {
  it("parses the native metric read model and preserves exemplars", () => {
    const parsed = parsePerformanceMetricResponse(responseBody());
    expect(parsed.catalog[0]?.supports_numeric_aggregation).toBe(true);
    expect(parsed.series[0]?.numeric_value).toBe(4.5);
    expect(parsed.series[0]?.exemplar?.trace_id).toBe("0123456789abcdef0123456789abcdef");
  });

  it("rejects malformed or unsupported response state instead of silently defaulting", () => {
    expect(() => parsePerformanceMetricResponse({ ...responseBody(), catalog: "not-an-array" })).toThrow("catalog must be an array");
    expect(() => parsePerformanceMetricResponse({ ...responseBody(), window: { ...responseBody().window, hours: 2 } })).toThrow("unsupported time range");
    expect(() => parsePerformanceMetricResponse({
      ...responseBody(),
      catalog: [{ ...responseBody().catalog[0], metric_type: "unknown" }],
    })).toThrow("unknown metric type");
  });

  it("uses the typed admin route and sends no arbitrary SQL", async () => {
    sendInternalAdminRequestMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(responseBody()), { status: 200 })));
    const result = await fetchPerformanceMetrics({}, { hours: 1, metricName: "queue.depth" });

    expect(result.selected_metric_name).toBe("queue.depth");
    expect(sendInternalAdminRequestMock).toHaveBeenCalledWith({}, "/internal/analytics/metrics", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ hours: 1, metric_name: "queue.depth" }),
    }));
  });

  it("loads each browser metric stream in parallel for the overview cards", async () => {
    sendInternalAdminRequestMock.mockClear();
    sendInternalAdminRequestMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(responseBody()), { status: 200 })));

    const result = await fetchWebVitals({}, 1);

    expect(result.size).toBe(WEB_VITAL_METRICS.length);
    expect(sendInternalAdminRequestMock).toHaveBeenCalledTimes(WEB_VITAL_METRICS.length);
    expect(sendInternalAdminRequestMock.mock.calls.map((call) => JSON.parse(call[2].body).metric_name)).toEqual(
      WEB_VITAL_METRICS.map((metric) => metric.metricName),
    );
  });
});
