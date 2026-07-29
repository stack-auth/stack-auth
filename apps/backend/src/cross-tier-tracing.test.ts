import { buildTraceparent, uuidToW3cTraceId } from "@hexclave/shared/dist/utils/analytics-wire";
import { ROOT_CONTEXT, defaultTextMapGetter } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

const { waitMock } = vi.hoisted(() => ({
  waitMock: vi.fn(async () => {}),
}));

vi.mock("@hexclave/shared/dist/utils/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("@hexclave/shared/dist/utils/promises")>(),
  wait: waitMock,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  waitMock.mockClear();
});

describe("cross-tier OpenTelemetry propagation", () => {
  it("allows W3C trace headers AND the native span-context header through the API CORS boundary", async () => {
    vi.stubEnv("STACK_ARTIFICIAL_DEVELOPMENT_DELAY_MS", "500");
    const response = await proxy(new NextRequest("http://localhost:8102/api/latest/users", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:8101",
        "access-control-request-headers": "traceparent, tracestate, x-hexclave-span-context",
      },
    }));

    expect(response.headers.get("Access-Control-Allow-Headers")?.split(", ")).toEqual(expect.arrayContaining([
      "traceparent",
      "tracestate",
      "x-hexclave-span-context",
    ]));
    expect(waitMock).not.toHaveBeenCalled();
  });

  it("continues a trace whose traceparent the SDK derived from a $http-client span uuid", () => {
    // The SDK's fetch instrumentation emits `traceparent = buildTraceparent(U)`
    // where U is the `$http-client` bridge span's uuid — so every backend span
    // of that request must store a trace id computable from the bridge span's
    // own id (`hc-<U>`). That derivability is the entire read-time join.
    const bridgeSpanUuid = "1b671a64-40d5-491e-99b0-da01ff1f3341";
    const propagator = new W3CTraceContextPropagator();
    const parentContext = propagator.extract(ROOT_CONTEXT, {
      traceparent: buildTraceparent(bridgeSpanUuid),
    }, defaultTextMapGetter);

    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    const backendSpan = provider.getTracer("cross-tier-test").startSpan("backend request", undefined, parentContext);
    backendSpan.end();

    const finished = exporter.getFinishedSpans();
    expect(finished).toHaveLength(1);
    expect(finished[0].spanContext().traceId).toBe(uuidToW3cTraceId(bridgeSpanUuid));
    expect(finished[0].spanContext().traceId).toBe("1b671a6440d5491e99b0da01ff1f3341");
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
