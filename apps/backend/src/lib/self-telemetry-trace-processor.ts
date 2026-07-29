import { SpanStatusCode, TraceFlags, type Context } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import {
  type ReadableSpan,
  type Span,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";

type TraceBuffer = {
  openSpanCount: number,
  endedSpans: ReadableSpan[],
  keep: boolean,
  completionTimer: ReturnType<typeof setTimeout> | null,
};

export type ErrorPromotingBatchSpanProcessorOptions = {
  completionDelayMillis?: number,
  maxExportBatchSize?: number,
  scheduledDelayMillis?: number,
};

const DEFAULT_COMPLETION_DELAY_MILLIS = 100;
const DEFAULT_MAX_EXPORT_BATCH_SIZE = 500;
const DEFAULT_SCHEDULED_DELAY_MILLIS = 1_000;

function isServerErrorStatus(value: unknown): boolean {
  return typeof value === "number" && value >= 500;
}

export function isErrorRelatedSpan(span: ReadableSpan): boolean {
  return span.status.code === SpanStatusCode.ERROR
    || span.events.some((event) => event.name === "exception")
    || span.attributes["error.type"] != null
    || isServerErrorStatus(span.attributes["http.response.status_code"])
    || isServerErrorStatus(span.attributes["http.status_code"]);
}

function exportError(resultError: Error | undefined): Error {
  return resultError ?? new Error("The backend self-telemetry span exporter failed without an error");
}

/**
 * Tail-promotes complete error traces while retaining the normal sampled-only
 * behavior for healthy traces.
 *
 * The sampler records all spans but marks only 10% sampled. This processor
 * buffers each local trace until its last span ends, then exports the sampled
 * traces plus every trace containing an error span or correlated error log.
 * A short completion grace period lets an error log emitted immediately after
 * the root span ends still promote the buffered trace.
 */
export class ErrorPromotingBatchSpanProcessor implements SpanProcessor {
  private readonly traceBuffers = new Map<string, TraceBuffer>();
  private readonly pendingExports: ReadableSpan[] = [];
  private readonly inFlightExports = new Set<Promise<void>>();
  private readonly completionDelayMillis: number;
  private readonly maxExportBatchSize: number;
  private readonly scheduledDelayMillis: number;
  private scheduledExportTimer: ReturnType<typeof setTimeout> | null = null;
  private shutdownStarted = false;

  constructor(
    private readonly exporter: SpanExporter,
    options: ErrorPromotingBatchSpanProcessorOptions = {},
  ) {
    this.completionDelayMillis = options.completionDelayMillis ?? DEFAULT_COMPLETION_DELAY_MILLIS;
    this.maxExportBatchSize = options.maxExportBatchSize ?? DEFAULT_MAX_EXPORT_BATCH_SIZE;
    this.scheduledDelayMillis = options.scheduledDelayMillis ?? DEFAULT_SCHEDULED_DELAY_MILLIS;
    if (this.completionDelayMillis < 0) throw new Error("completionDelayMillis must not be negative");
    if (this.maxExportBatchSize <= 0) throw new Error("maxExportBatchSize must be positive");
    if (this.scheduledDelayMillis < 0) throw new Error("scheduledDelayMillis must not be negative");
  }

  onStart(span: Span, _parentContext: Context): void {
    if (this.shutdownStarted) return;
    const spanContext = span.spanContext();
    const existing = this.traceBuffers.get(spanContext.traceId);
    if (existing !== undefined) {
      if (existing.completionTimer !== null) {
        clearTimeout(existing.completionTimer);
        existing.completionTimer = null;
      }
      existing.openSpanCount += 1;
      existing.keep ||= (spanContext.traceFlags & TraceFlags.SAMPLED) !== 0;
      return;
    }
    this.traceBuffers.set(spanContext.traceId, {
      openSpanCount: 1,
      endedSpans: [],
      keep: (spanContext.traceFlags & TraceFlags.SAMPLED) !== 0,
      completionTimer: null,
    });
  }

  onEnd(span: ReadableSpan): void {
    if (this.shutdownStarted) return;
    const spanContext = span.spanContext();
    const buffer = this.traceBuffers.get(spanContext.traceId);
    if (buffer === undefined) {
      throw new Error(`Span ${spanContext.spanId} ended without a matching onStart call`);
    }
    if (buffer.keep) {
      this.enqueueForExport([span]);
    } else if (isErrorRelatedSpan(span)) {
      buffer.keep = true;
      this.enqueueForExport([...buffer.endedSpans, span]);
      buffer.endedSpans.length = 0;
    } else {
      buffer.endedSpans.push(span);
    }
    buffer.openSpanCount -= 1;
    if (buffer.openSpanCount < 0) {
      throw new Error(`Trace ${spanContext.traceId} ended more spans than it started`);
    }
    if (buffer.openSpanCount === 0) {
      buffer.completionTimer = setTimeout(() => {
        this.completeTrace(spanContext.traceId);
      }, this.completionDelayMillis);
    }
  }

  /** Called synchronously by the console bridge for an error log in an active span. */
  markTraceAsErrored(traceId: string): void {
    const buffer = this.traceBuffers.get(traceId);
    if (buffer === undefined || buffer.keep) return;
    buffer.keep = true;
    this.enqueueForExport(buffer.endedSpans);
    buffer.endedSpans.length = 0;
  }

  private completeTrace(traceId: string): void {
    const buffer = this.traceBuffers.get(traceId);
    if (buffer === undefined || buffer.openSpanCount !== 0) return;
    if (buffer.completionTimer !== null) clearTimeout(buffer.completionTimer);
    this.traceBuffers.delete(traceId);
    if (!buffer.keep) return;
    this.enqueueForExport(buffer.endedSpans);
  }

  private enqueueForExport(spans: ReadableSpan[]): void {
    if (spans.length === 0) return;
    this.pendingExports.push(...spans);
    if (this.pendingExports.length >= this.maxExportBatchSize) {
      this.startPendingExports();
    } else {
      this.scheduleExport();
    }
  }

  private completeReadyTraces(): void {
    for (const [traceId, buffer] of this.traceBuffers) {
      if (buffer.openSpanCount === 0) this.completeTrace(traceId);
    }
  }

  private scheduleExport(): void {
    if (this.pendingExports.length === 0 || this.scheduledExportTimer !== null) return;
    this.scheduledExportTimer = setTimeout(() => {
      this.scheduledExportTimer = null;
      this.startPendingExports();
    }, this.scheduledDelayMillis);
  }

  private startPendingExports(): void {
    if (this.scheduledExportTimer !== null) {
      clearTimeout(this.scheduledExportTimer);
      this.scheduledExportTimer = null;
    }
    while (this.pendingExports.length > 0) {
      const batch = this.pendingExports.splice(0, this.maxExportBatchSize);
      const exportPromise = new Promise<void>((resolve, reject) => {
        this.exporter.export(batch, (result) => {
          if (result.code === ExportResultCode.SUCCESS) {
            resolve();
          } else {
            reject(exportError(result.error));
          }
        });
      });
      const observedExport = exportPromise.finally(() => {
        this.inFlightExports.delete(observedExport);
      });
      this.inFlightExports.add(observedExport);
      runAsynchronously(observedExport);
    }
  }

  async forceFlush(): Promise<void> {
    this.completeReadyTraces();
    this.startPendingExports();
    await Promise.all(this.inFlightExports);
    await this.exporter.forceFlush?.();
  }

  async shutdown(): Promise<void> {
    if (this.shutdownStarted) return;
    this.shutdownStarted = true;
    for (const buffer of this.traceBuffers.values()) {
      if (buffer.completionTimer !== null) clearTimeout(buffer.completionTimer);
      // OTel shutdown promises to flush finished spans. Active spans are not
      // fabricated as complete, but their already-ended sampled/error siblings
      // still must not be lost.
      if (buffer.keep) this.enqueueForExport(buffer.endedSpans);
    }
    this.traceBuffers.clear();
    if (this.scheduledExportTimer !== null) {
      clearTimeout(this.scheduledExportTimer);
      this.scheduledExportTimer = null;
    }
    this.startPendingExports();
    await Promise.all(this.inFlightExports);
    await this.exporter.shutdown();
  }
}
