import { ROOT_CONTEXT, SpanKind, TraceFlags, trace, type Context, type SpanContext } from "@opentelemetry/api";
import { SamplingDecision } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { createDevelopmentTraceSampler } from "./otel-sampling";

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

function isSampled(context: Context, traceId: string): boolean {
  const result = createDevelopmentTraceSampler().shouldSample(
    context,
    traceId,
    "backend request",
    SpanKind.SERVER,
    {},
    [],
  );
  return result.decision === SamplingDecision.RECORD_AND_SAMPLED;
}

describe("development OpenTelemetry sampling", () => {
  it("preserves sampled cross-tier parents while downsampling unrelated roots", () => {
    expect({
      sampledRemoteParent: isSampled(withRemoteParent(TraceFlags.SAMPLED), REMOTE_TRACE_ID),
      unsampledRemoteParent: isSampled(withRemoteParent(TraceFlags.NONE), REMOTE_TRACE_ID),
      sampledRoot: isSampled(ROOT_CONTEXT, "00000000000000000000000000000001"),
      droppedRoot: isSampled(ROOT_CONTEXT, "ffffffff00000000000000000000000000"),
    }).toMatchInlineSnapshot(`
      {
        "droppedRoot": false,
        "sampledRemoteParent": true,
        "sampledRoot": true,
        "unsampledRemoteParent": false,
      }
    `);
  });
});
