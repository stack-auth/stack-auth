import type { AttributeValue, Attributes, HrTime } from "@opentelemetry/api";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { insertAnalyticsSpans } from "./analytics-spans";
import { DEFAULT_BRANCH_ID } from "./branch-constants";
import { normalizeOtlpJsonTraceRequest, type NormalizedOtlpSpan } from "./otlp";

export type AnalyticsSpanWriter = (spans: NormalizedOtlpSpan[]) => Promise<void>;

function hrTimeToUnixNano(time: HrTime): string {
  return String(BigInt(time[0]) * 1_000_000_000n + BigInt(time[1]));
}

function toOtlpAnyValue(value: AttributeValue): object {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  return {
    arrayValue: {
      values: value
        .filter((item) => item !== null && item !== undefined)
        .map((item) => toOtlpAnyValue(item)),
    },
  };
}

function toOtlpAttributes(attributes: Attributes): { key: string, value: object }[] {
  return Object.entries(attributes).flatMap(([key, value]) => (
    value === undefined ? [] : [{ key, value: toOtlpAnyValue(value) }]
  ));
}

export function normalizeReadableSpans(spans: ReadableSpan[]): NormalizedOtlpSpan[] {
  return normalizeOtlpJsonTraceRequest({
    resourceSpans: spans.map((span) => {
      const spanContext = span.spanContext();
      return {
        resource: { attributes: toOtlpAttributes(span.resource.attributes) },
        scopeSpans: [{
          scope: {
            name: span.instrumentationLibrary.name,
            version: span.instrumentationLibrary.version,
          },
          spans: [{
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
            parentSpanId: span.parentSpanId,
            traceState: spanContext.traceState?.serialize(),
            flags: spanContext.traceFlags,
            name: span.name,
            // The API SpanKind enum is INTERNAL=0..CONSUMER=4, while OTLP's
            // wire enum reserves 0 for UNSPECIFIED and shifts those values by 1.
            kind: span.kind + 1,
            startTimeUnixNano: hrTimeToUnixNano(span.startTime),
            endTimeUnixNano: hrTimeToUnixNano(span.endTime),
            attributes: toOtlpAttributes(span.attributes),
            status: span.status,
            events: span.events.map((event) => ({
              timeUnixNano: hrTimeToUnixNano(event.time),
              name: event.name,
              attributes: toOtlpAttributes(event.attributes ?? {}),
              droppedAttributesCount: event.droppedAttributesCount,
            })),
            links: span.links.map((link) => ({
              traceId: link.context.traceId,
              spanId: link.context.spanId,
              traceState: link.context.traceState?.serialize(),
              flags: link.context.traceFlags,
              attributes: toOtlpAttributes(link.attributes ?? {}),
              droppedAttributesCount: link.droppedAttributesCount,
            })),
            droppedAttributesCount: span.droppedAttributesCount,
            droppedEventsCount: span.droppedEventsCount,
            droppedLinksCount: span.droppedLinksCount,
          }],
        }],
      };
    }),
  });
}

async function writeInternalAnalyticsSpans(spans: NormalizedOtlpSpan[]): Promise<void> {
  await insertAnalyticsSpans({ spans, projectId: "internal", branchId: DEFAULT_BRANCH_ID });
}

function errorFromUnknown(error: unknown): Error {
  return error instanceof Error ? error : new Error("Failed to export OpenTelemetry spans to Analytics", { cause: error });
}

/** Writes completed backend OTel spans into Hexclave's native Analytics span model. */
export class AnalyticsSpanExporter implements SpanExporter {
  constructor(private readonly writeSpans: AnalyticsSpanWriter = writeInternalAnalyticsSpans) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.writeSpans(normalizeReadableSpans(spans)).then(
      () => resultCallback({ code: ExportResultCode.SUCCESS }),
      (error: unknown) => resultCallback({ code: ExportResultCode.FAILED, error: errorFromUnknown(error) }),
    );
  }

  async shutdown(): Promise<void> {}
}
