import { context, metrics, propagation, trace, TraceFlags, type Attributes, type Context, type Span } from "@opentelemetry/api";
import { logs, type LoggerProvider as ApiLoggerProvider } from "@opentelemetry/api-logs";
import { CompositePropagator, ExportResultCode, W3CBaggagePropagator, W3CTraceContextPropagator, type ExportResult } from "@opentelemetry/core";
import { JsonLogsSerializer, JsonMetricsSerializer, JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { registerInstrumentations, type Instrumentation } from "@opentelemetry/instrumentation";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider, type LogRecordExporter, type ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { MeterProvider, PeriodicExportingMetricReader, type ResourceMetrics } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler, type ReadableSpan, type SpanExporter, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { StackContextManager, WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_NAMESPACE, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { HEXCLAVE_PAGE_VIEW_SPAN_ID_BAGGAGE_KEY, HEXCLAVE_SESSION_REPLAY_ID_BAGGAGE_KEY, HEXCLAVE_SESSION_REPLAY_SEGMENT_ID_BAGGAGE_KEY } from "@hexclave/shared/dist/utils/span-context-codec";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { ignoreUnhandledRejection } from "@hexclave/shared/dist/utils/promises";
import { Result } from "@hexclave/shared/dist/utils/results";
import { BrowserOtlpQueuePersistenceError, createBrowserOtlpOfflineQueue, type BrowserOtlpOfflineQueue, type BrowserOtlpQueueDropSummary, type BrowserOtlpQueueEntry } from "./browser-otel-queue";
import { OtlpHttpMetricRecorder } from "./otel-http-metrics";
import type { TelemetryResource } from "./telemetry-config";
import type { NetworkCaptureConfig } from "./network-capture";

const OTLP_TRACES_PATH = "/api/v1/analytics/otlp/v1/traces";
const OTLP_LOGS_PATH = "/api/v1/analytics/otlp/v1/logs";
const OTLP_METRICS_PATH = "/api/v1/analytics/otlp/v1/metrics";
const CLIENT_REPORTS_PATH = "/api/v1/analytics/client-reports";
type BrowserOtlpSignal = "traces" | "logs" | "metrics";
const CORRELATION_BAGGAGE_KEYS = [
  HEXCLAVE_SESSION_REPLAY_ID_BAGGAGE_KEY,
  HEXCLAVE_SESSION_REPLAY_SEGMENT_ID_BAGGAGE_KEY,
  HEXCLAVE_PAGE_VIEW_SPAN_ID_BAGGAGE_KEY,
] as const;

class BrowserCorrelationSpanProcessor implements SpanProcessor {
  onStart(span: Span, parentContext: Context): void {
    const baggage = propagation.getBaggage(parentContext);
    for (const key of CORRELATION_BAGGAGE_KEYS) {
      const value = baggage?.getEntry(key)?.value;
      if (value !== undefined) span.setAttribute(key, value);
    }
  }

  onEnd(_span: ReadableSpan): void {}
  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}

/**
 * The context manager's base context is the session ambient context, not the
 * empty OTel root. The official fetch/XHR instrumentations parent their spans
 * from `context.active()`, and application-initiated requests run outside any
 * `context.with(...)` frame — with a plain StackContextManager they would see
 * ROOT_CONTEXT and every fetch would mint a fresh parentless single-span trace,
 * detaching the entire request + backend subtree from the refresh-token session
 * trace. Falling back to the current `$page-view` execution context (span +
 * correlation baggage) at the base of the stack is what makes those spans nest
 * under the page view, per the session-hierarchy trace model. An explicit
 * frame always wins, even a span-less one (e.g. suppressTracing), so the
 * fallback applies ONLY when the stack is at its untouched base.
 */
class AmbientBaseStackContextManager extends StackContextManager {
  // The manager's own untouched base context, captured at enable() time. This
  // is deliberately NOT compared against our imported ROOT_CONTEXT: bundlers
  // can load two copies of @opentelemetry/api, and StackContextManager resets
  // to ITS copy's root instance (enable(), disable(), and with(null) all
  // restore the same object), so reference identity only holds against the
  // instance the manager itself hands out.
  private _baseContext: Context | null = null;

  constructor(private readonly _getAmbientContext: () => Context | null) {
    super();
  }

  override enable(): this {
    super.enable();
    this._baseContext = super.active();
    return this;
  }

  override active(): Context {
    const current = super.active();
    if (this._baseContext === null || current !== this._baseContext) return current;
    return this._getAmbientContext() ?? current;
  }
}

/**
 * Exports an OPEN snapshot (endTimeUnixNano 0) of client system spans the
 * moment they start. `$page-view` lives for the whole page; a standard OTel
 * pipeline only exports spans when they END, so until navigation every fetch,
 * backend subtree, and presence span parented under the current page view is
 * a parentless fragment in ClickHouse — the trace UI cannot attach them. The
 * backend treats endTimeUnixNano 0 as "still open" (ended_at NULL) and the
 * spans table versions rows by end time, so the eventual end-write replaces
 * the snapshot. Restores the pre-OTel SDK's open-row write behavior.
 *
 * System spans only: they are the hierarchy layer (and are never billable), so
 * this cannot double-meter and does not double every span export.
 */
class OpenSystemSpanSnapshotProcessor implements SpanProcessor {
  constructor(private readonly _exporter: SpanExporter) {}

  onStart(span: Span & ReadableSpan): void {
    if (span.attributes["hexclave.signal.type"] !== "system_span") return;
    if ((span.spanContext().traceFlags & TraceFlags.SAMPLED) === 0) return;
    const snapshot: ReadableSpan = {
      name: span.name,
      kind: span.kind,
      spanContext: () => span.spanContext(),
      ...span.parentSpanContext === undefined ? {} : { parentSpanContext: span.parentSpanContext },
      startTime: span.startTime,
      endTime: [0, 0],
      status: span.status,
      attributes: { ...span.attributes },
      // Events and links are deliberately snapshot as empty even if present at
      // start: their table rows are not versioned by span end time, so writing
      // them twice (snapshot + end) would duplicate rows.
      links: [],
      events: [],
      duration: [0, 0],
      ended: false,
      resource: span.resource,
      instrumentationScope: span.instrumentationScope,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    };
    this._exporter.export([snapshot], () => {
      // Best-effort: a failed snapshot only means the tree stays fragmented
      // until the span's authoritative end-write; the batch pipeline already
      // handles delivery failures of that one.
    });
  }

  onEnd(_span: ReadableSpan): void {}
  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}

export type BrowserManagedOtelOptions = {
  analyticsBaseUrl: string,
  projectId: string,
  clientVersion: string,
  traceSampleRate: number,
  resource: TelemetryResource,
  getRequestHeaders: () => Promise<Record<string, string>>,
  onOutcome?: (outcome: BrowserOtlpDeliveryOutcome) => void,
  offlineQueue?: BrowserOtlpOfflineQueueOptions,
  flushDeadlineMs?: number,
  shutdownDeadlineMs?: number,
  metricExportIntervalMillis?: number,
  networkCapture: NetworkCaptureConfig,
  getPropagationPolicy: () => { allowedOrigins: readonly string[], allowLocalhost: boolean },
  /**
   * Install Fetch/XHR instrumentation immediately. Browser callers that must
   * resolve an authenticated session root first can set this to false and
   * call the registration's `enableHttpInstrumentation()` once that root is
   * available. Starting an HTTP span before its only safe parent is known
   * creates a new trace that cannot be repaired later.
   *
   * Defaults to true so existing-provider integrations keep the normal OTel
   * registration behavior unless they explicitly own a startup race.
   */
  installHttpInstrumentationImmediately?: boolean,
  /**
   * The ambient base context for spans started outside any explicit
   * `context.with(...)` frame — the current `$page-view` execution context, or
   * null before the first page view (the tracker is lazily loaded, so this is
   * late-bound and consulted on every read). See AmbientBaseStackContextManager.
   */
  getAmbientOtelContext: () => Context | null,
};

export type BrowserManagedOtelRegistration = {
  provider: WebTracerProvider,
  loggerProvider: ApiLoggerProvider,
  meterProvider: MeterProvider,
  forceFlush: (timeoutMs?: number) => Promise<void>,
  flushBeforeAuthenticationChange: () => Promise<BrowserManagedOtelRegistration>,
  getOutcomeCounts: () => ReadonlyMap<string, number>,
  enableHttpInstrumentation: () => boolean,
  updatePropagationPolicy: () => void,
  shutdown: (timeoutMs?: number) => Promise<void>,
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function originUrlPattern(origin: string): RegExp {
  return new RegExp(`^${escapeRegex(origin)}(?:/|$)`);
}

function networkIgnorePatterns(options: BrowserManagedOtelOptions): RegExp[] {
  if (!options.networkCapture.enabled) return [/.*/];
  const patterns = options.networkCapture.ignoreUrls
    .filter((value) => value !== "")
    .map((value) => new RegExp(escapeRegex(value)));
  for (const origin of options.networkCapture.denyOrigins ?? []) patterns.push(originUrlPattern(origin));
  if (options.networkCapture.allowOrigins !== null) {
    const allowed = options.networkCapture.allowOrigins.map((origin) => escapeRegex(origin)).join("|");
    patterns.push(new RegExp(`^(?!(?:${allowed})(?:/|$)).*$`));
  }
  // Export requests must never recursively produce more export spans.
  patterns.push(new RegExp(`^${escapeRegex(new URL("/api/v1/analytics/otlp/", options.analyticsBaseUrl).toString())}`));
  return patterns;
}

function propagationPatterns(options: BrowserManagedOtelOptions): RegExp[] {
  const policy = options.getPropagationPolicy();
  const patterns = policy.allowedOrigins.map(originUrlPattern);
  if (policy.allowLocalhost) {
    patterns.push(/^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/);
  }
  return patterns;
}

export type HexclaveBrowserOtelExporterOptions = {
  analyticsBaseUrl: string,
  projectId: string,
  clientVersion: string,
  getRequestHeaders: () => Promise<Record<string, string>>,
  onOutcome?: (outcome: BrowserOtlpDeliveryOutcome) => void,
  offlineQueue?: BrowserOtlpOfflineQueueOptions,
  flushDeadlineMs?: number,
  shutdownDeadlineMs?: number,
  sendClientReports?: boolean,
};

export type BrowserOtlpOfflineQueueOptions = {
  dbName?: string,
  maxQueueSize?: number,
  maxQueueBytes?: number,
};

export type BrowserOtlpExporterControls = {
  forceFlush: (timeoutMs?: number) => Promise<void>,
  shutdown: (timeoutMs?: number) => Promise<void>,
  advanceAuthGeneration: () => Promise<void>,
};

export type BrowserOtlpDeliveryOutcome = {
  signal: "traces" | "logs" | "metrics",
  outcome: "accepted" | "partial" | "queued" | "dropped",
  reason: "accepted" | "partial_failure" | "rejected" | "oversized" | "permanent_failure" | "network_error" | "retry_exhausted" | "deadline" | "serialization_failure" | "shutdown" | "queue_overflow" | "persistence_failure" | "auth_generation_mismatch",
  itemCount: number,
  droppedItemCount: number,
  attempts: number,
  bodyBytes?: number,
  statusCode?: number,
  message?: string,
};

export function createHexclaveBrowserCorrelationSpanProcessor(): SpanProcessor {
  return new BrowserCorrelationSpanProcessor();
}

const OTLP_EXPORT_MAX_ATTEMPTS = 3;
const OTLP_EXPORT_RETRY_BASE_DELAY_MS = 1_000;
const OTLP_EXPORT_RETRY_MAX_DELAY_MS = 30_000;
// Keep browser batches bounded before a proxy or backend returns an opaque
// payload-too-large response. The server still validates record counts and
// fields independently; this is only the client transport budget.
const OTLP_EXPORT_MAX_BODY_BYTES = 1 * 1024 * 1024;
const OTLP_EXPORT_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const OTLP_OFFLINE_QUEUE_MAX_SIZE = 30;
const OTLP_OFFLINE_QUEUE_MAX_BYTES = 5 * 1024 * 1024;
const OTLP_FLUSH_DEADLINE_MS = 5_000;
const OTLP_SHUTDOWN_DEADLINE_MS = 2_000;
const OTLP_METRIC_EXPORT_INTERVAL_MS = 5_000;
const OTLP_UNLOAD_DEADLINE_MS = 250;
// Keep the unload-flush request comfortably inside the shared keepalive budget
// (see the transport comment) so it isn't rejected at the one moment keepalive
// is actually needed.
const OTLP_UNLOAD_KEEPALIVE_MAX_BODY_BYTES = 30_000;
const OTLP_UNLOAD_KEEPALIVE_PAGE_BUDGET_BYTES = 64 * 1024;

let browserKeepaliveBytesInFlight = 0;

type SerializedOtlpSendResult =
  | {
    kind: "accepted",
    itemCount: number,
    attempts: number,
    bodyBytes: number,
  }
  | {
    kind: "partial",
    itemCount: number,
    attempts: number,
    bodyBytes: number,
    droppedItemCount: number,
    statusCode: number,
    message?: string,
  }
  | {
    kind: "rejected",
    itemCount: number,
    attempts: number,
    bodyBytes: number,
    statusCode: number,
    message: string,
  }
  | {
    kind: "permanent_failure",
    itemCount: number,
    attempts: number,
    bodyBytes: number,
    statusCode?: number,
    reason: "rejected" | "oversized" | "permanent_failure" | "serialization_failure",
    message: string,
  }
  | {
    kind: "retryable",
    itemCount: number,
    attempts: number,
    bodyBytes: number,
    reason: "network_error" | "retry_exhausted" | "deadline",
    retryAfterMs: number,
    statusCode?: number,
    message: string,
  }
  | {
    kind: "auth_generation_mismatch",
    itemCount: number,
    attempts: number,
    bodyBytes: number,
    message: string,
  };

type PreparedOtlpBatch = {
  body: Uint8Array<ArrayBuffer>,
  itemCount: number,
  bodyBytes: number,
  authGeneration: number,
  generationToken: number,
};

type ClientReportSendResult =
  | { kind: "accepted" }
  | { kind: "retryable", nextAttemptAt: number }
  | { kind: "permanent_failure" };

type PreparedOtlpSend = {
  result: SerializedOtlpSendResult,
  batch?: PreparedOtlpBatch,
};

function normalizedPositiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function queueOptionsForExporter(options: HexclaveBrowserOtelExporterOptions, signal: BrowserOtlpSignal): {
  dbName: string,
  storeName: string,
  maxQueueSize: number,
  maxQueueBytes: number,
} {
  const projectKey = encodeURIComponent(options.projectId);
  return {
    dbName: options.offlineQueue?.dbName ?? `hexclave-otlp-offline-${projectKey}-${signal}`,
    storeName: `batches-${signal}`,
    maxQueueSize: normalizedPositiveInteger(options.offlineQueue?.maxQueueSize, OTLP_OFFLINE_QUEUE_MAX_SIZE),
    maxQueueBytes: normalizedPositiveInteger(options.offlineQueue?.maxQueueBytes, OTLP_OFFLINE_QUEUE_MAX_BYTES),
  };
}

function elapsedDeadline(timeoutMs: number): number {
  return performance.now() + timeoutMs;
}

function remainingDeadline(deadline: number): number {
  return Math.max(0, deadline - performance.now());
}

function deadlineError(operation: string): Error {
  const error = new Error(`Hexclave browser OTLP ${operation} deadline exceeded`);
  error.name = "BrowserOtlpDeadlineError";
  return error;
}

function isDeadlineError(error: unknown): boolean {
  return error instanceof Error && error.name === "BrowserOtlpDeadlineError";
}

function withDeadline<T>(promise: Promise<T>, deadline: number, operation: string): Promise<T> {
  const remaining = remainingDeadline(deadline);
  if (remaining <= 0) return Promise.reject(deadlineError(operation));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(deadlineError(operation)), remaining);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

function waitUntil(targetTime: number, deadline: number | undefined, operation: string): Promise<void> {
  const delay = Math.max(0, targetTime - Date.now());
  if (deadline === undefined) {
    return new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
  const remaining = remainingDeadline(deadline);
  if (remaining <= 0 || delay > remaining) return Promise.reject(deadlineError(operation));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      resolve();
    }, delay);
    const deadlineTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(deadlineError(operation));
    }, remaining);
  });
}

