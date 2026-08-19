import type { BatchEventWireItem } from "@/lib/analytics-telemetry-writers";
import type { LogLevel } from "@hexclave/shared/dist/utils/analytics-wire";
import type { ErrorIngestEnvelopeHeader, ErrorIngestEnvelopeItem } from "./error-ingest-envelope";
import type { ErrorIngestScrubbedValue } from "./error-ingest-scrubber";

type ErrorRecord = { [key: string]: ErrorIngestScrubbedValue };

function isRecord(value: ErrorIngestScrubbedValue | undefined): value is ErrorRecord {
  return value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value);
}

function field(value: ErrorRecord | undefined, key: string): ErrorIngestScrubbedValue | undefined {
  return value?.[key];
}

function stringField(value: ErrorRecord | undefined, key: string): string | undefined {
  const result = field(value, key);
  return typeof result === "string" ? result : undefined;
}

function booleanField(value: ErrorRecord | undefined, key: string): boolean | undefined {
  const result = field(value, key);
  return typeof result === "boolean" ? result : undefined;
}

function sentryLevel(value: string | undefined): LogLevel | undefined {
  switch (value) {
    case "fatal":
    case "error": { return "error"; }
    case "warning":
    case "warn": { return "warn"; }
    case "info": { return "info"; }
    case "debug": { return "debug"; }
    default: { return undefined; }
  }
}

function recordField(value: ErrorRecord | undefined, key: string): ErrorRecord | undefined {
  const result = field(value, key);
  return isRecord(result) ? result : undefined;
}

function lastExceptionValue(event: ErrorRecord): ErrorRecord | undefined {
  const exception = recordField(event, "exception");
  const values = field(exception, "values");
  if (!Array.isArray(values)) return undefined;
  let last: ErrorRecord | undefined;
  for (const value of values) {
    if (isRecord(value)) last = value;
  }
  return last;
}

function stackFromFrames(stacktrace: ErrorRecord | undefined): string | undefined {
  const frames = field(stacktrace, "frames");
  if (!Array.isArray(frames) || frames.length === 0) return undefined;
  const lines: string[] = [];
  for (const frame of frames) {
    if (!isRecord(frame)) continue;
    const filename = stringField(frame, "filename") ?? stringField(frame, "abs_path") ?? "<anonymous>";
    const functionName = stringField(frame, "function") ?? "<anonymous>";
    const line = typeof field(frame, "lineno") === "number" ? String(field(frame, "lineno")) : "?";
    const column = typeof field(frame, "colno") === "number" ? String(field(frame, "colno")) : "?";
    lines.push(`    at ${functionName} (${filename}:${line}:${column})`);
  }
  return lines.length === 0 ? undefined : lines.join("\n");
}

function traceIdFromEvent(event: ErrorRecord, header: ErrorIngestEnvelopeHeader): string | undefined {
  const traceContext = recordField(recordField(event, "contexts"), "trace");
  const traceId = stringField(traceContext, "trace_id") ?? header.trace?.trace_id;
  return traceId !== undefined && /^[0-9a-f]{32}$/u.test(traceId) ? traceId : undefined;
}

function spanIdFromEvent(event: ErrorRecord): string | undefined {
  const traceContext = recordField(recordField(event, "contexts"), "trace");
  const spanId = stringField(traceContext, "span_id");
  return spanId !== undefined && /^[0-9a-f]{16}$/u.test(spanId) ? spanId : undefined;
}

function eventTimeMs(event: ErrorRecord, receivedAtMs: number): number {
  const timestamp = field(event, "timestamp");
  if (typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp >= 0) {
    const milliseconds = Math.round(timestamp * 1_000);
    // Safe integers reach ~9.0e15 but Date only supports ±8.64e15, so a
    // safe-integer ms value can still be an Invalid Date that ClickHouse would
    // reject; treat that range as unusable and fall back to receipt time.
    if (Number.isSafeInteger(milliseconds) && milliseconds >= 0 && Number.isFinite(new Date(milliseconds).getTime())) return milliseconds;
  }
  if (typeof timestamp === "string") {
    const milliseconds = Date.parse(timestamp);
    if (Number.isSafeInteger(milliseconds) && milliseconds >= 0) return milliseconds;
  }
  return receivedAtMs;
}

/**
 * Projects one accepted Sentry event item onto the existing canonical error
 * writer. The original scrubbed event remains nested in the row, while the
 * flat name/message/stack fields give the existing grouping and issue read
 * models the identity they already understand.
 */
export function projectSentryEnvelopeEvent(options: {
  event: ErrorIngestScrubbedValue,
  header: ErrorIngestEnvelopeHeader,
  item: ErrorIngestEnvelopeItem,
  receivedAtMs: number,
}): BatchEventWireItem {
  if (!isRecord(options.event)) throw new Error("Sentry envelope event must be an object");
  if (options.item.outcome.eventId === undefined) throw new Error("Sentry envelope event is missing its validated event id");

  const root = lastExceptionValue(options.event);
  const rootStacktrace = recordField(root, "stacktrace") ?? recordField(options.event, "stacktrace");
  const name = stringField(root, "type") ?? stringField(options.event, "name") ?? "Error";
  const message = stringField(root, "value") ?? stringField(options.event, "message") ?? "";
  const rawStack = stringField(rootStacktrace, "raw") ?? stringField(options.event, "stack") ?? stackFromFrames(rootStacktrace);
  const mechanism = recordField(root, "mechanism") ?? recordField(options.event, "mechanism");
  // Sentry's event protocol makes mechanism.handled optional, including for
  // captureMessage and generic exception payloads. An absent flag represents
  // an explicitly captured (handled) event; SDKs mark unhandled crashes false.
  const handled = booleanField(mechanism, "handled") ?? booleanField(options.event, "handled") ?? true;
  const synthetic = booleanField(mechanism, "synthetic") ?? booleanField(options.event, "synthetic");
  const level = sentryLevel(stringField(options.event, "level"));

  const data: ErrorRecord = {
    ...options.event,
    event_id: options.item.outcome.eventId,
    event_type: "$error",
    kind: root === undefined ? "message" : "exception",
    name,
    message,
    handled,
    ...(rawStack === undefined ? {} : { stack: rawStack }),
    ...(synthetic === undefined ? {} : { synthetic }),
    ...(level === undefined ? {} : { level }),
  };

  // The wire contract requires trace_id and span_id together or not at all: an
  // event has no span identity of its own, so a lone half would persist an
  // unjoinable partial identity (see BatchEventWireItem). Sentry events can
  // legitimately carry only a trace_id (e.g. from the envelope DSC), so drop
  // the partial pair rather than reject the event.
  const traceId = traceIdFromEvent(options.event, options.header);
  const spanId = spanIdFromEvent(options.event);
  const spanIdentity = traceId !== undefined && spanId !== undefined ? { trace_id: traceId, span_id: spanId } : {};

  return {
    event_type: "$error",
    event_at_ms: eventTimeMs(options.event, options.receivedAtMs),
    data,
    ...spanIdentity,
    ...(level === undefined ? {} : { level }),
  };
}
