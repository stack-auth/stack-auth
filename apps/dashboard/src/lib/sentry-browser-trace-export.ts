import { getPublicEnvVar } from "@/lib/env";
import { getInternalProjectHeaders } from "@/lib/internal-project-headers";
import { throwErr } from "@hexclave/shared/dist/utils/errors";

type SentryAttributeValue = string | number | boolean | readonly (string | number | boolean | null | undefined)[];

type DashboardSentrySpan = {
  data: Record<string, unknown>,
  description?: string,
  op?: string,
  parent_span_id?: string,
  span_id: string,
  start_timestamp: number,
  status?: string,
  timestamp?: number,
  trace_id: string,
  origin?: string,
};

export type DashboardSentryTransaction = {
  transaction?: string,
  start_timestamp?: number,
  timestamp?: number,
  spans?: DashboardSentrySpan[],
  contexts?: {
    trace?: {
      data?: Record<string, unknown>,
      op?: string,
      parent_span_id?: string,
      span_id: string,
      status?: string,
      trace_id: string,
      origin?: string,
    },
  },
};

type OtlpAnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { arrayValue: { values: OtlpAnyValue[] } };

type OtlpAttribute = {
  key: string,
  value: OtlpAnyValue,
};

type OtlpSpan = {
  traceId: string,
  spanId: string,
  parentSpanId?: string,
  name: string,
  kind: number,
  startTimeUnixNano: string,
  endTimeUnixNano: string,
  attributes: OtlpAttribute[],
  status: { code: number },
};

export type DashboardBrowserTraceRequest = {
  resourceSpans: [{
    resource: {
      attributes: OtlpAttribute[],
    },
    scopeSpans: [{
      scope: {
        name: string,
        version?: string,
      },
      spans: OtlpSpan[],
    }],
  }],
};

function secondsToUnixNanos(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Sentry span timestamp must be a positive finite number, received ${JSON.stringify(seconds)}`);
  }
  // Sentry timestamps are floating-point epoch seconds. Millisecond precision
  // matches ClickHouse DateTime64(3) while keeping the integer conversion below
  // Number.MAX_SAFE_INTEGER before switching to BigInt.
  return String(BigInt(Math.round(seconds * 1_000)) * BigInt(1_000_000));
}

function attributeValue(value: SentryAttributeValue): OtlpAnyValue {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { stringValue: String(value) };
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  return {
    arrayValue: {
      values: value.flatMap((item) => item == null ? [] : [attributeValue(item)]),
    },
  };
}

function normalizeAttributeValue(value: unknown): SentryAttributeValue | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (!Array.isArray(value)) return null;
  const normalized: (string | number | boolean | null | undefined)[] = [];
  for (const item of value) {
    if (item == null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      normalized.push(item);
    }
  }
  return normalized;
}

function spanAttributes(span: DashboardSentrySpan, transactionName?: string): OtlpAttribute[] {
  const entries = new Map<string, SentryAttributeValue>();
  for (const [key, value] of Object.entries(span.data)) {
    const normalized = normalizeAttributeValue(value);
    if (normalized != null) entries.set(key, normalized);
  }
  if (span.description != null) entries.set("sentry.description", span.description);
  if (span.origin != null) entries.set("sentry.origin", span.origin);
  if (span.status != null) entries.set("sentry.status", span.status);
  if (transactionName != null) entries.set("sentry.transaction", transactionName);

  // The OTLP endpoint caps each entity at 256 attributes. Sentry's own span
  // contract is already scalar/array-valued, so no lossy object coercion is
  // needed here; retain its first 256 stable entries.
  return [...entries].slice(0, 256).map(([key, value]) => ({
    key,
    value: attributeValue(value),
  }));
}

function otlpStatusCode(status: string | undefined): number {
  if (status == null) return 0;
  return status === "ok" ? 1 : 2;
}

function toOtlpSpan(span: DashboardSentrySpan, transactionName?: string): OtlpSpan | null {
  if (span.timestamp == null) return null;
  return {
    traceId: span.trace_id,
    spanId: span.span_id,
    ...(span.parent_span_id == null ? {} : { parentSpanId: span.parent_span_id }),
    name: span.op ?? span.description ?? "browser.span",
    kind: span.op === "http.client" || span.op === "browser.request" ? 3 : 1,
    startTimeUnixNano: secondsToUnixNanos(span.start_timestamp),
    endTimeUnixNano: secondsToUnixNanos(span.timestamp),
    attributes: spanAttributes(span, transactionName),
    status: { code: otlpStatusCode(span.status) },
  };
}

function transactionRootSpan(event: DashboardSentryTransaction): DashboardSentrySpan | null {
  const trace = event.contexts?.trace;
  if (
    trace == null
    || event.start_timestamp == null
    || event.timestamp == null
  ) {
    return null;
  }
  return {
    data: trace.data ?? {},
    description: event.transaction,
    op: trace.op,
    parent_span_id: trace.parent_span_id,
    span_id: trace.span_id,
    start_timestamp: event.start_timestamp,
    status: trace.status,
    timestamp: event.timestamp,
    trace_id: trace.trace_id,
    origin: trace.origin,
  };
}

/**
 * Converts the completed Sentry transaction envelope into OTLP without changing
 * its trace/span IDs. Backend spans that continued the browser traceparent can
 * therefore join this exact page-load tree in Analytics.
 */
export function dashboardSentryTransactionToOtlp(event: DashboardSentryTransaction): DashboardBrowserTraceRequest | null {
  const root = transactionRootSpan(event);
  if (root == null) return null;
  const spans = [root, ...event.spans ?? []]
    .map((span) => toOtlpSpan(span, event.transaction))
    .filter((span): span is OtlpSpan => span != null);
  if (spans.length === 0) return null;

  return {
    resourceSpans: [{
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "stack-dashboard-browser" } },
          { key: "deployment.environment.name", value: { stringValue: process.env.NODE_ENV } },
        ],
      },
      scopeSpans: [{
        scope: {
          name: "@sentry/nextjs-browser",
        },
        spans,
      }],
    }],
  };
}

export async function exportDashboardSentryTransaction(event: DashboardSentryTransaction): Promise<void> {
  const payload = dashboardSentryTransactionToOtlp(event);
  if (payload == null) return;
  // Keep the pure converter importable in tests and tooling without eagerly
  // constructing the browser-only internal StackClientApp.
  const { hexclaveClientApp } = await import("@/hexclave/client");
  const accessToken = await hexclaveClientApp.getAccessToken();
  const apiUrl = getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_API_URL")
    ?? getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL")
    ?? throwErr("Dashboard browser trace export requires NEXT_PUBLIC_BROWSER_STACK_API_URL or NEXT_PUBLIC_STACK_API_URL");
  const response = await fetch(new URL("/api/v1/analytics/otlp/v1/traces", apiUrl), {
    method: "POST",
    headers: getInternalProjectHeaders({
      accessToken,
      contentType: "application/json",
    }),
    body: JSON.stringify(payload),
    credentials: "omit",
  });
  if (!response.ok) {
    throw new Error(`Dashboard browser trace export failed with HTTP ${response.status}: ${await response.text()}`);
  }
}
