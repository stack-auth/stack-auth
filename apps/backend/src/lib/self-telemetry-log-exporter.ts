import { TELEMETRY_MAX_LOG_MESSAGE_BYTES, truncateUtf8Bytes, type LogLevel } from "@hexclave/shared/dist/utils/analytics-wire";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { insertAnalyticsLogs, type AnalyticsLogRow } from "./self-telemetry-logs";
import { hrTimeToMilliseconds } from "./self-telemetry-span-exporter";
import { DEFAULT_BRANCH_ID } from "./branch-constants";
import { stripLoneSurrogates } from "./clickhouse";
import { splitResourceAttributes } from "./self-telemetry-span-exporter";

export type AnalyticsLogWriter = (logs: AnalyticsLogRow[]) => Promise<void>;

/**
 * Buckets the in-process logging API's 1–24 severity scale into the product's
 * five log levels. 0 (or absent) means "unspecified" and lands on `info` so a
 * level-less record still shows up in the default Logs view rather than being
 * hidden behind a trace/debug filter.
 */
export function severityNumberToLevel(severityNumber: number | undefined): LogLevel {
  if (severityNumber == null || severityNumber === 0) return "info";
  if (severityNumber <= 4) return "trace";
  if (severityNumber <= 8) return "debug";
  if (severityNumber <= 12) return "info";
  if (severityNumber <= 16) return "warn";
  return "error";
}

function logBodyToMessage(body: unknown): string {
  if (body == null) return "";
  const sanitized = stripLoneSurrogates(body);
  const text = typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized);
  // The producer-side cap (console capture truncates before emitting) is the
  // primary bound; this is the backstop for direct logs-API emitters so one
  // giant structured body cannot blow up the events row.
  return truncateUtf8Bytes(text, TELEMETRY_MAX_LOG_MESSAGE_BYTES);
}

function attributesToData(attributes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attributes).flatMap(([key, value]) => value == null ? [] : [[key, stripLoneSurrogates(value)]]),
  );
}

/**
 * Builds native `$log` event rows DIRECTLY from the in-process logs pipeline's
 * records — no wire-protocol round-trip. Input is the backend's own logging
 * bridge (otel-console-capture.ts), i.e. trusted; ids come straight from the
 * active span context.
 */
export function buildAnalyticsLogRows(logs: ReadableLogRecord[]): AnalyticsLogRow[] {
  return logs.flatMap((log): AnalyticsLogRow[] => {
    const level = severityNumberToLevel(log.severityNumber);
    // The console bridge already avoids producing lower-severity records. This
    // exporter guard also covers libraries that emit directly through OTel.
    if (level !== "warn" && level !== "error") return [];
    const spanContext = log.spanContext ?? null;
    const { promoted, remainderJson } = splitResourceAttributes(log.resource.attributes);
    return [{
      event_type: "$log",
      event_at: new Date(hrTimeToMilliseconds(log.hrTime)),
      message: logBodyToMessage(log.body),
      level,
      data: attributesToData(log.attributes),
      parent_span_ids: spanContext === null ? [] : [spanContext.spanId],
      trace_id: spanContext?.traceId ?? null,
      span_id: spanContext?.spanId ?? null,
      producer: "hexclave-backend",
      ...promoted,
      resource_attributes: remainderJson,
    }];
  });
}

async function writeInternalAnalyticsLogs(logs: AnalyticsLogRow[]): Promise<void> {
  await insertAnalyticsLogs({ logs, projectId: "internal", branchId: DEFAULT_BRANCH_ID });
}

function errorFromUnknown(error: unknown): Error {
  return error instanceof Error ? error : new Error("Failed to export backend logs to Analytics", { cause: error });
}

/** Writes the backend's own captured logs into Hexclave's native Analytics
 * event model (project "internal" only — see the no-tenancy-fan-out note in
 * self-telemetry-tenancy.ts). */
export class AnalyticsLogExporter implements LogRecordExporter {
  constructor(private readonly writeLogs: AnalyticsLogWriter = writeInternalAnalyticsLogs) {}

  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    let logRows: AnalyticsLogRow[];
    try {
      logRows = buildAnalyticsLogRows(logs);
    } catch (error) {
      resultCallback({ code: ExportResultCode.FAILED, error: errorFromUnknown(error) });
      return;
    }
    if (logRows.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }
    this.writeLogs(logRows).then(
      () => resultCallback({ code: ExportResultCode.SUCCESS }),
      (error: unknown) => resultCallback({ code: ExportResultCode.FAILED, error: errorFromUnknown(error) }),
    );
  }

  async shutdown(): Promise<void> {}
}
