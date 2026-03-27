import { isValidPublicAnalyticsSpanType } from "@/lib/analytics-validation";
import { insertSpans } from "@/lib/spans";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

/**
 * OTLP/HTTP trace ingest endpoint.
 *
 * Accepts the standard OTLP JSON encoding (`application/json`) as defined by
 * https://opentelemetry.io/docs/specs/otlp/#otlphttp-request
 *
 * Only server or admin auth is supported (not client auth) because OTLP traces
 * typically originate from backend services.
 */

const MAX_SPANS = 500;
const SPAN_TYPE_RE = /[^A-Za-z0-9._:-]/g;

function sanitizeSpanType(name: string): string {
  const sanitized = name.replace(/[\s/]/g, ".").replace(SPAN_TYPE_RE, "");
  return sanitized.length > 0 ? `otel.${sanitized}` : "otel.unknown";
}

function nanosToDate(nanos: string | number): Date {
  const ns = typeof nanos === "string" ? BigInt(nanos) : BigInt(nanos);
  return new Date(Number(ns / 1_000_000n));
}

type OtlpAttribute = { key: string, value: OtlpAnyValue };
type OtlpAnyValue = {
  stringValue?: string,
  intValue?: string | number,
  doubleValue?: number,
  boolValue?: boolean,
  arrayValue?: { values: OtlpAnyValue[] },
  kvlistValue?: { values: OtlpAttribute[] },
};

function extractAttributeValue(anyValue: OtlpAnyValue): unknown {
  if (anyValue.stringValue !== undefined) return anyValue.stringValue;
  if (anyValue.intValue !== undefined) return typeof anyValue.intValue === "string" ? parseInt(anyValue.intValue, 10) : anyValue.intValue;
  if (anyValue.doubleValue !== undefined) return anyValue.doubleValue;
  if (anyValue.boolValue !== undefined) return anyValue.boolValue;
  if (anyValue.arrayValue) return anyValue.arrayValue.values.map(extractAttributeValue);
  if (anyValue.kvlistValue) {
    const obj: Record<string, unknown> = {};
    for (const attr of anyValue.kvlistValue.values) {
      obj[attr.key] = extractAttributeValue(attr.value);
    }
    return obj;
  }
  return null;
}

function attributesToMap(attributes?: OtlpAttribute[]): Record<string, unknown> {
  if (!attributes) return {};
  const result: Record<string, unknown> = {};
  for (const attr of attributes) {
    result[attr.key] = extractAttributeValue(attr.value);
  }
  return result;
}

const STATUS_NAMES = ["unset", "ok", "error"] as const;
const KIND_NAMES = ["unspecified", "internal", "server", "client", "producer", "consumer"] as const;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "OTLP trace ingest",
    description: "Accepts OpenTelemetry traces in OTLP/HTTP JSON encoding and inserts them as analytics spans.",
    tags: ["Analytics Spans"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: adaptSchema,
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      inserted: yupNumber().defined(),
    }).defined(),
  }),
  async handler({ auth, body }) {
    if (!auth.tenancy.config.apps.installed["analytics"]?.enabled) {
      throw new KnownErrors.AnalyticsNotEnabled();
    }

    const projectId = auth.tenancy.project.id;
    const branchId = auth.tenancy.branchId;

    const resourceSpans = (body as any)?.resourceSpans;
    if (!Array.isArray(resourceSpans)) {
      throw new StatusError(StatusError.BadRequest, "Invalid OTLP payload: missing resourceSpans array");
    }

    const rows: Parameters<typeof insertSpans>[0] = [];

    for (const rs of resourceSpans) {
      const resourceAttrs = attributesToMap(rs.resource?.attributes);
      const scopeSpans = rs.scopeSpans ?? rs.instrumentationLibrarySpans ?? [];

      for (const ss of scopeSpans) {
        const spans = ss.spans ?? [];

        for (const span of spans) {
          if (rows.length >= MAX_SPANS) break;

          const traceId = span.traceId as string | undefined;
          const spanId = span.spanId as string | undefined;
          const parentSpanId = span.parentSpanId as string | undefined;
          const name = span.name as string | undefined;

          if (!spanId || !name) continue;

          const spanType = sanitizeSpanType(name);
          if (!isValidPublicAnalyticsSpanType(spanType)) continue;

          const statusCode = span.status?.code ?? 0;
          const attributes = attributesToMap(span.attributes);
          const data: Record<string, unknown> = {
            ...attributes,
            $status: STATUS_NAMES[statusCode] ?? "unset",
            "otel.kind": KIND_NAMES[span.kind ?? 0] ?? "unspecified",
            "otel.trace_id": traceId,
            "otel.span_id": spanId,
          };

          if (span.status?.message) {
            data.$status_message = span.status.message;
          }

          if (Array.isArray(span.events) && span.events.length > 0) {
            data["otel.events"] = span.events.map((e: any) => ({
              name: e.name,
              time_ms: e.timeUnixNano ? Number(BigInt(e.timeUnixNano) / 1_000_000n) : 0,
              attributes: attributesToMap(e.attributes),
            }));
          }

          for (const [key, value] of Object.entries(resourceAttrs)) {
            data[`otel.resource.${key}`] = value;
          }

          rows.push({
            span_type: spanType,
            span_id: spanId,
            trace_id: traceId ?? null,
            started_at: span.startTimeUnixNano ? nanosToDate(span.startTimeUnixNano) : new Date(),
            ended_at: span.endTimeUnixNano ? nanosToDate(span.endTimeUnixNano) : null,
            parent_ids: parentSpanId ? [parentSpanId] : [],
            data,
            project_id: projectId,
            branch_id: branchId,
            user_id: null,
            team_id: null,
            refresh_token_id: null,
            session_replay_id: null,
            session_replay_segment_id: null,
            from_server: true,
          });
        }
      }
    }

    if (rows.length === 0) {
      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: { inserted: 0 },
      };
    }

    await insertSpans(rows);

    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: { inserted: rows.length },
    };
  },
});
