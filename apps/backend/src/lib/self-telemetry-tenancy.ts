import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { decodeSpanContextHeader, readSpanContextHeader } from "@hexclave/shared/dist/utils/span-context-codec";
import type { Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { AsyncLocalStorage } from "node:async_hooks";
import type { AnalyticsSpanRow } from "./self-telemetry-spans";

/**
 * Routes the backend's own OpenTelemetry self-instrumentation to the CUSTOMER
 * project that caused it, so a customer's trace view shows their browser
 * `$http-client` span connected to the backend request it triggered.
 *
 * Mechanism: `handleApiRequest` installs a mutable per-request holder into an
 * AsyncLocalStorage BEFORE the OTel root span opens; `parseAuth` fills it in
 * once tenancy is known. Span/log processors record which holder was ambient
 * when each span STARTED (a WeakMap sidecar — deliberately NOT span
 * attributes: spans that end before `parseAuth` finishes would miss
 * attribute stamping, but export happens seconds later via the batch
 * processors, by which point the shared holder cell is filled; and tenant
 * routing must never leak into customer-visible attribute JSON). The
 * exporters then group by resolved tenancy and fan out inserts per project.
 */

export type ResolvedTelemetryTenancy = {
  projectId: string,
  branchId: string,
  /** Server-derived from the access token — trusted. */
  userId: string | null,
  /** Server-derived from the access token — trusted. */
  refreshTokenId: string | null,
  /** From the x-hexclave-span-context header — untrusted telemetry label. */
  sessionReplayId: string | null,
  /** From the x-hexclave-span-context header — untrusted telemetry label. */
  sessionReplaySegmentId: string | null,
  /** From the x-hexclave-span-context header — untrusted telemetry label. */
  pageViewSpanId: string | null,
  /** From the x-hexclave-span-context header — untrusted telemetry label. */
  httpClientSpanId: string | null,
};

export class TelemetryTenancyHolder {
  resolved: ResolvedTelemetryTenancy | null = null;
}

const holderStorage = new AsyncLocalStorage<TelemetryTenancyHolder>();

/**
 * Sidecar mapping OTel spans/log records to the request holder that was ambient
 * when they were created. Module-level (not processor state) so the exporters
 * can read it without holding a processor reference; WeakMap keys make it
 * leak-free once the batch processor drops the spans.
 */
const recordedHolders = new WeakMap<object, TelemetryTenancyHolder>();

export function runWithTelemetryTenancyHolder<T>(fn: () => Promise<T>): Promise<T> {
  return holderStorage.run(new TelemetryTenancyHolder(), fn);
}

/**
 * Fills the ambient request holder once auth has resolved. Call ONLY on auth
 * success — failed/unauthenticated requests stay attributed to "internal".
 * No-op outside a request holder (background loops, tests) — those spans keep
 * their "internal" attribution.
 */
export function resolveTelemetryTenancy(options: {
  projectId: string,
  branchId: string,
  userId: string | null,
  refreshTokenId: string | null,
  headers: { get: (name: string) => string | null },
}): void {
  const holder = holderStorage.getStore();
  if (holder === undefined) return;
  if (holder.resolved !== null && holder.resolved.projectId !== options.projectId) {
    throw new HexclaveAssertionError("Telemetry tenancy was already resolved to a different project within one request. parseAuth must resolve at most one project per request.", {
      previousProjectId: holder.resolved.projectId,
      newProjectId: options.projectId,
    });
  }

  // The header ids are client-controlled labels: only accepted when the header
  // claims the SAME project the request authenticated against, and never used
  // for anything but telemetry attribution (same trust rules as the SDK's
  // _resolveServerRequestContext and the analytics batch route).
  const spanContext = decodeSpanContextHeader(readSpanContextHeader(options.headers));
  const labels = spanContext !== null && spanContext.projectId === options.projectId ? spanContext : null;

  holder.resolved = {
    projectId: options.projectId,
    branchId: options.branchId,
    userId: options.userId,
    refreshTokenId: options.refreshTokenId,
    sessionReplayId: labels?.sessionReplayId ?? null,
    sessionReplaySegmentId: labels?.sessionReplaySegmentId ?? null,
    pageViewSpanId: labels?.pageViewSpanId ?? null,
    httpClientSpanId: labels?.httpClientSpanId ?? null,
  };
}

/** Reads the tenancy recorded for a span/log record at creation time. */
export function getRecordedTenancy(record: object): ResolvedTelemetryTenancy | null {
  return recordedHolders.get(record)?.resolved ?? null;
}

/** Test-only escape hatch: associates a record with an already-resolved holder. */
export function recordTenancyForTest(record: object, resolved: ResolvedTelemetryTenancy): void {
  const holder = new TelemetryTenancyHolder();
  holder.resolved = resolved;
  recordedHolders.set(record, holder);
}

export class TenancyRecordingSpanProcessor implements SpanProcessor {
  onStart(span: Span, _parentContext: Context): void {
    const holder = holderStorage.getStore();
    if (holder !== undefined) recordedHolders.set(span, holder);
  }
  onEnd(_span: ReadableSpan): void {}
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

// Backend self-LOGS deliberately have no tenancy fan-out: a log's value is its
// freeform message, and unlike span data there is no meaningful allowlist
// for internal log text — scrubbed-empty logs would be noise, unscrubbed ones
// would leak Hexclave internals. Customers get logs from their own SDK logger
// (explicit calls plus automatic console capture); backend self-logs stay
// under "internal".

// ---------------------------------------------------------------------------
// Attribute scrubbing for customer-visible spans
// ---------------------------------------------------------------------------

/**
 * Span data keys allowed through to CUSTOMER projects. Everything else —
 * notably `db.statement` SQL text, Prisma internals, and `stack.*` request
 * metadata — stays visible only under project "internal". Exact-key allowlist
 * (no prefix rules) so a newly-added sensitive attribute is private by
 * default; extend deliberately.
 */
const CUSTOMER_VISIBLE_SPAN_ATTRIBUTES = new Set([
  // HTTP (current + pre-1.23 semconv names)
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "http.method",
  "http.status_code",
  "url.path",
  "url.scheme",
  "server.address",
  "server.port",
  // Coarse DB info — the operation kind, never the statement
  "db.system",
  "db.operation",
  // Errors
  "error.type",
  "otel.status_code",
]);

function scrubAttributesJson(attributesJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(attributesJson);
  } catch {
    // Exporter-built rows always carry valid JSON; if not, drop everything
    // rather than leak an unparseable blob.
    return "{}";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "{}";
  const scrubbed = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => CUSTOMER_VISIBLE_SPAN_ATTRIBUTES.has(key)),
  );
  return JSON.stringify(scrubbed);
}

/**
 * Returns a copy of the span safe to store under a CUSTOMER project: span
 * data reduced to the allowlist, the resource-metadata blob emptied (service
 * identity has dedicated columns and survives), and span events' data emptied
 * (an `exception` event's presence/name/timing is useful signal; its stack
 * trace of Hexclave internals is not — selectively exposing exception details
 * is a follow-up).
 */
export function scrubSpanForCustomer(span: AnalyticsSpanRow): AnalyticsSpanRow {
  return {
    ...span,
    data: scrubAttributesJson(span.data),
    resource_attributes: "{}",
    events: span.events.map((event) => ({ ...event, data: {} })),
  };
}