function reserveKeepalive(bodyBytes: number, lifecycleFlushRequested: boolean): boolean {
  if (
    typeof document === "undefined"
    || (!lifecycleFlushRequested && document.visibilityState !== "hidden")
    || bodyBytes > OTLP_UNLOAD_KEEPALIVE_MAX_BODY_BYTES
    || browserKeepaliveBytesInFlight + bodyBytes > OTLP_UNLOAD_KEEPALIVE_PAGE_BUDGET_BYTES
  ) return false;
  browserKeepaliveBytesInFlight += bodyBytes;
  return true;
}

function releaseKeepalive(bodyBytes: number): void {
  browserKeepaliveBytesInFlight = Math.max(0, browserKeepaliveBytesInFlight - bodyBytes);
}

function parseRetryAfterDelay(header: string | null): number | null {
  if (header === null) return null;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, OTLP_EXPORT_RETRY_MAX_DELAY_MS);
  }

  // Retry-After also permits an HTTP date. Date.now() is intentional here:
  // this is a wall-clock protocol value, not elapsed-time measurement.
  const targetTime = Date.parse(header);
  if (Number.isNaN(targetTime)) return null;
  return Math.min(Math.max(targetTime - Date.now(), 0), OTLP_EXPORT_RETRY_MAX_DELAY_MS);
}

