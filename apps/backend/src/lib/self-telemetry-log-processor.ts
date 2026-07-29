import { trace, type Context } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type {
  LogRecord,
  LogRecordProcessor,
} from "@opentelemetry/sdk-logs";

/**
 * Applies the backend's severity policy before records enter the batch queue
 * and promotes traces for any error emitted directly through the OTel Logs API.
 */
export class WarnAndErrorLogRecordProcessor implements LogRecordProcessor {
  constructor(
    private readonly delegate: LogRecordProcessor,
    private readonly markTraceAsErrored: (traceId: string) => void,
  ) {}

  onEmit(logRecord: LogRecord, activeContext?: Context): void {
    const severityNumber = logRecord.severityNumber;
    if (severityNumber == null || severityNumber < SeverityNumber.WARN) return;
    if (severityNumber >= SeverityNumber.ERROR) {
      const spanContext = logRecord.spanContext
        ?? (activeContext === undefined ? undefined : trace.getSpanContext(activeContext));
      if (spanContext !== undefined) this.markTraceAsErrored(spanContext.traceId);
    }
    this.delegate.onEmit(logRecord, activeContext);
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
}
