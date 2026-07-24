import { ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";

const DEVELOPMENT_ROOT_TRACE_SAMPLE_RATE = 0.01;

/**
 * Keeps the sampled decision from an incoming W3C parent, while limiting
 * unrelated development-environment roots so bounded exporter queues remain
 * available for request traces.
 */
export function createDevelopmentTraceSampler(): ParentBasedSampler {
  return new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(DEVELOPMENT_ROOT_TRACE_SAMPLE_RATE),
  });
}
