import type { AnalyticsBatchSpan } from "@stackframe/stack-shared/dist/interface/crud/analytics";
import { generateUuid } from "./session-replay";

// Structural types matching the OpenTelemetry API — no @opentelemetry/api dependency required.
// Users bring their own OTel SDK; these types are satisfied by duck-typing.

type OTelHrTime = [number, number];

type OTelSpanContext = {
  traceId: string,
  spanId: string,
};

type OTelReadableSpan = {
  name: string,
  spanContext(): OTelSpanContext,
  parentSpanId?: string,
  startTime: OTelHrTime,
  endTime: OTelHrTime,
  status: { code: number, message?: string },
  kind: number,
  attributes: Record<string, unknown>,
  events?: Array<{ name: string, time: OTelHrTime, attributes?: Record<string, unknown> }>,
  resource?: { attributes: Record<string, unknown> },
};

type OTelExportResultCallback = (result: { code: number }) => void;

const OTEL_STATUS_UNSET = 0;
const OTEL_STATUS_OK = 1;
const OTEL_STATUS_ERROR = 2;

const OTEL_KIND_NAMES = ["unspecified", "internal", "server", "client", "producer", "consumer"] as const;

const SPAN_TYPE_RE = /[^A-Za-z0-9._:-]/g;

function hrTimeToMs(hrTime: OTelHrTime): number {
  return hrTime[0] * 1000 + Math.round(hrTime[1] / 1_000_000);
}

/**
 * Deterministic mapping from OTel hex ID to a UUID-like string.
 * Uses a namespace-based approach: pads to 32 hex chars, inserts hyphens,
 * and forces version nibble to `4` and variant nibble to `8` so the result
 * passes standard UUID regex validation.
 */
function hexToUuid(hex: string): string {
  const padded = hex.padStart(32, "0").slice(0, 32).toLowerCase();
  // Force version=4 (position 12) and variant=8 (position 16) for UUID compat
  const chars = padded.split("");
  chars[12] = "4";
  chars[16] = "8";
  return `${chars.slice(0, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12, 16).join("")}-${chars.slice(16, 20).join("")}-${chars.slice(20, 32).join("")}`;
}

function sanitizeSpanType(name: string, prefix: string): string {
  const sanitized = name
    .replace(/[\s/]/g, ".")
    .replace(SPAN_TYPE_RE, "");
  if (sanitized.length === 0) return `${prefix}unknown`;
  return `${prefix}${sanitized}`;
}

export type StackSpanExporterOptions = {
  /**
   * Optional filter — return `false` to skip a span.
   */
  filter?: (span: { name: string, attributes: Record<string, unknown> }) => boolean,
  /**
   * Prefix for span_type. Default: `"otel."`.
   */
  spanTypePrefix?: string,
};

export class StackSpanExporter {
  private readonly _pushSpan: (span: AnalyticsBatchSpan) => void;
  private readonly _filter: ((span: { name: string, attributes: Record<string, unknown> }) => boolean) | undefined;
  private readonly _prefix: string;

  constructor(
    pushSpan: (span: AnalyticsBatchSpan) => void,
    options?: StackSpanExporterOptions,
  ) {
    this._pushSpan = pushSpan;
    this._filter = options?.filter;
    this._prefix = options?.spanTypePrefix ?? "otel.";
  }

  export(spans: OTelReadableSpan[], resultCallback: OTelExportResultCallback): void {
    for (const span of spans) {
      if (this._filter && !this._filter({ name: span.name, attributes: span.attributes })) {
        continue;
      }

      const ctx = span.spanContext();
      const spanId = hexToUuid(ctx.spanId);
      const traceId = hexToUuid(ctx.traceId);
      const parentIds = span.parentSpanId ? [hexToUuid(span.parentSpanId)] : undefined;

      const status = span.status.code === OTEL_STATUS_OK
        ? "ok"
        : span.status.code === OTEL_STATUS_ERROR
          ? "error"
          : "unset";

      const data: Record<string, unknown> = {
        ...span.attributes,
        $status: status,
        "otel.trace_id": ctx.traceId,
        "otel.span_id": ctx.spanId,
        "otel.kind": OTEL_KIND_NAMES[span.kind] ?? "unspecified",
      };

      if (span.status.message) {
        data.$status_message = span.status.message;
      }

      if (span.events && span.events.length > 0) {
        data["otel.events"] = span.events.map((e) => ({
          name: e.name,
          time_ms: hrTimeToMs(e.time),
          attributes: e.attributes ?? {},
        }));
      }

      if (span.resource?.attributes) {
        for (const [key, value] of Object.entries(span.resource.attributes)) {
          data[`otel.resource.${key}`] = value;
        }
      }

      const batchSpan: AnalyticsBatchSpan = {
        span_type: sanitizeSpanType(span.name, this._prefix),
        span_id: spanId,
        trace_id: traceId,
        started_at_ms: hrTimeToMs(span.startTime),
        ended_at_ms: hrTimeToMs(span.endTime),
        parent_ids: parentIds,
        data,
      };

      this._pushSpan(batchSpan);
    }

    resultCallback({ code: 0 });
  }

  async shutdown(): Promise<void> {
    // No resources to clean up — the batcher is owned by the server app
  }

  async forceFlush(): Promise<void> {
    // Flushing is handled by the batcher
  }
}

// Re-export for convenience
export { hexToUuid, sanitizeSpanType, hrTimeToMs };
