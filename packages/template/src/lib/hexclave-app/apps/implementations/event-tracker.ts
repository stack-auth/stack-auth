import { isBrowserLike } from "@hexclave/shared/dist/utils/env";
import { CLICKMAP_ROOT_ID, DEV_TOOL_ROOT_ID } from "@hexclave/shared/dist/utils/dev-tool";
import { cssEscapeIdent } from "@hexclave/shared/dist/utils/dom";
import { buildElementsChain, ELEMENTS_CHAIN_MAX_DEPTH } from "@hexclave/shared/dist/utils/elements-chain";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { Result } from "@hexclave/shared/dist/utils/results";
import { CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES, CUSTOM_TELEMETRY_MAX_PARENT_CHAIN, CUSTOM_TELEMETRY_NAME_RE } from "@hexclave/shared/dist/utils/telemetry";
import { generateUuid, isAdBlockerNetworkError, isAnalyticsNotEnabledError } from "./session-replay";
import { getAmbientSpanRefs, runWithSpanContext } from "./span-context";

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
   * Drop specific ambient parents ("I don't want THAT span as a parent").
   * Filters the FINAL merged parent list — an excluded span stays excluded even
   * when it re-enters via a kept child's frozen chain, which means "descendants
   * of the excluded span" queries will not match this item (by design; that is
   * the literal meaning of the option, not a dedupe bug).
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
};

type Settler = {
  resolve: () => void,
  reject: (error: unknown) => void,
};

// Subscribing an internal no-op handler means an ignored rejection never counts
// as "unhandled" (the runtime only reports rejected promises with zero
// subscribers), while callers who do await still observe it through their own
// handler. This is what makes fire-and-forget usage safe.
function preCaught<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}

export function rejectedPreCaught(message: string): Promise<never> {
  console.error(`Hexclave analytics: ${message}`);
  return preCaught(Promise.reject(new Error(message)));
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
};

type TrackedEvent = {
  // System types ($page-view, $click) from the auto-capture paths, or a custom
  // name (validated against CUSTOM_TELEMETRY_NAME_RE) from trackEvent().
  event_type: string,
  event_at_ms: number,
  data: Record<string, unknown>,
  // Custom ancestor chain, root-first, raw span uuids. Omitted for system
  // events; the server composes system ancestry on top for every event.
  parent_span_ids?: string[],
};

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
    this._setupPageHideListeners();

    this._flushTimer = setInterval(() => this._tick(), FLUSH_INTERVAL_MS);
  }

  stop() {
    this._cancelled = true;
    if (this._flushTimer !== null) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
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

    const event: TrackedEvent = {
      event_type: eventType,
      event_at_ms: Date.now(),
      data: { ...data ?? {} },
      ...resolved.ids.length > 0 ? { parent_span_ids: resolved.ids } : {},
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
      ref: () => ({ spanId, parentSpanIds: [...parentSpanIds] }),
    };

    // Write the open interval right away: a span the user never ends (e.g. the
    // tab closes) still shows up, as an open interval, from its first flush on.
    enqueue(null).catch(() => {});
    return span;
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
    // Enclosing withSpan() frames, outermost first, after the globals.
    refs.push(...getAmbientSpanRefs());
    return refs;
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

  private _capturePageView(entryType: "initial" | "push" | "replace" | "pop") {
    const screenObject = window.screen;
    if (!hasScreenDimensions(screenObject)) {
      return;
    }

    const url = window.location.href;
    if (url === this._lastUrl && entryType !== "initial") return;
    this._lastUrl = url;

    this._pushEvent({
      event_type: "$page-view",
      event_at_ms: Date.now(),
      data: {
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
      },
    });
  }

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

  private _findNearestAnchorHref(element: Element): string | null {
    let current: Element | null = element;
    while (current) {
      if (current.tagName === "A" && current.hasAttribute("href")) {
        return current.getAttribute("href");
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

    const clickEvent: TrackedEvent = {
      event_type: "$click",
      event_at_ms: Date.now(),
      data: {
        tag_name: target.tagName.toLowerCase(),
        text: getTextSnippet(target.textContent),
        href: this._findNearestAnchorHref(target),
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
      },
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

  private readonly _onPageHide = () => {
    runAsynchronously(() => this._flush({ keepalive: true }));
  };

  private _setupPageHideListeners() {
    window.addEventListener("pagehide", this._onPageHide);
    document.addEventListener("visibilitychange", this._onPageHide);
    this._detachListeners = () => {
      window.removeEventListener("pagehide", this._onPageHide);
      document.removeEventListener("visibilitychange", this._onPageHide);
    };
  }

  private _teardown() {
    if (this._detachListeners) {
      this._detachListeners();
      this._detachListeners = null;
    }

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
    this._deps.registerBackgroundTask?.(tracked);
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
