import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";

export type SpanAggregate = {
  name: string;
  count: number;
  totalInclusiveDurationMs: number;
  totalExclusiveDurationMs: number;
};

const spanAggregationEnabled = getEnvVariable("HEXCLAVE_SPAN_AGGREGATION", "false") === "true";

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
