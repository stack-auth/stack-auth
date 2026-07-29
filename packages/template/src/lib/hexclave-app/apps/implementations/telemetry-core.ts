import { ignoreUnhandledRejection } from "@hexclave/shared/dist/utils/promises";
import { CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES, CUSTOM_TELEMETRY_MAX_PARENT_CHAIN, CUSTOM_TELEMETRY_NAME_RE, TELEMETRY_UUID_RE } from "@hexclave/shared/dist/utils/analytics-wire";
import { runWithSpanContext } from "./span-context";
// Runtime-safe: span-propagation only imports TYPES from this package's
// telemetry modules, so this value import cannot create a runtime cycle.
import { mergeParentSpanPath, type ParentSpanPathPart } from "./span-propagation";

/**
 * Environment-independent core of the custom telemetry API: the public types
 * (Span & friends), input validation, parent-path resolution, and the shared
 * withSpan() driver. Split out of event-tracker.ts so environments that never
 * ship the browser tracker (server bundles) — and browser bundles BEFORE the
 * lazily-loaded tracker module arrives — can validate input and build span
 * handles without pulling in ~1.5k lines of autocapture code. event-tracker.ts
 * re-exports everything here for compatibility.
 */

// Raw parent ids that fail this locally would 400 the entire batch
// server-side, so they must never enter the buffer. Hoisted to shared so the
// tracker, header codec, server buffer, and batch route validate identically.
const UUID_RE = TELEMETRY_UUID_RE;

/**
 * Serializable form of a span's identity + full custom ancestor chain. Survives
 * JSON boundaries (page props, headers), so a span started on one tier can be
 * continued as a parent on another with full ancestry — unlike a bare uuid
 * string, which contributes only itself.
 */
export type SpanRef = {
  spanId: string,
  parentSpanIds: string[],
};

/**
 * Anything accepted as a parent: a raw span uuid (contributes only itself — its
 * ancestors are unknowable), a serialized SpanRef, or a live Span handle (both
 * contribute their full ancestor chain plus themselves).
 */
export type ParentRef = string | SpanRef | Span;

export type TrackOptions = {
  parentIds?: ParentRef[],
  /**
   * Drop ALL ambient parents (global spans + enclosing withSpan context); only
   * explicit parentIds apply. This is the opt-out for ambient parenting.
   */
  root?: boolean,
  /**
   * Drop specific parent span ids from the FINAL merged parent list, after both
   * ambient parents and explicit `parentIds` have been expanded. This can remove
   * an explicit parent too; e.g. `{ parentIds: [span], excludeParentIds: [span] }`
   * produces no parent for `span`. An excluded span stays excluded even when it
   * re-enters via a kept child's frozen chain, which means "descendants of the
   * excluded span" queries will not match this item (by design; that is the
   * literal meaning of the option, not a dedupe bug).
   */
  excludeParentIds?: ParentRef[],
};

export type StartSpanOptions = {
  data?: Record<string, unknown>,
  parentIds?: ParentRef[],
  startedAtMs?: number,
  /** See TrackOptions.root. */
  root?: boolean,
  /** See TrackOptions.excludeParentIds. */
  excludeParentIds?: ParentRef[],
};

/**
 * A custom span: a time interval written to analytics as an open interval on
 * start and re-written (versioned upsert) on setData/end. A span that is never
 * ended — e.g. the tab closed — stays visible as an open interval by design.
 *
 * Returned promises resolve when the batch containing the update is acknowledged
 * and reject on definitive send failure. Methods validate their arguments and
 * may throw before creating an update.
 */