function clientReportIdempotencyKey(signal: BrowserOtlpSignal, sequence: number): string {
  const randomValues = new Uint32Array(4);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(randomValues);
    return `hexclave-client-report-${signal}-${Array.from(randomValues, (value) => value.toString(16).padStart(8, "0")).join("")}`;
  }
  return `hexclave-client-report-${signal}-${Date.now().toString(16)}-${sequence.toString(16)}`;
}

function permanentResponseReason(statusCode: number): "rejected" | "oversized" | "permanent_failure" {
  if (statusCode === 413) return "oversized";
  if (statusCode === 400 || statusCode === 415 || statusCode === 422) return "rejected";
  return "permanent_failure";
}

/**
 * OTLP/HTTP JSON exporter on a plain-fetch transport. The official browser
 * exporters' fetch transport turns `keepalive: true` on for every export under
 * 60KB, but browsers cap CUMULATIVE in-flight keepalive bodies at 64KiB PER
 * PAGE, shared with session-replay batches, other analytics vendors, and every
 * other exporter — none of which the transport's own accounting can see. On a
 * busy page its requests are then rejected by the browser with an opaque
 * network error before they ever leave (observed: ~5KB log batches failing
 * near-100% while >60KB trace batches, whose size disabled keepalive, sailed
 * through — which is why spans arrived and $click events silently vanished).
 * Plain fetch has no such budget, so ordinary exports never use keepalive;
 * only the final flush of an unloading page does, where a normal request
 * would otherwise be cancelled outright.
 */
class HexclaveBrowserOtlpJsonExporter<Payload> implements BrowserOtlpExporterControls {
  private _inFlight = 0;
  private readonly _idleWaiters: Array<() => void> = [];
  private readonly _activeControllers = new Set<AbortController>();
  private readonly _queue: BrowserOtlpOfflineQueue;
  private readonly _flushDeadlineMs: number;
  private readonly _shutdownDeadlineMs: number;
  private readonly _onlineHandler: () => void;
  private readonly _visibilityChangeHandler: () => void;
  private readonly _pageHideHandler: () => void;
  private readonly _pageShowHandler: () => void;
  private _drainPromise: Promise<void> | null = null;
  private _queueMutationPromise: Promise<void> = Promise.resolve();
  private readonly _pendingQueueWrites = new Set<Promise<void>>();
  private _clientReportQueueNeedsDrain = false;
  private _authGenerationToken = 0;
  private _shutdownRequested = false;
  private _queueTimer: ReturnType<typeof setTimeout> | null = null;
  private _queueTimerAt: number | null = null;
  private _lifecycleFlushRequested = false;
  private _reportSequence = 0;

