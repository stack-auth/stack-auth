import { context, SpanKind, SpanStatusCode, TraceFlags, trace } from "@opentelemetry/api";
import { Resource } from "@opentelemetry/resources";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { AnalyticsSpanExporter, buildAnalyticsSpanRows, hrTimeToMilliseconds, splitResourceAttributes, type AnalyticsSpanExportGroup } from "./self-telemetry-span-exporter";
import type { AnalyticsSpanRow } from "./self-telemetry-spans";

describe("AnalyticsSpanExporter", () => {
  it("writes completed backend spans in the native Analytics span shape", async () => {
    const written: AnalyticsSpanRow[] = [];
    const writtenGroups: AnalyticsSpanExportGroup[] = [];
    const exporter = new AnalyticsSpanExporter(async (groups) => {
      writtenGroups.push(...groups);
      written.push(...groups.flatMap((group) => group.spans));
    });
    const provider = new BasicTracerProvider({
      resource: new Resource({
        "service.name": "backend-test",
        "deployment.environment.name": "test",
        "host.name": "test-host",
      }),
    });
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    const tracer = provider.getTracer("analytics-exporter-test", "1.0.0");

    const upstreamSpanContext = {
      traceId: "11111111111111111111111111111111",
      spanId: "2222222222222222",
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    };
    const linkedSpanContext = {
      traceId: "33333333333333333333333333333333",
      spanId: "4444444444444444",
      traceFlags: TraceFlags.SAMPLED,
    };
    const upstreamContext = trace.setSpanContext(context.active(), upstreamSpanContext);
    const root = tracer.startSpan("request", {
      kind: SpanKind.SERVER,
      links: [{ context: linkedSpanContext, attributes: { reason: "follows-from" } }],
    }, upstreamContext);
    root.setAttribute("http.request.method", "POST");
    root.addEvent("exception", { "exception.type": "TypeError" });
    root.setStatus({ code: SpanStatusCode.OK });
    const rootContext = trace.setSpan(context.active(), root);
    const child = tracer.startSpan("database", { kind: SpanKind.CLIENT }, rootContext);
    child.setAttribute("db.system.name", "postgresql");
    child.setStatus({ code: SpanStatusCode.ERROR, message: "connection reset" });
    child.end();
    root.end();

    await provider.forceFlush();
    expect(written).toHaveLength(2);
    // No tenancy was recorded for these spans (no request holder in tests), so
    // every group is the unresolved ("internal") one. (SimpleSpanProcessor
    // exports each span as its own batch, hence potentially several groups.)
    expect(writtenGroups.every((group) => group.tenancy === null)).toBe(true);
    const rootRow = written.find((span) => span.span_type === "request");
    const childRow = written.find((span) => span.span_type === "database");
    if (rootRow === undefined || childRow === undefined) throw new Error("Expected both exported spans");

    expect(rootRow.trace_id).toBe(upstreamSpanContext.traceId);
    expect(rootRow.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(rootRow.parent_span_ids).toEqual([upstreamSpanContext.spanId]);
    expect(rootRow.kind).toBe("server");
    expect(rootRow.status_code).toBe("ok");
    expect(rootRow.status_message).toBeNull();
    expect(rootRow.producer).toBe("hexclave-backend");
    expect(rootRow.service_name).toBe("backend-test");
    expect(rootRow.deployment_environment_name).toBe("test");
    // Promoted identity keys must NOT be duplicated in the remainder blob;
    // everything unpromoted must survive there.
    const resourceRemainder = JSON.parse(rootRow.resource_attributes);
    expect(resourceRemainder["service.name"]).toBeUndefined();
    expect(resourceRemainder["host.name"]).toBe("test-host");
    expect(JSON.parse(rootRow.data)).toEqual({ "http.request.method": "POST" });
    expect(rootRow.scope_name).toBe("analytics-exporter-test");
    expect(rootRow.scope_version).toBe("1.0.0");
    expect(rootRow.events).toMatchObject([{ name: "exception", data: { "exception.type": "TypeError" } }]);
    expect(rootRow.links).toEqual([{
      linked_trace_id: linkedSpanContext.traceId,
      linked_span_id: linkedSpanContext.spanId,
      attributes: JSON.stringify({ reason: "follows-from" }),
    }]);
    expect(rootRow.version).toBe(rootRow.ended_at.getTime());

    expect(childRow.kind).toBe("client");
    expect(childRow.status_code).toBe("error");
    expect(childRow.status_message).toBe("connection reset");
    expect(JSON.parse(childRow.data)).toEqual({ "db.system.name": "postgresql" });
    // SimpleSpanProcessor exports each span in its own batch, so the child's
    // ancestry cannot be expanded through the (not-yet-exported) root here —
    // it keeps its single known parent. Whole-batch expansion is covered by
    // the buildAnalyticsSpanRows test below.
    expect(childRow.parent_span_ids).toEqual([rootRow.span_id]);

    await provider.shutdown();
  });

  it("strips lone surrogates from span data before it can poison the ClickHouse insert", async () => {
    const written: AnalyticsSpanRow[] = [];
    const exporter = new AnalyticsSpanExporter(async (groups) => {
      written.push(...groups.flatMap((group) => group.spans));
    });
    const provider = new BasicTracerProvider({ resource: new Resource({}) });
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    const span = provider.getTracer("test").startSpan("surrogates");
    span.setAttribute("label", "truncated \ud83d");
    span.end();
    await provider.forceFlush();
    expect(JSON.parse(written[0].data)).toEqual({ label: "truncated �" });
    await provider.shutdown();
  });
});

describe("buildAnalyticsSpanRows", () => {
  it("returns no rows for an empty batch", () => {
    expect(buildAnalyticsSpanRows([])).toEqual([]);
  });

  it("expands ancestry through parents present in the same batch, root-first", async () => {
    // The production path (BatchSpanProcessor) flushes a request's spans
    // together; collect the finished spans with an in-memory exporter and run
    // the row builder over the WHOLE batch to exercise the expansion.
    const inMemory = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({ resource: new Resource({}) });
    provider.addSpanProcessor(new SimpleSpanProcessor(inMemory));
    const tracer = provider.getTracer("expansion-test");

    const upstreamContext = trace.setSpanContext(context.active(), {
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      spanId: "bbbbbbbbbbbbbbbb",
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    });
    const root = tracer.startSpan("request", {}, upstreamContext);
    const rootContext = trace.setSpan(context.active(), root);
    const mid = tracer.startSpan("handler", {}, rootContext);
    const leaf = tracer.startSpan("query", {}, trace.setSpan(context.active(), mid));
    leaf.end();
    mid.end();
    root.end();
    await provider.forceFlush();

    const rows = buildAnalyticsSpanRows(inMemory.getFinishedSpans());
    const rowByType = new Map(rows.map((row) => [row.span_type, row]));
    const rootRow = rowByType.get("request");
    const midRow = rowByType.get("handler");
    const leafRow = rowByType.get("query");
    if (rootRow === undefined || midRow === undefined || leafRow === undefined) throw new Error("Expected all three exported spans");
    // The remote upstream parent is outside the batch, so it stays as the
    // farthest KNOWN ancestor; in-batch ancestors expand to the full path.
    expect(rootRow.parent_span_ids).toEqual(["bbbbbbbbbbbbbbbb"]);
    expect(midRow.parent_span_ids).toEqual(["bbbbbbbbbbbbbbbb", rootRow.span_id]);
    expect(leafRow.parent_span_ids).toEqual(["bbbbbbbbbbbbbbbb", rootRow.span_id, midRow.span_id]);
    await provider.shutdown();
  });
});

describe("hrTimeToMilliseconds", () => {
  it("floors sub-millisecond precision", () => {
    expect(hrTimeToMilliseconds([1, 999_999])).toBe(1_000);
    expect(hrTimeToMilliseconds([1, 1_000_000])).toBe(1_001);
  });
});

describe("splitResourceAttributes", () => {
  it("promotes the service identity keys and keeps the rest as JSON", () => {
    const { promoted, remainderJson } = splitResourceAttributes({
      "service.namespace": "acme",
      "service.name": "checkout",
      "service.version": "1.2.3",
      "service.instance.id": "pod-7",
      "deployment.environment.name": "production",
      "process.pid": 42,
    });
    expect(promoted).toEqual({
      service_namespace: "acme",
      service_name: "checkout",
      service_version: "1.2.3",
      service_instance_id: "pod-7",
      deployment_environment_name: "production",
    });
    expect(JSON.parse(remainderJson)).toEqual({ "process.pid": 42 });
  });

  it("leaves malformed (non-string) identity values in the blob instead of promoting them", () => {
    // A number is a legal attribute value on the wire, just not a legal
    // service identity — it must stay in the blob rather than be coerced.
    const { promoted, remainderJson } = splitResourceAttributes({ "service.name": 7 });
    expect(promoted.service_name).toBeNull();
    expect(JSON.parse(remainderJson)).toEqual({ "service.name": 7 });
  });
});