export type Span = {
  readonly spanId: string,
  readonly spanType: string,
  readonly isEnded: boolean,
  /** Shallow-merges into the span's data and re-writes the span. */
  setData(data: Record<string, unknown>): Promise<void>,
  /** Idempotent; repeated calls return the first call's promise. */
  end(options?: { endedAtMs?: number }): Promise<void>,
  /** Tracks an event with this span (and its full ancestor chain) as a parent. */
  trackEvent(eventType: string, data?: Record<string, unknown>, options?: TrackOptions): Promise<void>,
  /** Starts a child span of this span. */
  startSpan(spanType: string, options?: StartSpanOptions): Span,
  /**
   * Runs `fn` inside a child span of this span (auto-ends, records errors —
   * same contract as the app-level withSpan). The HANDLE-based nesting path:
   * parentage comes from this span, not ambient context, so it is exact in
   * every environment and under any concurrency.
   */
  withSpan<T>(spanType: string, fn: (span: Span) => Promise<T> | T): Promise<T>,
  withSpan<T>(spanType: string, options: StartSpanOptions, fn: (span: Span) => Promise<T> | T): Promise<T>,
  /**
   * Re-enters this span as an ambient parent for `fn` — the manual-rebind
   * primitive for post-await code, timers, and third-party callbacks. Under an
   * exact async-context primitive (server today, browsers once AsyncContext
   * ships) the context covers `fn`'s full async extent; on the browser fallback
   * it is exact for `fn`'s synchronous window. Always returns a promise because
   * the first server call may need to initialize the async-context primitive.
   */
  run<T>(fn: () => T): Promise<Awaited<T>>,
  /**
   * The cross-tier propagation headers pinned to exactly this span (and its
   * frozen ancestor chain) — for transports the SDK cannot instrument (XHR,
   * sendBeacon, WebSocket handshakes). Setting this header on a fetch also
   * overrides the automatic ambient one.
   */
  getSpanPropagationHeaders(): Record<string, string>,
  /**
   * `fetch` with the propagation header pinned to exactly this span, so the
   * backend span opened by `withSpan({ request })` nests under it — immune to
   * ambient-context ambiguity. Follows the same same-origin/allowlist policy as
   * the automatic wrapper and never overwrites an explicitly-set header.
   */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>,
  /** Serializable identity + full custom ancestor chain (see SpanRef). */
  ref(): SpanRef,
};

export type SpanUpdateRow = {
  span_id: string,
  span_type: string,
  started_at_ms: number,
  ended_at_ms: number | null,
  parent_span_ids: string[],
  data: Record<string, unknown>,
  updated_at_ms: number,
  // The `$page-view` span this span happened on (raw uuid). Client tab state
  // the server cannot derive — composed into system ancestry server-side (with
  // the pv- prefix). Frozen at span creation; never set on $page-view rows.
  page_view_span_id?: string,
  // The `$http-client` span of the request that carried this item to the
  // server (raw uuid; hc- prefix applied by the ingestion route, AFTER the
  // custom chain). Only ever set by the SERVER telemetry buffer, and only on
  // items whose custom chain came entirely from the propagation header — the
  // nearest-known-ancestor contract; see httpClientSpanIdForServerItem in
  // server-app-impl. Never set on $page-view or $http-client rows.
  http_client_span_id?: string,
};

// Keep fire-and-forget telemetry from becoming an unhandled rejection while
// returning the original promise so callers that await it still observe failure.
export function preCaught<T>(promise: Promise<T>): Promise<T> {
  ignoreUnhandledRejection(promise);
  return promise;
}

export function rejectedPreCaught(message: string): Promise<never> {
  return preCaught(Promise.reject(new Error(`Hexclave analytics: ${message}`)));
}

export function registerTelemetryBackgroundTask(
  registerBackgroundTask: ((promise: Promise<unknown>) => void) | undefined,
  promise: Promise<unknown>,
  source: string,
): void {
  if (registerBackgroundTask === undefined) return;
  try {
    registerBackgroundTask(promise);
  } catch (error) {
    console.warn(`Hexclave analytics: ${source} waitUntil hook failed:`, error);
  }
}

/**
 * Default serverless keep-alive hook, used when `TelemetryOptions.waitUntil`
 * is not set: on Vercel, un-awaited telemetry sends are killed at response
 * teardown, silently dropping batches — the worst kind of misconfiguration
 * (no error, just missing data). Vercel exposes the active request context
 * under a well-known global symbol (the same contract `@vercel/functions`'
 * `waitUntil` reads), so we can wire it without a dependency. The lookup runs
 * PER SEND — the context is request-scoped, so resolving it once at
 * construction would pin the first request's context (or none). Off Vercel
 * the symbol is absent and this is a no-op, which is why an explicit
 * `waitUntil` stays the way to wire platforms whose context is handed to the
 * handler instead of being globally discoverable (e.g. Cloudflare's
 * `ctx.waitUntil`).
 */