  constructor(
    private readonly _serializer: { serializeRequest: (payload: Payload) => Uint8Array | undefined },
    private readonly _itemCount: (payload: Payload) => number,
    private readonly _url: string,
    private readonly _getHeaders: () => Promise<Record<string, string>>,
    private readonly _signal: BrowserOtlpSignal,
    private readonly _onOutcome: ((outcome: BrowserOtlpDeliveryOutcome) => void) | undefined,
    queue: BrowserOtlpOfflineQueue,
    flushDeadlineMs: number,
    shutdownDeadlineMs: number,
    private readonly _clientReportUrl: string,
    private readonly _sendClientReports: boolean,
  ) {
    this._queue = queue;
    this._flushDeadlineMs = flushDeadlineMs;
    this._shutdownDeadlineMs = shutdownDeadlineMs;
    this._onlineHandler = () => {
      ignoreUnhandledRejection(this.forceFlush(this._flushDeadlineMs));
    };
    this._visibilityChangeHandler = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        this._requestLifecycleFlush();
      } else {
        this._lifecycleFlushRequested = false;
        this._scheduleQueueDrain();
      }
    };
    this._pageHideHandler = () => {
      this._requestLifecycleFlush();
    };
    this._pageShowHandler = () => {
      this._lifecycleFlushRequested = false;
      this._scheduleQueueDrain();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("online", this._onlineHandler);
      window.addEventListener("pagehide", this._pageHideHandler);
      window.addEventListener("pageshow", this._pageShowHandler);
    }
    // Some SSR/test runtimes expose a document-shaped value without DOM event
    // methods. Lifecycle delivery is optional there; an attempted listener
    // call must not prevent the client from constructing its auth surface.
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", this._visibilityChangeHandler);
    }
    this._scheduleQueueDrain();
  }

  export(payload: Payload, resultCallback: (result: ExportResult) => void): void {
    const itemCount = this._itemCount(payload);
    if (this._shutdownRequested) {
      this._recordOutcome({
        outcome: "dropped",
        reason: "shutdown",
        itemCount,
        droppedItemCount: itemCount,
        attempts: 0,
      });
      resultCallback({ code: ExportResultCode.FAILED, error: new Error("Hexclave OTLP export was requested after shutdown") });
      return;
    }

    this._inFlight += 1;
    ignoreUnhandledRejection(this._runExport(payload, resultCallback));
  }

  private async _runExport(payload: Payload, resultCallback: (result: ExportResult) => void): Promise<void> {
    const itemCount = this._itemCount(payload);
    let result: ExportResult;
    try {
      const sent = await this._send(payload);
      result = await this._completeSend(sent);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this._recordOutcome({
        outcome: "dropped",
        reason: error instanceof BrowserOtlpQueuePersistenceError ? "persistence_failure" : "permanent_failure",
        itemCount,
        droppedItemCount: itemCount,
        attempts: 0,
        message: normalizedError.message,
      });
      result = { code: ExportResultCode.FAILED, error: normalizedError };
    }
    this._inFlight -= 1;
    if (this._inFlight === 0) {
      const waiters = this._idleWaiters.splice(0);
      for (const resolve of waiters) resolve();
    }
    resultCallback(result);
  }

  private async _send(payload: Payload): Promise<PreparedOtlpSend> {
    const itemCount = this._itemCount(payload);
    let serialized: Uint8Array | undefined;
    try {
      serialized = this._serializer.serializeRequest(payload);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      return {
        result: {
          kind: "permanent_failure",
          reason: "serialization_failure",
          itemCount,
          attempts: 0,
          bodyBytes: 0,
          message: normalizedError.message,
        },
      };
    }
    if (serialized === undefined) {
      const error = new Error("Hexclave OTLP export could not serialize the batch");
      return {
        result: {
          kind: "permanent_failure",
          reason: "serialization_failure",
          itemCount,
          attempts: 0,
          bodyBytes: 0,
          message: error.message,
        },
      };
    }
    // Copied into a fresh ArrayBuffer-backed view: the serializer's is typed
    // over ArrayBufferLike, which the DOM lib's BodyInit rejects.
    const body = new Uint8Array(new ArrayBuffer(serialized.byteLength));
    body.set(serialized);
    if (body.byteLength > OTLP_EXPORT_MAX_BODY_BYTES) {
      const error = new Error(`Hexclave OTLP export is too large (${body.byteLength} bytes; maximum is ${OTLP_EXPORT_MAX_BODY_BYTES})`);
      return {
        result: {
          kind: "permanent_failure",
          reason: "oversized",
          itemCount,
          attempts: 0,
          bodyBytes: body.byteLength,
          message: error.message,
        },
      };
    }

    const authGeneration = await this._queue.currentAuthGeneration();
    const batch: PreparedOtlpBatch = {
      body,
      itemCount,
      bodyBytes: body.byteLength,
      authGeneration,
      generationToken: this._authGenerationToken,
    };
    return {
      batch,
      result: await this._sendSerialized(batch, elapsedDeadline(this._flushDeadlineMs)),
    };
  }

  private async _sendSerialized(batch: PreparedOtlpBatch, deadline: number): Promise<SerializedOtlpSendResult> {
    let lastError: Error | null = null;
    let lastStatusCode: number | undefined;
    let lastFailureWasNetwork = false;
    let retryAfterResponse: Response | undefined;
    let attempts = 0;
    for (let attempt = 1; attempt <= OTLP_EXPORT_MAX_ATTEMPTS; attempt++) {
      attempts = attempt;
      if (!(await this._isGenerationCurrent(batch))) {
        return {
          kind: "auth_generation_mismatch",
          itemCount: batch.itemCount,
          attempts: attempt - 1,
          bodyBytes: batch.bodyBytes,
          message: "Hexclave browser OTLP batch belongs to an earlier authentication generation",
        };
      }
      if (attempt > 1) {
        try {
          await waitUntil(Date.now() + this._retryDelayMs(attempt - 1, retryAfterResponse), deadline, "retry");
        } catch (error) {
          if (!isDeadlineError(error)) throw error;
          return {
            kind: "retryable",
            reason: "deadline",
            itemCount: batch.itemCount,
            attempts: attempt - 1,
            bodyBytes: batch.bodyBytes,
            retryAfterMs: 0,
            ...(lastStatusCode === undefined ? {} : { statusCode: lastStatusCode }),
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }

      let response: Response;
      try {
        response = await this._fetch(batch.body, deadline);
      } catch (error) {
        if (isDeadlineError(error)) {
          return {
            kind: "retryable",
            reason: "deadline",
            itemCount: batch.itemCount,
            attempts: attempt - 1,
            bodyBytes: batch.bodyBytes,
            retryAfterMs: 0,
            message: error instanceof Error ? error.message : String(error),
          };
        }
        lastError = new Error("Hexclave OTLP export encountered a network error", { cause: error });
        lastFailureWasNetwork = true;
        continue;
      }

      if (!(await this._isGenerationCurrent(batch))) {
        return {
          kind: "auth_generation_mismatch",
          itemCount: batch.itemCount,
          attempts: attempt,
          bodyBytes: batch.bodyBytes,
          message: "Hexclave browser OTLP authentication changed while the batch was in flight",
        };
      }
      lastFailureWasNetwork = false;
      if (response.ok) {
        let partialSuccess: { rejectedItemCount: number, message?: string } | null;
        try {
          partialSuccess = await this._readPartialSuccess(response, deadline);
        } catch (error) {
          if (isDeadlineError(error)) {
            return {
              kind: "retryable",
              reason: "deadline",
              itemCount: batch.itemCount,
              attempts: attempt,
              bodyBytes: batch.bodyBytes,
              retryAfterMs: 0,
              message: error instanceof Error ? error.message : String(error),
            };
          }
          lastError = error instanceof Error ? error : new Error(String(error));
          lastFailureWasNetwork = true;
          continue;
        }
        if (partialSuccess === null || partialSuccess.rejectedItemCount === 0) {
          return {
            kind: "accepted",
            itemCount: batch.itemCount,
            attempts: attempt,
            bodyBytes: batch.bodyBytes,
          };
        }
        const droppedItemCount = Math.min(batch.itemCount, partialSuccess.rejectedItemCount);
        const allItemsRejected = droppedItemCount >= batch.itemCount;
        if (allItemsRejected) {
          return {
            kind: "rejected",
            itemCount: batch.itemCount,
            attempts: attempt,
            bodyBytes: batch.bodyBytes,
            statusCode: response.status,
            message: partialSuccess.message ?? "Hexclave OTLP endpoint rejected every item in the batch",
          };
        }
        return {
          kind: "partial",
          itemCount: batch.itemCount,
          droppedItemCount,
          attempts: attempt,
          bodyBytes: batch.bodyBytes,
          statusCode: response.status,
          message: partialSuccess.message,
        };
      }

      lastError = new Error(`Hexclave OTLP export failed with status ${response.status}`);
      lastStatusCode = response.status;
      retryAfterResponse = response;
      if (!OTLP_EXPORT_RETRYABLE_STATUSES.has(response.status)) {
        return {
          kind: "permanent_failure",
          reason: permanentResponseReason(response.status),
          itemCount: batch.itemCount,
          attempts,
          bodyBytes: batch.bodyBytes,
          statusCode: response.status,
          message: lastError.message,
        };
      }
    }

    const error = lastError ?? throwErr("unreachable: the Hexclave OTLP export retry loop cannot exit without recording an error");
    return {
      kind: "retryable",
      reason: lastFailureWasNetwork ? "network_error" : "retry_exhausted",
      itemCount: batch.itemCount,
      attempts,
      bodyBytes: batch.bodyBytes,
      retryAfterMs: this._retryDelayMs(attempts, retryAfterResponse),
      ...(lastStatusCode === undefined ? {} : { statusCode: lastStatusCode }),
      message: error.message,
    };
  }

  private async _fetch(body: Uint8Array<ArrayBuffer>, deadline: number, url = this._url): Promise<Response> {
    const controller = new AbortController();
    this._activeControllers.add(controller);
    const useKeepalive = reserveKeepalive(body.byteLength, this._lifecycleFlushRequested);
    try {
      const headers = await withDeadline(this._getHeaders(), deadline, "request headers");
      const request = fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body,
        keepalive: useKeepalive,
        signal: controller.signal,
      });
      try {
        return await withDeadline(request, deadline, "export request");
      } catch (error) {
        if (isDeadlineError(error)) controller.abort();
        throw error;
      }
    } catch (error) {
      if (isDeadlineError(error)) controller.abort();
      throw error;
    } finally {
      if (useKeepalive) releaseKeepalive(body.byteLength);
      this._activeControllers.delete(controller);
    }
  }

  private _requestLifecycleFlush(): void {
    this._lifecycleFlushRequested = true;
    queueMicrotask(() => {
      if (this._shutdownRequested) return;
      ignoreUnhandledRejection(this.forceFlush(OTLP_UNLOAD_DEADLINE_MS));
    });
  }

  private _scheduleQueueDrain(): void {
    ignoreUnhandledRejection(this._scheduleQueueDrainInner());
  }

  private async _scheduleQueueDrainInner(): Promise<void> {
    if (this._shutdownRequested) return;
    const entry = await this._queue.peek();
    if (entry === undefined) {
      if (this._queueTimer !== null) clearTimeout(this._queueTimer);
      this._queueTimer = null;
      this._queueTimerAt = null;
      return;
    }

    const now = Date.now();
    const nextAttemptAt = Math.max(now, entry.nextAttemptAt);
    if (this._queueTimerAt !== null && this._queueTimerAt <= nextAttemptAt) return;
    if (this._queueTimer !== null) clearTimeout(this._queueTimer);
    this._queueTimerAt = nextAttemptAt;
    this._queueTimer = setTimeout(() => {
      this._queueTimer = null;
      this._queueTimerAt = null;
      ignoreUnhandledRejection(this.forceFlush(this._flushDeadlineMs));
    }, entry.nextAttemptAt <= now ? OTLP_EXPORT_RETRY_BASE_DELAY_MS : nextAttemptAt - now);
  }

  private _trackQueueWrite(task: Promise<void>): void {
    this._pendingQueueWrites.add(task);
    task.then(
      () => this._pendingQueueWrites.delete(task),
      () => this._pendingQueueWrites.delete(task),
    );
    ignoreUnhandledRejection(task);
  }

  private async _completeSend(sent: PreparedOtlpSend): Promise<ExportResult> {
    const result = sent.result;
    switch (result.kind) {
      case "accepted": {
        this._recordOutcome({
          outcome: "accepted",
          reason: "accepted",
          itemCount: result.itemCount,
          droppedItemCount: 0,
          attempts: result.attempts,
          bodyBytes: result.bodyBytes,
        });
        return { code: ExportResultCode.SUCCESS };
      }
      case "partial": {
        this._recordOutcome({
          outcome: "partial",
          reason: "partial_failure",
          itemCount: result.itemCount,
          droppedItemCount: result.droppedItemCount,
          attempts: result.attempts,
          bodyBytes: result.bodyBytes,
          statusCode: result.statusCode,
          message: result.message,
        });
        return { code: ExportResultCode.SUCCESS };
      }
      case "rejected": {
        this._recordOutcome({
          outcome: "dropped",
          reason: "rejected",
          itemCount: result.itemCount,
          droppedItemCount: result.itemCount,
          attempts: result.attempts,
          bodyBytes: result.bodyBytes,
          statusCode: result.statusCode,
          message: result.message,
        });
        return { code: ExportResultCode.FAILED, error: new Error(result.message) };
      }
      case "permanent_failure": {
        this._recordOutcome({
          outcome: "dropped",
          reason: result.reason,
          itemCount: result.itemCount,
          droppedItemCount: result.itemCount,
          attempts: result.attempts,
          bodyBytes: result.bodyBytes,
          ...(result.statusCode === undefined ? {} : { statusCode: result.statusCode }),
          message: result.message,
        });
        return { code: ExportResultCode.FAILED, error: new Error(result.message) };
      }
      case "auth_generation_mismatch": {
        this._recordOutcome({
          outcome: "dropped",
          reason: "auth_generation_mismatch",
          itemCount: result.itemCount,
          droppedItemCount: result.itemCount,
          attempts: result.attempts,
          bodyBytes: result.bodyBytes,
          message: result.message,
        });
        return { code: ExportResultCode.FAILED, error: new Error(result.message) };
      }
      case "retryable": {
        const batch = sent.batch ?? throwErr("unreachable: retryable browser OTLP result has no serialized batch");
        return await this._enqueueRetryable(batch, result);
      }
    }
  }

  private async _enqueueRetryable(batch: PreparedOtlpBatch, result: Extract<SerializedOtlpSendResult, { kind: "retryable" }>): Promise<ExportResult> {
    return await this._withQueueMutation(async () => {
      if (batch.generationToken !== this._authGenerationToken || !(await this._isGenerationCurrent(batch))) {
        const message = "Hexclave browser OTLP batch was not queued because authentication changed";
        this._recordOutcome({
          outcome: "dropped",
          reason: "auth_generation_mismatch",
          itemCount: batch.itemCount,
          droppedItemCount: batch.itemCount,
          attempts: result.attempts,
          bodyBytes: batch.bodyBytes,
          message,
        });
        return { code: ExportResultCode.FAILED, error: new Error(message) };
      }

      let enqueueResult: Awaited<ReturnType<BrowserOtlpOfflineQueue["enqueue"]>>;
      try {
        enqueueResult = await this._queue.enqueue({
          body: batch.body,
          itemCount: batch.itemCount,
          bodyBytes: batch.bodyBytes,
          nextAttemptAt: Date.now() + result.retryAfterMs,
        });
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        this._recordOutcome({
          outcome: "dropped",
          reason: "persistence_failure",
          itemCount: batch.itemCount,
          droppedItemCount: batch.itemCount,
          attempts: result.attempts,
          bodyBytes: batch.bodyBytes,
          message: normalizedError.message,
        });
        return { code: ExportResultCode.FAILED, error: normalizedError };
      }
      if (enqueueResult.status === "dropped") {
        const error = new Error("Hexclave browser OTLP offline queue is full");
        this._recordOutcome({
          outcome: "dropped",
          reason: "queue_overflow",
          itemCount: batch.itemCount,
          droppedItemCount: batch.itemCount,
          attempts: result.attempts,
          bodyBytes: batch.bodyBytes,
          message: error.message,
        });
        return { code: ExportResultCode.FAILED, error };
      }
      this._recordOutcome({
        outcome: "queued",
        reason: result.reason,
        itemCount: batch.itemCount,
        droppedItemCount: 0,
        attempts: result.attempts,
        bodyBytes: batch.bodyBytes,
        ...(result.statusCode === undefined ? {} : { statusCode: result.statusCode }),
        message: result.message,
      });
      this._scheduleQueueDrain();
      return { code: ExportResultCode.SUCCESS };
    });
  }

  private async _drainQueue(deadline: number): Promise<void> {
    const existing = this._drainPromise;
    if (existing !== null) {
      await withDeadline(existing, deadline, "offline queue drain");
      return;
    }
    const drain = this._drainQueueLoop(deadline);
    const tracked = drain.finally(() => {
      if (this._drainPromise === tracked) this._drainPromise = null;
    });
    this._drainPromise = tracked;
    ignoreUnhandledRejection(tracked);
    await withDeadline(tracked, deadline, "offline queue drain");
  }

  private async _drainQueueLoop(deadline: number): Promise<void> {
    while (remainingDeadline(deadline) > 0) {
      const entry = await this._queue.peek();
      if (entry === undefined) return;
      const currentGeneration = await this._queue.currentAuthGeneration();
      if (entry.authGeneration !== currentGeneration) {
        await this._queue.remove(entry.id);
        // Client reports are feedback about an earlier telemetry drop. They
        // are deliberately invisible to outcome accounting, including when
        // auth rotation removes their queued bytes; otherwise report loss
        // would create another report and form a feedback loop.
        if (entry.kind === "otlp") {
          this._recordOutcome({
            outcome: "dropped",
            reason: "auth_generation_mismatch",
            itemCount: entry.itemCount,
            droppedItemCount: entry.itemCount,
            attempts: 0,
            bodyBytes: entry.bodyBytes,
            message: "Hexclave browser OTLP offline queue entry belonged to an earlier authentication generation",
          });
        }
        continue;
      }
      if (entry.kind === "client_report") {
        const reportResult = await this._sendClientReport(entry, deadline);
        if (reportResult.kind === "accepted" || reportResult.kind === "permanent_failure") {
          await this._queue.remove(entry.id);
          this._clientReportQueueNeedsDrain = false;
        } else {
          await this._queue.reschedule(entry.id, reportResult.nextAttemptAt);
        }
        return;
      }
      // Retry-After is a wall-clock retry schedule. A flush/reconnect should
      // make a due entry drain, but must not turn a server backoff into a hot
      // loop while the page remains online.
      if (entry.nextAttemptAt > Date.now()) return;
      const batch: PreparedOtlpBatch = {
        body: (() => {
          const body = new Uint8Array(new ArrayBuffer(entry.body.byteLength));
          body.set(entry.body);
          return body;
        })(),
        itemCount: entry.itemCount,
        bodyBytes: entry.bodyBytes,
        authGeneration: entry.authGeneration,
        generationToken: this._authGenerationToken,
      };
      const result = await this._sendSerialized(batch, deadline);
      switch (result.kind) {
        case "accepted": {
          await this._queue.remove(entry.id);
          this._recordOutcome({
            outcome: "accepted",
            reason: "accepted",
            itemCount: result.itemCount,
            droppedItemCount: 0,
            attempts: result.attempts,
            bodyBytes: result.bodyBytes,
          });
          continue;
        }
        case "partial": {
          await this._queue.remove(entry.id);
          this._recordOutcome({
            outcome: "partial",
            reason: "partial_failure",
            itemCount: result.itemCount,
            droppedItemCount: result.droppedItemCount,
            attempts: result.attempts,
            bodyBytes: result.bodyBytes,
            statusCode: result.statusCode,
            message: result.message,
          });
          continue;
        }
        case "rejected": {
          await this._queue.remove(entry.id);
          this._recordOutcome({
            outcome: "dropped",
            reason: "rejected",
            itemCount: result.itemCount,
            droppedItemCount: result.itemCount,
            attempts: result.attempts,
            bodyBytes: result.bodyBytes,
            statusCode: result.statusCode,
            message: result.message,
          });
          continue;
        }
        case "permanent_failure": {
          await this._queue.remove(entry.id);
          this._recordOutcome({
            outcome: "dropped",
            reason: result.reason,
            itemCount: result.itemCount,
            droppedItemCount: result.itemCount,
            attempts: result.attempts,
            bodyBytes: result.bodyBytes,
            ...(result.statusCode === undefined ? {} : { statusCode: result.statusCode }),
            message: result.message,
          });
          continue;
        }
        case "auth_generation_mismatch": {
          await this._queue.remove(entry.id);
          this._recordOutcome({
            outcome: "dropped",
            reason: "auth_generation_mismatch",
            itemCount: result.itemCount,
            droppedItemCount: result.itemCount,
            attempts: result.attempts,
            bodyBytes: result.bodyBytes,
            message: result.message,
          });
          continue;
        }
        case "retryable": {
          await this._queue.reschedule(entry.id, Date.now() + result.retryAfterMs);
          this._recordOutcome({
            outcome: "queued",
            reason: result.reason,
            itemCount: result.itemCount,
            droppedItemCount: 0,
            attempts: result.attempts,
            bodyBytes: result.bodyBytes,
            ...(result.statusCode === undefined ? {} : { statusCode: result.statusCode }),
            message: result.message,
          });
          return;
        }
      }
    }
  }

  private async _isGenerationCurrent(batch: PreparedOtlpBatch): Promise<boolean> {
    if (batch.generationToken !== this._authGenerationToken) return false;
    const currentGeneration = await this._queue.currentAuthGeneration();
    return batch.generationToken === this._authGenerationToken && currentGeneration === batch.authGeneration;
  }

  private async _waitForInFlight(deadline: number): Promise<void> {
    if (this._inFlight === 0) return;
    let resolveIdle: () => void = () => {
      throw new Error("Hexclave browser OTLP in-flight waiter was not initialized");
    };
    const idle = new Promise<void>((resolve) => {
      resolveIdle = resolve;
      this._idleWaiters.push(resolve);
    });
    try {
      await withDeadline(idle, deadline, "in-flight export");
    } catch (error) {
      const index = this._idleWaiters.indexOf(resolveIdle);
      if (index >= 0) this._idleWaiters.splice(index, 1);
      if (isDeadlineError(error)) {
        for (const controller of this._activeControllers) controller.abort();
      }
      throw error;
    }
  }

  private async _withQueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this._queueMutationPromise;
    let release: () => void = () => {
      throw new Error("Hexclave browser OTLP queue mutation gate was not initialized");
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this._queueMutationPromise = previous.then(() => gate);
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async _sendClientReport(entry: BrowserOtlpQueueEntry, deadline: number): Promise<ClientReportSendResult> {
    const body = new Uint8Array(new ArrayBuffer(entry.body.byteLength));
    body.set(entry.body);
    if (!(await this._isGenerationCurrent({
      body,
      itemCount: entry.itemCount,
      bodyBytes: entry.bodyBytes,
      authGeneration: entry.authGeneration,
      generationToken: this._authGenerationToken,
    }))) return { kind: "permanent_failure" };

    try {
      const response = await this._fetch(body, deadline, this._clientReportUrl);
      if (response.ok) return { kind: "accepted" };
      if (!OTLP_EXPORT_RETRYABLE_STATUSES.has(response.status)) return { kind: "permanent_failure" };
      const retryAfterMs = parseRetryAfterDelay(response.headers.get("retry-after")) ?? OTLP_EXPORT_RETRY_BASE_DELAY_MS;
      return { kind: "retryable", nextAttemptAt: Date.now() + retryAfterMs };
    } catch (error) {
      if (isDeadlineError(error)) return { kind: "retryable", nextAttemptAt: Date.now() + OTLP_EXPORT_RETRY_BASE_DELAY_MS };
      return { kind: "retryable", nextAttemptAt: Date.now() + OTLP_EXPORT_RETRY_BASE_DELAY_MS };
    }
  }

  async advanceAuthGeneration(): Promise<void> {
    // Invalidate batches synchronously before waiting on IndexedDB. An export
    // that finishes during the transition can therefore only report a drop;
    // it cannot enqueue old-user bytes under the next generation.
    this._authGenerationToken += 1;
    const dropped = await this._withQueueMutation(async () => await this._queue.advanceAuthGeneration());
    if (dropped.queueEntryCount === 0) return;
    this._recordOutcome({
      outcome: "dropped",
      reason: "auth_generation_mismatch",
      itemCount: dropped.itemCount,
      droppedItemCount: dropped.itemCount,
      attempts: 0,
      bodyBytes: dropped.bodyBytes,
      message: "Hexclave browser OTLP offline queue was cleared during authentication rotation",
    });
  }

  private _recordOutcome(outcome: Omit<BrowserOtlpDeliveryOutcome, "signal">): void {
    const fullOutcome = { signal: this._signal, ...outcome } satisfies BrowserOtlpDeliveryOutcome;
    this._onOutcome?.(fullOutcome);
    if (
      this._sendClientReports
      && !this._shutdownRequested
      && fullOutcome.reason !== "auth_generation_mismatch"
      && fullOutcome.reason !== "queue_overflow"
      && fullOutcome.reason !== "persistence_failure"
      && (fullOutcome.outcome === "dropped" || fullOutcome.droppedItemCount > 0)
    ) {
      const quantity = fullOutcome.droppedItemCount > 0 ? fullOutcome.droppedItemCount : fullOutcome.itemCount;
      if (quantity > 0) this._queueClientReport(fullOutcome.reason, quantity);
    }
  }

  private _queueClientReport(reason: string, quantity: number): void {
    const idempotencyKey = clientReportIdempotencyKey(this._signal, this._reportSequence++);
    const bodyText = JSON.stringify({
      discarded_events: [{
        reason,
        category: this._signal === "traces" ? "span" : this._signal === "logs" ? "log_item" : "metric",
        quantity,
      }],
      rate_limited_events: [],
      filtered_events: [],
      filtered_sampling_events: [],
      idempotency_key: idempotencyKey,
    });
    const encoded = new TextEncoder().encode(bodyText);
    const body = new Uint8Array(new ArrayBuffer(encoded.byteLength));
    body.set(encoded);
    const task = this._withQueueMutation(async () => {
      if (this._shutdownRequested) return;
      try {
        const generation = await this._queue.currentAuthGeneration();
        const result = await this._queue.enqueue({
          body,
          itemCount: 1,
          bodyBytes: body.byteLength,
          nextAttemptAt: Date.now(),
          kind: "client_report",
        });
        if (result.status === "queued") {
          this._clientReportQueueNeedsDrain = true;
          this._scheduleQueueDrain();
          return;
        }
        console.warn("Hexclave browser client report was dropped because the delivery queue is full", {
          signal: this._signal,
          generation,
          reason,
          quantity,
        });
      } catch (error) {
        console.warn("Hexclave browser client report could not be queued:", error);
      }
    });
    this._trackQueueWrite(task);
  }

  private _retryDelayMs(attempt: number, response: Response | undefined): number {
    const retryAfter = response?.headers.get("retry-after");
    const retryAfterDelay = parseRetryAfterDelay(retryAfter ?? null);
    if (retryAfterDelay !== null) return retryAfterDelay;
    const exponentialDelay = Math.min(OTLP_EXPORT_RETRY_MAX_DELAY_MS, OTLP_EXPORT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    return Math.floor(exponentialDelay * (0.5 + Math.random() * 0.5));
  }

  private async _readPartialSuccess(response: Response, deadline: number): Promise<{ rejectedItemCount: number, message?: string } | null> {
    if (!response.headers.get("content-type")?.toLowerCase().includes("json")) return null;
    const body = await withDeadline(response.text(), deadline, "OTLP response");
    if (body === "") return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
    if (parsed === null || typeof parsed !== "object") return null;
    const partialSuccessValue = "partialSuccess" in parsed
      ? parsed.partialSuccess
      : "partial_success" in parsed
        ? parsed.partial_success
        : undefined;
    if (partialSuccessValue === null || typeof partialSuccessValue !== "object") return null;
    const rejectedItemValue = "rejectedLogRecords" in partialSuccessValue
      ? partialSuccessValue.rejectedLogRecords
      : "rejectedSpans" in partialSuccessValue
        ? partialSuccessValue.rejectedSpans
        : undefined;
    const rejectedItemCount = typeof rejectedItemValue === "number"
      ? rejectedItemValue
      : typeof rejectedItemValue === "string" ? Number.parseInt(rejectedItemValue, 10) : NaN;
    if (!Number.isFinite(rejectedItemCount) || rejectedItemCount <= 0) return null;
    const message = "errorMessage" in partialSuccessValue && typeof partialSuccessValue.errorMessage === "string"
      ? partialSuccessValue.errorMessage
      : "error_message" in partialSuccessValue && typeof partialSuccessValue.error_message === "string"
        ? partialSuccessValue.error_message
        : undefined;
    return { rejectedItemCount: Math.floor(rejectedItemCount), ...(message === undefined ? {} : { message }) };
  }

  async shutdown(timeoutMs = this._shutdownDeadlineMs): Promise<void> {
    if (this._shutdownRequested) return;
    this._shutdownRequested = true;
    if (this._queueTimer !== null) clearTimeout(this._queueTimer);
    this._queueTimer = null;
    this._queueTimerAt = null;
    const result = await Result.fromPromise(this.forceFlush(timeoutMs));
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this._onlineHandler);
      window.removeEventListener("pagehide", this._pageHideHandler);
      window.removeEventListener("pageshow", this._pageShowHandler);
    }
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", this._visibilityChangeHandler);
    }
    this._queue.close();
    if (result.status === "error") {
      throw new Error("Hexclave browser OTLP exporter could not finish its bounded shutdown", { cause: result.error });
    }
  }

  async forceFlush(timeoutMs = this._flushDeadlineMs): Promise<void> {
    const deadline = elapsedDeadline(timeoutMs);
    const shouldDrainClientReports = this._clientReportQueueNeedsDrain || this._pendingQueueWrites.size > 0;
    try {
      await this._drainQueue(deadline);
      await this._waitForInFlight(deadline);
      await Promise.resolve();
      if (this._pendingQueueWrites.size > 0) {
        await withDeadline(Promise.all([...this._pendingQueueWrites]), deadline, "client report queue write");
      }
      if (shouldDrainClientReports || this._clientReportQueueNeedsDrain) await this._drainQueue(deadline);
    } finally {
      this._scheduleQueueDrain();
    }
  }
}

