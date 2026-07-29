import { ROOT_CONTEXT, SpanKind, TraceFlags, trace, type Context, type SpanContext } from "@opentelemetry/api";
import { SamplingDecision } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { BACKEND_TRACE_SAMPLE_RATE, createBackendTraceSampler } from "./otel-sampling";

const REMOTE_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const REMOTE_SPAN_ID = "00f067aa0ba902b7";

function withRemoteParent(traceFlags: TraceFlags): Context {
  const spanContext: SpanContext = {
    traceId: REMOTE_TRACE_ID,
    spanId: REMOTE_SPAN_ID,
    traceFlags,
    isRemote: true,
  };
  return trace.setSpanContext(ROOT_CONTEXT, spanContext);
}

function decision(context: Context, traceId: string): SamplingDecision {
  return createBackendTraceSampler().shouldSample(
    context,
    traceId,
    "backend request",
    SpanKind.SERVER,
    {},
    [],
  ).decision;
}

describe("backend OpenTelemetry sampling", () => {
  it("samples 10% by trace id and keeps the remainder recordable for error promotion", () => {
    expect({
      rate: BACKEND_TRACE_SAMPLE_RATE,
      sampledRemoteParent: decision(withRemoteParent(TraceFlags.SAMPLED), REMOTE_TRACE_ID),
      unsampledRemoteParent: decision(withRemoteParent(TraceFlags.NONE), REMOTE_TRACE_ID),
      sampledRoot: decision(ROOT_CONTEXT, "00000000000000000000000000000001"),
      unselectedRoot: decision(ROOT_CONTEXT, "ffffffff00000000000000000000000000"),
    }).toMatchInlineSnapshot(`
      {
        "rate": 0.1,
        "sampledRemoteParent": 1,
        "sampledRoot": 2,
        "unsampledRemoteParent": 1,
        "unselectedRoot": 1,
      }
    `);
  });
});
