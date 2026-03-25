import { describe, expect, it, vi } from "vitest";
import { SpanImpl, extractTraceContext, getActiveSpan, getErrorMetadata, runWithSpan, serializeTraceContext } from "./tracing";

describe("SpanImpl", () => {
  it("creates a span with auto-generated IDs", () => {
    const onEnd = vi.fn();
    const span = new SpanImpl({ spanType: "test.op", onEnd });

    expect(span.spanId).toBeTruthy();
    expect(span.traceId).toBeTruthy();
    expect(span.isEnded).toBe(false);
  });

  it("creates a span with explicit IDs", () => {
    const onEnd = vi.fn();
    const span = new SpanImpl({
      spanType: "test.op",
      spanId: "00000000-0000-4000-8000-000000000001",
      traceId: "00000000-0000-4000-8000-000000000002",
      onEnd,
    });

    expect(span.spanId).toBe("00000000-0000-4000-8000-000000000001");
    expect(span.traceId).toBe("00000000-0000-4000-8000-000000000002");
  });

  it("sets attributes", () => {
    const onEnd = vi.fn();
    const span = new SpanImpl({ spanType: "test.op", onEnd });

    span.setAttribute("key", "value");
    span.setAttributes({ a: 1, b: 2 });

    span.end();
    const payload = span.toPayload();
    expect(payload.data).toMatchObject({ key: "value", a: 1, b: 2 });
  });

  it("ignores setAttribute after end", () => {
    const onEnd = vi.fn();
    const span = new SpanImpl({ spanType: "test.op", onEnd });

    span.setAttribute("before", true);
    span.end();
    span.setAttribute("after", true);

    const payload = span.toPayload();
    expect(payload.data).toHaveProperty("before", true);
    expect(payload.data).not.toHaveProperty("after");
  });

  it("sets status", () => {
    const onEnd = vi.fn();
    const span = new SpanImpl({ spanType: "test.op", onEnd });

    span.setStatus("ok");
    span.end();

    const payload = span.toPayload();
    expect(payload.data["$status"]).toBe("ok");
  });

  it("sets status with message", () => {
    const onEnd = vi.fn();
    const span = new SpanImpl({ spanType: "test.op", onEnd });

    span.setStatus("error", "something broke");
    span.end();

    const payload = span.toPayload();
    expect(payload.data["$status"]).toBe("error");
    expect(payload.data["$status_message"]).toBe("something broke");
  });

  it("recordException sets error status and metadata", () => {
    const onEnd = vi.fn();
    const span = new SpanImpl({ spanType: "test.op", onEnd });

    span.recordException(new Error("test error"));
    span.end();

    const payload = span.toPayload();
    expect(payload.data["$status"]).toBe("error");
    expect(payload.data["error_name"]).toBe("Error");
    expect(payload.data["error_message"]).toBe("test error");
  });

  it("end() is idempotent", () => {
    const onEnd = vi.fn();
    const span = new SpanImpl({ spanType: "test.op", onEnd });

    span.end();
    span.end();

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(span.isEnded).toBe(true);
  });

  it("calls onEnd callback with the span", () => {
    const onEnd = vi.fn();
    const span = new SpanImpl({ spanType: "test.op", onEnd });

    span.end();

    expect(onEnd).toHaveBeenCalledWith(span);
  });

  it("toPayload includes trace_id", () => {
    const onEnd = vi.fn();
    const span = new SpanImpl({
      spanType: "test.op",
      traceId: "trace-123",
      onEnd,
    });
    span.end();

    const payload = span.toPayload();
    expect(payload.trace_id).toBe("trace-123");
    expect(payload.span_type).toBe("test.op");
  });

  it("toPayload includes parent_ids when set", () => {
    const onEnd = vi.fn();
    const span = new SpanImpl({
      spanType: "test.op",
      parentIds: ["parent-1", "parent-2"],
      onEnd,
    });
    span.end();

    const payload = span.toPayload();
    expect(payload.parent_ids).toEqual(["parent-1", "parent-2"]);
  });
});

