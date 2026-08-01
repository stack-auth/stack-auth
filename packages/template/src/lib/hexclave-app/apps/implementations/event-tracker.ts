import { isBrowserLike } from "@hexclave/shared/dist/utils/env";
import { CLICKMAP_ROOT_ID, DEV_TOOL_ROOT_ID } from "@hexclave/shared/dist/utils/dev-tool";
import { cssEscapeIdent } from "@hexclave/shared/dist/utils/dom";
import { buildElementsChain, ELEMENTS_CHAIN_MAX_DEPTH } from "@hexclave/shared/dist/utils/elements-chain";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { Result } from "@hexclave/shared/dist/utils/results";
import { generateW3cSpanId, generateW3cTraceId, uuidToW3cSpanId, type ClientSystemSpanType, type SystemEventType } from "@hexclave/shared/dist/utils/analytics-wire";
import { createSpanCore, createSpanHandle, type SpanCore } from "./span-handle";
import { assertValidSpanStartInput, getCustomTelemetryDataError, getCustomTelemetryNameError, preCaught, registerTelemetryBackgroundTask, rejectedPreCaught, resolveSpanParent, type Span, type SpanContext, type SpanUpdateRow, type StartSpanOptions, type TrackOptions } from "./telemetry-core";
import { generateUuid, isAdBlockerNetworkError, isAnalyticsNotEnabledError } from "./telemetry-transport";
import type { TelemetryResource } from "./telemetry-config";
import { getAmbientSpanContexts } from "./span-context";
import { beginHttpClientSpanCore, HTTP_CLIENT_SPANS_PER_PAGE_VIEW_CAP, normalizeNetworkCaptureOptions, sanitizeHttpClientUrl, shouldCaptureNetworkRequest, type HttpRequestSpanHandle, type NetworkCaptureConfig } from "./network-capture";
// Runtime-safe: span-propagation only imports TYPES from the telemetry modules.
import { buildFetchInitWithSpanContext, buildPropagationHeaderValues, type RequestSpanInfo, type SpanPropagationContext } from "./span-propagation";
import { startWebVitalsCollector, type WebVitalsCollector } from "./web-vitals";
import { getKeptTraceIds, isTraceSampled } from "./trace-sampling";

// The environment-independent core of the custom telemetry API (types,
// validation, parent resolution, withSpanImpl) moved to telemetry-core.ts so
// this module — with its ~1.5k lines of autocapture — can be lazy-loaded.
// Re-exported for compatibility (span-propagation.ts and external consumers
// import the types from here).
export {
  getCustomTelemetryDataError,
  getCustomTelemetryNameError,
  preCaught,
  registerTelemetryBackgroundTask,
  rejectedPreCaught,
  resolveEndedAtMs,
  resolveSpanParent,
  withSpanImpl,
  type ParentRef,
  type Span,
  type SpanContext,
  type SpanUpdateRow,
  type StartSpanOptions,
  type TrackOptions,
} from "./telemetry-core";

const FLUSH_INTERVAL_MS = 10_000;
const MAX_EVENTS_PER_BATCH = 50;
const MAX_APPROX_BYTES_PER_BATCH = 64_000;
// Circuit breaker (see the _breakerOpenUntilMs field): N identical network
// failures in a row ⇒ assume a deterministic blocker (ad blocker, proxy) and
// stop sending for the cooldown; a quota 429 opens it for the server's
// Retry-After. Status-0-style failures get few strikes on purpose — they
// virtually never heal within a page's lifetime.
const BREAKER_NETWORK_FAILURE_THRESHOLD = 3;
const BREAKER_NETWORK_COOLDOWN_MS = 5 * 60_000;
const BREAKER_DEFAULT_RETRY_AFTER_MS = 60_000;
// See _capLiveSpanRegistries.
export const LIVE_SPAN_REGISTRY_SOFT_CAP = 1000;

type Settler = {
  resolve: () => void,
  reject: (error: unknown) => void,
};

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

export type KeystrokeCaptureOptions = {
  enabled: boolean,
  maskAllInputs: boolean,
  blockClass?: string | RegExp,
  blockSelector?: string,
};

export type EventTrackerDeps = {
  projectId: string,
  resource: TelemetryResource,
  sendBatch: (body: string, options: { keepalive: boolean }) => Promise<Result<Response, Error>>,
  // Per-tab id shared with the SessionRecorder so analytics events and replay
  // chunks from the same tab carry the same session_replay_segment_id. Falls
  // back to a fresh uuid when constructed standalone (e.g. in tests).
  sessionReplaySegmentId?: string,
  /** The authenticated refresh-token span: the stable root of browser telemetry. */
  sessionRootContext?: SpanContext,
  /** Whether the replay + per-tab lifecycle levels exist between the root and page views. */
  sessionReplayEnabled?: boolean,
  // Product autocapture is independently gated from logs/spans, which still
  // use this shared buffer when Analytics is disabled.
  productAnalyticsEnabled?: boolean,
  // Opt-in replay keyboard activity. This is deliberately configured from the
  // replay options so its privacy boundary matches rrweb's recorder settings.
  keystrokeCapture?: KeystrokeCaptureOptions,
  // Serverless keep-alive hook (TelemetryOptions.waitUntil): every batch-send
  // promise is passed to it so un-awaited sends survive runtime teardown.
  registerBackgroundTask?: (promise: Promise<unknown>) => void,
  // Origin policy for span.fetch / propagation headers (same-origin default +
  // exact-origin allowlist). Provided by the app from observability.spanPropagation.
  getPropagationPolicy?: () => { selfOrigin: string | null, allowedOrigins: readonly string[], allowLocalhost: boolean },
  // Opt-in presence/integrity signals ($away, clipboard, context-menu, print,
  // fullscreen-exit). Default OFF: they are surveillance-adjacent, so capturing
  // them must be a deliberate customer decision
  // (AnalyticsOptions.integritySignals), not default autocapture.
  integritySignals?: boolean,
  // Recursion guard for $http-client capture: analytics and session-replay
  // batch uploads would otherwise enqueue another span for the next batch
  // forever. Normal SDK API/auth calls are captured for cross-tier tracing.
  // URL-based rather than a re-entrancy flag, so timer and keepalive sends are
  // covered too.
  shouldIgnoreFetchUrl?: (url: string) => boolean,
  // Normalized ObservabilityOptions.network (sampling + origin/URL filters for
  // $http-client spans). Defaults to capture-everything when omitted.
  networkCapture?: NetworkCaptureConfig,
  // Healthy traces are sampled once from the complete flush snapshot. Defaults
  // to 1 for direct EventTracker construction in tests and internal callers.
  traceSampleRate?: number,
};

