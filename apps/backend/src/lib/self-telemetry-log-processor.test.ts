import { context, TraceFlags, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { Resource } from "@opentelemetry/resources";
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
  type LogRecordExporter,
  type ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { describe, expect, it } from "vitest";
import { WarnAndErrorLogRecordProcessor } from "./self-telemetry-log-processor";

class CollectingLogExporter implements LogRecordExporter {
  readonly records: ReadableLogRecord[] = [];

  export(records: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    this.records.push(...records);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  async shutdown(): Promise<void> {}
}

describe("WarnAndErrorLogRecordProcessor", () => {
  it("queues only warn/error and promotes a directly emitted error's trace", async () => {
    const exporter = new CollectingLogExporter();
    const promotedTraceIds: string[] = [];
    const provider = new LoggerProvider({ resource: new Resource({}) });
    provider.addLogRecordProcessor(new WarnAndErrorLogRecordProcessor(
      new SimpleLogRecordProcessor(exporter),
      (traceId) => promotedTraceIds.push(traceId),
    ));
    const logger = provider.getLogger("severity-policy-test");
    const spanContext = {
      traceId: "11111111111111111111111111111111",
      spanId: "2222222222222222",
      traceFlags: TraceFlags.NONE,
      isRemote: false,
    };
    const activeContext = trace.setSpanContext(context.active(), spanContext);
    logger.emit({ severityNumber: SeverityNumber.DEBUG, body: "debug", context: activeContext });
    logger.emit({ severityNumber: SeverityNumber.INFO, body: "info", context: activeContext });
    logger.emit({ severityNumber: SeverityNumber.WARN, body: "warn", context: activeContext });
    logger.emit({ severityNumber: SeverityNumber.ERROR, body: "error", context: activeContext });

    await provider.forceFlush();
    expect({
      records: exporter.records.map((record) => ({
        body: record.body,
        traceId: record.spanContext?.traceId,
        spanId: record.spanContext?.spanId,
      })),
      promotedTraceIds,
    }).toMatchInlineSnapshot(`
      {
        "promotedTraceIds": [
          "11111111111111111111111111111111",
        ],
        "records": [
          {
            "body": "warn",
            "spanId": "2222222222222222",
            "traceId": "11111111111111111111111111111111",
          },
          {
            "body": "error",
            "spanId": "2222222222222222",
            "traceId": "11111111111111111111111111111111",
          },
        ],
      }
    `);
    await provider.shutdown();
  });
});
