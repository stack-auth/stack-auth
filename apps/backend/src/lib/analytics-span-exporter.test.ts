import { context, createTraceState, SpanKind, SpanStatusCode, TraceFlags, trace } from "@opentelemetry/api";
import { Resource } from "@opentelemetry/resources";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { AnalyticsSpanExporter } from "./analytics-span-exporter";
import type { NormalizedOtlpSpan } from "./otlp";

describe("AnalyticsSpanExporter", () => {
  it("writes completed OTel spans in the native Analytics span shape", async () => {
    const written: NormalizedOtlpSpan[] = [];
    const exporter = new AnalyticsSpanExporter(async (spans) => {
      written.push(...spans);
    });
    const provider = new BasicTracerProvider({
      resource: new Resource({ "service.name": "backend-test" }),
    });
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    const tracer = provider.getTracer("analytics-exporter-test", "1.0.0");

    const upstreamSpanContext = {
      traceId: "11111111111111111111111111111111",
      spanId: "2222222222222222",
      traceFlags: TraceFlags.SAMPLED,
      traceState: createTraceState("vendor=upstream"),
      isRemote: true,
    };
    const linkedSpanContext = {
      traceId: "33333333333333333333333333333333",
      spanId: "4444444444444444",
      traceFlags: TraceFlags.SAMPLED,
      traceState: createTraceState("vendor=linked"),
    };
    const upstreamContext = trace.setSpanContext(context.active(), upstreamSpanContext);
    const root = tracer.startSpan("request", {
      kind: SpanKind.SERVER,
      links: [{ context: linkedSpanContext }],
    }, upstreamContext);
    root.setAttribute("http.request.method", "POST");
    root.setStatus({ code: SpanStatusCode.OK });
    const rootContext = trace.setSpan(context.active(), root);
    const child = tracer.startSpan("database", { kind: SpanKind.CLIENT }, rootContext);
    child.setAttribute("db.system.name", "postgresql");
    child.end();
    root.end();

    await provider.forceFlush();
    expect(written).toHaveLength(2);
    const rootRow = written.find((span) => span.name === "request");
    const childRow = written.find((span) => span.name === "database");
    if (rootRow === undefined || childRow === undefined) throw new Error("Expected both exported spans");

    expect(rootRow.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(rootRow.parent_span_ids).toEqual([upstreamSpanContext.spanId]);
    expect(rootRow.trace_flags).toBe(TraceFlags.SAMPLED);
    expect(rootRow.trace_state).toBe("vendor=upstream");
    expect(rootRow.links).toMatchObject([{
      linked_trace_id: linkedSpanContext.traceId,
      linked_span_id: linkedSpanContext.spanId,
      linked_trace_flags: TraceFlags.SAMPLED,
      linked_trace_state: "vendor=linked",
    }]);
    expect(rootRow.service_name).toBe("backend-test");
    expect(rootRow.attributes).toContain("\"http.request.method\":\"POST\"");
    expect(rootRow.kind).toBe("server");
    expect(rootRow.status_code).toBe("ok");
    expect(rootRow.scope_name).toBe("analytics-exporter-test");
    expect(childRow.parent_span_ids).toEqual([rootRow.span_id]);
    expect(childRow.attributes).toContain("\"db.system.name\":\"postgresql\"");
    expect(childRow.kind).toBe("client");

    await provider.shutdown();
  });
});