export function autoDetectedBackgroundTaskHook(promise: Promise<unknown>): void {
  // Untyped platform contract: Vercel publishes no types for this seam, so
  // every step is narrowed before use — a shape change degrades to a no-op,
  // never a throw into the telemetry path.
  const holder = (globalThis as Record<symbol, unknown>)[Symbol.for("@vercel/request-context")];
  if (typeof holder !== "object" || holder === null) return;
  const get = (holder as { get?: unknown }).get;
  if (typeof get !== "function") return;
  let context: unknown;
  try {
    context = get.call(holder);
  } catch {
    return;
  }
  if (typeof context !== "object" || context === null) return;
  const waitUntil = (context as { waitUntil?: unknown }).waitUntil;
  if (typeof waitUntil !== "function") return;
  // A throwing waitUntil is handled by registerTelemetryBackgroundTask's
  // try/catch around the hook invocation.
  waitUntil.call(context, promise);
}

/** Guarded `process.env` access — no Node types in this package, and browser
 * runtimes may not define `process` at all (bundlers that shim it are covered
 * by the same path). */
export function getCustomTelemetryNameError(kind: "event" | "span", name: unknown): string | null {
  if (typeof name !== "string" || !CUSTOM_TELEMETRY_NAME_RE.test(name)) {
    return `Invalid custom ${kind} type ${JSON.stringify(name)}: must start with a letter, contain only letters, digits, "_", ".", ":" or "-", and be at most 64 characters ("$"-prefixed names are reserved for system telemetry)`;
  }
  return null;
}

export function getCustomTelemetryDataError(data: unknown): string | null {
  if (data === undefined) return null;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return "Telemetry data must be a plain JSON-serializable object";
  }
  let serialized: string | undefined;
  try {
    const stringified = JSON.stringify(data);
    serialized = typeof stringified === "string" ? stringified : undefined;
  } catch {
    return "Telemetry data must be JSON-serializable (no circular references or BigInt values)";
  }
  if (serialized === undefined || new TextEncoder().encode(serialized).length > CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES) {
    return `Telemetry data must serialize to at most ${CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES} bytes`;
  }
  return null;
}

// Moved to the shared wire-contract module so the backend's console log
// capture can bound bodies with the exact same truncation as the SDK.
// Re-exported here for compatibility with the existing SDK import sites.
export { truncateUtf8Bytes } from "@hexclave/shared/dist/utils/analytics-wire";

export function resolveEndedAtMs(startedAtMs: number, endedAtMs: number | undefined): number {
  const resolvedEndedAtMs = endedAtMs ?? Date.now();
  if (!Number.isInteger(resolvedEndedAtMs) || resolvedEndedAtMs < 0) {
    throw new Error("Hexclave analytics: endedAtMs must be a non-negative integer epoch-milliseconds value");
  }
  if (resolvedEndedAtMs < startedAtMs) {
    throw new Error("Hexclave analytics: endedAtMs must be greater than or equal to startedAtMs");
  }
  return resolvedEndedAtMs;
}

/**
 * Validates the name/data/startedAtMs inputs of startSpan(), throwing the exact
 * errors every implementation must produce. Shared by the browser tracker, the
 * server-key path, and the non-browser inert path, so invalid input fails with
 * identical messages no matter where the span would have been recorded.
 */
export function assertValidSpanStartInput(spanType: string, options: StartSpanOptions | undefined): void {
  const nameError = getCustomTelemetryNameError("span", spanType);
  if (nameError) {
    throw new Error(`Hexclave analytics: ${nameError}`);
  }
  const dataError = getCustomTelemetryDataError(options?.data);
  if (dataError) {
    throw new Error(`Hexclave analytics: ${dataError}`);
  }
  if (options?.startedAtMs !== undefined && (!Number.isInteger(options.startedAtMs) || options.startedAtMs < 0)) {
    throw new Error("Hexclave analytics: startedAtMs must be a non-negative integer epoch-milliseconds value");
  }
}

