import type { Context, Link, SpanAttributes, SpanKind } from "@opentelemetry/api";
import {
  SamplingDecision,
  TraceIdRatioBasedSampler,
  type Sampler,
  type SamplingResult,
} from "@opentelemetry/sdk-trace-base";

export const BACKEND_TRACE_SAMPLE_RATE = 0.1;

/**
 * Makes one deterministic decision per trace id: selected traces are sampled,
 * while the other 90% remain RECORD-only long enough for the self-telemetry
 * processor to promote the complete trace if any span or correlated log is an
 * error. Standard sampled-only exporters still see exactly the selected 10%.
 *
 * This deliberately does not inherit an incoming sampled flag. The browser
 * currently propagates sampled traceparents for cross-tier correlation; using
 * a parent-based sampler here would let that client decision silently bypass
 * the backend's own volume policy.
 */
export function createBackendTraceSampler(): Sampler {
  const ratioSampler = new TraceIdRatioBasedSampler(BACKEND_TRACE_SAMPLE_RATE);
  return {
    shouldSample(
      context: Context,
      traceId: string,
      spanName: string,
      spanKind: SpanKind,
      attributes: SpanAttributes,
      links: Link[],
    ): SamplingResult {
      const result = ratioSampler.shouldSample(context, traceId);
      return result.decision === SamplingDecision.RECORD_AND_SAMPLED
        ? result
        : { ...result, decision: SamplingDecision.RECORD };
    },
    toString(): string {
      return `ErrorPromotableTraceIdRatioBased{${BACKEND_TRACE_SAMPLE_RATE}}`;
    },
  };
}
