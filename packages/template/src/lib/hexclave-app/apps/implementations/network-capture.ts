import { HTTP_CLIENT_SPAN_TYPE, generateW3cSpanId } from "@hexclave/shared/dist/utils/analytics-wire";
import { createSpanCore } from "./span-handle";
import type { SpanContext } from "./telemetry-core";

/**
 * Shared logic for `$http-client` spans — the bridge nodes of cross-tier
 * tracing (one span per outgoing HTTP request the SDK's fetch/XHR
 * instrumentation observes). Three call sites build on this module: the
 * browser EventTracker (post-load), the ClientAnalytics facade (pre-load
 * requests, adopted once the tracker arrives), and the server app's outbound
 * fetch instrumentation. Keeping the config semantics and the keep/drop state
 * machine here is what guarantees all three record identically.
 *
 * This module must stay small and autocapture-free: it is imported eagerly
 * (the fetch wrapper installs at app construction, before the lazily-loaded
 * tracker module arrives).
 */

/** User-facing network capture options (`ObservabilityOptions.network`). */
export type NetworkOptions = {
  /**
   * Whether outgoing fetch/XHR requests are recorded as `$http-client` spans.
   * Independent of `spanPropagation.enabled` (which controls only the header
   * attached to outgoing requests).
   *
   * @default true
   */
  enabled?: boolean,
  /**
   * `"all"` records every request (subject to `sampleRate`); `"errors-only"`
   * keeps only failures: status >= 400, network errors, and slow requests
   * (>= 3s).
   *
   * @default "all"
   */
  capture?: "all" | "errors-only",
  /**
   * @deprecated Use `observability.traceSampleRate`. This remains a
   * backwards-compatible alias, but sampling is applied to whole traces by the
   * SDK flusher rather than independently to network spans.
   *
   * @default 1
   */
  sampleRate?: number,
  /**
   * When set, only requests to these exact origins are recorded. Mutually
   * exclusive with `denyOrigins`.
   */
  allowOrigins?: string[],
  /**
   * Requests to these exact origins are never recorded. Mutually exclusive
   * with `allowOrigins`.
   */
  denyOrigins?: string[],
  /**
   * Requests whose full URL contains any of these substrings are never
   * recorded (checked against the raw URL, before query/hash stripping).
   */
  ignoreUrls?: string[],
};

/** Normalized (defaulted + validated) form of NetworkOptions. */
export type NetworkCaptureConfig = {
  enabled: boolean,
  capture: "all" | "errors-only",
  sampleRate: number,
  allowOrigins: readonly string[] | null,
  denyOrigins: readonly string[] | null,
  ignoreUrls: readonly string[],
};

/**
 * Validates + defaults the user's network options. Throws (at app
 * construction) on contradictory input instead of silently picking a winner.
 */
export function normalizeNetworkCaptureOptions(options: NetworkOptions | undefined): NetworkCaptureConfig {
  if (options?.allowOrigins !== undefined && options.denyOrigins !== undefined) {
    throw new Error("Hexclave analytics: network.allowOrigins and network.denyOrigins are mutually exclusive; set at most one");
  }
  const sampleRate = options?.sampleRate ?? 1;
  if (typeof sampleRate !== "number" || !(sampleRate >= 0 && sampleRate <= 1)) {
    throw new Error("Hexclave analytics: network.sampleRate must be a number between 0 and 1");
  }
  return {
    enabled: options?.enabled ?? true,
    capture: options?.capture ?? "all",
    sampleRate,
    allowOrigins: options?.allowOrigins ?? null,
    denyOrigins: options?.denyOrigins ?? null,
    ignoreUrls: options?.ignoreUrls ?? [],
  };
}

/**
 * The URL as stored in span data: origin + pathname only. Query strings and
 * hashes routinely carry tokens/PII, and `URL.origin` already excludes
 * userinfo — so the stored value can never leak credentials embedded in the
 * request URL. Returns null for non-http(s) or unparseable targets (those are
 * never recorded).
 */
export function sanitizeHttpClientUrl(url: string, base?: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return `${parsed.origin}${parsed.pathname}`;
}

/** Whether the origin/URL filters admit this request (enabled is checked too). */
export function shouldCaptureNetworkRequest(config: NetworkCaptureConfig, target: URL): boolean {
  if (!config.enabled) return false;
  if (config.allowOrigins !== null && !config.allowOrigins.includes(target.origin)) return false;
  if (config.denyOrigins !== null && config.denyOrigins.includes(target.origin)) return false;
  for (const ignored of config.ignoreUrls) {
    if (ignored !== "" && target.href.includes(ignored)) return false;
  }
  return true;
}

// Requests at/above this duration are always kept (a slow dependency is a
// signal even when it eventually succeeds).
export const SLOW_REQUEST_ALWAYS_KEEP_MS = 3_000;

// Hard cap on `$http-client` spans per page view: a polling/streaming page
// must not grind out unbounded telemetry volume.
export const HTTP_CLIENT_SPANS_PER_PAGE_VIEW_CAP = 500;