/**
 * Merges ambient parents (e.g. global spans) and explicit ParentRefs into one
 * farthest-known-to-nearest-known path. Each Span/SpanRef contributes its full
 * frozen ancestor path plus itself, so incompatible branches are rejected
 * instead of flattened. Raw ids declare successive parents in array order
 * because no ancestry metadata exists for the SDK to verify.
 */
export function resolveParentIds(opts: {
  explicit?: ParentRef[],
  ambient?: SpanRef[],
  /** Ignore ambient parents entirely; only explicit ones apply. */
  root?: boolean,
  /**
   * Ids to drop from the FINAL merged list (each ParentRef contributes only its
   * own id here, not its chain) — see TrackOptions.excludeParentIds.
   */
  exclude?: ParentRef[],
}): { ids: string[] } | { error: string } {
  const parts: ParentSpanPathPart[] = [];
  if (!opts.root) {
    for (const ambient of opts.ambient ?? []) {
      parts.push({ kind: "known-path", ids: [...ambient.parentSpanIds, ambient.spanId] });
    }
  }
  for (const parent of opts.explicit ?? []) {
    if (typeof parent === "string") {
      parts.push({ kind: "declared-next", id: parent });
    } else {
      const ref = "ref" in parent && typeof parent.ref === "function" ? parent.ref() : parent as SpanRef;
      parts.push({ kind: "known-path", ids: [...ref.parentSpanIds, ref.spanId] });
    }
  }
  const excludeIds = new Set<string>();
  for (const excluded of opts.exclude ?? []) {
    const id = typeof excluded === "string"
      ? excluded
      : "ref" in excluded && typeof excluded.ref === "function" ? excluded.ref().spanId : (excluded as SpanRef).spanId;
    if (!UUID_RE.test(id)) {
      return { error: `Invalid excluded parent span id ${JSON.stringify(id)}: excludeParentIds must be span uuids` };
    }
    excludeIds.add(id);
  }
  for (const part of parts) {
    const ids = part.kind === "known-path" ? part.ids : [part.id];
    for (const id of ids) {
      if (!UUID_RE.test(id)) {
        return { error: `Invalid parent span id ${JSON.stringify(id)}: parent ids must be span uuids` };
      }
    }
  }
  const mergedResult = mergeParentSpanPath(parts);
  if ("error" in mergedResult) return mergedResult;
  const merged = mergedResult.ids.filter((id) => !excludeIds.has(id));
  if (merged.length > CUSTOM_TELEMETRY_MAX_PARENT_CHAIN) {
    console.warn(`Hexclave analytics: parent chain exceeds ${CUSTOM_TELEMETRY_MAX_PARENT_CHAIN} spans; keeping the ${CUSTOM_TELEMETRY_MAX_PARENT_CHAIN} nearest ancestors`);
    return { ids: merged.slice(-CUSTOM_TELEMETRY_MAX_PARENT_CHAIN) };
  }
  return { ids: merged };
}

/**
 * Shared implementation of withSpan(): starts the span (parents come from the
 * ENCLOSING context, not itself), runs `fn` with the span as an ambient parent
 * for everything created inside, auto-ends on settle, and on throw records
 * `data.error` and rethrows. Telemetry delivery remains off the callback's
 * critical path, so the caller's result is never blocked on an analytics ack.
 */
export async function withSpanImpl<T>(
  startSpan: (spanType: string, options?: StartSpanOptions) => Span,
  spanType: string,
  optionsOrFn: StartSpanOptions | ((span: Span) => Promise<T> | T),
  maybeFn?: (span: Span) => Promise<T> | T,
): Promise<T> {
  const options = typeof optionsOrFn === "function" ? undefined : optionsOrFn;
  const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
  if (typeof fn !== "function") {
    return await rejectedPreCaught("withSpan() requires a callback function");
  }
  const span = startSpan(spanType, options);
  return await runWithSpanContext(span.ref(), async () => {
    try {
      const result = await fn(span);
      span.end().catch(() => {});
      return result;
    } catch (error) {
      // Order matters: the merge lands before the end row is enqueued, so the
      // single deduped wire row carries both the error and the end time.
      span.setData({ error: error instanceof Error ? error.message : String(error) }).catch(() => {});
      span.end().catch(() => {});
      throw error;
    }
  });
}