function browserOtlpHeadersFactory(options: HexclaveBrowserOtelExporterOptions): () => Promise<Record<string, string>> {
  return async () => ({
    ...await options.getRequestHeaders(),
    "x-hexclave-project-id": options.projectId,
    "x-hexclave-access-type": "client",
    "x-hexclave-client-version": options.clientVersion,
  });
}

export function createHexclaveBrowserOtlpTraceExporter(options: HexclaveBrowserOtelExporterOptions): SpanExporter & BrowserOtlpExporterControls {
  return new HexclaveBrowserOtlpJsonExporter<ReadableSpan[]>(
    JsonTraceSerializer,
    (spans) => spans.length,
    new URL(OTLP_TRACES_PATH, options.analyticsBaseUrl).toString(),
    browserOtlpHeadersFactory(options),
    "traces",
    options.onOutcome,
    createBrowserOtlpOfflineQueue(queueOptionsForExporter(options, "traces")),
    normalizedPositiveInteger(options.flushDeadlineMs, OTLP_FLUSH_DEADLINE_MS),
    normalizedPositiveInteger(options.shutdownDeadlineMs, OTLP_SHUTDOWN_DEADLINE_MS),
    new URL(CLIENT_REPORTS_PATH, options.analyticsBaseUrl).toString(),
    options.sendClientReports === true,
  );
}