type TrackedEvent = {
  // System types ($page-view, $click, $form-submit, …) from the auto-capture
  // paths, or a custom name (validated against CUSTOM_TELEMETRY_NAME_RE) from
  // trackEvent().
  event_type: string,
  event_at_ms: number,
  data: Record<string, unknown>,
  // The enclosing span this event happened inside. Both are omitted together for
  // an event with no enclosing span (autocapture at the top of a task): an event
  // is an instant, so unlike a span it has no identity of its own to anchor a
  // trace with.
  trace_id?: string,
  span_id?: string,
  // CORRELATION, not ancestry: the `$page-view` span the event happened on.
  page_view_span_id?: string,
  // `$log`-only wire fields (route-enforced: REQUIRED on $log items, forbidden
  // on every other event type).
  message?: string,
  level?: string,
};

/**
 * Internal handle for client-minted SYSTEM spans ($page-view, $away, …).
 * Deliberately NOT a public `Span`: system spans have no public capabilities
 * (no child spans, no propagation headers, no settling promises), so the handle
 * exposes only what the tracker itself needs. Its W3C identity IS exposed, because
 * `$away`/`$offline` parent under the page view and events correlate to it. All
 * operations are fire-and-forget.
 */
type SystemSpanHandle = {
  readonly traceId: string,
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
// A short trailing debounce turns a typing burst into one bounded analytics
// event. The payload carries only the number and timing of keydown events —
// never KeyboardEvent.key/code or input values.
const KEYSTROKE_DEBOUNCE_MS = 500;
const FORM_FIELD_NAMES_MAX = 50;
// Click targets whose href looks like a file download even without a `download`
// attribute (the attribute is also honored; this catches plain file links).
const DOWNLOAD_EXTENSION_RE = /\.(pdf|zip|gz|tar|tgz|rar|7z|dmg|pkg|exe|msi|apk|csv|tsv|xls[xm]?|doc[xm]?|ppt[xm]?|mp3|wav|mp4|mov|avi|webm)$/i;

type PendingKeystrokeBatch = {
  target: Element,
  count: number,
  eventAtMs: number,
  startedAtPerformanceMs: number,
  lastAtPerformanceMs: number,
  url: string,
  path: string,
};

function classMatchesReplayBlock(element: Element, blockClass: string | RegExp): boolean {
  if (typeof blockClass === "string") return element.classList.contains(blockClass);
  for (const className of element.classList) {
    // RegExp instances with g/y flags are stateful. Preserve the caller's
    // lastIndex so privacy filtering cannot alternate between matching and not
    // matching the same class across keystrokes.
    const lastIndex = blockClass.lastIndex;
    blockClass.lastIndex = 0;
    const matches = blockClass.test(className);
    blockClass.lastIndex = lastIndex;
    if (matches) return true;
  }
  return false;
}

function isInsideBlockedReplaySubtree(element: Element, options: KeystrokeCaptureOptions): boolean {
  // rrweb defaults blockClass to rr-block when the SDK caller does not provide
  // one; mirror the effective option so keyboard metadata cannot reveal
  // activity from a subtree that is absent from playback.
  const blockClass = options.blockClass ?? "rr-block";
  let current: Element | null = element;
  while (current !== null) {
    if (classMatchesReplayBlock(current, blockClass)) return true;
    if (options.blockSelector !== undefined && current.matches(options.blockSelector)) return true;
    current = current.parentElement;
  }
  return false;
}

function isMaskedReplayInput(element: Element, maskAllInputs: boolean): boolean {
  // rrweb masks password inputs even when maskAllInputs is false. When it is
  // true (Hexclave's default), it masks every input/textarea/select. Skip the
  // event rather than reporting even a count, which could reveal secret length.
  if (element instanceof HTMLInputElement) {
    return element.type.toLowerCase() === "password" || maskAllInputs;
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return maskAllInputs;
  }
  // rrweb's default text-masking class also applies recursively to descendants,
  // including contenteditable regions.
  return element.closest(".rr-mask") !== null;
}

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
  private _sessionRootContext: SpanContext | null;
  private readonly _sessionReplayEnabled: boolean;
  // A deterministic segment id is not sufficient proof that its row exists in
  // this trace. It becomes a valid parent only after replay ingestion has
  // acknowledged materializing the segment under the current refresh root.
  private _sessionReplaySegmentMaterialized = false;

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
  // custom events and spans until cleared (end() auto-clears).
  private _globalSpans = new Set<Span>();
  // Live (un-ended) span handles' inert switches; flipped on clearBuffer so a
  // span started before sign-out can never be re-written under the next user.
  private _liveSpanControls = new Set<{ markInert: () => void }>();
  // See _capLiveSpanRegistries.
  private _warnedLiveSpanRegistryCap = false;
  // Batch sends currently on the wire; flush() awaits these.
  private _inFlight = new Set<Promise<void>>();

  // Circuit breaker against deterministic delivery blockers. Ad blockers and
  // corporate proxies fail every send the same way — retrying each flush
  // interval just burns network and console noise — and a quota 429 tells us
  // exactly how long to stay away. While the breaker is open, _flush drains
  // buffers WITHOUT touching the network (memory stays bounded, settlers
  // reject). A network-failure breaker also closes early when the browser
  // reports connectivity returned.
  private _consecutiveNetworkFailures = 0;
  private _breakerOpenUntilMs = 0;
  private _breakerOnlineListener: (() => void) | null = null;

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
  private _keystrokeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingKeystrokes: PendingKeystrokeBatch | null = null;
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

  // $http-client volume control: normalized config, a per-page-view span
  // counter (reset in _capturePageView), and the warn-once flag for the cap.
  private readonly _networkCapture: NetworkCaptureConfig;
  private readonly _traceSampleRate: number;
  private readonly _keystrokeCapture: KeystrokeCaptureOptions;
  private _httpClientSpanCount = 0;
  private _warnedHttpClientSpanCap = false;

  constructor(deps: EventTrackerDeps) {
    this._deps = deps;
    this._sessionReplaySegmentId = deps.sessionReplaySegmentId ?? generateUuid();
    this._sessionRootContext = deps.sessionRootContext ?? null;
    this._sessionReplayEnabled = deps.sessionReplayEnabled === true;
    this._networkCapture = deps.networkCapture ?? normalizeNetworkCaptureOptions(undefined);
    this._traceSampleRate = deps.traceSampleRate ?? 1;
    this._keystrokeCapture = deps.keystrokeCapture ?? { enabled: false, maskAllInputs: true };
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

    if (this._deps.productAnalyticsEnabled !== false) {
      this._setupPageViewCapture();
      this._setupClickCapture();
      this._setupDeadClickDetection();
      this._setupAutocaptureListeners();
      if (this._deps.integritySignals === true) {
        this._setupIntegritySignals();
      }
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
    this._flushPendingKeystrokes();
    this._endPageViewSpan();
    this._endOpenPresenceSpans();
    runAsynchronously(() => this._flush({ keepalive: true }));
    this._teardown();
  }

  clearBuffer() {
    this._clearPendingKeystrokes();
    this._settleAllPending("analytics buffer cleared");
    this._events = [];
    this._approxBytes = 0;
    this._unclassifiedClicks.clear();
    this._disconnectDeadClickMutationObserverIfIdle();
  }

  // Rejects every pending custom-event/span promise, drops buffered span rows,
  // and inert-ifies all live
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
    this._sessionReplaySegmentMaterialized = false;
    // Paired with clearBuffer() on sign-out (clearBuffer runs first): the
    // previous $page-view span and any open presence spans were inert-ified
    // under the old identity, so the ongoing page needs fresh spans under the
    // new segment. Page views are span-only; rotation just restarts the
    // `$page-view` interval under the new identity (same as restore).
    if (this._deps.productAnalyticsEnabled !== false && this._started && !this._cancelled && !this._disabled) {
      this._capturePageView("rotation");
      this._restartPresenceSpans();
    }
  }

  /**
   * Installs the authenticated refresh-token root after startup. Identity
   * resolution is intentionally asynchronous so click/page capture never waits
   * for anonymous sign-up or token refresh.
   */
  setSessionRootContext(sessionRootContext: SpanContext): void {
    this._updateSessionHierarchy(sessionRootContext, false);
  }

  private _updateSessionHierarchy(sessionRootContext: SpanContext, markSegmentMaterialized: boolean): void {
    const previousParent = this._pageViewLifecycleParent();
    this._sessionRootContext = sessionRootContext;
    if (markSegmentMaterialized) this._sessionReplaySegmentMaterialized = true;
    const nextParent = this._pageViewLifecycleParent();
    const parentChanged = previousParent === null
      ? nextParent !== null
      : nextParent === null
        || previousParent.traceId !== nextParent.traceId
        || previousParent.spanId !== nextParent.spanId;
    if (
      parentChanged
      && this._deps.productAnalyticsEnabled !== false
      && this._started
      && !this._cancelled
      && !this._disabled
    ) {
      this._capturePageView("rotation");
      this._restartPresenceSpans();
    }
  }

  /**
   * Marks the current tab segment as a usable parent after the replay endpoint
   * has durably materialized it. The callback also refreshes the session root:
   * auth can rotate while this lazy tracker stays mounted, and combining an old
   * trace id with a segment written under the new refresh token creates a
   * cross-trace missing parent. A stale acknowledgement for a pre-rotation
   * segment is ignored.
   */
  markSessionReplaySegmentMaterialized(segmentId: string, sessionRootContext: SpanContext): void {
    if (segmentId !== this._sessionReplaySegmentId) return;
    this._updateSessionHierarchy(sessionRootContext, true);
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
   * failure. Invalid input and disabled telemetry reject explicitly.
   *
   * `internalOptions.eventAtMs` is the adoption path for events captured before
   * this lazily-loaded module arrived (ClientAnalytics buffers them with their
   * real timestamps) — deliberately NOT part of the public TrackOptions, since
   * user-supplied timestamps would need server-side plausibility validation.
   */
  trackCustomEvent(eventType: string, data?: Record<string, unknown>, options?: TrackOptions, internalOptions?: { eventAtMs?: number }): Promise<void> {
    const nameError = getCustomTelemetryNameError("event", eventType);
    if (nameError) return rejectedPreCaught(nameError);
    const dataError = getCustomTelemetryDataError(data);
    if (dataError) return rejectedPreCaught(dataError);
    const enclosing = this._resolveEnclosingSpan(options);
    if ("error" in enclosing) return rejectedPreCaught(enclosing.error);
    if (this._disabled) {
      return rejectedPreCaught("telemetry is disabled");
    }

    const pageViewSpanId = this.getCurrentPageViewSpanId();
    const event: TrackedEvent = {
      event_type: eventType,
      event_at_ms: internalOptions?.eventAtMs ?? Date.now(),
      data: { ...data ?? {} },
      ...enclosing.span !== null ? { trace_id: enclosing.span.traceId, span_id: enclosing.span.spanId } : {},
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
   * Buffers a `$log` event (app.logger / console capture). Same buffering,
   * ambient parenting, page stamping and settling semantics as
   * trackCustomEvent — minus the custom-name validation ($log is a system
   * type) and plus the log wire fields. `options`/`internalOptions` exist for
   * the facade's pre-load adoption path (pre-resolved parents + the real
   * timestamp), mirroring trackCustomEvent's adoption contract.
   */
  trackLogEvent(log: { message: string, level: string }, data?: Record<string, unknown>, options?: TrackOptions, internalOptions?: { eventAtMs?: number }): Promise<void> {
    const dataError = getCustomTelemetryDataError(data);
    if (dataError) return rejectedPreCaught(dataError);
    const enclosing = this._resolveEnclosingSpan(options);
    if ("error" in enclosing) return rejectedPreCaught(enclosing.error);
    if (this._disabled) {
      return rejectedPreCaught("telemetry is disabled");
    }

    const pageViewSpanId = this.getCurrentPageViewSpanId();
    const event: TrackedEvent = {
      event_type: "$log",
      event_at_ms: internalOptions?.eventAtMs ?? Date.now(),
      data: { ...data ?? {} },
      message: log.message,
      level: log.level,
      ...enclosing.span !== null ? { trace_id: enclosing.span.traceId, span_id: enclosing.span.spanId } : {},
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
   * Buffers a `$error` event from the global error-capture module.
   * System-event semantics: fire-and-forget and no custom parent chain — the
   * global handlers run at the top of the task where no ambient withSpan frame
   * exists anyway (a failure INSIDE a span interval is recorded on the span's
   * own `data.error` instead). `eventAtMs` is the adoption path for errors
   * captured before this lazily-loaded module arrived.
   */
  trackErrorEvent(data: Record<string, unknown>, internalOptions?: { eventAtMs?: number }): void {
    this._pushSystemEvent("$error", data, internalOptions);
  }

  /**
   * Starts a custom span: the open interval is written on the next flush and
   * re-written (versioned upsert) on setData/end. Invalid input and disabled
   * telemetry throw instead of returning an inert handle.
   */
  startSpan(spanType: string, options?: StartSpanOptions): Span {
    assertValidSpanStartInput(spanType, options);
    const resolved = resolveSpanParent({
      explicit: options?.parent,
      ambient: this._ambientSpanContexts(),
      fallbackParent: this._currentPageViewContext(),
      links: options?.links,
      root: options?.root,
    });
    if ("error" in resolved) {
      throw new Error(`Hexclave analytics: ${resolved.error}`);
    }
    if (this._disabled) {
      throw new Error("Hexclave analytics: telemetry is disabled");
    }

    // Trace and parent are frozen at creation: they are identity, not state, so a
    // later setGlobalSpan call can never re-parent an existing span (and every
    // re-write of this span carries the same identity). The page correlation is
    // frozen for the same reason: a span that outlives its page still reports the
    // page it STARTED on.
    const pageViewSpanId = this.getCurrentPageViewSpanId();

    // `handle` is assigned synchronously below; the closures can only fire after.
    let handle!: { span: Span, markInert: () => void };
    const control = { markInert: () => handle.markInert() };
    handle = createSpanHandle({
      traceId: resolved.traceId,
      spanId: generateW3cSpanId(),
      spanType,
      startedAtMs: options?.startedAtMs ?? Date.now(),
      parentSpanId: resolved.parentSpanId,
      links: resolved.links,
      pageViewSpanId,
      initialData: { ...options?.data ?? {} },
      validateData: getCustomTelemetryDataError,
      isSuppressed: () => this._disabled,
      enqueueRow: (row) => this._enqueueSpanUpdate(row),
      onEnded: () => {
        this._globalSpans.delete(handle.span);
        this._liveSpanControls.delete(control);
      },
      capabilities: {
        trackEvent: (eventType, data, trackOptions) => this.trackCustomEvent(eventType, data, trackOptions),
        startChildSpan: (childType, childOptions) => this.startSpan(childType, childOptions),
        // The FROZEN page correlation rides along (not the current page): headers
        // pinned to this span must describe this span's context exactly.
        getSpanPropagationHeaders: (span) => this._spanPropagationHeaders(span, pageViewSpanId),
        fetch: (span, input, init) => this._spanFetch(span, pageViewSpanId, input, init),
      },
    });
    this._liveSpanControls.add(control);
    this._capLiveSpanRegistries();
    return handle.span;
  }

  /**
   * Starts a client-minted SYSTEM span ($page-view, $away, $offline). Unlike the
   * public startSpan: no name/data validation (callers are internal), no ambient
   * parenting, and no public capabilities. Registered in _liveSpanControls, so
   * sign-out inert-ifies it like any live span (a span started under user A must
   * never be re-written under user B).
   *
   * Parenting is EXPLICIT here rather than ambient, because `$page-view` must
   * pick up the lifecycle parent (segment when replay is enabled, refresh token
   * otherwise), never whichever custom span happens to be ambient.
   * `$away`/`$offline` pass the current page-view context explicitly for the
   * same reason the ambient chain would give them anyway — stated outright
   * because these fire from lifecycle listeners with no ambient frame at all.
   */
  private _startSystemSpan(spanType: ClientSystemSpanType, opts?: { data?: Record<string, unknown>, parent?: SpanContext | null, pageViewSpanId?: string }): SystemSpanHandle {
    // Same state machine as custom spans (versioning, data accumulation, inert
    // switch) — but no data validation (callers are internal) and no public
    // capabilities. `core` is assigned synchronously below; the control closure
    // can only fire after.
    let core!: SpanCore;
    const control = { markInert: () => core.markInert() };
    core = createSpanCore({
      traceId: opts?.parent?.traceId ?? generateW3cTraceId(),
      spanId: generateW3cSpanId(),
      spanType,
      startedAtMs: Date.now(),
      parentSpanId: opts?.parent?.spanId ?? null,
      pageViewSpanId: opts?.pageViewSpanId ?? null,
      initialData: { ...opts?.data ?? {} },
      validateData: null,
      isSuppressed: () => this._disabled,
      enqueueRow: (row) => this._enqueueSpanUpdate(row),
      onEnded: () => this._liveSpanControls.delete(control),
    });
    this._liveSpanControls.add(control);
    this._capLiveSpanRegistries();
    return {
      traceId: core.traceId,
      spanId: core.spanId,
      spanType,
      isEnded: () => core.isEnded(),
      setData: (data: Record<string, unknown>) => {
        // The core rejects on an ended span; that pre-caught rejection is the
        // fire-and-forget equivalent of the old silent no-op.
        core.setData(data).catch(() => {});
      },
      end: (endedAtMs?: number) => {
        core.end(endedAtMs).catch(() => {});
      },
    };
  }

  /**
   * The `$http-client` span factory backing the fetch/XHR wrappers'
   * `beginRequestSpan` hook. One span per outgoing request, on the system-span
   * substrate: `page_view_span_id` stamping like other system spans, plus —
   * unlike other system spans — AMBIENT parenting. A fetch issued inside
   * `withSpan()` joins that span's trace; a bare fetch joins the current
   * `$page-view`'s. Either way the backend work it triggers inherits the same
   * trace through `traceparent`, so page → request → server → database is ONE
   * tree. Only a fetch with no page view at all (the pre-load window, or a
   * non-browser runtime) roots a trace of its own.
   *
   * Returns null when the request must not be recorded (disabled, SDK-own URL,
   * filtered origin, per-page-view cap). Callers (the global wrappers) guard
   * against throws; this method itself avoids throwing on the expected paths.
   */
  beginHttpRequestSpan(info: RequestSpanInfo): HttpRequestSpanHandle | null {
    if (this._disabled) return null;
    if (this._deps.shouldIgnoreFetchUrl?.(info.url) === true) return null;
    const sanitizedUrl = sanitizeHttpClientUrl(info.url);
    if (sanitizedUrl === null) return null;
    // sanitizeHttpClientUrl parsed the same string successfully, so this
    // cannot throw.
    const target = new URL(info.url);
    if (!shouldCaptureNetworkRequest(this._networkCapture, target)) return null;
    if (this._httpClientSpanCount >= HTTP_CLIENT_SPANS_PER_PAGE_VIEW_CAP) {
      if (!this._warnedHttpClientSpanCap) {
        // Warned once per tracker (not per page) so a polling page cannot spam
        // the console across navigations.
        this._warnedHttpClientSpanCap = true;
        console.warn(`Hexclave analytics: more than ${HTTP_CLIENT_SPANS_PER_PAGE_VIEW_CAP} outgoing requests on one page view; further $http-client spans on this page are dropped`);
      }
      return null;
    }
    this._httpClientSpanCount += 1;

    // Ambient parenting only (no explicit parent exists for auto-instrumentation),
    // falling back to the page this request was made from. Contexts come from our
    // own live handles, so an error should be impossible — but it must degrade to
    // "own trace root", never break the caller's request.
    const ambient = this._ambientSpanContexts();
    const pageView = this._currentPageViewContext();
    const resolved = resolveSpanParent({ ambient, fallbackParent: pageView });
    const parent = "error" in resolved ? resolveSpanParent({ ambient: [] }) : resolved;
    if ("error" in parent) {
      throw new Error(`Hexclave analytics: ${parent.error}`);
    }

    // `control` is assigned synchronously below; onEnded can only fire after.
    let control!: { markInert: () => void };
    const handle = beginHttpClientSpanCore({
      config: this._networkCapture,
      sampled: isTraceSampled(parent.traceId, this._traceSampleRate),
      sanitizedUrl,
      method: info.method,
      transport: info.transport,
      traceId: parent.traceId,
      parentSpanId: parent.parentSpanId,
      pageViewSpanId: this.getCurrentPageViewSpanId(),
      isSuppressed: () => this._disabled,
      enqueueRow: (row) => this._enqueueSpanUpdate(row),
      onEnded: () => this._liveSpanControls.delete(control),
    });
    control = { markInert: handle.markInert };
    this._liveSpanControls.add(control);
    this._capLiveSpanRegistries();
    return handle;
  }

  /** The correlation context pinned to exactly `span`: its frozen page correlation
   * plus the per-tab segment identity. Hierarchy is NOT here — it rides the
   * `traceparent` built by _spanPropagationHeaders. */
  private _spanPropagationContext(pageViewSpanId: string | null): SpanPropagationContext {
    return {
      projectId: this._deps.projectId,
      sessionReplaySegmentId: this._sessionReplaySegmentId,
      ...pageViewSpanId !== null ? { pageViewSpanId } : {},
    };
  }

  /**
   * Correlation is always safe to expose to an allowed origin. Hierarchy is
   * pinned only when the deterministic trace decision guarantees this span's
   * row will survive a healthy flush.
   */
  private _spanPropagationHeaders(span: Span, pageViewSpanId: string | null): Record<string, string> {
    const sampled = isTraceSampled(span.traceId, this._traceSampleRate);
    return buildPropagationHeaderValues({
      traceparent: sampled ? {
        ...span.spanContext(),
        sampled: true,
      } : null,
      context: this._spanPropagationContext(pageViewSpanId),
    });
  }

  private _spanFetch(span: Span, pageViewSpanId: string | null, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      const policy = this._deps.getPropagationPolicy?.() ?? {
        selfOrigin: typeof window !== "undefined" ? window.location.origin : null,
        allowedOrigins: [],
        allowLocalhost: false,
      };
      const initWithHeader = buildFetchInitWithSpanContext({
        input,
        init,
        headerValues: this._spanPropagationHeaders(span, pageViewSpanId),
        selfOrigin: policy.selfOrigin,
        allowedOrigins: policy.allowedOrigins,
        allowLocalhost: policy.allowLocalhost,
      });
      return globalThis.fetch(input, initWithHeader?.init ?? init);
    } catch {
      // Propagation must never break the caller's actual request.
      return globalThis.fetch(input, init);
    }
  }

  /**
   * Registers a span as an ambient parent for all subsequently created custom
   * events and spans. Ending the span automatically unregisters it.
   *
   * Registering several global spans is no longer an error the way incompatible
   * ancestry paths used to be: the NEAREST ambient context wins as parent, and any
   * other global span in a different trace is recorded as a link instead. That is
   * strictly more expressive than the old "one path or reject" rule.
   */
  setGlobalSpan(span: Span): void {
    if (span.isEnded) {
      console.warn("Hexclave analytics: setGlobalSpan() called with an already-ended span; ignoring");
      return;
    }
    this._globalSpans.add(span);
    this._capLiveSpanRegistries();
  }

  clearGlobalSpan(span: Span): void {
    this._globalSpans.delete(span);
  }

  /**
   * Soft-caps the live-span registries: both grow one entry per never-ended
   * span, so an app that starts spans in a loop and never ends them would leak
   * without bound. Beyond the cap the OLDEST entry is evicted (Sets iterate in
   * insertion order): an evicted live-control is inert-ified first — its open
   * row remains valid server-side, only local mutability is lost — and an
   * evicted global span simply stops being an ambient parent. Trade-off:
   * pathological span usage degrades gracefully instead of leaking; the warning
   * fires once per tracker so a hot loop cannot spam the console.
   */
  private _capLiveSpanRegistries(): void {
    let evicted = false;
    if (this._liveSpanControls.size > LIVE_SPAN_REGISTRY_SOFT_CAP) {
      const oldest = this._liveSpanControls.values().next();
      if (!oldest.done) {
        oldest.value.markInert();
        this._liveSpanControls.delete(oldest.value);
        evicted = true;
      }
    }
    if (this._globalSpans.size > LIVE_SPAN_REGISTRY_SOFT_CAP) {
      const oldest = this._globalSpans.values().next();
      if (!oldest.done) {
        this._globalSpans.delete(oldest.value);
        evicted = true;
      }
    }
    if (evicted && !this._warnedLiveSpanRegistryCap) {
      this._warnedLiveSpanRegistryCap = true;
      console.warn(`Hexclave analytics: more than ${LIVE_SPAN_REGISTRY_SOFT_CAP} live spans are registered; dropping the oldest ones from the local registry (their open rows remain valid, but local mutability/ambient parenting is lost). End spans you no longer need.`);
    }
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

  private _ambientSpanContexts(): SpanContext[] {
    const contexts: SpanContext[] = [];
    for (const span of this._globalSpans) {
      if (!span.isEnded) contexts.push(span.spanContext());
    }
    // Enclosing withSpan() frames, outermost first, after the globals. Exact
    // primitive (ALS/AsyncContext) → the per-flow store, always. Sync-stack
    // fallback → only prologue-open frames (provably same-flow); after an await
    // in browsers, rebind via the span handle (`span.run` / `trackEvent` / …).
    contexts.push(...getAmbientSpanContexts());
    return contexts;
  }

  /**
   * The enclosing span a new EVENT belongs to: an explicit `parent`, else the
   * nearest ambient context (which in a browser bottoms out at the current
   * `$page-view` — see _ambientSpanContexts), else none. Events are instants, so
   * unlike spans they never mint a trace of their own: an event with nothing
   * enclosing it (before the tab's first page view, or under `root: true`)
   * carries no trace/span id at all, and is then reachable only by its
   * correlation columns.
   */
  private _resolveEnclosingSpan(options: TrackOptions | undefined): { span: SpanContext | null } | { error: string } {
    const resolved = resolveSpanParent({
      explicit: options?.parent,
      ambient: this._ambientSpanContexts(),
      fallbackParent: this._currentPageViewContext(),
      links: options?.links,
      root: options?.root,
    });
    if ("error" in resolved) return resolved;
    return { span: resolved.parentSpanId === null ? null : { traceId: resolved.traceId, spanId: resolved.parentSpanId } };
  }

  /** The current `$page-view` span's context, or null before the first page view. */
  private _currentPageViewContext(): SpanContext | null {
    const span = this._pageViewSpan;
    return span === null ? null : { traceId: span.traceId, spanId: span.spanId };
  }

  /**
   * The old session hierarchy expressed with the new scalar W3C schema. Early
   * pages remain direct children of the refresh root until replay ingestion
   * confirms the segment row exists in this exact trace. This preserves the old
   * server-resolved behavior and prevents cross-trace phantom segment parents.
   */
  private _pageViewLifecycleParent(): SpanContext | null {
    if (this._sessionRootContext === null) return null;
    if (!this._sessionReplayEnabled || !this._sessionReplaySegmentMaterialized) return this._sessionRootContext;
    return {
      traceId: this._sessionRootContext.traceId,
      spanId: uuidToW3cSpanId(this._sessionReplaySegmentId),
    };
  }

  /**
   * The ambient contexts every new event/span would get right now — live global
   * spans first, then enclosing withSpan() frames (outermost first), so the LAST
   * entry is the nearest. Used by cross-tier propagation so an outgoing request
   * joins the same trace a locally-tracked span would.
   */
  getAmbientSpanContexts(): SpanContext[] {
    return this._ambientSpanContexts();
  }

  /**
   * The ancestor of last resort for anything started on this page — see
   * `resolveSpanParent`'s `fallbackParent`. Exposed (alongside the ambient list)
   * so a manually-instrumented transport propagates the same hierarchy the
   * auto-instrumented one would.
   */
  getPageViewSpanContext(): SpanContext | null {
    return this._currentPageViewContext();
  }

  /**
   * Adoption path for span rows minted BEFORE this lazily-loaded module
   * arrived: ClientAnalytics builds pre-load span handles on the shared state
   * machine and routes their rows here once the tracker exists. Rows carry
   * their own monotonic versions, so late delivery is safe for the
   * ReplacingMergeTree upsert model.
   */
  enqueueSpanUpdate(row: SpanUpdateRow): Promise<void> {
    // Mirrors the suppression of tracker-owned handles: once telemetry is
    // disabled, updates resolve without buffering.
    if (this._disabled) return Promise.resolve();
    return this._enqueueSpanUpdate(row);
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
  //
  // The enclosing span is the current `$page-view` DIRECTLY rather than through
  // _resolveEnclosingSpan: autocapture fires from DOM handlers, so whatever
  // withSpan frame happens to be open elsewhere on the page is not the operation
  // a click belongs to. The page view is.
  private _pushSystemEvent(eventType: SystemEventType, data: Record<string, unknown>, internalOptions?: { eventAtMs?: number }) {
    const dataError = getCustomTelemetryDataError(data);
    if (dataError !== null) {
      console.warn(`Hexclave analytics: dropping ${eventType}: ${dataError}`);
      return;
    }
    const pageViewSpanId = this.getCurrentPageViewSpanId();
    const enclosing = this._currentPageViewContext();
    this._pushEvent({
      event_type: eventType,
      // eventAtMs is the pre-load adoption path ($error capture installs
      // eagerly, before this module arrives) — see trackCustomEvent's
      // internalOptions for the rationale.
      event_at_ms: internalOptions?.eventAtMs ?? Date.now(),
      data,
      ...enclosing !== null ? { trace_id: enclosing.traceId, span_id: enclosing.spanId } : {},
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
    // Keep a burst on the page where it started. Otherwise a route change that
    // lands inside the debounce window would stamp old typing onto the new page.
    this._flushPendingKeystrokes();
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
    // Session → replay → tab segment → page is the product's trace boundary.
    // The scalar parent stores only the immediate segment edge; the backend
    // materializes the replay/segment rows after it resolves the durable replay.
    const span = this._startSystemSpan("$page-view", {
      data: pageViewData,
      parent: this._pageViewLifecycleParent(),
    });
    this._pageViewSpan = span;
    this._resetScrollDepth();
    // Rage bursts describe repeated interaction with one page. Carrying the
    // prior route's clicks into an SPA navigation creates false positives.
    this._recentClicks = [];
    // The $http-client volume cap is per page view.
    this._httpClientSpanCount = 0;

    // Web vitals are collected PER $page-view span: the tab's hard load gets
    // all five metrics ({ mode: "initial" }), while every later entry (SPA
    // push/replace/pop, bfcache restore, sign-out rotation) gets a soft-nav
    // collector — CLS/INP only, windowed to entries after this navigation and
    // flagged `soft_nav: 1` so dashboards never mix them into load metrics.
    // Values are absorbed into the span's data as they finalize and frozen
    // when the span ends (updates within a flush window coalesce into one wire
    // row, so no extra throttling is needed).
    if (this._webVitals !== null) {
      // _endPageViewSpan (called above) already froze + disconnected the
      // previous span's collector; this guards the paths where the previous
      // span was ended elsewhere (e.g. pagehide before a bfcache restore) —
      // one collector must never feed two spans.
      this._webVitals.disconnect();
      this._webVitals = null;
      this._webVitalsSpanId = null;
    }
    let collector: WebVitalsCollector | null = null;
    collector = startWebVitalsCollector(
      () => {
        if (collector !== null && !span.isEnded()) {
          span.setData({ web_vitals: collector.snapshot() });
        }
      },
      entryType === "initial"
        ? { mode: "initial" }
        // performance.now() HERE is the navigation timestamp: _capturePageView
        // runs synchronously inside the pushState/replaceState patch and the
        // popstate/pageshow handlers.
        : { mode: "soft-nav", navStartTime: performance.now() },
    );
    if (collector !== null) {
      this._webVitals = collector;
      this._webVitalsSpanId = span.spanId;
    }
  }

  /**
   * Ends the current $page-view span, absorbing the final scroll depth and the
   * span's web-vitals snapshot so the single deduped wire row carries both the
   * data and the end time.
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
    // Built inline rather than through _pushSystemEvent (dead-click
    // classification needs the object identity before it is buffered), so the
    // enclosing-span stamping has to be repeated here — same rule: the current
    // `$page-view` span is the operation a click happens inside.
    const enclosing = this._currentPageViewContext();
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
      ...enclosing !== null ? { trace_id: enclosing.traceId, span_id: enclosing.spanId } : {},
      ...pageViewSpanId !== null ? { page_view_span_id: pageViewSpanId } : {},
    };

    // Register for dead-click classification before buffering, so a
    // size-triggered flush from this very push already holds the click back.
    if (this._deadClickTimer !== null && this._unclassifiedClicks.size < DEAD_CLICK_MAX_PENDING) {
      // Connect BEFORE the classification windows start, so mutations caused
      // by this click are observed (observe() registers synchronously).
      this._connectDeadClickMutationObserver();
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

    // Capture phase so scrolls inside nested scroll containers count, not just
    // the document itself (scroll events don't bubble).
    document.addEventListener("scroll", this._onDeadClickScroll, { capture: true, passive: true });
    document.addEventListener("selectionchange", this._onDeadClickSelectionChange);
    document.addEventListener("visibilitychange", this._onDeadClickVisibilityChange);

    // The MutationObserver is NOT connected here: observing the whole document
    // subtree for the entire session costs a callback on every DOM change,
    // while `_lastMutationAtMs` is only ever consumed while a click awaits
    // classification. The observer connects in the click handler (see
    // `_connectDeadClickMutationObserver`) and disconnects once the pending
    // set drains.
    this._deadClickTimer = setInterval(() => this._checkDeadClicks(), DEAD_CLICK_CHECK_INTERVAL_MS);
  }

  /**
   * Connects the dead-click MutationObserver for the duration of pending click
   * classification. Called SYNCHRONOUSLY from the click handler, before any
   * classification window opens: MutationObserver.observe() registers
   * synchronously, so DOM mutations caused by this very click (delivered on the
   * following microtask) are still observed. Classification semantics are
   * unchanged — only post-click mutations count anyway (`signalWithin` filters
   * `signalAtMs >= click.event_at_ms`), so a stale `_lastMutationAtMs` from a
   * previous observation window can never mark a later click alive.
   */
  private _connectDeadClickMutationObserver() {
    if (this._deadClickMutationObserver !== null) return;
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
  }

  // Disconnecting with pending mutation records is safe: records only matter
  // while clicks await classification, and this runs exactly when none do.
  private _disconnectDeadClickMutationObserverIfIdle() {
    if (this._unclassifiedClicks.size > 0) return;
    if (this._deadClickMutationObserver !== null) {
      this._deadClickMutationObserver.disconnect();
      this._deadClickMutationObserver = null;
    }
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
    this._disconnectDeadClickMutationObserverIfIdle();
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
    if (event.persisted) {
      this._capturePageView("restore");
      // pagehide closed presence spans before its keepalive flush. Browsers do
      // not replay offline/visibility events for state that remained true while
      // frozen, so restore must sample those sensors again under the new view.
      this._restartPresenceSpans();
    }
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

  private readonly _onKeyDownCapture = (event: KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      this._flushPendingKeystrokes();
      return;
    }
    if (
      isInsideHexclaveUi(target)
      || isInsideBlockedReplaySubtree(target, this._keystrokeCapture)
      || isMaskedReplayInput(target, this._keystrokeCapture.maskAllInputs)
    ) {
      // A private/blocked target is also a batching boundary: never merge
      // activity on either side of it into one event whose duration spans the
      // hidden interaction.
      this._flushPendingKeystrokes();
      return;
    }

    const eventAtMs = Date.now();
    const nowPerformanceMs = performance.now();
    if (this._pendingKeystrokes !== null && this._pendingKeystrokes.target !== target) {
      this._flushPendingKeystrokes();
    }
    if (this._pendingKeystrokes === null) {
      this._pendingKeystrokes = {
        target,
        count: 1,
        eventAtMs,
        startedAtPerformanceMs: nowPerformanceMs,
        lastAtPerformanceMs: nowPerformanceMs,
        url: window.location.href,
        path: window.location.pathname,
      };
    } else {
      this._pendingKeystrokes.count += 1;
      this._pendingKeystrokes.lastAtPerformanceMs = nowPerformanceMs;
    }

    if (this._keystrokeDebounceTimer !== null) clearTimeout(this._keystrokeDebounceTimer);
    this._keystrokeDebounceTimer = setTimeout(() => {
      this._keystrokeDebounceTimer = null;
      this._flushPendingKeystrokes();
    }, KEYSTROKE_DEBOUNCE_MS);
  };

  private _flushPendingKeystrokes() {
    if (this._keystrokeDebounceTimer !== null) {
      clearTimeout(this._keystrokeDebounceTimer);
      this._keystrokeDebounceTimer = null;
    }
    const pending = this._pendingKeystrokes;
    this._pendingKeystrokes = null;
    if (pending === null) return;
    this._pushSystemEvent("$keystroke", {
      count: pending.count,
      duration_ms: pending.lastAtPerformanceMs - pending.startedAtPerformanceMs,
      url: pending.url,
      path: pending.path,
    }, { eventAtMs: pending.eventAtMs });
  }

  private _clearPendingKeystrokes() {
    if (this._keystrokeDebounceTimer !== null) {
      clearTimeout(this._keystrokeDebounceTimer);
      this._keystrokeDebounceTimer = null;
    }
    this._pendingKeystrokes = null;
  }

  private readonly _onOffline = () => {
    if (this._offlineSpan !== null && !this._offlineSpan.isEnded()) return;
    this._offlineSpan = this._startSystemSpan("$offline", { parent: this._currentPageViewContext(), pageViewSpanId: this.getCurrentPageViewSpanId() ?? undefined });
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
    if (this._keystrokeCapture.enabled) {
      document.addEventListener("keydown", this._onKeyDownCapture, { capture: true });
    }
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
      document.removeEventListener("keydown", this._onKeyDownCapture, { capture: true });
      this._clearPendingKeystrokes();
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
        parent: this._currentPageViewContext(),
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
      this._offlineSpan = this._startSystemSpan("$offline", { parent: this._currentPageViewContext(), pageViewSpanId: this.getCurrentPageViewSpanId() ?? undefined });
    }
  }

  // ---------------------------------------------------------------------------
  // Unload / teardown
  // ---------------------------------------------------------------------------

  private readonly _onPageHide = () => {
    // pagehide = the page is going away (unload or bfcache entry): close the
    // $page-view interval so time-on-page is correct, then flush keepalive. A
    // bfcache restore starts a fresh span via pageshow.
    this._flushPendingKeystrokes();
    this._endPageViewSpan();
    this._endOpenPresenceSpans();
    runAsynchronously(() => this._flush({ keepalive: true }));
  };

  private readonly _onVisibilityChangeFlush = () => {
    // A hidden tab is the last reliable moment to ship on mobile (pagehide may
    // never fire). The page may come back, so the $page-view span stays open.
    this._flushPendingKeystrokes();
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
    if (this._breakerOnlineListener !== null) {
      window.removeEventListener("online", this._breakerOnlineListener);
      this._breakerOnlineListener = null;
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
      this._disconnectDeadClickMutationObserverIfIdle();
    }

    // Clicks still awaiting classification stay buffered so the sweep can
    // mark them dead in place; classification finishes well within one flush
    // interval, so they ride the next flush at the latest. Span rows are never
    // held back — the holdback exists only for dead-click classification.
    const bufferedEvents = this._events.filter((event) => !this._unclassifiedClicks.has(event));
    const bufferedSpanEntries = [...this._spanUpdates.values()];
    if (bufferedEvents.length === 0 && bufferedSpanEntries.length === 0) return;
    this._events = this._events.filter((event) => this._unclassifiedClicks.has(event));
    this._spanUpdates.clear();
    this._approxBytes = this._events.reduce((total, event) => total + JSON.stringify(event).length, 0);

    // Sampling belongs HERE, after producer updates have coalesced and before a
    // transport payload exists. One decision therefore covers the complete
    // event/span trace group in this flush instead of each producer rolling its
    // own coin. Failed/slow traces are promoted by getKeptTraceIds.
    const keptTraceIds = getKeptTraceIds(
      bufferedEvents,
      bufferedSpanEntries.map((entry) => entry.row),
      this._traceSampleRate,
    );
    const keepEvent = (event: TrackedEvent) =>
      event.trace_id === undefined || keptTraceIds.has(event.trace_id);
    const events = bufferedEvents.filter(keepEvent);
    const spanEntries = bufferedSpanEntries.filter((entry) => keptTraceIds.has(entry.row.trace_id));

    // Snapshot the settlers of everything this batch carries. Sampled-out
    // items resolve locally: sampling is a successful delivery policy decision,
    // not a transport failure callers should retry.
    const settlers: Settler[] = [];
    for (const event of bufferedEvents) {
      const settler = this._eventSettlers.get(event);
      if (settler) {
        this._eventSettlers.delete(event);
        if (keepEvent(event)) settlers.push(settler);
        else settler.resolve();
      }
    }
    for (const entry of bufferedSpanEntries) {
      if (keptTraceIds.has(entry.row.trace_id)) {
        settlers.push(...entry.settlers);
      } else {
        for (const settler of entry.settlers) settler.resolve();
        // Keep only the latest OPEN ancestor locally. If a later flush promotes
        // this trace, its root/page-view row is still available and the error
        // trace does not start at a dangling parent. Ended healthy work is
        // discarded now; retaining whole long-lived browser traces would make
        // sampling an unbounded memory buffer.
        if (
          entry.row.ended_at_ms === null
          && this._spanUpdates.size < LIVE_SPAN_REGISTRY_SOFT_CAP
        ) {
          this._spanUpdates.set(entry.row.span_id, { row: entry.row, settlers: [] });
          this._approxBytes += JSON.stringify(entry.row).length;
        }
      }
    }
    if (events.length === 0 && spanEntries.length === 0) return;

    // Breaker open: drain without touching the network. Buffers were already
    // cleared above, so memory stays bounded no matter how long the blocker
    // persists; awaiting callers see a rejection like any other send failure.
    if (Date.now() < this._breakerOpenUntilMs) {
      const breakerError = new Error("Hexclave analytics: delivery paused after repeated send failures (ad blocker, offline proxy, or quota)");
      for (const settler of settlers) settler.reject(breakerError);
      return;
    }

    const nowMs = Date.now();

    const batchId = generateUuid();
    const payload = {
      // Versions the BATCH BODY (shape of the envelope + rows), the same way
      // the span-context header versions itself with its `v1.` prefix. The
      // backend tolerates unknown fields today; a future route can dispatch on
      // this instead of sniffing shapes.
      schema_version: 3,
      resource: this._deps.resource,
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
          for (const settler of settlers) settler.reject(res.error);
          if (isAnalyticsNotEnabledError(res.error)) {
            this._disable();
            return;
          }
          // Ad blockers commonly block analytics endpoints, causing network
          // errors. These are expected and should not pollute the console.
          if (isAdBlockerNetworkError(res.error)) {
            this._recordBreakerNetworkFailure();
            return;
          }
          console.warn("Hexclave analytics: EventTracker flush failed:", res.error);
          return;
        }

        if (!res.data.ok) {
          if (res.data.status === 429) {
            // Quota exhausted: the server says exactly how long to stay away.
            const retryAfterSec = Number(res.data.headers.get("retry-after"));
            this._breakerOpenUntilMs = Date.now() + (Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : BREAKER_DEFAULT_RETRY_AFTER_MS);
          }
          const text = await res.data.text();
          for (const settler of settlers) settler.reject(new Error(`EventTracker flush failed: ${res.data.status} ${text}`));
          console.warn("Hexclave analytics: EventTracker flush failed:", res.data.status, text);
          return;
        }

        this._consecutiveNetworkFailures = 0;
        for (const settler of settlers) settler.resolve();
      } catch (error) {
        // _flush must never reject (public flush() and fire-and-forget callers
        // don't expect telemetry failures to throw); the settlers carry it.
        for (const settler of settlers) settler.reject(error);
        console.warn("Hexclave analytics: EventTracker flush failed:", error);
      }
    })();

    const tracked: Promise<void> = send.finally(() => {
      this._inFlight.delete(tracked);
    });
    this._inFlight.add(tracked);
    registerTelemetryBackgroundTask(this._deps.registerBackgroundTask, tracked, "EventTracker");
    await tracked;
  }

  private _recordBreakerNetworkFailure() {
    this._consecutiveNetworkFailures += 1;
    if (this._consecutiveNetworkFailures < BREAKER_NETWORK_FAILURE_THRESHOLD) return;
    this._breakerOpenUntilMs = Date.now() + BREAKER_NETWORK_COOLDOWN_MS;
    // Connectivity returning is the one signal that a status-0 blocker might
    // actually have healed (tethering flaps, captive portals) — close early.
    if (this._breakerOnlineListener === null && typeof window !== "undefined") {
      const listener = () => {
        this._breakerOpenUntilMs = 0;
        this._consecutiveNetworkFailures = 0;
      };
      this._breakerOnlineListener = listener;
      window.addEventListener("online", listener);
    }
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
