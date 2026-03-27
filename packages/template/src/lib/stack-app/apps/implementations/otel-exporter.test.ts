import { describe, expect, it, vi } from "vitest";
import type { AnalyticsBatchSpan } from "@stackframe/stack-shared/dist/interface/crud/analytics";
import { StackSpanExporter, hexToUuid, sanitizeSpanType, hrTimeToMs } from "./otel-exporter";

function makeReadableSpan(overrides: Record<string, unknown> = {}) {
  return {
    name: "db.query",
    spanContext: () => ({
      traceId: "abcdef0123456789abcdef0123456789",
      spanId: "1234567890abcdef",
    }),
    parentSpanId: "fedcba0987654321",
    startTime: [1700000000, 0] as [number, number],
    endTime: [1700000000, 500_000_000] as [number, number],
    status: { code: 1, message: "" },
    kind: 2, // SERVER
    attributes: { "db.system": "postgresql", "db.statement": "SELECT 1" },
    events: [],
    resource: { attributes: { "service.name": "my-service" } },
    ...overrides,
  };
}

describe("hexToUuid", () => {
  it("converts 32-hex trace ID to UUID format", () => {
    const result = hexToUuid("abcdef0123456789abcdef0123456789");
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // Version nibble forced to 4
    expect(result[14]).toBe("4");
    // Variant nibble forced to 8
    expect(result[19]).toBe("8");
  });

  it("pads 16-hex span ID to 32 chars before conversion", () => {
    const result = hexToUuid("1234567890abcdef");
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("produces deterministic results", () => {
    const a = hexToUuid("abcdef0123456789");
    const b = hexToUuid("abcdef0123456789");
    expect(a).toBe(b);
  });

  it("produces different results for different inputs", () => {
    const a = hexToUuid("aaaaaaaaaaaaaaaa");
    const b = hexToUuid("bbbbbbbbbbbbbbbb");
    expect(a).not.toBe(b);
  });
});

describe("sanitizeSpanType", () => {
  it("prefixes with the given prefix", () => {
    expect(sanitizeSpanType("db.query", "otel.")).toBe("otel.db.query");
  });

  it("replaces spaces and slashes with dots", () => {
    expect(sanitizeSpanType("GET /api/users", "otel.")).toBe("otel.GET..api.users");
  });

  it("strips invalid characters", () => {
    expect(sanitizeSpanType("my span <test>", "otel.")).toBe("otel.my.span.test");
  });

  it("returns prefix + unknown for empty result", () => {
    expect(sanitizeSpanType("<>", "otel.")).toBe("otel.unknown");
  });
});

describe("hrTimeToMs", () => {
  it("converts [seconds, nanoseconds] to milliseconds", () => {
    expect(hrTimeToMs([1700000000, 500_000_000])).toBe(1700000000500);
  });

  it("handles zero nanoseconds", () => {
    expect(hrTimeToMs([1700000000, 0])).toBe(1700000000000);
  });
});

describe("StackSpanExporter", () => {
  it("converts OTel ReadableSpan to AnalyticsBatchSpan", () => {
    const pushed: AnalyticsBatchSpan[] = [];
    const exporter = new StackSpanExporter((span) => pushed.push(span));

    const resultCallback = vi.fn();
    exporter.export([makeReadableSpan()], resultCallback);

    expect(resultCallback).toHaveBeenCalledWith({ code: 0 });
    expect(pushed).toHaveLength(1);

    const span = pushed[0]!;
    expect(span.span_type).toBe("otel.db.query");
    expect(span.span_id).toMatch(/^[0-9a-f]{8}-/);
    expect(span.trace_id).toMatch(/^[0-9a-f]{8}-/);
    expect(span.started_at_ms).toBe(1700000000000);
    expect(span.ended_at_ms).toBe(1700000000500);
    expect(span.parent_ids).toHaveLength(1);
    expect(span.data["db.system"]).toBe("postgresql");
    expect(span.data["db.statement"]).toBe("SELECT 1");
    expect(span.data.$status).toBe("ok");
    expect(span.data["otel.kind"]).toBe("server");
    expect(span.data["otel.trace_id"]).toBe("abcdef0123456789abcdef0123456789");
    expect(span.data["otel.span_id"]).toBe("1234567890abcdef");
    expect(span.data["otel.resource.service.name"]).toBe("my-service");
  });

  it("applies filter to skip spans", () => {
    const pushed: AnalyticsBatchSpan[] = [];
    const exporter = new StackSpanExporter((span) => pushed.push(span), {
      filter: (span) => span.name !== "skip-me",
    });

    exporter.export([
      makeReadableSpan({ name: "keep-me" }),
      makeReadableSpan({ name: "skip-me" }),
    ], vi.fn());

    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.span_type).toBe("otel.keep-me");
  });

  it("uses custom spanTypePrefix", () => {
    const pushed: AnalyticsBatchSpan[] = [];
    const exporter = new StackSpanExporter((span) => pushed.push(span), {
      spanTypePrefix: "custom.",
    });

    exporter.export([makeReadableSpan()], vi.fn());
    expect(pushed[0]!.span_type).toBe("custom.db.query");
  });

  it("maps error status correctly", () => {
    const pushed: AnalyticsBatchSpan[] = [];
    const exporter = new StackSpanExporter((span) => pushed.push(span));

    exporter.export([makeReadableSpan({
      status: { code: 2, message: "something broke" },
    })], vi.fn());

    expect(pushed[0]!.data.$status).toBe("error");
    expect(pushed[0]!.data.$status_message).toBe("something broke");
  });

  it("includes OTel events in data", () => {
    const pushed: AnalyticsBatchSpan[] = [];
    const exporter = new StackSpanExporter((span) => pushed.push(span));

    exporter.export([makeReadableSpan({
      events: [
        { name: "exception", time: [1700000000, 100_000_000], attributes: { "exception.message": "boom" } },
      ],
    })], vi.fn());

    const events = pushed[0]!.data["otel.events"] as Array<{ name: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe("exception");
  });

  it("preserves parent-child relationships through deterministic ID mapping", () => {
    const pushed: AnalyticsBatchSpan[] = [];
    const exporter = new StackSpanExporter((span) => pushed.push(span));

    const parentHexId = "aaaaaaaaaaaaaaaa";
    exporter.export([
      makeReadableSpan({
        name: "parent",
        spanContext: () => ({ traceId: "tttttttttttttttttttttttttttttttt", spanId: parentHexId }),
        parentSpanId: undefined,
      }),
      makeReadableSpan({
        name: "child",
        spanContext: () => ({ traceId: "tttttttttttttttttttttttttttttttt", spanId: "bbbbbbbbbbbbbbbb" }),
        parentSpanId: parentHexId,
      }),
    ], vi.fn());

    const parentSpan = pushed[0]!;
    const childSpan = pushed[1]!;
    // Child's parent_ids[0] should match parent's span_id
    expect(childSpan.parent_ids![0]).toBe(parentSpan.span_id);
    // Both should share the same trace_id
    expect(childSpan.trace_id).toBe(parentSpan.trace_id);
  });
});