export function createHexclaveBrowserOtlpLogExporter(options: HexclaveBrowserOtelExporterOptions): LogRecordExporter & BrowserOtlpExporterControls {
  return new HexclaveBrowserOtlpJsonExporter<ReadableLogRecord[]>(
    JsonLogsSerializer,
    (records) => records.length,
    new URL(OTLP_LOGS_PATH, options.analyticsBaseUrl).toString(),
    browserOtlpHeadersFactory(options),
    "logs",
    options.onOutcome,
    createBrowserOtlpOfflineQueue(queueOptionsForExporter(options, "logs")),
    normalizedPositiveInteger(options.flushDeadlineMs, OTLP_FLUSH_DEADLINE_MS),
    normalizedPositiveInteger(options.shutdownDeadlineMs, OTLP_SHUTDOWN_DEADLINE_MS),
    new URL(CLIENT_REPORTS_PATH, options.analyticsBaseUrl).toString(),
    options.sendClientReports === true,
  );
}

function metricDataPointCount(metricsData: ResourceMetrics): number {
  return metricsData.scopeMetrics.reduce(
    (scopeCount, scope) => scopeCount + scope.metrics.reduce((metricCount, metric) => metricCount + metric.dataPoints.length, 0),
    0,
  );
}

export function createHexclaveBrowserOtlpMetricExporter(options: HexclaveBrowserOtelExporterOptions): BrowserOtlpExporterControls & {
  export: (metricsData: ResourceMetrics, resultCallback: (result: ExportResult) => void) => void,
  forceFlush: (timeoutMs?: number) => Promise<void>,
  shutdown: (timeoutMs?: number) => Promise<void>,
} {
  return new HexclaveBrowserOtlpJsonExporter<ResourceMetrics>(
    JsonMetricsSerializer,
    metricDataPointCount,
    new URL(OTLP_METRICS_PATH, options.analyticsBaseUrl).toString(),
    browserOtlpHeadersFactory(options),
    "metrics",
    options.onOutcome,
    createBrowserOtlpOfflineQueue(queueOptionsForExporter(options, "metrics")),
    normalizedPositiveInteger(options.flushDeadlineMs, OTLP_FLUSH_DEADLINE_MS),
    normalizedPositiveInteger(options.shutdownDeadlineMs, OTLP_SHUTDOWN_DEADLINE_MS),
    new URL(CLIENT_REPORTS_PATH, options.analyticsBaseUrl).toString(),
    options.sendClientReports === true,
  );
}