export type HttpRequestSpanOutcome = {
  /** Response status; omit when the request never produced response headers. */
  status?: number,
  errored: boolean,
  aborted: boolean,
  /** Set by the wrapper when this span's context actually rode the outgoing
   * `traceparent` — i.e. the backend could join this trace. Recorded as
   * `propagated: 1` in the span data so readers can tell cross-tier requests from
   * local-only ones. */
  propagated?: boolean,
};

export type HttpRequestSpanHandle = {
  spanContext: SpanContext,
  /**
   * Whether the outgoing request may name this span as its parent. This is true
   * only when the span is guaranteed-keep and already owned by a live delivery
   * buffer; otherwise propagation would create a parent id that can never be
   * fetched from the receiving project's trace.
   */
  propagate: boolean,
  end: (outcome: HttpRequestSpanOutcome) => void,
  /** Sign-out privacy switch — same contract as SpanCore.markInert. */
  markInert: () => void,
};

export type BeginHttpClientSpanOptions = {
  config: NetworkCaptureConfig,
  /** The shared trace-level head decision made before propagation. */
  sampled: boolean,
  /** Already sanitized (origin + pathname) — see sanitizeHttpClientUrl. */
  sanitizedUrl: string,
  method: string,
  transport: "fetch" | "xhr",
  /** The trace this fetch belongs to; a root fetch mints its own. */
  traceId: string,
  parentSpanId: string | null,
  pageViewSpanId: string | null,
  enqueueRow: Parameters<typeof createSpanCore>[0]["enqueueRow"],
  /**
   * False while the lazy browser tracker has not loaded. Pre-load rows can be
   * discarded during sign-in rotation before they ever reach a delivery buffer,
   * so they must not be promised as remote parents.
   */
  propagationEligible?: boolean,
  isSuppressed?: () => boolean,
  onEnded?: () => void,
};

/**
 * Opens one `$http-client` span on the shared span state machine.
 *
 * Sampling deliberately does NOT live here. `opts.sampled` is the deterministic
 * trace decision shared with the SDK flusher; this module owns only the
 * network-specific capture policy:
 *
 * - Under `capture: "all"`, the open row is enqueued immediately. The shared
 *   flusher later keeps or drops its complete trace group.
 * - Under `capture: "errors-only"`, NO row is written until end time, when the
 *   span is kept only if the outcome is in the always-keep class (status >=
 *   400, network error, or duration >= 3s). Deferred-first-write trade-off,
 *   accepted deliberately:
 *   the versioned-upsert model has no tombstones (a written open row could
 *   never be retracted), so maybe-keep spans appear only at end time — and a
 *   maybe-keep request still in flight at tab close is lost entirely.
 * - Aborted requests are NOT in the always-keep class (unless slow): SPA data
 *   layers cancel superseded requests routinely, so treating aborts as
 *   failures would flood errors-only capture with noise.
 */
export function beginHttpClientSpanCore(opts: BeginHttpClientSpanOptions): HttpRequestSpanHandle {
  const eagerCapture = opts.config.capture === "all";
  // While false, rows are swallowed (the deferred first write). The final
  // setData+end rows carry the full accumulated state, so nothing needs to be
  // replayed when the decision flips to keep at end time.
  let keepDecided = eagerCapture;
  const startedAtPerf = performance.now();

  const core = createSpanCore({
    traceId: opts.traceId,
    spanId: generateW3cSpanId(),
    spanType: HTTP_CLIENT_SPAN_TYPE,
    startedAtMs: Date.now(),
    parentSpanId: opts.parentSpanId,
    pageViewSpanId: opts.pageViewSpanId,
    initialData: { method: opts.method, url: opts.sanitizedUrl, transport: opts.transport },
    // System span: callers are internal, and validation could only drop data
    // the wire format actually accepts.
    validateData: null,
    isSuppressed: opts.isSuppressed,
    enqueueRow: (row) => {
      if (!keepDecided) return Promise.resolve();
      return opts.enqueueRow(row);
    },
    onEnded: opts.onEnded,
  });

  return {
    spanContext: core.spanContext(),
    propagate: eagerCapture && opts.sampled && (opts.propagationEligible ?? true),
    markInert: core.markInert,
    end: (outcome) => {
      if (core.isEnded()) return;
      const durationMs = performance.now() - startedAtPerf;
      const alwaysKeep = (outcome.status !== undefined && outcome.status >= 400)
        || (outcome.errored && !outcome.aborted)
        || durationMs >= SLOW_REQUEST_ALWAYS_KEEP_MS;
      if (keepDecided || alwaysKeep) {
        keepDecided = true;
      } else {
        // Dropped: never written, and the end rows below are swallowed too.
        core.markInert();
      }
      // setData before end, so the single coalesced wire row (updates within
      // one flush window dedupe per span id) carries outcome and end together.
      core.setData({
        ...outcome.status !== undefined ? { status: outcome.status } : {},
        ...outcome.errored ? { error: 1 } : {},
        ...outcome.aborted ? { aborted: 1 } : {},
        ...outcome.propagated ? { propagated: 1 } : {},
      }).catch(() => {});
      core.end(undefined).catch(() => {});
    },
  };
}
