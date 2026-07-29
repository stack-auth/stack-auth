import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  type IdGenerator,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { createBackendTraceSampler } from "./otel-sampling";
import { ErrorPromotingBatchSpanProcessor } from "./self-telemetry-trace-processor";

const SELECTED_TRACE_ID = "00000000000000000000000000000001";
const UNSELECTED_TRACE_ID = "ffffffff00000000000000000000000000";

class FixedTraceIdGenerator implements IdGenerator {
  private nextSpanId = 1;

  constructor(private readonly traceId: string) {}

  generateTraceId(): string {
    return this.traceId;
  }

  generateSpanId(): string {
    const spanId = this.nextSpanId.toString(16).padStart(16, "0");
    this.nextSpanId += 1;
    return spanId;
  }
}

class CollectingSpanExporter implements SpanExporter {
  readonly spans: ReadableSpan[] = [];

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.spans.push(...spans);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  async shutdown(): Promise<void> {}
}

async function runTrace(options: {
  traceId: string,
  markChildAsError?: boolean,
  promoteFromErrorLog?: boolean,
}): Promise<string[]> {
  const exporter = new CollectingSpanExporter();
  const processor = new ErrorPromotingBatchSpanProcessor(exporter, {
    completionDelayMillis: 0,
    scheduledDelayMillis: 60_000,
  });
  const provider = new BasicTracerProvider({
    sampler: createBackendTraceSampler(),
    idGenerator: new FixedTraceIdGenerator(options.traceId),
  });
  provider.addSpanProcessor(processor);
  const tracer = provider.getTracer("error-promoting-processor-test");
  const root = tracer.startSpan("root");
  context.with(trace.setSpan(context.active(), root), () => {
    const child = tracer.startSpan("child");
    if (options.markChildAsError === true) child.setStatus({ code: SpanStatusCode.ERROR });
    child.end();
    if (options.promoteFromErrorLog === true) {
      processor.markTraceAsErrored(root.spanContext().traceId);
    }
  });
  root.end();
  await provider.forceFlush();
  const names = exporter.spans.map((span) => span.name).sort();
  await provider.shutdown();
  return names;
}

describe("ErrorPromotingBatchSpanProcessor", () => {
  it("exports a healthy trace selected by the 10% sampler", async () => {
    await expect(runTrace({ traceId: SELECTED_TRACE_ID })).resolves.toEqual(["child", "root"]);
  });

  it("drops a healthy trace outside the 10% sample", async () => {
    await expect(runTrace({ traceId: UNSELECTED_TRACE_ID })).resolves.toEqual([]);
  });

  it("promotes the complete trace when an unsampled span is an error", async () => {
    await expect(runTrace({
      traceId: UNSELECTED_TRACE_ID,
      markChildAsError: true,
    })).resolves.toEqual(["child", "root"]);
  });

  it("promotes the complete trace when an error log is attached to it", async () => {
    await expect(runTrace({
      traceId: UNSELECTED_TRACE_ID,
      promoteFromErrorLog: true,
    })).resolves.toEqual(["child", "root"]);
  });

  it("exports finished spans immediately after promotion even while an ancestor remains open", async () => {
    const exporter = new CollectingSpanExporter();
    const processor = new ErrorPromotingBatchSpanProcessor(exporter, {
      completionDelayMillis: 0,
      scheduledDelayMillis: 60_000,
    });
    const provider = new BasicTracerProvider({
      sampler: createBackendTraceSampler(),
      idGenerator: new FixedTraceIdGenerator(UNSELECTED_TRACE_ID),
    });
    provider.addSpanProcessor(processor);
    const tracer = provider.getTracer("open-ancestor-test");
    const root = tracer.startSpan("root");
    context.with(trace.setSpan(context.active(), root), () => {
      const finishedChild = tracer.startSpan("finished-child");
      finishedChild.end();
      processor.markTraceAsErrored(root.spanContext().traceId);
    });

    await provider.forceFlush();
    expect(exporter.spans.map((span) => span.name)).toEqual(["finished-child"]);

    root.end();
    await provider.forceFlush();
    expect(exporter.spans.map((span) => span.name).sort()).toEqual(["finished-child", "root"]);
    await provider.shutdown();
  });
});