function browserResourceAttributes(resource: TelemetryResource): Attributes {
  const attributes: Attributes = {
    [ATTR_SERVICE_NAME]: resource.service.name,
  };
  if (resource.service.namespace !== undefined) attributes[ATTR_SERVICE_NAMESPACE] = resource.service.namespace;
  if (resource.service.version !== undefined) attributes[ATTR_SERVICE_VERSION] = resource.service.version;
  if (resource.service.instanceId !== undefined) attributes["service.instance.id"] = resource.service.instanceId;
  if (resource.deploymentEnvironmentName !== undefined) attributes["deployment.environment.name"] = resource.deploymentEnvironmentName;
  for (const [key, value] of Object.entries(resource.attributes ?? {})) {
    if (
      key === ATTR_SERVICE_NAME
      || key === ATTR_SERVICE_NAMESPACE
      || key === ATTR_SERVICE_VERSION
      || key === "service.instance.id"
      || key === "deployment.environment.name"
    ) continue;
    if (value === null) continue;
    if (!Array.isArray(value)) {
      attributes[key] = value;
      continue;
    }
    const strings = value.filter((entry): entry is string => typeof entry === "string");
    const numbers = value.filter((entry): entry is number => typeof entry === "number");
    const booleans = value.filter((entry): entry is boolean => typeof entry === "boolean");
    const nonNullLength = value.filter((entry) => entry !== null).length;
    if (strings.length === nonNullLength) attributes[key] = strings;
    else if (numbers.length === nonNullLength) attributes[key] = numbers;
    else if (booleans.length === nonNullLength) attributes[key] = booleans;
    else attributes[key] = JSON.stringify(value);
  }
  return attributes;
}

type ManagedBrowserOtelRegistration = BrowserManagedOtelRegistration & {
  claim: (options: BrowserManagedOtelOptions) => number,
  enableHttpInstrumentationForOwner: (ownerId: number) => boolean,
};

// OTel providers are global within a browser page, but ClientAnalytics is an
// app-instance object. Keep one provider while handing each caller an owner
// view; otherwise a second same-project app instance silently reuses the first
// instance's ambient-context closure and bootstrap gate.
let browserRegistration: { signature: string, value: ManagedBrowserOtelRegistration } | null = null;

function registrationView(value: ManagedBrowserOtelRegistration, ownerId: number): BrowserManagedOtelRegistration {
  return {
    provider: value.provider,
    loggerProvider: value.loggerProvider,
    meterProvider: value.meterProvider,
    forceFlush: value.forceFlush,
    flushBeforeAuthenticationChange: async () => {
      const nextRegistration = await value.flushBeforeAuthenticationChange();
      // A successful auth rotation keeps the same provider. Preserve the
      // owner guard when handing it back; returning the internal registration
      // would let an older ClientAnalytics instance enable the active owner's
      // HTTP instrumentation after a later app instance claimed the provider.
      return nextRegistration === value ? registrationView(value, ownerId) : nextRegistration;
    },
    getOutcomeCounts: value.getOutcomeCounts,
    enableHttpInstrumentation: () => value.enableHttpInstrumentationForOwner(ownerId),
    updatePropagationPolicy: value.updatePropagationPolicy,
    shutdown: value.shutdown,
  };
}

function registrationSignature(options: BrowserManagedOtelOptions): string {
  return JSON.stringify({
    url: new URL(OTLP_TRACES_PATH, options.analyticsBaseUrl).toString(),
    projectId: options.projectId,
    resource: options.resource,
    traceSampleRate: options.traceSampleRate,
  });
}

