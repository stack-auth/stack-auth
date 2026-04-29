import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { appendFileSync } from "node:fs";

const traceLogFile = process.env.STACK_TRACE_LOG_FILE;

const provider = new NodeTracerProvider();

if (traceLogFile) {
  const exporter: SpanExporter = {
    export(spans: ReadableSpan[], cb: (result: { code: ExportResultCode }) => void) {
      try {
        const lines = spans.map((s) => JSON.stringify({
          name: s.name,
          traceId: s.spanContext().traceId,
          spanId: s.spanContext().spanId,
          parentSpanId: (s as any).parentSpanContext?.spanId ?? (s as any).parentSpanId,
          startMs: s.startTime[0] * 1000 + s.startTime[1] / 1e6,
          durationMs: s.duration[0] * 1000 + s.duration[1] / 1e6,
          attributes: s.attributes,
        })).join("\n") + "\n";
        appendFileSync(traceLogFile, lines);
        cb({ code: ExportResultCode.SUCCESS });
      } catch {
        cb({ code: ExportResultCode.FAILED });
      }
    },
    shutdown: () => Promise.resolve(),
  };
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
}

provider.register();
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
