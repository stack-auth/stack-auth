import { isBrowserLike } from "@hexclave/shared/dist/utils/env";
import { CLICKMAP_ROOT_ID, DEV_TOOL_ROOT_ID } from "@hexclave/shared/dist/utils/dev-tool";
import { cssEscapeIdent } from "@hexclave/shared/dist/utils/dom";
import { buildElementsChain, ELEMENTS_CHAIN_MAX_DEPTH } from "@hexclave/shared/dist/utils/elements-chain";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { Result } from "@hexclave/shared/dist/utils/results";
import { CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES, CUSTOM_TELEMETRY_MAX_PARENT_CHAIN, CUSTOM_TELEMETRY_NAME_RE, type ClientSystemSpanType, type SystemEventType } from "@hexclave/shared/dist/utils/telemetry";
import { generateUuid, isAdBlockerNetworkError, isAnalyticsNotEnabledError } from "./session-replay";
import { getAmbientSpanRefs, runWithSpanContext, runWithSpanFrame } from "./span-context";
// Runtime-safe: span-propagation only imports TYPES from this module.
import { buildFetchInitWithSpanContext, encodeSpanContextHeader, SPAN_CONTEXT_HEADER, type SpanPropagationContext } from "./span-propagation";
import { startWebVitalsCollector, type WebVitalsCollector } from "./web-vitals";

const FLUSH_INTERVAL_MS = 10_000;
const MAX_EVENTS_PER_BATCH = 50;
const MAX_APPROX_BYTES_PER_BATCH = 64_000;

// ---------------------------------------------------------------------------
// Custom telemetry (public trackEvent/startSpan API)
// ---------------------------------------------------------------------------

// Mirrors the server's UUID_RE — raw parent ids that fail this locally would
// 400 the entire batch server-side, so they must never enter the buffer.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
 * and reject on definitive send failure; they are pre-caught internally, so
 * ignoring them never causes unhandled-rejection noise. No method throws.
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
  getPropagationHeaders(): Record<string, string>,
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
};

type Settler = {
  resolve: () => void,
  reject: (error: unknown) => void,
};

// Subscribing an internal no-op handler means an ignored rejection never counts
// as "unhandled" (the runtime only reports rejected promises with zero
// subscribers), while callers who do await still observe it through their own
// handler. This is what makes fire-and-forget usage safe.
export function preCaught<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}