export function registerManagedBrowserOtel(options: BrowserManagedOtelOptions): BrowserManagedOtelRegistration {
  const signature = registrationSignature(options);
  if (browserRegistration !== null) {
    if (browserRegistration.signature !== signature) {
      throw new Error("Hexclave browser OpenTelemetry is already configured for a different project or resource on this page");
    }
    const ownerId = browserRegistration.value.claim(options);
    return registrationView(browserRegistration.value, ownerId);
  }

  let activeOptions = options;
  let ambientContextGetter = options.getAmbientOtelContext;
  let activeOwnerId = 1;
  const outcomeCounts = new Map<string, number>();
  const recordOutcome = (outcome: BrowserOtlpDeliveryOutcome): void => {
    const key = `${outcome.signal}:${outcome.outcome}:${outcome.reason}`;
    outcomeCounts.set(key, (outcomeCounts.get(key) ?? 0) + 1);
    activeOptions.onOutcome?.(outcome);
  };
  const exporterOptions: HexclaveBrowserOtelExporterOptions = {
    analyticsBaseUrl: activeOptions.analyticsBaseUrl,
    projectId: activeOptions.projectId,
    clientVersion: activeOptions.clientVersion,
    getRequestHeaders: async () => await activeOptions.getRequestHeaders(),
    onOutcome: recordOutcome,
    offlineQueue: activeOptions.offlineQueue,
    flushDeadlineMs: activeOptions.flushDeadlineMs,
    shutdownDeadlineMs: activeOptions.shutdownDeadlineMs,
    sendClientReports: true,
  };

  // Access tokens rotate. The exporter resolves the header factory for each
  // HTTP export, so a long-lived page never freezes construction-time
  // credentials into its telemetry transport.
  const exporter = createHexclaveBrowserOtlpTraceExporter(exporterOptions);
  const logExporter = createHexclaveBrowserOtlpLogExporter(exporterOptions);
  const metricExporter = createHexclaveBrowserOtlpMetricExporter(exporterOptions);
  const resource = resourceFromAttributes(browserResourceAttributes(options.resource));
  const provider = new WebTracerProvider({
    resource,
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(options.traceSampleRate) }),
    spanProcessors: [createHexclaveBrowserCorrelationSpanProcessor(), new OpenSystemSpanSnapshotProcessor(exporter), new BatchSpanProcessor(exporter)],
  });
  if (!trace.setGlobalTracerProvider(provider)) {
    ignoreUnhandledRejection(provider.shutdown());
    throw new Error("Hexclave could not install its managed browser OpenTelemetry provider because another global provider is already registered. Use observability.openTelemetry.provider = \"existing-provider\" and configure that provider explicitly.");
  }
  const contextManager = new AmbientBaseStackContextManager(() => ambientContextGetter()).enable();
  if (!context.setGlobalContextManager(contextManager)) {
    ignoreUnhandledRejection(provider.shutdown());
    trace.disable();
    contextManager.disable();
    throw new Error("Hexclave installed its browser tracer provider but could not install its OTel context manager");
  }
  const propagator = new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  });
  if (!propagation.setGlobalPropagator(propagator)) {
    ignoreUnhandledRejection(provider.shutdown());
    trace.disable();
    context.disable();
    contextManager.disable();
    throw new Error("Hexclave installed its browser tracer provider but could not install the W3C trace context and baggage propagator");
  }

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor({ exporter: logExporter })],
  });
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: normalizedPositiveInteger(options.metricExportIntervalMillis, OTLP_METRIC_EXPORT_INTERVAL_MS),
  });
  const meterProvider = new MeterProvider({ resource, readers: [metricReader] });
  if (!metrics.setGlobalMeterProvider(meterProvider)) {
    ignoreUnhandledRejection(loggerProvider.shutdown());
    ignoreUnhandledRejection(provider.shutdown());
    ignoreUnhandledRejection(meterProvider.shutdown());
    trace.disable();
    context.disable();
    propagation.disable();
    contextManager.disable();
    throw new Error("Hexclave installed its browser tracer and logger providers but could not install its managed OpenTelemetry MeterProvider because another global meter provider is already registered. Configure that provider with Hexclave's OTLP endpoint instead of enabling managed mode.");
  }
  if (logs.setGlobalLoggerProvider(loggerProvider) !== loggerProvider) {
    ignoreUnhandledRejection(loggerProvider.shutdown());
    ignoreUnhandledRejection(provider.shutdown());
    ignoreUnhandledRejection(meterProvider.shutdown());
    metrics.disable();
    trace.disable();
    context.disable();
    propagation.disable();
    contextManager.disable();
    throw new Error("Hexclave installed its browser tracer provider but could not install its managed OpenTelemetry LoggerProvider");
  }

  // One factory for construction AND setConfig (which replaces the whole
  // config, so every field must be repeated there). Resource-timing span
  // events (fetchStart, domainLookupStart, …, responseEnd) are suppressed:
  // the product UI never surfaces them, the request span's own interval
  // already carries the duration, and at up to nine rows per request they
  // would be the bulk of span_events volume.
  const httpMetricRecorder = new OtlpHttpMetricRecorder(meterProvider.getMeter("@hexclave/browser-http", options.clientVersion));
  const httpInstrumentationConfig = () => ({
    ignoreUrls: networkIgnorePatterns(activeOptions),
    propagateTraceHeaderCorsUrls: propagationPatterns(activeOptions),
    ignoreNetworkEvents: true,
  });
  const fetchInstrumentation = new FetchInstrumentation({
    ...httpInstrumentationConfig(),
    requestHook: (span, request) => httpMetricRecorder.start(span, request),
    applyCustomAttributesOnSpan: (span, _request, result) => {
      httpMetricRecorder.end(span, result.status, "message" in result ? "fetch_error" : undefined);
    },
  });
  const xhrInstrumentation = typeof XMLHttpRequest === "function"
    ? new XMLHttpRequestInstrumentation(httpInstrumentationConfig())
    : null;
  const instrumentations: Instrumentation[] = [fetchInstrumentation];
  if (xhrInstrumentation !== null) instrumentations.push(xhrInstrumentation);
  let httpInstrumentationEnabled = false;
  let disableInstrumentations: (() => void) | null = null;
  const setHttpInstrumentationEnabled = (enabled: boolean): boolean => {
    if (enabled === httpInstrumentationEnabled) return false;
    if (!enabled) {
      disableInstrumentations?.();
      disableInstrumentations = null;
      httpInstrumentationEnabled = false;
      return true;
    }
    if (httpInstrumentationEnabled) return false;
    disableInstrumentations = registerInstrumentations({
      instrumentations,
      tracerProvider: provider,
    });
    // registerInstrumentations intentionally skips enable() when an
    // instrumentation's config is already enabled. That is normally correct
    // for one-shot setup, but this provider can be gated and later rebound;
    // explicitly enabling makes the false -> true transition reliable after
    // a prior owner disabled the hooks.
    for (const instrumentation of instrumentations) instrumentation.enable();
    httpInstrumentationEnabled = true;
    return true;
  };
  setHttpInstrumentationEnabled(options.installHttpInstrumentationImmediately !== false);
  const updatePropagationPolicy = (): void => {
    fetchInstrumentation.setConfig(httpInstrumentationConfig());
    xhrInstrumentation?.setConfig(httpInstrumentationConfig());
  };

  const claim = (nextOptions: BrowserManagedOtelOptions): number => {
    activeOptions = nextOptions;
    ambientContextGetter = nextOptions.getAmbientOtelContext;
    activeOwnerId += 1;
    setHttpInstrumentationEnabled(nextOptions.installHttpInstrumentationImmediately !== false);
    updatePropagationPolicy();
    return activeOwnerId;
  };

  const value: ManagedBrowserOtelRegistration = {
    provider,
    loggerProvider,
    meterProvider,
    forceFlush: async (timeoutMs) => {
      const timeout = normalizedPositiveInteger(timeoutMs, normalizedPositiveInteger(options.flushDeadlineMs, OTLP_FLUSH_DEADLINE_MS));
      await withDeadline(Promise.all([
        provider.forceFlush(),
        loggerProvider.forceFlush(),
        meterProvider.forceFlush(),
        exporter.forceFlush(timeout),
        logExporter.forceFlush(timeout),
        metricExporter.forceFlush(timeout),
      ]), elapsedDeadline(timeout), "managed browser OTLP forceFlush");
    },
    getOutcomeCounts: () => new Map(outcomeCounts),
    enableHttpInstrumentation: () => setHttpInstrumentationEnabled(true),
    enableHttpInstrumentationForOwner: (ownerId) => ownerId === activeOwnerId && setHttpInstrumentationEnabled(true),
    claim,
    flushBeforeAuthenticationChange: async () => {
      const flushResult = await Result.fromPromise(value.forceFlush(normalizedPositiveInteger(options.flushDeadlineMs, OTLP_FLUSH_DEADLINE_MS)));
      const advanceGeneration = async () => await Result.fromPromise(Promise.all([
        exporter.advanceAuthGeneration(),
        logExporter.advanceAuthGeneration(),
        metricExporter.advanceAuthGeneration(),
      ]).then(() => undefined));
      if (flushResult.status === "ok") {
        const generationResult = await advanceGeneration();
        if (generationResult.status === "error") {
          throw new Error("Hexclave could not advance browser telemetry authentication generation", {
            cause: generationResult.error,
          });
        }
        return value;
      }

      const generationResult = await advanceGeneration();
      if (generationResult.status === "error") {
        throw new Error("Hexclave could not isolate queued browser telemetry before authentication rotation", {
          cause: generationResult.error,
        });
      }

      // A failed flush may leave BatchSpanProcessor entries queued. Reusing
      // that processor after credentials rotate could authenticate old-user
      // spans as the next user, so retire the entire provider before allowing
      // the auth transition to continue.
      const shutdownTimeout = normalizedPositiveInteger(options.shutdownDeadlineMs, OTLP_SHUTDOWN_DEADLINE_MS);
      removeLifecycleListeners();
      const shutdownResult = await Result.fromPromise(withDeadline(
        Promise.all([provider.shutdown(), loggerProvider.shutdown(), meterProvider.shutdown()]),
        elapsedDeadline(shutdownTimeout),
        "authentication rotation shutdown",
      ));
      contextManager.disable();
      trace.disable();
      context.disable();
      propagation.disable();
      logs.disable();
      metrics.disable();
      if (shutdownResult.status === "error") {
        throw new Error("Hexclave could not safely rotate browser telemetry authentication after an OTel flush failure", {
          cause: shutdownResult.error,
        });
      }
      browserRegistration = null;
      console.warn("Hexclave browser OpenTelemetry flush failed during authentication rotation; the provider was replaced so buffered spans cannot cross users.", flushResult.error);
      return registerManagedBrowserOtel(activeOptions);
    },
    updatePropagationPolicy,
    shutdown: async (timeoutMs) => {
      disableInstrumentations?.();
      const timeout = normalizedPositiveInteger(timeoutMs, normalizedPositiveInteger(options.shutdownDeadlineMs, OTLP_SHUTDOWN_DEADLINE_MS));
      const shutdownResult = await Result.fromPromise(withDeadline(
        Promise.all([provider.shutdown(), loggerProvider.shutdown(), meterProvider.shutdown()]),
        elapsedDeadline(timeout),
        "managed browser OTLP shutdown",
      ));
      contextManager.disable();
      if (shutdownResult.status === "error") {
        throw new Error("Hexclave could not finish its bounded browser telemetry shutdown", {
          cause: shutdownResult.error,
        });
      }
    },
  };

  // The exporter-level lifecycle hook can only drain batches that have already
  // left the OTel processors. Flush the managed providers as well so a hidden
  // or bfcache-bound page does not suspend with records still buffered in the
  // BatchLogRecordProcessor/BatchSpanProcessor.
  const lifecycleFlush = (): void => {
    queueMicrotask(() => ignoreUnhandledRejection(value.forceFlush(OTLP_UNLOAD_DEADLINE_MS)));
  };
  const visibilityChangeHandler = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") lifecycleFlush();
  };
  const pageHideHandler = (): void => lifecycleFlush();
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", visibilityChangeHandler);
  }
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("pagehide", pageHideHandler);
  }
  const removeLifecycleListeners = (): void => {
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", visibilityChangeHandler);
    }
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("pagehide", pageHideHandler);
    }
  };
  const shutdown = value.shutdown;
  value.shutdown = async (timeoutMs) => {
    removeLifecycleListeners();
    await shutdown(timeoutMs);
  };
  browserRegistration = { signature, value };
  return registrationView(value, activeOwnerId);
}

export async function resetManagedBrowserOtelForTesting(): Promise<void> {
  if (browserRegistration !== null) await browserRegistration.value.shutdown();
  browserRegistration = null;
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
  logs.disable();
}
