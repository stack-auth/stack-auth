import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

export type SpanAggregate = {
  name: string;
  count: number;
  totalInclusiveDurationMs: number;
  totalExclusiveDurationMs: number;
};

export type BackendRuntimeDiagnostics = {
  eventLoopDelay: {
    minMs: number,
    maxMs: number,
    meanMs: number,
    p50Ms: number,
    p95Ms: number,
    p99Ms: number,
    p99_9Ms: number,
  },
  cpu: {
    userSeconds: number,
    systemSeconds: number,
  },
};

const spanAggregationEnabled = getEnvVariable("HEXCLAVE_SPAN_AGGREGATION", "false") === "true";
const eventLoopHistogram: IntervalHistogram | undefined = spanAggregationEnabled
  ? monitorEventLoopDelay({ resolution: 20 })
  : undefined;
let previousCpuUsage = spanAggregationEnabled ? process.cpuUsage() : undefined;

if (eventLoopHistogram != null) {
  eventLoopHistogram.enable();
}

function durationMs(startTime: [number, number], endTime: [number, number]): number {
  return (endTime[0] - startTime[0]) * 1000 + (endTime[1] - startTime[1]) / 1_000_000;
}

class SpanAggregationProcessor implements SpanProcessor {
  private readonly aggregates = new Map<string, SpanAggregate>();
  private readonly childDurationBySpanId = new Map<string, number>();

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  onEnd(span: ReadableSpan): void {
    const spanId = span.spanContext().spanId;
    const inclusiveDurationMs = durationMs(span.startTime, span.endTime);
    const childDurationMs = this.childDurationBySpanId.get(spanId) ?? 0;
    const exclusiveDurationMs = Math.max(0, inclusiveDurationMs - childDurationMs);
    this.childDurationBySpanId.delete(spanId);

    const aggregate = this.aggregates.get(span.name);
    if (aggregate == null) {
      this.aggregates.set(span.name, {
        name: span.name,
        count: 1,
        totalInclusiveDurationMs: inclusiveDurationMs,
        totalExclusiveDurationMs: exclusiveDurationMs,
      });
    } else {
      aggregate.count += 1;
      aggregate.totalInclusiveDurationMs += inclusiveDurationMs;
      aggregate.totalExclusiveDurationMs += exclusiveDurationMs;
    }

    const parentSpanId = span.parentSpanContext?.spanId;
    if (parentSpanId != null) {
      this.childDurationBySpanId.set(
        parentSpanId,
        (this.childDurationBySpanId.get(parentSpanId) ?? 0) + inclusiveDurationMs,
      );
    }
  }

  onStart(): void {
    // Span durations are calculated when spans end; no start bookkeeping is required.
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  snapshot(): SpanAggregate[] {
    return Array.from(this.aggregates.values())
      .map((aggregate) => ({ ...aggregate }))
      .sort((left, right) => right.totalExclusiveDurationMs - left.totalExclusiveDurationMs);
  }

  reset(): void {
    this.aggregates.clear();
    this.childDurationBySpanId.clear();
  }
}

export const spanAggregationProcessor = new SpanAggregationProcessor();

export function isSpanAggregationEnabled(): boolean {
  return spanAggregationEnabled;
}

export function getSpanAggregates(reset = false): SpanAggregate[] {
  const aggregates = spanAggregationProcessor.snapshot();
  if (reset) {
    spanAggregationProcessor.reset();
  }
  return aggregates;
}

function histogramValue(value: number): number {
  return Number.isFinite(value) ? value / 1e6 : 0;
}

export function getBackendRuntimeDiagnostics(reset = false): BackendRuntimeDiagnostics {
  if (!spanAggregationEnabled || eventLoopHistogram == null) {
    return {
      eventLoopDelay: {
        minMs: 0,
        maxMs: 0,
        meanMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        p99_9Ms: 0,
      },
      cpu: {
        userSeconds: 0,
        systemSeconds: 0,
      },
    };
  }

  const cpuUsage = process.cpuUsage(previousCpuUsage);
  const diagnostics = {
    eventLoopDelay: {
      minMs: histogramValue(eventLoopHistogram.min),
      maxMs: histogramValue(eventLoopHistogram.max),
      meanMs: histogramValue(eventLoopHistogram.mean),
      p50Ms: histogramValue(eventLoopHistogram.percentile(50)),
      p95Ms: histogramValue(eventLoopHistogram.percentile(95)),
      p99Ms: histogramValue(eventLoopHistogram.percentile(99)),
      p99_9Ms: histogramValue(eventLoopHistogram.percentile(99.9)),
    },
    cpu: {
      userSeconds: cpuUsage.user / 1e6,
      systemSeconds: cpuUsage.system / 1e6,
    },
  };

  if (reset) {
    previousCpuUsage = process.cpuUsage();
    eventLoopHistogram.reset();
  }

  return diagnostics;
}
