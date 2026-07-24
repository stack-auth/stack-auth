import { ROOT_CONTEXT, defaultTextMapGetter } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

describe("cross-tier OpenTelemetry propagation", () => {
  it("allows W3C trace headers through the API CORS boundary", async () => {
    const response = await proxy(new NextRequest("http://localhost:8102/api/latest/users", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:8101",
        "access-control-request-headers": "traceparent, tracestate",
      },
    }));

    expect(response.headers.get("Access-Control-Allow-Headers")?.split(", ")).toEqual(expect.arrayContaining([
      "traceparent",
      "tracestate",
    ]));
  });

  it("continues the dashboard trace ID and parent span on the backend", () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const dashboardSpanId = "00f067aa0ba902b7";
    const propagator = new W3CTraceContextPropagator();
    const parentContext = propagator.extract(ROOT_CONTEXT, {
      traceparent: `00-${traceId}-${dashboardSpanId}-01`,
    }, defaultTextMapGetter);

    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

    const backendSpan = provider.getTracer("cross-tier-test").startSpan("backend request", undefined, parentContext);
    backendSpan.end();

    expect(exporter.getFinishedSpans().map((span) => ({
      traceId: span.spanContext().traceId,
      parentSpanId: span.parentSpanId,
    }))).toMatchInlineSnapshot(`
      [
        {
          "parentSpanId": "00f067aa0ba902b7",
          "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
        },
      ]
    `);
  });
});
