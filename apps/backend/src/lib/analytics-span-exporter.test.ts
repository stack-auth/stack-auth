import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
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

    const root = tracer.startSpan("request", { kind: SpanKind.SERVER });
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
    expect(rootRow.parent_span_ids).toEqual([]);
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