export function rejectedPreCaught(message: string): Promise<never> {
  console.error(`Hexclave analytics: ${message}`);
  return preCaught(Promise.reject(new Error(message)));
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

let warnedTelemetryUnavailable = false;
export function warnTelemetryUnavailableOnce(): void {
  if (warnedTelemetryUnavailable) return;
  warnedTelemetryUnavailable = true;
  console.warn("Hexclave analytics: trackEvent/startSpan called where analytics is unavailable (non-browser environment, no persistent token store, or analytics disabled); telemetry is dropped");
}

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

export function resolveEndedAtMs(startedAtMs: number, endedAtMs: number | undefined): number {
  const rawEndedAtMs = endedAtMs ?? Date.now();
  if (!Number.isFinite(rawEndedAtMs)) {
    console.error("Hexclave analytics: endedAtMs must be a finite epoch-milliseconds value; using the current time instead");
    return Math.max(startedAtMs, Date.now());
  }
  return Math.max(startedAtMs, Math.round(rawEndedAtMs));
}

/**
 * Merges ambient parents (e.g. global spans) and explicit ParentRefs into one
 * root-first, deduped id chain. Each Span/SpanRef contributes its full frozen
 * ancestor chain plus itself; a raw string uuid contributes only itself.
 * Root-first order is preserved because every contributor is itself root-first
 * and first-occurrence dedupe keeps the earliest (root-most) position.
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
  const chains: string[][] = [];
  if (!opts.root) {
    for (const ambient of opts.ambient ?? []) {
      chains.push([...ambient.parentSpanIds, ambient.spanId]);
    }
  }
  for (const parent of opts.explicit ?? []) {
    if (typeof parent === "string") {
      chains.push([parent]);
    } else {
      const ref = "ref" in parent && typeof parent.ref === "function" ? parent.ref() : parent as SpanRef;
      chains.push([...ref.parentSpanIds, ref.spanId]);
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
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const chain of chains) {
    for (const id of chain) {
      if (!UUID_RE.test(id)) {
        return { error: `Invalid parent span id ${JSON.stringify(id)}: parent ids must be span uuids` };
      }
      if (!seen.has(id) && !excludeIds.has(id)) {
        seen.add(id);
        merged.push(id);
      }
    }
  }
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
 * `data.error` and rethrows. Telemetry failures never fail `fn` — the end/
 * setData promises are pre-caught and intentionally not awaited, so the
 * caller's result is never blocked on an analytics ack.
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

/**
 * A Span that records nothing. Returned wherever analytics cannot run (SSR,
 * analytics disabled, tracker torn down) so isomorphic user code never needs to
 * branch: every method succeeds immediately.
 */
export function createInertSpan(spanType: string): Span {
  let ended = false;
  const span: Span = {
    spanId: generateUuid(),
    spanType,
    get isEnded() {
      return ended;
    },
    setData: () => Promise.resolve(),
    end: () => {
      ended = true;
      return Promise.resolve();
    },
    trackEvent: () => Promise.resolve(),
    startSpan: (childType: string) => createInertSpan(childType),
    withSpan: <T,>(childType: string, optionsOrFn: StartSpanOptions | ((child: Span) => Promise<T> | T), maybeFn?: (child: Span) => Promise<T> | T) =>
      withSpanImpl((type, opts) => span.startSpan(type, opts), childType, optionsOrFn, maybeFn),
    run: async <T,>(fn: () => T): Promise<Awaited<T>> => await fn(),
    getPropagationHeaders: () => ({}),
    // Still the caller's REAL request — only the telemetry is inert.
    fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
    ref: () => ({ spanId: span.spanId, parentSpanIds: [] }),
  };
  return span;
}

function hasScreenDimensions(value: unknown): value is { width: number, height: number } {
  if (value == null || typeof value !== "object") {
    return false;
  }
  if (!("width" in value) || !("height" in value)) {
    return false;
  }
  return typeof value.width === "number" && typeof value.height === "number";
}

function hasHistoryMethods(value: unknown): value is { pushState: History["pushState"], replaceState: History["replaceState"] } {
  if (value == null || typeof value !== "object") {
    return false;
  }
  if (!("pushState" in value) || !("replaceState" in value)) {
    return false;
  }
  return typeof value.pushState === "function" && typeof value.replaceState === "function";
}

function getTextSnippet(textContent: string | null): string {
  return textContent == null ? "" : textContent.trim().substring(0, 200);
}

// Pixel quantization factor for x/y/viewport in stored click events. Matches the
// SCALE_FACTOR used by the ClickHouse clickmap_events MV — keep them in sync.
const CLICKMAP_SCALE_FACTOR = 16;

// Dead-click detection (PostHog-style). Whether an element has a click handler
// is unknowable from page script, so a click is classified by its observable
// consequences instead: it is "alive" if the page scrolled, the text selection
// changed, or the tab visibility changed (a new tab opened) almost
// immediately, or if the DOM mutated within a couple of seconds — and "dead"
// if none of that happened by the absolute timeout.
//
// The $click event is buffered immediately like any other event (so
// event_at_ms, ordering, and every query are untouched) and the sweep sets
// data.dead=1 on it in place if nothing observable happened. _flush holds
// back clicks that are still unclassified — classification always finishes
// well within one FLUSH_INTERVAL_MS, so a held click rides the next flush at
// the latest. A keepalive flush (pagehide/stop) sends them unmarked: a click
// still pending when the page unloads led to that navigation, alive by
// definition.
//
// NOTE — blocker for any future real-time / "live clicks" view: a click that
// is still unclassified when its natural flush fires arrives up to one extra
// FLUSH_INTERVAL_MS late. A surface showing clicks as they happen must either
// accept that lag or emit a provisional $click plus a later dead-click
// reconciliation event.
const DEAD_CLICK_SCROLL_THRESHOLD_MS = 100;
const DEAD_CLICK_SELECTION_CHANGED_THRESHOLD_MS = 100;
const DEAD_CLICK_VISIBILITY_CHANGE_THRESHOLD_MS = 100;
const DEAD_CLICK_MUTATION_THRESHOLD_MS = 2_500;
// 1.1x the mutation threshold, mirroring posthog-js: every signal window has
// closed before a click is declared dead.
const DEAD_CLICK_ABSOLUTE_TIMEOUT_MS = 2_750;
const DEAD_CLICK_CHECK_INTERVAL_MS = 1_000;
// Backstop against click storms (e.g. rage clicks on a dead element): past the
// cap, clicks are simply not classified rather than not recorded.
const DEAD_CLICK_MAX_PENDING = 50;

function isPointerTargetFixed(element: Element): boolean {
  let current: Element | null = element;
  let depth = 0;
  while (current != null && depth < ELEMENTS_CHAIN_MAX_DEPTH * 2) {
    const style = window.getComputedStyle(current);
    if (style.position === "fixed" || style.position === "sticky") {
      return true;
    }
    current = current.parentElement;
    depth += 1;
  }
  return false;
}

// Clicks on Hexclave's own in-page UI (the dev tool and the standalone
// clickmap overlay) must never be ingested as analytics events.
function isInsideHexclaveUi(element: Element): boolean {
  return element.closest(`#${cssEscapeIdent(DEV_TOOL_ROOT_ID)}, #${cssEscapeIdent(CLICKMAP_ROOT_ID)}`) != null;
}

// Mutation-record targets can be text/comment nodes; resolve to the nearest
// element before asking whether the mutation came from Hexclave's own UI.
function isInsideHexclaveUiNode(node: Node | null): boolean {
  const element = node instanceof Element ? node : node?.parentElement ?? null;
  return element != null && isInsideHexclaveUi(element);
}

export type EventTrackerDeps = {
  projectId: string,
  sendBatch: (body: string, options: { keepalive: boolean }) => Promise<Result<Response, Error>>,
  // Per-tab id shared with the SessionRecorder so analytics events and replay
  // chunks from the same tab carry the same session_replay_segment_id. Falls
  // back to a fresh uuid when constructed standalone (e.g. in tests).
  sessionReplaySegmentId?: string,
  // Serverless keep-alive hook (AnalyticsOptions.waitUntil): every batch-send
  // promise is passed to it so un-awaited sends survive runtime teardown.
  registerBackgroundTask?: (promise: Promise<unknown>) => void,
  // Origin policy for span.fetch / propagation headers (same-origin default +
  // exact-origin allowlist). Provided by the app from analytics.spanPropagation.
  getPropagationPolicy?: () => { selfOrigin: string | null, allowedOrigins: readonly string[] },
  // Opt-in presence/integrity signals ($away, clipboard, context-menu, print,
  // fullscreen-exit). Default OFF: they are surveillance-adjacent, so capturing
  // them must be a deliberate customer decision
  // (AnalyticsOptions.integritySignals), not default autocapture.
  integritySignals?: boolean,
};

type TrackedEvent = {
  // System types ($page-view, $click, $form-submit, …) from the auto-capture
  // paths, or a custom name (validated against CUSTOM_TELEMETRY_NAME_RE) from
  // trackEvent().
  event_type: string,
  event_at_ms: number,
  data: Record<string, unknown>,
  // Custom ancestor chain, root-first, raw span uuids. Omitted for system
  // events; the server composes system ancestry on top for every event.
  parent_span_ids?: string[],
  // The `$page-view` span the event happened on — see SpanUpdateRow.
  page_view_span_id?: string,
};

/**
 * Internal handle for client-minted SYSTEM spans ($page-view, $away, …).
 * Deliberately NOT a public `Span`: a system span must never enter a custom
 * parent chain (its raw uuid would get the cs- prefix server-side and dangle as
 * a broken reference), so the handle exposes only what the tracker itself
 * needs. All operations are fire-and-forget.
 */
type SystemSpanHandle = {
  readonly spanId: string,
  readonly spanType: string,
  isEnded: () => boolean,
  /** Shallow-merges into the span's data and re-writes the row. */
  setData: (data: Record<string, unknown>) => void,
  end: (endedAtMs?: number) => void,
};

// Sensors feeding the unified `$away` presence span. Recorded (without the $)
// in the span's data.reasons so "window blurred but tab still visible"
// (side-by-side windows) stays distinguishable from a real tab switch.
type AwayReason = "tab-hidden" | "window-blur";

const RAGE_CLICK_WINDOW_MS = 1_000;
const RAGE_CLICK_RADIUS_PX = 30;
const RAGE_CLICK_MIN_CLICKS = 3;
const RESIZE_DEBOUNCE_MS = 500;
const FORM_FIELD_NAMES_MAX = 50;
// Click targets whose href looks like a file download even without a `download`
// attribute (the attribute is also honored; this catches plain file links).
const DOWNLOAD_EXTENSION_RE = /\.(pdf|zip|gz|tar|tgz|rar|7z|dmg|pkg|exe|msi|apk|csv|tsv|xls[xm]?|doc[xm]?|ppt[xm]?|mp3|wav|mp4|mov|avi|webm)$/i;

// djb2-xor over UTF-16 code units. Used ONLY locally to compare a paste against
// the last same-page copy; the hash is never transmitted (a hash of short text
// would be dictionary-reversible, defeating the no-content-capture guarantee).
function hashTextLocal(text: string): number {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export class EventTracker {
  private _started = false;
  private _cancelled = false;
  private _disabled = false;
  private _detachListeners: (() => void) | null = null;
  private _flushTimer: ReturnType<typeof setInterval> | null = null;
  private _events: TrackedEvent[] = [];
  private _approxBytes = 0;
  private _lastUrl: string | null = null;
  private _sessionReplaySegmentId: string;
  private readonly _deps: EventTrackerDeps;

  private _originalPushState: History["pushState"] | null = null;
  private _originalReplaceState: History["replaceState"] | null = null;

  // Custom-span updates awaiting the next flush, latest row per span id (a span
  // touched N times within one flush window costs one wire row). Settlers from
  // superseded rows are carried over so every returned promise still settles
  // with the batch that actually carries the span's latest state.
  private _spanUpdates = new Map<string, { row: SpanUpdateRow, settlers: Settler[] }>();
  // Settlers for buffered custom events (system events are fire-and-forget).
  private _eventSettlers = new Map<TrackedEvent, Settler>();
  // Spans registered via setGlobalSpan — ambient parents for all subsequent
  // custom events and spans until unset (end() auto-unsets).
  private _globalSpans = new Set<Span>();
  // Live (un-ended) span handles' inert switches; flipped on clearBuffer so a
  // span started before sign-out can never be re-written under the next user.
  private _liveSpanControls = new Set<{ markInert: () => void }>();
  // Batch sends currently on the wire; flush() awaits these.
  private _inFlight = new Set<Promise<void>>();

  // The $page-view span everything on the current page nests under. Replaced on
  // every navigation; null before start / after teardown.
  private _pageViewSpan: SystemSpanHandle | null = null;
  private _maxScrollDepthPx = 0;
  private _maxScrollDepthRatio = 0;
  private _webVitals: WebVitalsCollector | null = null;
  // Which $page-view span the vitals belong to (only ever the tab's initial one).
  private _webVitalsSpanId: string | null = null;
  private _recentClicks: { x: number, y: number, atMs: number }[] = [];
  private _resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Presence spans (open while the state holds). Offline is default-on; $away
  // (tab hidden and/or window blurred) only exists with integritySignals.
  private _awaySpan: SystemSpanHandle | null = null;
  // Sensors currently holding the user away (empty = present), and the union
  // of sensors seen during the open $away span (mirrored to its data.reasons).
  private _awayReasons = new Set<AwayReason>();
  private _awaySpanSeenReasons = new Set<AwayReason>();
  private _offlineSpan: SystemSpanHandle | null = null;
  // Local-only hash of the last same-page copy/cut (see hashTextLocal).
  private _lastCopyHash: number | null = null;
  private _wasFullscreen = false;
  private _detachAutocaptureListeners: (() => void) | null = null;
  private _detachIntegrityListeners: (() => void) | null = null;

  private _deadClickTimer: ReturnType<typeof setInterval> | null = null;
  private _deadClickMutationObserver: MutationObserver | null = null;
  // Buffered $click events still awaiting dead-click classification. Always a
  // subset of _events — _flush holds these back until the sweep resolves them.
  private _unclassifiedClicks = new Set<TrackedEvent>();
  private _lastMutationAtMs: number | null = null;
  private _lastScrollAtMs: number | null = null;
  private _lastSelectionChangedAtMs: number | null = null;
  private _lastVisibilityChangeAtMs: number | null = null;

  constructor(deps: EventTrackerDeps) {
    this._deps = deps;
    this._sessionReplaySegmentId = deps.sessionReplaySegmentId ?? generateUuid();
  }

  start() {
    if (this._started) return;
    if (!isBrowserLike()) return;
    if (
      typeof window.addEventListener !== "function"
      || typeof window.removeEventListener !== "function"
      || typeof document.addEventListener !== "function"
      || typeof document.removeEventListener !== "function"
      || !hasScreenDimensions(window.screen)
    ) {
      return;
    }
    this._started = true;

    this._setupPageViewCapture();
    this._setupClickCapture();
    this._setupDeadClickDetection();
    this._setupAutocaptureListeners();
    if (this._deps.integritySignals === true) {
      this._setupIntegritySignals();
    }
    // Last: the keepalive-flush listeners must run AFTER the handlers above for
    // the same events (visibilitychange, pagehide), so rows they enqueue (e.g.
    // an $away open row, the $page-view end row) ride the same flush.
    this._setupPageHideListeners();

    this._flushTimer = setInterval(() => this._tick(), FLUSH_INTERVAL_MS);
  }

  stop() {
    this._cancelled = true;
    if (this._flushTimer !== null) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    // Close all open intervals so the final flush carries their ends.
    this._endPageViewSpan();
    this._endOpenPresenceSpans();
    runAsynchronously(() => this._flush({ keepalive: true }));
    this._teardown();
  }

  clearBuffer() {
    this._settleAllPending("analytics buffer cleared");
    this._events = [];
    this._approxBytes = 0;
    this._unclassifiedClicks.clear();
  }

  // Rejects every pending custom-event/span promise (pre-caught, so silent for
  // fire-and-forget callers), drops buffered span rows, and inert-ifies all live
  // span handles. Called on sign-out (paired with the segment-id rotation): a
  // span started under user A must never be re-written under user B's session.
  private _settleAllPending(reason: string) {
    const error = new Error(`Hexclave analytics: ${reason}`);
    for (const settler of this._eventSettlers.values()) {
      settler.reject(error);
    }
    this._eventSettlers.clear();
    for (const entry of this._spanUpdates.values()) {
      for (const settler of entry.settlers) {
        settler.reject(error);
      }
    }
    this._spanUpdates.clear();
    for (const control of this._liveSpanControls) {
      control.markInert();
    }
    this._liveSpanControls.clear();
    this._globalSpans.clear();
  }

  /**
   * Replaces the per-tab id shared with the SessionRecorder. Called on sign-out
   * (paired with clearBuffer) so a subsequent same-tab sign-in as a different user
   * does not reuse the previous user's session_replay_segment_id — which would let
   * the two users' analytics be correlated. The app rotates both trackers to the
   * SAME new id so they stay in sync.
   */
  setSessionReplaySegmentId(id: string) {
    this._sessionReplaySegmentId = id;
    // Paired with clearBuffer() on sign-out (clearBuffer runs first): the
    // previous $page-view span and any open presence spans were inert-ified
    // under the old identity, so the ongoing page needs fresh spans under the
    // new segment. Page views are span-only; rotation just restarts the
    // `$page-view` interval under the new identity (same as restore).
    if (this._started && !this._cancelled && !this._disabled) {
      this._capturePageView("rotation");
      this._restartPresenceSpans();
    }
  }

  /** The current per-tab id (reflects sign-out rotation) — used by cross-tier span propagation. */
  getSessionReplaySegmentId(): string {
    return this._sessionReplaySegmentId;
  }

  /**
   * The current `$page-view` span id (null before start / after teardown).
   * Stamped on every buffered event/span and carried by cross-tier propagation,
   * so all telemetry from this page — including backend spans — nests under it.
   */
  getCurrentPageViewSpanId(): string | null {
    return this._pageViewSpan?.spanId ?? null;
  }

  /**
   * Buffers a custom analytics event. The returned promise resolves when the
   * batch carrying the event is acknowledged and rejects on definitive send
   * failure; it is pre-caught, so ignoring it is safe. Never throws — invalid
   * input yields a rejected promise plus a console error.
   */
  trackCustomEvent(eventType: string, data?: Record<string, unknown>, options?: TrackOptions): Promise<void> {
    const nameError = getCustomTelemetryNameError("event", eventType);
    if (nameError) return rejectedPreCaught(nameError);
    const dataError = getCustomTelemetryDataError(data);
    if (dataError) return rejectedPreCaught(dataError);
    const resolved = resolveParentIds({
      explicit: options?.parentIds,
      ambient: this._ambientParentRefs(),
      root: options?.root,
      exclude: options?.excludeParentIds,
    });
    if ("error" in resolved) return rejectedPreCaught(resolved.error);
    if (this._disabled) return Promise.resolve();

    const pageViewSpanId = this.getCurrentPageViewSpanId();
    const event: TrackedEvent = {
      event_type: eventType,
      event_at_ms: Date.now(),
      data: { ...data ?? {} },
      ...resolved.ids.length > 0 ? { parent_span_ids: resolved.ids } : {},
      ...pageViewSpanId !== null ? { page_view_span_id: pageViewSpanId } : {},
    };
    let settler!: Settler;
    const promise = preCaught(new Promise<void>((resolve, reject) => {
      settler = { resolve, reject };
    }));
    this._eventSettlers.set(event, settler);
    this._pushEvent(event);
    return promise;
  }

  /**
   * Starts a custom span: the open interval is written on the next flush and
   * re-written (versioned upsert) on setData/end. Never throws — invalid input
   * yields an inert span plus a console error, so caller code always proceeds.
   */
  startSpan(spanType: string, options?: StartSpanOptions): Span {
    const nameError = getCustomTelemetryNameError("span", spanType);
    if (nameError) {
      console.error(`Hexclave analytics: ${nameError}`);
      return createInertSpan(spanType);
    }
    const dataError = getCustomTelemetryDataError(options?.data);
    if (dataError) {
      console.error(`Hexclave analytics: ${dataError}`);
      return createInertSpan(spanType);
    }
    if (options?.startedAtMs !== undefined && (!Number.isInteger(options.startedAtMs) || options.startedAtMs < 0)) {
      console.error(`Hexclave analytics: startedAtMs must be a non-negative integer epoch-milliseconds value`);
      return createInertSpan(spanType);
    }
    const resolved = resolveParentIds({
      explicit: options?.parentIds,
      ambient: this._ambientParentRefs(),
      root: options?.root,
      exclude: options?.excludeParentIds,
    });
    if ("error" in resolved) {
      console.error(`Hexclave analytics: ${resolved.error}`);
      return createInertSpan(spanType);
    }
    if (this._disabled) return createInertSpan(spanType);

    const spanId = generateUuid();
    // The custom ancestor chain is frozen at creation: parents are identity, not
    // state, so later setGlobalSpan calls or parent mutations never re-parent an
    // existing span (and every re-write of this span carries the same chain).
    // The page ancestry is frozen for the same reason: a span that outlives its
    // page stays parented under the page it STARTED on.
    const pageViewSpanId = this.getCurrentPageViewSpanId();
    const parentSpanIds = resolved.ids;
    const startedAtMs = options?.startedAtMs ?? Date.now();
    let accumulatedData: Record<string, unknown> = { ...options?.data ?? {} };
    let lastVersion = 0;
    let ended = false;
    let inert = false;
    let endPromise: Promise<void> | null = null;

    // Per-span monotonic version: the row carrying the latest update always wins
    // in the ReplacingMergeTree, even when batches arrive out of order (keepalive
    // sends are single-attempt and can race a normal flush).
    const nextVersion = () => (lastVersion = Math.max(Date.now(), lastVersion + 1));
    const enqueue = (endedAtMs: number | null): Promise<void> => {
      if (inert || this._disabled) return Promise.resolve();
      return this._enqueueSpanUpdate({
        span_id: spanId,
        span_type: spanType,
        started_at_ms: startedAtMs,
        ended_at_ms: endedAtMs,
        parent_span_ids: parentSpanIds,
        data: { ...accumulatedData },
        updated_at_ms: nextVersion(),
        ...pageViewSpanId !== null ? { page_view_span_id: pageViewSpanId } : {},
      });
    };

    const control = {
      markInert: () => {
        inert = true;
      },
    };
    this._liveSpanControls.add(control);

    const span: Span = {
      spanId,
      spanType,
      get isEnded() {
        return ended;
      },
      setData: (data: Record<string, unknown>) => {
        if (ended) return rejectedPreCaught(`setData() called on already-ended span "${spanType}"`);
        const merged = { ...accumulatedData, ...data };
        const mergedError = getCustomTelemetryDataError(merged);
        if (mergedError) return rejectedPreCaught(mergedError);
        accumulatedData = merged;
        return enqueue(null);
      },
      end: (endOptions?: { endedAtMs?: number }) => {
        if (endPromise) return endPromise;
        ended = true;
        this._globalSpans.delete(span);
        this._liveSpanControls.delete(control);
        // Clamp so a caller-supplied end can never invert the interval — the
        // server rejects ended < started, and one bad item would 400 the batch.
        const endedAtMs = resolveEndedAtMs(startedAtMs, endOptions?.endedAtMs);
        endPromise = enqueue(endedAtMs);
        return endPromise;
      },
      trackEvent: (eventType: string, data?: Record<string, unknown>, trackOptions?: TrackOptions) =>
        this.trackCustomEvent(eventType, data, { ...trackOptions, parentIds: [span, ...trackOptions?.parentIds ?? []] }),
      startSpan: (childType: string, childOptions?: StartSpanOptions) =>
        this.startSpan(childType, { ...childOptions, parentIds: [span, ...childOptions?.parentIds ?? []] }),
      withSpan: <T,>(childType: string, optionsOrFn: StartSpanOptions | ((child: Span) => Promise<T> | T), maybeFn?: (child: Span) => Promise<T> | T) =>
        withSpanImpl((type, opts) => span.startSpan(type, opts), childType, optionsOrFn, maybeFn),
      run: <T,>(fn: () => T) => runWithSpanFrame(span.ref(), fn),
      // The FROZEN page ancestry rides along (not the current page): headers
      // pinned to this span must describe this span's context exactly.
      getPropagationHeaders: () => ({ [SPAN_CONTEXT_HEADER]: encodeSpanContextHeader(this._spanPropagationContext(span, pageViewSpanId)) }),
      fetch: (input: RequestInfo | URL, init?: RequestInit) => this._spanFetch(span, pageViewSpanId, input, init),
      ref: () => ({ spanId, parentSpanIds: [...parentSpanIds] }),
    };

    // Write the open interval right away: a span the user never ends (e.g. the
    // tab closes) still shows up, as an open interval, from its first flush on.
    enqueue(null).catch(() => {});
    return span;
  }

  /**
   * Starts a client-minted SYSTEM span ($page-view, $away, $offline). Unlike
   * the public startSpan: no name/data validation (callers
   * are internal), no ambient custom parents (system ancestry — session,
   * segment, page — is composed server-side from scalar ids), and the row
   * carries `page_view_span_id` instead of a custom chain. Registered in
   * _liveSpanControls, so sign-out inert-ifies it like any live span (a span
   * started under user A must never be re-written under user B).
   */
  private _startSystemSpan(spanType: ClientSystemSpanType, opts?: { data?: Record<string, unknown>, pageViewSpanId?: string }): SystemSpanHandle {
    const spanId = generateUuid();
    const startedAtMs = Date.now();
    const pageViewSpanId = opts?.pageViewSpanId;
    let accumulatedData: Record<string, unknown> = { ...opts?.data ?? {} };
    let lastVersion = 0;
    let ended = false;
    let inert = false;
    // Same versioning scheme as custom spans (see startSpan's nextVersion).
    const nextVersion = () => (lastVersion = Math.max(Date.now(), lastVersion + 1));
    const control = {
      markInert: () => {
        inert = true;
      },
    };
    this._liveSpanControls.add(control);
    const enqueue = (endedAtMs: number | null) => {
      if (inert || this._disabled) return;
      this._enqueueSpanUpdate({
        span_id: spanId,
        span_type: spanType,
        started_at_ms: startedAtMs,
        ended_at_ms: endedAtMs,
        parent_span_ids: [],
        data: { ...accumulatedData },
        updated_at_ms: nextVersion(),
        ...pageViewSpanId !== undefined ? { page_view_span_id: pageViewSpanId } : {},
      }).catch(() => {});
    };
    enqueue(null);
    return {
      spanId,
      spanType,
      isEnded: () => ended,
      setData: (data: Record<string, unknown>) => {
        if (ended) return;
        accumulatedData = { ...accumulatedData, ...data };
        enqueue(null);
      },
      end: (endedAtMs?: number) => {
        if (ended) return;
        ended = true;
        this._liveSpanControls.delete(control);
        enqueue(resolveEndedAtMs(startedAtMs, endedAtMs));
      },
    };
  }

  /** The cross-tier context pinned to exactly `span`: its frozen chain (which
   * already includes the globals/ambient captured at creation), its frozen page
   * ancestry, and the per-tab segment identity. Raw ids — the backend applies
   * the prefixes. */
  private _spanPropagationContext(span: Span, pageViewSpanId: string | null): SpanPropagationContext {
    const ref = span.ref();
    return {
      projectId: this._deps.projectId,
      sessionReplaySegmentId: this._sessionReplaySegmentId,
      customParentSpanIds: [...ref.parentSpanIds, ref.spanId],
      ...pageViewSpanId !== null ? { pageViewSpanId } : {},
    };
  }

  private _spanFetch(span: Span, pageViewSpanId: string | null, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      const policy = this._deps.getPropagationPolicy?.() ?? {
        selfOrigin: typeof window !== "undefined" ? window.location.origin : null,
        allowedOrigins: [],
      };
      const initWithHeader = buildFetchInitWithSpanContext({
        input,
        init,
        headerValue: encodeSpanContextHeader(this._spanPropagationContext(span, pageViewSpanId)),
        selfOrigin: policy.selfOrigin,
        allowedOrigins: policy.allowedOrigins,
      });
      return globalThis.fetch(input, initWithHeader ?? init);
    } catch {
      // Propagation must never break the caller's actual request.
      return globalThis.fetch(input, init);
    }
  }

  /**
   * Registers a span as an ambient parent for all subsequently created custom
   * events and spans (additive with explicit parentIds). Ending the span
   * automatically unregisters it.
   */
  setGlobalSpan(span: Span): void {
    if (span.isEnded) {
      console.warn("Hexclave analytics: setGlobalSpan() called with an already-ended span; ignoring");
      return;
    }
    this._globalSpans.add(span);
  }

  unsetGlobalSpan(span: Span): void {
    this._globalSpans.delete(span);
  }

  /**
   * Sends everything buffered right now and settles all in-flight sends. This is
   * the "send now" escape hatch — awaiting trackEvent alone waits for the
   * regular flush cadence.
   */
  async flush(): Promise<void> {
    await this._flush({ keepalive: false });
    await Promise.allSettled([...this._inFlight]);
  }

  private _ambientParentRefs(): SpanRef[] {
    const refs: SpanRef[] = [];
    for (const span of this._globalSpans) {
      if (!span.isEnded) refs.push(span.ref());
    }
    // Enclosing withSpan() frames, outermost first, after the globals. Exact
    // primitive (ALS/AsyncContext) → the per-flow store, always. Sync-stack
    // fallback → only prologue-open frames (provably same-flow); after an await
    // in browsers, rebind via the span handle (`span.run` / `trackEvent` / …).
    refs.push(...getAmbientSpanRefs());
    return refs;
  }

  /**
   * The ambient parents every new event/span would get right now — live global
   * spans first, then enclosing withSpan() frames (outermost first), each with
   * its full frozen ancestor chain. Used by cross-tier span propagation so an
   * outgoing request carries the same ancestry a locally-tracked event would.
   */
  getAmbientParentRefs(): SpanRef[] {
    return this._ambientParentRefs();
  }

  private _enqueueSpanUpdate(row: SpanUpdateRow): Promise<void> {
    let settler!: Settler;
    const promise = preCaught(new Promise<void>((resolve, reject) => {
      settler = { resolve, reject };
    }));
    const previous = this._spanUpdates.get(row.span_id);
    if (previous) {
      this._approxBytes -= JSON.stringify(previous.row).length;
    }
    // Latest row per span id wins within a batch, but superseded rows' settlers
    // ride along so their promises still settle with the batch that ships.
    this._spanUpdates.set(row.span_id, { row, settlers: [...previous?.settlers ?? [], settler] });
    this._approxBytes += JSON.stringify(row).length;
    this._maybeTriggerSizeFlush();
    return promise;
  }

  private _maybeTriggerSizeFlush() {
    if (this._events.length + this._spanUpdates.size >= MAX_EVENTS_PER_BATCH || this._approxBytes >= MAX_APPROX_BYTES_PER_BATCH) {
      runAsynchronously(() => this._flush({ keepalive: false }));
    }
  }

  private _pushEvent(event: TrackedEvent) {
    if (this._disabled) return;
    this._events.push(event);
    this._approxBytes += JSON.stringify(event).length;
    this._maybeTriggerSizeFlush();
  }

  // System events from the auto-capture paths are fire-and-forget (no settler)
  // and always stamped with the current page ancestry. Their DOM-derived data
  // is still bounded locally: one oversized selector/URL must not make the
  // server reject every otherwise-valid item in the shared batch.
  private _pushSystemEvent(eventType: SystemEventType, data: Record<string, unknown>) {
    const dataError = getCustomTelemetryDataError(data);
    if (dataError !== null) {
      console.warn(`Hexclave analytics: dropping ${eventType}: ${dataError}`);
      return;
    }
    const pageViewSpanId = this.getCurrentPageViewSpanId();
    this._pushEvent({
      event_type: eventType,
      event_at_ms: Date.now(),
      data,
      ...pageViewSpanId !== null ? { page_view_span_id: pageViewSpanId } : {},
    });
  }

  // "restore" = bfcache revival (pageshow with persisted), "rotation" =
  // sign-out segment rotation; both restart the span the same way as a
  // navigation. Page views are span-only — readers that need them query
  // `default.spans` / `analytics_internal.spans` (`span_type = '$page-view'`),
  // never `default.events`.
  private _capturePageView(entryType: "initial" | "push" | "replace" | "pop" | "restore" | "rotation") {
    const screenObject = window.screen;
    if (!hasScreenDimensions(screenObject)) {
      return;
    }

    const url = window.location.href;
    const isForcedRestart = entryType === "initial" || entryType === "restore" || entryType === "rotation";
    if (url === this._lastUrl && !isForcedRestart) return;
    this._lastUrl = url;

    this._endPageViewSpan();

    const pageViewData = {
      url,
      path: window.location.pathname,
      referrer: document.referrer,
      title: document.title,
      entry_type: entryType,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      screen_width: screenObject.width,
      screen_height: screenObject.height,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    };

    // The $page-view SPAN is the hierarchy layer everything on this page nests
    // under (auto-captured events, custom telemetry, and backend spans via
    // cross-tier propagation). It ends on the next navigation / pagehide, so
    // its interval IS the time-on-page. There is no companion `$page-view`
    // EVENT — projecting spans into default.events made the traces UI show
    // the same fact twice (diamond + bar).
    const span = this._startSystemSpan("$page-view", { data: pageViewData });
    this._pageViewSpan = span;
    this._resetScrollDepth();
    // Rage bursts describe repeated interaction with one page. Carrying the
    // prior route's clicks into an SPA navigation creates false positives.
    this._recentClicks = [];

    // Web vitals describe the initial load only, so a collector is attached to
    // the tab's first $page-view span alone; values are absorbed into its data
    // as they finalize and frozen when the span ends (updates within a flush
    // window coalesce into one wire row, so no extra throttling is needed).
    if (entryType === "initial" && this._webVitals === null) {
      let collector: WebVitalsCollector | null = null;
      collector = startWebVitalsCollector(() => {
        if (collector !== null && !span.isEnded()) {
          span.setData({ web_vitals: collector.snapshot() });
        }
      });
      if (collector !== null) {
        this._webVitals = collector;
        this._webVitalsSpanId = span.spanId;
      }
    }
  }

  /**
   * Ends the current $page-view span, absorbing the final scroll depth (and web
   * vitals, when this is the initial page) so the single deduped wire row
   * carries both the data and the end time.
   */
  private _endPageViewSpan() {
    const span = this._pageViewSpan;
    if (span === null || span.isEnded()) return;
    this._sampleScrollDepth();
    span.setData({
      scroll_depth_px: Math.round(this._maxScrollDepthPx),
      // 3 decimals is plenty for a 0..1 ratio and keeps rows stable.
      scroll_depth_ratio: Math.round(this._maxScrollDepthRatio * 1000) / 1000,
    });
    if (this._webVitals !== null && this._webVitalsSpanId === span.spanId) {
      span.setData({ web_vitals: this._webVitals.snapshot() });
      this._webVitals.disconnect();
      this._webVitals = null;
      this._webVitalsSpanId = null;
    }
    span.end();
  }

  private _resetScrollDepth() {
    this._maxScrollDepthPx = 0;
    this._maxScrollDepthRatio = 0;
    // Sample immediately so a page that is never scrolled still reports the
    // initially visible depth.
    this._sampleScrollDepth();
  }

  // Depth = bottom edge of the viewport within the document. Page-level scroll
  // only (nested scroll containers do not describe how far down the PAGE the
  // user got).
  private _sampleScrollDepth() {
    const bottom = window.scrollY + window.innerHeight;
    const height = Math.max(document.documentElement.scrollHeight, window.innerHeight);
    if (bottom > this._maxScrollDepthPx) this._maxScrollDepthPx = bottom;
    const ratio = height > 0 ? Math.min(bottom / height, 1) : 0;
    if (ratio > this._maxScrollDepthRatio) this._maxScrollDepthRatio = ratio;
  }

  private readonly _onScrollDepth = () => {
    this._sampleScrollDepth();
  };

  private _setupPageViewCapture() {
    // Fire initial page-view
    this._capturePageView("initial");
    const historyObject = window.history;
    if (!hasHistoryMethods(historyObject)) {
      return;
    }
    const originalPushState = historyObject.pushState;
    const originalReplaceState = historyObject.replaceState;

    // Monkey-patch history.pushState
    this._originalPushState = (...args: Parameters<History["pushState"]>) => originalPushState.apply(historyObject, args);
    historyObject.pushState = (...args: Parameters<History["pushState"]>) => {
      this._originalPushState!(...args);
      this._capturePageView("push");
    };

    // Monkey-patch history.replaceState
    this._originalReplaceState = (...args: Parameters<History["replaceState"]>) => originalReplaceState.apply(historyObject, args);
    historyObject.replaceState = (...args: Parameters<History["replaceState"]>) => {
      this._originalReplaceState!(...args);
      this._capturePageView("replace");
    };

    // Listen for popstate (back/forward navigation)
    window.addEventListener("popstate", this._onPopState);
  }

  private readonly _onPopState = () => {
    this._capturePageView("pop");
  };

  private _buildSelector(element: Element): string {
    const parts: string[] = [];
    let current: Element | null = element;
    let depth = 0;

    while (current && depth < 8 && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      let testIdAttr = "data-testid";
      let testId = current.getAttribute("data-testid");
      if (testId == null) {
        testIdAttr = "data-test-id";
        testId = current.getAttribute("data-test-id");
      }
      if (testId != null && testId.trim() !== "") {
        part += `[${testIdAttr}="${testId.replace(/"/g, '\\"')}"]`;
        parts.unshift(part);
        break;
      }
      if (current.id !== "") {
        part += `#${cssEscapeIdent(current.id)}`;
        parts.unshift(part);
        break;
      }
      if (current.className && typeof current.className === "string") {
        const classes = current.className.trim().split(/\s+/).filter(Boolean).slice(0, 4);
        if (classes.length > 0) {
          part += `.${classes.map(cssEscapeIdent).join(".")}`;
        }
      }
      const parent: Element | null = current.parentElement;
      if (parent != null) {
        const tagName = current.tagName;
        const siblings = Array.from(parent.children).filter((child) => child.tagName === tagName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      parts.unshift(part);
      current = parent;
      depth++;
    }

    return parts.join(" > ");
  }

  private _findNearestAnchor(element: Element): Element | null {
    let current: Element | null = element;
    while (current) {
      if (current.tagName === "A" && current.hasAttribute("href")) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  private readonly _onClickCapture = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (isInsideHexclaveUi(target)) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const pointerTargetFixed = isPointerTargetFixed(target);
    // Pre-scale at ingest so old + new rows land in identical buckets in CH.
    const xScaled = Math.round(event.pageX / CLICKMAP_SCALE_FACTOR);
    const yScaled = Math.round(event.pageY / CLICKMAP_SCALE_FACTOR);
    const clientYScaled = Math.round(event.clientY / CLICKMAP_SCALE_FACTOR);
    const relativeX = viewportWidth > 0 ? event.clientX / viewportWidth : 0;

    // Rage detection: the click that COMPLETES a burst (>= 3 clicks within a
    // 30px box inside 1s) is marked in place — earlier clicks of the burst may
    // already be on the wire, so marking only the completer keeps this a pure
    // buffer-time flag with no reconciliation.
    const nowMs = Date.now();
    this._recentClicks = this._recentClicks.filter((click) => nowMs - click.atMs < RAGE_CLICK_WINDOW_MS);
    this._recentClicks.push({ x: event.clientX, y: event.clientY, atMs: nowMs });
    const burstSize = this._recentClicks.filter((click) =>
      Math.abs(click.x - event.clientX) <= RAGE_CLICK_RADIUS_PX && Math.abs(click.y - event.clientY) <= RAGE_CLICK_RADIUS_PX,
    ).length;

    const anchor = this._findNearestAnchor(target);
    const href = anchor?.getAttribute("href") ?? null;
    let outbound = false;
    let download = anchor !== null && anchor.hasAttribute("download");
    if (href !== null) {
      try {
        const hrefUrl = new URL(href, window.location.href);
        outbound = (hrefUrl.protocol === "http:" || hrefUrl.protocol === "https:") && hrefUrl.origin !== window.location.origin;
        download = download || DOWNLOAD_EXTENSION_RE.test(hrefUrl.pathname);
      } catch {
        // Unparsable href: neither flag applies.
      }
    }

    const pageViewSpanId = this.getCurrentPageViewSpanId();
    const clickEvent: TrackedEvent = {
      event_type: "$click",
      event_at_ms: nowMs,
      data: {
        tag_name: target.tagName.toLowerCase(),
        text: getTextSnippet(target.textContent),
        href,
        selector: this._buildSelector(target),
        elements_chain: buildElementsChain(target),
        pointer_target_fixed: pointerTargetFixed ? 1 : 0,
        url: window.location.href,
        path: window.location.pathname,
        title: document.title,
        x: event.clientX,
        y: event.clientY,
        page_x: event.pageX,
        page_y: event.pageY,
        x_scaled: xScaled,
        y_scaled: yScaled,
        client_y_scaled: clientYScaled,
        pointer_relative_x: relativeX,
        viewport_width: viewportWidth,
        viewport_height: viewportHeight,
        scale_factor: CLICKMAP_SCALE_FACTOR,
        // Flags are present-when-set only (like `dead`), so existing rows and
        // queries with `data.rage = 1`-style filters stay cheap and stable.
        ...burstSize >= RAGE_CLICK_MIN_CLICKS ? { rage: 1 } : {},
        ...outbound ? { outbound: 1 } : {},
        ...download ? { download: 1 } : {},
      },
      ...pageViewSpanId !== null ? { page_view_span_id: pageViewSpanId } : {},
    };

    // Register for dead-click classification before buffering, so a
    // size-triggered flush from this very push already holds the click back.
    if (this._deadClickTimer !== null && this._unclassifiedClicks.size < DEAD_CLICK_MAX_PENDING) {
      this._unclassifiedClicks.add(clickEvent);
    }
    this._pushEvent(clickEvent);
  };

  private _setupClickCapture() {
    document.addEventListener("click", this._onClickCapture, { capture: true });
  }

  private readonly _onDeadClickScroll = () => {
    this._lastScrollAtMs = Date.now();
  };

  private readonly _onDeadClickSelectionChange = () => {
    this._lastSelectionChangedAtMs = Date.now();
  };

  private readonly _onDeadClickVisibilityChange = () => {
    this._lastVisibilityChangeAtMs = Date.now();
  };

  private _setupDeadClickDetection() {
    if (typeof MutationObserver !== "function") return;

    this._deadClickMutationObserver = new MutationObserver((mutations) => {
      // The dev tool and the clickmap overlay rewrite their own DOM constantly
      // while open; their mutations must not mark host-page clicks as alive.
      if (mutations.every((mutation) => isInsideHexclaveUiNode(mutation.target))) {
        return;
      }
      this._lastMutationAtMs = Date.now();
    });
    this._deadClickMutationObserver.observe(document.documentElement, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
    });

    // Capture phase so scrolls inside nested scroll containers count, not just
    // the document itself (scroll events don't bubble).
    document.addEventListener("scroll", this._onDeadClickScroll, { capture: true, passive: true });
    document.addEventListener("selectionchange", this._onDeadClickSelectionChange);
    document.addEventListener("visibilitychange", this._onDeadClickVisibilityChange);

    this._deadClickTimer = setInterval(() => this._checkDeadClicks(), DEAD_CLICK_CHECK_INTERVAL_MS);
  }

  private _checkDeadClicks() {
    const nowMs = Date.now();
    for (const click of this._unclassifiedClicks) {
      const signalWithin = (signalAtMs: number | null, thresholdMs: number) =>
        signalAtMs != null && signalAtMs >= click.event_at_ms && signalAtMs - click.event_at_ms < thresholdMs;

      const isAlive = signalWithin(this._lastScrollAtMs, DEAD_CLICK_SCROLL_THRESHOLD_MS)
        || signalWithin(this._lastSelectionChangedAtMs, DEAD_CLICK_SELECTION_CHANGED_THRESHOLD_MS)
        || signalWithin(this._lastVisibilityChangeAtMs, DEAD_CLICK_VISIBILITY_CHANGE_THRESHOLD_MS)
        || signalWithin(this._lastMutationAtMs, DEAD_CLICK_MUTATION_THRESHOLD_MS);
      if (isAlive) {
        this._unclassifiedClicks.delete(click);
      } else if (nowMs - click.event_at_ms >= DEAD_CLICK_ABSOLUTE_TIMEOUT_MS) {
        // The already-buffered event is marked in place — no second event.
        click.data.dead = 1;
        this._unclassifiedClicks.delete(click);
      }
    }
  }

  private _teardownDeadClickDetection() {
    if (this._deadClickTimer !== null) {
      clearInterval(this._deadClickTimer);
      this._deadClickTimer = null;
    }
    if (this._deadClickMutationObserver !== null) {
      this._deadClickMutationObserver.disconnect();
      this._deadClickMutationObserver = null;
    }
    document.removeEventListener("scroll", this._onDeadClickScroll, { capture: true });
    document.removeEventListener("selectionchange", this._onDeadClickSelectionChange);
    document.removeEventListener("visibilitychange", this._onDeadClickVisibilityChange);
    this._unclassifiedClicks.clear();
  }

  // ---------------------------------------------------------------------------
  // Default-on autocapture (page-level scroll depth, bfcache restore, forms,
  // resize, offline)
  // ---------------------------------------------------------------------------

  private readonly _onPageShow = (event: PageTransitionEvent) => {
    // A bfcache restore revives a page whose $page-view span was already ended
    // by pagehide; the restored view is a new interval on the same URL.
    if (event.persisted) this._capturePageView("restore");
  };

  private readonly _onFormSubmit = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (isInsideHexclaveUi(form)) return;

    // Field NAMES only, never values — names identify the form shape without
    // touching what the user typed.
    const fieldNames: string[] = [];
    for (const element of Array.from(form.elements)) {
      const name = element.getAttribute("name");
      if (name !== null && name !== "" && !fieldNames.includes(name)) {
        fieldNames.push(name);
        if (fieldNames.length >= FORM_FIELD_NAMES_MAX) break;
      }
    }

    // The action's query string can carry user-derived values; keep only
    // origin + path (path only when same-origin).
    let actionPath: string | null = null;
    try {
      const actionUrl = new URL(form.action, window.location.href);
      actionPath = actionUrl.origin === window.location.origin ? actionUrl.pathname : `${actionUrl.origin}${actionUrl.pathname}`;
    } catch {
      actionPath = null;
    }

    this._pushSystemEvent("$form-submit", {
      selector: this._buildSelector(form),
      elements_chain: buildElementsChain(form),
      form_id: form.id === "" ? null : form.id,
      form_name: form.getAttribute("name"),
      method: form.method,
      action_path: actionPath,
      field_names: fieldNames,
      url: window.location.href,
      path: window.location.pathname,
      title: document.title,
    });
  };

  private readonly _onWindowResize = () => {
    // Trailing debounce: resize fires continuously during a drag; only the
    // settled size is interesting.
    if (this._resizeDebounceTimer !== null) clearTimeout(this._resizeDebounceTimer);
    this._resizeDebounceTimer = setTimeout(() => {
      this._resizeDebounceTimer = null;
      const screenObject = window.screen;
      this._pushSystemEvent("$window-resize", {
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
        screen_width: hasScreenDimensions(screenObject) ? screenObject.width : null,
        screen_height: hasScreenDimensions(screenObject) ? screenObject.height : null,
        url: window.location.href,
        path: window.location.pathname,
      });
    }, RESIZE_DEBOUNCE_MS);
  };

  private readonly _onOffline = () => {
    if (this._offlineSpan !== null && !this._offlineSpan.isEnded()) return;
    this._offlineSpan = this._startSystemSpan("$offline", { pageViewSpanId: this.getCurrentPageViewSpanId() ?? undefined });
  };

  private readonly _onOnline = () => {
    this._offlineSpan?.end();
    this._offlineSpan = null;
  };

  private _setupAutocaptureListeners() {
    window.addEventListener("scroll", this._onScrollDepth, { passive: true });
    window.addEventListener("pageshow", this._onPageShow);
    document.addEventListener("submit", this._onFormSubmit, { capture: true });
    window.addEventListener("resize", this._onWindowResize);
    window.addEventListener("offline", this._onOffline);
    window.addEventListener("online", this._onOnline);
    // Reflect a state that is already true at start.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this._onOffline();
    }
    this._detachAutocaptureListeners = () => {
      window.removeEventListener("scroll", this._onScrollDepth);
      window.removeEventListener("pageshow", this._onPageShow);
      document.removeEventListener("submit", this._onFormSubmit, { capture: true });
      window.removeEventListener("resize", this._onWindowResize);
      window.removeEventListener("offline", this._onOffline);
      window.removeEventListener("online", this._onOnline);
      if (this._resizeDebounceTimer !== null) {
        clearTimeout(this._resizeDebounceTimer);
        this._resizeDebounceTimer = null;
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Opt-in integrity signals (AnalyticsOptions.integritySignals). All of these
  // are ADVISORY: page script cannot prove presence or catch a second device —
  // they are review signals for tools like exam/quiz platforms, never
  // enforcement. Clipboard CONTENT is never captured (lengths + a local-only
  // hash comparison; see hashTextLocal).
  // ---------------------------------------------------------------------------

  // One `$away` span per continuous away interval, fed by two sensors:
  // visibilitychange (tab switch / minimize) and window blur/focus, which
  // catches switching to ANOTHER WINDOW while the tab stays visible — a case
  // visibilitychange misses. A tab switch fires both sensors; recording one
  // span whose data.reasons holds the union of sensors that fired during the
  // interval keeps the distinction without emitting overlapping spans that
  // every consumer would have to merge.

  private readonly _onIntegrityVisibilityChange = () => {
    this._setAwayReason("tab-hidden", document.visibilityState === "hidden");
  };

  private readonly _onWindowBlur = () => {
    this._setAwayReason("window-blur", true);
  };

  private readonly _onWindowFocus = () => {
    this._setAwayReason("window-blur", false);
  };

  private _currentAwayReasons(): Set<AwayReason> {
    const reasons = new Set<AwayReason>();
    if (document.visibilityState === "hidden") reasons.add("tab-hidden");
    if (typeof document.hasFocus === "function" && !document.hasFocus()) reasons.add("window-blur");
    return reasons;
  }

  private _setAwayReason(reason: AwayReason, active: boolean) {
    if (active) {
      this._awayReasons.add(reason);
    } else {
      this._awayReasons.delete(reason);
    }
    this._reconcileAwaySpan();
  }

  private _reconcileAwaySpan() {
    if (this._awayReasons.size === 0) {
      this._awaySpan?.end();
      this._awaySpan = null;
      return;
    }
    if (this._awaySpan === null || this._awaySpan.isEnded()) {
      this._awaySpanSeenReasons = new Set(this._awayReasons);
      this._awaySpan = this._startSystemSpan("$away", {
        data: { reasons: [...this._awaySpanSeenReasons] },
        pageViewSpanId: this.getCurrentPageViewSpanId() ?? undefined,
      });
      return;
    }
    // Already away: a second sensor firing extends the row's reasons; the
    // interval itself is unchanged. A sensor CLEARING while others still hold
    // (e.g. focus returns to a hidden tab) is not removed — reasons record
    // what fired during the interval, not the instantaneous state.
    const unseen = [...this._awayReasons].filter((reason) => !this._awaySpanSeenReasons.has(reason));
    if (unseen.length > 0) {
      for (const reason of unseen) {
        this._awaySpanSeenReasons.add(reason);
      }
      this._awaySpan.setData({ reasons: [...this._awaySpanSeenReasons] });
    }
  }

  private readonly _onCopyCapture = (event: ClipboardEvent) => {
    this._recordClipboardCopy("$copy", event);
  };

  private readonly _onCutCapture = (event: ClipboardEvent) => {
    this._recordClipboardCopy("$cut", event);
  };

  private _recordClipboardCopy(eventType: "$copy" | "$cut", event: ClipboardEvent) {
    const target = event.target;
    if (target instanceof Element && isInsideHexclaveUi(target)) return;
    const selection = typeof document.getSelection === "function" ? document.getSelection()?.toString() ?? "" : "";
    if (selection !== "") this._lastCopyHash = hashTextLocal(selection);
    this._pushSystemEvent(eventType, {
      selection_length: selection.length,
      url: window.location.href,
      path: window.location.pathname,
    });
  }

  private readonly _onPasteCapture = (event: ClipboardEvent) => {
    const target = event.target;
    if (target instanceof Element && isInsideHexclaveUi(target)) return;
    const text = event.clipboardData?.getData("text/plain");
    const data: Record<string, unknown> = {
      url: window.location.href,
      path: window.location.pathname,
      ...target instanceof Element ? {
        tag_name: target.tagName.toLowerCase(),
        selector: this._buildSelector(target),
      } : {},
    };
    if (typeof text === "string") {
      data.length = text.length;
      // "Did this paste originate from a copy on this same page?" — the signal
      // that distinguishes internal shuffling from an external source. Hash
      // comparison happens locally; the content never leaves the page.
      data.same_page_origin = this._lastCopyHash !== null && text !== "" && hashTextLocal(text) === this._lastCopyHash ? 1 : 0;
    }
    this._pushSystemEvent("$paste", data);
  };

  private readonly _onContextMenuCapture = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (isInsideHexclaveUi(target)) return;
    this._pushSystemEvent("$context-menu", {
      tag_name: target.tagName.toLowerCase(),
      selector: this._buildSelector(target),
      x: event.clientX,
      y: event.clientY,
      url: window.location.href,
      path: window.location.pathname,
    });
  };

  private readonly _onBeforePrint = () => {
    this._pushSystemEvent("$print", {
      url: window.location.href,
      path: window.location.pathname,
    });
  };

  private readonly _onFullscreenChange = () => {
    const isFullscreen = document.fullscreenElement != null;
    // Exit-only: entering fullscreen is the expected state for e.g. a
    // fullscreen-required exam; LEAVING it is the signal.
    if (this._wasFullscreen && !isFullscreen) {
      this._pushSystemEvent("$fullscreen-exit", {
        url: window.location.href,
        path: window.location.pathname,
      });
    }
    this._wasFullscreen = isFullscreen;
  };

  private _setupIntegritySignals() {
    // Registered BEFORE _setupPageHideListeners (see start()) so an $away
    // open row enqueued here rides the same keepalive flush.
    document.addEventListener("visibilitychange", this._onIntegrityVisibilityChange);
    window.addEventListener("blur", this._onWindowBlur);
    window.addEventListener("focus", this._onWindowFocus);
    document.addEventListener("copy", this._onCopyCapture, { capture: true });
    document.addEventListener("cut", this._onCutCapture, { capture: true });
    document.addEventListener("paste", this._onPasteCapture, { capture: true });
    document.addEventListener("contextmenu", this._onContextMenuCapture, { capture: true });
    window.addEventListener("beforeprint", this._onBeforePrint);
    document.addEventListener("fullscreenchange", this._onFullscreenChange);
    this._wasFullscreen = document.fullscreenElement != null;
    // Reflect state that is already true at start. Focus is deliberately NOT
    // probed here: document.hasFocus() is unreliable while a page is still
    // loading, and a background-tab load is already covered by
    // visibilityState — the first real blur/focus event syncs the sensor.
    this._setAwayReason("tab-hidden", document.visibilityState === "hidden");
    this._detachIntegrityListeners = () => {
      document.removeEventListener("visibilitychange", this._onIntegrityVisibilityChange);
      window.removeEventListener("blur", this._onWindowBlur);
      window.removeEventListener("focus", this._onWindowFocus);
      document.removeEventListener("copy", this._onCopyCapture, { capture: true });
      document.removeEventListener("cut", this._onCutCapture, { capture: true });
      document.removeEventListener("paste", this._onPasteCapture, { capture: true });
      document.removeEventListener("contextmenu", this._onContextMenuCapture, { capture: true });
      window.removeEventListener("beforeprint", this._onBeforePrint);
      document.removeEventListener("fullscreenchange", this._onFullscreenChange);
    };
  }

  private _endOpenPresenceSpans() {
    for (const span of [this._awaySpan, this._offlineSpan]) {
      if (span !== null && !span.isEnded()) span.end();
    }
    this._awaySpan = null;
    this._offlineSpan = null;
  }

  // Called on sign-out rotation: the old presence spans were inert-ified with
  // the previous identity, so any state that STILL holds re-opens as a fresh
  // span under the new segment/page.
  private _restartPresenceSpans() {
    this._awaySpan = null;
    this._offlineSpan = null;
    if (this._deps.integritySignals === true) {
      this._awayReasons = this._currentAwayReasons();
      this._reconcileAwaySpan();
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this._offlineSpan = this._startSystemSpan("$offline", { pageViewSpanId: this.getCurrentPageViewSpanId() ?? undefined });
    }
  }

  // ---------------------------------------------------------------------------
  // Unload / teardown
  // ---------------------------------------------------------------------------

  private readonly _onPageHide = () => {
    // pagehide = the page is going away (unload or bfcache entry): close the
    // $page-view interval so time-on-page is correct, then flush keepalive. A
    // bfcache restore starts a fresh span via pageshow.
    this._endPageViewSpan();
    this._endOpenPresenceSpans();
    runAsynchronously(() => this._flush({ keepalive: true }));
  };

  private readonly _onVisibilityChangeFlush = () => {
    // A hidden tab is the last reliable moment to ship on mobile (pagehide may
    // never fire). The page may come back, so the $page-view span stays open.
    runAsynchronously(() => this._flush({ keepalive: true }));
  };

  private _setupPageHideListeners() {
    window.addEventListener("pagehide", this._onPageHide);
    document.addEventListener("visibilitychange", this._onVisibilityChangeFlush);
    this._detachListeners = () => {
      window.removeEventListener("pagehide", this._onPageHide);
      document.removeEventListener("visibilitychange", this._onVisibilityChangeFlush);
    };
  }

  private _teardown() {
    if (this._detachListeners) {
      this._detachListeners();
      this._detachListeners = null;
    }
    if (this._detachAutocaptureListeners) {
      this._detachAutocaptureListeners();
      this._detachAutocaptureListeners = null;
    }
    if (this._detachIntegrityListeners) {
      this._detachIntegrityListeners();
      this._detachIntegrityListeners = null;
    }
    if (this._webVitals !== null) {
      this._webVitals.disconnect();
      this._webVitals = null;
      this._webVitalsSpanId = null;
    }
    this._pageViewSpan = null;
    this._awaySpan = null;
    this._awayReasons.clear();
    this._awaySpanSeenReasons.clear();
    this._offlineSpan = null;
    this._recentClicks = [];
    this._lastCopyHash = null;

    // Restore history methods
    const historyObject = window.history;
    if (hasHistoryMethods(historyObject)) {
      if (this._originalPushState) {
        historyObject.pushState = this._originalPushState;
      }
      if (this._originalReplaceState) {
        historyObject.replaceState = this._originalReplaceState;
      }
    }
    this._originalPushState = null;
    this._originalReplaceState = null;

    window.removeEventListener("popstate", this._onPopState);
    document.removeEventListener("click", this._onClickCapture, { capture: true });
    this._teardownDeadClickDetection();

    this._settleAllPending("analytics tracker stopped");
    this._events = [];
    this._approxBytes = 0;
  }

  private async _flush(options: { keepalive: boolean }) {
    if (this._disabled) return;

    // A keepalive flush means the page is unloading — a click still awaiting
    // dead-click classification led to that unload, so it is alive by
    // definition and ships unmarked.
    if (options.keepalive) {
      this._unclassifiedClicks.clear();
    }

    // Clicks still awaiting classification stay buffered so the sweep can
    // mark them dead in place; classification finishes well within one flush
    // interval, so they ride the next flush at the latest. Span rows are never
    // held back — the holdback exists only for dead-click classification.
    const events = this._events.filter((event) => !this._unclassifiedClicks.has(event));
    const spanEntries = [...this._spanUpdates.values()];
    if (events.length === 0 && spanEntries.length === 0) return;
    this._events = this._events.filter((event) => this._unclassifiedClicks.has(event));
    this._spanUpdates.clear();
    this._approxBytes = this._events.reduce((total, event) => total + JSON.stringify(event).length, 0);

    // Snapshot the settlers of everything this batch carries: they settle with
    // this send's outcome. Items buffered after this point ride the next flush.
    const settlers: Settler[] = [];
    for (const event of events) {
      const settler = this._eventSettlers.get(event);
      if (settler) {
        settlers.push(settler);
        this._eventSettlers.delete(event);
      }
    }
    for (const entry of spanEntries) {
      settlers.push(...entry.settlers);
    }

    const nowMs = Date.now();

    const batchId = generateUuid();
    const payload = {
      session_replay_segment_id: this._sessionReplaySegmentId,
      batch_id: batchId,
      sent_at_ms: nowMs,
      events,
      ...spanEntries.length > 0 ? { spans: spanEntries.map((entry) => entry.row) } : {},
    };

    const send = (async () => {
      try {
        const res = await this._deps.sendBatch(
          JSON.stringify(payload),
          { keepalive: options.keepalive },
        );

        if (res.status === "error") {
          // All rejections are pre-caught at promise creation, so failures are
          // silent for fire-and-forget callers and observable for awaiting ones.
          for (const settler of settlers) settler.reject(res.error);
          if (isAnalyticsNotEnabledError(res.error)) {
            this._disable();
            return;
          }
          // Ad blockers commonly block analytics endpoints, causing network
          // errors. These are expected and should not pollute the console.
          if (isAdBlockerNetworkError(res.error)) {
            return;
          }
          console.warn("EventTracker flush failed:", res.error);
          return;
        }

        if (!res.data.ok) {
          const text = await res.data.text();
          for (const settler of settlers) settler.reject(new Error(`EventTracker flush failed: ${res.data.status} ${text}`));
          console.warn("EventTracker flush failed:", res.data.status, text);
          return;
        }

        for (const settler of settlers) settler.resolve();
      } catch (error) {
        // _flush must never reject (public flush() and fire-and-forget callers
        // don't expect telemetry failures to throw); the settlers carry it.
        for (const settler of settlers) settler.reject(error);
        console.warn("EventTracker flush failed:", error);
      }
    })();

    const tracked: Promise<void> = send.finally(() => {
      this._inFlight.delete(tracked);
    });
    this._inFlight.add(tracked);
    registerTelemetryBackgroundTask(this._deps.registerBackgroundTask, tracked, "EventTracker");
    await tracked;
  }

  private _disable() {
    this._disabled = true;
    if (this._flushTimer !== null) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    this._teardown();
  }

  private _tick() {
    if (this._cancelled) return;
    if (this._events.length > 0 || this._spanUpdates.size > 0) {
      runAsynchronously(() => this._flush({ keepalive: false }));
    }
  }
}