describe("Span context", () => {
  it("getActiveSpan returns null when no span is active", () => {
    expect(getActiveSpan()).toBeNull();
  });

  it("runWithSpan sets and restores active span", () => {
    const onEnd = vi.fn();
    const span = new SpanImpl({ spanType: "test.op", onEnd });

    expect(getActiveSpan()).toBeNull();

    const result = runWithSpan(span, () => {
      expect(getActiveSpan()).toBe(span);
      return 42;
    });

    expect(result).toBe(42);
    expect(getActiveSpan()).toBeNull();
  });

  it("runWithSpan supports nesting", () => {
    const onEnd = vi.fn();
    const outer = new SpanImpl({ spanType: "outer", onEnd });
    const inner = new SpanImpl({ spanType: "inner", onEnd });

    runWithSpan(outer, () => {
      expect(getActiveSpan()).toBe(outer);

      runWithSpan(inner, () => {
        expect(getActiveSpan()).toBe(inner);
      });

      expect(getActiveSpan()).toBe(outer);
    });

    expect(getActiveSpan()).toBeNull();
  });

  it("runWithSpan restores on throw", () => {
    const onEnd = vi.fn();
    const span = new SpanImpl({ spanType: "test.op", onEnd });

    expect(() => {
      runWithSpan(span, () => {
        throw new Error("test");
      });
    }).toThrow("test");

    expect(getActiveSpan()).toBeNull();
  });
});

describe("Trace context serialization", () => {
  it("round-trips through serialize/extract", () => {
    const context = { traceId: "trace-abc", spanId: "span-xyz" };
    const headers = serializeTraceContext(context);

    expect(headers).toHaveProperty("x-stack-trace");

    const extracted = extractTraceContext(headers);
    expect(extracted.traceId).toBe("trace-abc");
    expect(extracted.parentSpanId).toBe("span-xyz");
  });

  it("extractTraceContext returns null for missing header", () => {
    const result = extractTraceContext({});
    expect(result.traceId).toBeNull();
    expect(result.parentSpanId).toBeNull();
  });

  it("extractTraceContext handles Fetch API Headers", () => {
    const headers = new Headers();
    headers.set("x-stack-trace", JSON.stringify({ trace_id: "t1", span_id: "s1" }));

    const result = extractTraceContext(headers);
    expect(result.traceId).toBe("t1");
    expect(result.parentSpanId).toBe("s1");
  });

  it("extractTraceContext handles malformed JSON", () => {
    const result = extractTraceContext({ "x-stack-trace": "not json" });
    expect(result.traceId).toBeNull();
    expect(result.parentSpanId).toBeNull();
  });

  it("extractTraceContext handles Express-style array headers", () => {
    const result = extractTraceContext({
      "x-stack-trace": [JSON.stringify({ trace_id: "t2", span_id: "s2" })],
    });
    expect(result.traceId).toBe("t2");
    expect(result.parentSpanId).toBe("s2");
  });
});

describe("getErrorMetadata", () => {
  it("extracts metadata from Error", () => {
    const result = getErrorMetadata(new Error("test"));
    expect(result.error_name).toBe("Error");
    expect(result.error_message).toBe("test");
    expect(result.error_kind).toBe("Error");
  });

  it("handles string errors", () => {
    const result = getErrorMetadata("oops");
    expect(result.error_message).toBe("oops");
    expect(result.error_kind).toBe("string");
  });

  it("handles null", () => {
    const result = getErrorMetadata(null);
    expect(result.error_kind).toBe("null");
  });

  it("handles plain objects", () => {
    const result = getErrorMetadata({ message: "obj error", name: "CustomError" });
    expect(result.error_name).toBe("CustomError");
    expect(result.error_message).toBe("obj error");
  });
});
