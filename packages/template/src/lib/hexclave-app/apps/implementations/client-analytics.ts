import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { Result } from "@hexclave/shared/dist/utils/results";
import type { AnalyticsReplayOptions } from "./analytics-config";
import { installClientErrorCapture, type ClientErrorCapture, type NormalizedErrorCaptureOptions } from "./error-capture";
import type { EventTracker } from "./event-tracker";
import type { LogEmitItem } from "./logs";
import type { TelemetryResource } from "./telemetry-config";
import { beginHttpClientSpanCore, sanitizeHttpClientUrl, shouldCaptureNetworkRequest, type HttpRequestSpanHandle, type NetworkCaptureConfig } from "./network-capture";
import type { SessionRecorder } from "./session-replay";
import { createSpanHandle } from "./span-handle";
import { getAmbientSpanRefs } from "./span-context";
// Runtime-safe: span-propagation only imports TYPES from the telemetry modules.
import { buildFetchInitWithSpanContext, encodeSpanContextHeader, SPAN_CONTEXT_HEADER, type RequestSpanInfo } from "./span-propagation";
import { assertValidSpanStartInput, getCustomTelemetryDataError, getCustomTelemetryNameError, preCaught, rejectedPreCaught, resolveParentIds, type Span, type SpanRef, type SpanUpdateRow, type StartSpanOptions, type TrackOptions } from "./telemetry-core";
import { generateUuid } from "./telemetry-transport";

/**
 * Lazily-loading front for the browser analytics runtime (EventTracker +
 * SessionRecorder). The two modules total ~2k lines that used to ship in every
 * initial bundle via static imports from the app constructor; this facade is
 * the only thing constructed eagerly — it holds the per-tab segment identity
 * (needed at construction time by the fetch span-propagation installer) and
 * `import()`s the real modules on idle, or immediately on the first explicit
 * analytics API call.
 *
 * Contract for the pre-load window (construction → module arrival):
 * - trackEvent: parents and timestamp are captured synchronously (the browser
 *   sync-stack ambient frames close at the first await, so resolution cannot
 *   wait for the load) and the event is re-submitted to the tracker on
 *   arrival — nothing fired in the window is dropped.
 * - startSpan: returns a REAL handle built on the shared span state machine;
 *   its rows queue behind the load and are adopted by the tracker. Pre-load
 *   spans predate the tab's first `$page-view` span, so their rows carry no
 *   page ancestry — accepted: the call itself triggers an immediate load, so
 *   the window is module-fetch latency, and user code overwhelmingly runs
 *   after it closes.
 * - Autocapture (clicks, page views, replay) only exists once the modules
 *   load; the idle deadline bounds what the very first seconds can miss. This
 *   is the standard trade of lazily-loaded analytics snippets.
 * - Sign-out privacy holds pre-load too: clearBuffer() bumps a generation that
 *   queued items check at adoption, and inert-ifies pre-load span handles.
 */

// Don't defer forever on busy pages: everything before the load is invisible
// to autocapture, so cap the idle wait. The fallback delay (no
// requestIdleCallback, e.g. Safari) just yields past hydration's critical path.
const IDLE_LOAD_TIMEOUT_MS = 2_000;
const FALLBACK_LOAD_DELAY_MS = 200;
// Pre-load queue bound for automatic console-capture logs. Unlike explicit
// telemetry calls, console mirrors must never TRIGGER the runtime load (a
// chatty hydration would drag ~2k lines of analytics code onto the critical
// path), so they wait for the idle-scheduled load in this ring buffer;
// overflow drops the OLDEST entries — the newest logs are the ones that
// explain the state the page ends up in.
const PRELOAD_CONSOLE_LOG_CAP = 100;

export type ClientAnalyticsDeps = {
  projectId: string,
  resource: TelemetryResource,
  sendEventBatch: (body: string, options: { keepalive: boolean }) => Promise<Result<Response, Error>>,
  sendReplayBatch: (body: string, options: { keepalive: boolean }) => Promise<Result<Response, Error>>,
  /** Replay options incl. the enabled flag; the recorder module is not even fetched when disabled. */
  replayOptions: AnalyticsReplayOptions,
  /** Enables product autocapture independently from the shared telemetry transport. */
  productAnalyticsEnabled: boolean,
  registerBackgroundTask?: (promise: Promise<unknown>) => void,
  getPropagationPolicy: () => { selfOrigin: string | null, allowedOrigins: readonly string[], allowLocalhost: boolean },
  integritySignals: boolean,
  /** Normalized ObservabilityOptions.network — $http-client volume control. */
  networkCapture: NetworkCaptureConfig,
  /** SDK-own-URL recursion guard for $http-client spans — see EventTrackerDeps. */
  shouldIgnoreFetchUrl: (url: string) => boolean,
  /** Normalized ObservabilityOptions.errorCapture — the global $error capture installs eagerly from this facade. */
  errorCapture: NormalizedErrorCaptureOptions,
  /** Resource service.version / deployment environment and SDK version, stamped on $error events. */
  release: string | null,
  environment: string | null,
  sdkVersion: string,
};

export class ClientAnalytics {
  private readonly _deps: ClientAnalyticsDeps;
  private _segmentId: string;
  private _tracker: EventTracker | null = null;
  private _recorder: SessionRecorder | null = null;
  private _loadPromise: Promise<EventTracker> | null = null;
  // Pre-load mirrors of the tracker's registries; transferred on adoption.
  private readonly _preloadGlobalSpans = new Set<Span>();
  private readonly _preloadSpanControls = new Set<{ markInert: () => void }>();
  // Bumped by clearBuffer (sign-out): pre-load items queued under an older
  // generation must never be delivered under the next user's identity.
  private _bufferGeneration = 0;
  // Console-capture logs that arrived before the tracker loaded — see
  // PRELOAD_CONSOLE_LOG_CAP. Drained (generation-checked) on load.
  private readonly _pendingConsoleLogs: { log: LogEmitItem, parentIds: string[], eventAtMs: number, generation: number }[] = [];
  // The installed global error capture (null when disabled or non-browser).
  // Kept for tests; there is no facade teardown that would uninstall it.
  private _errorCapture: ClientErrorCapture | null = null;

  constructor(deps: ClientAnalyticsDeps) {
    this._deps = deps;
    // One per-tab id shared by the SessionRecorder and EventTracker, so replay
    // chunks and analytics events from the same tab report the same
    // session_replay_segment_id. Minted here (eagerly) because the fetch
    // propagation wrapper needs it from the first instrumented request on.
    this._segmentId = generateUuid();

    const kickOff = () => runAsynchronously(async () => {
      await this._ensureLoaded();
    }, { noErrorLogging: true }); // _doLoad already warns with context
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(kickOff, { timeout: IDLE_LOAD_TIMEOUT_MS });
    } else {
      setTimeout(kickOff, FALLBACK_LOAD_DELAY_MS);
    }

    // Global error capture installs EAGERLY (here, not in the lazily-loaded
    // tracker): errors thrown before the tracker module arrives — often the
    // most interesting ones, e.g. a broken hydration — must still capture.
    // They route through trackErrorEvent's pre-load adoption path below.
    if (deps.errorCapture.enabled) {
      this._errorCapture = installClientErrorCapture({
        emit: (data) => this.trackErrorEvent(data),
        ignoreErrors: deps.errorCapture.ignoreErrors,
        release: deps.release,
        environment: deps.environment,
        sdkVersion: deps.sdkVersion,
        getCurrentPageViewSpanId: () => this.getCurrentPageViewSpanId(),
      });
    }
  }

  /** The installed global error capture, or null. Exposed for tests. */
  getErrorCapture(): ClientErrorCapture | null {
    return this._errorCapture;
  }

  /** The loaded tracker, or null while the module is still on its way. Exposed for tests. */
  getLoadedTracker(): EventTracker | null {
    return this._tracker;
  }

  /** Triggers the load (if not already running) and resolves once the runtime is live. */
  loadNow(): Promise<void> {
    return preCaught(this._ensureLoaded().then(() => {}));
  }

  private _ensureLoaded(): Promise<EventTracker> {
    if (this._loadPromise === null) {
      // preCaught: fire-and-forget consumers (the idle kickoff) must not turn
      // an import failure into an unhandled rejection; awaiting consumers
      // still observe it.
      this._loadPromise = preCaught(this._doLoad());
    }
    return this._loadPromise;
  }

  private async _doLoad(): Promise<EventTracker> {
    // Fetch both chunks in parallel; the recorder failing (or being disabled)
    // must never take event tracking down with it.
    const trackerImport = Result.fromPromise(import("./event-tracker"));
    const recorderImport = this._deps.replayOptions.enabled ? Result.fromPromise(import("./session-replay")) : null;

    const trackerModule = await trackerImport;
    if (trackerModule.status === "error") {
      console.warn("Hexclave analytics: failed to load the analytics runtime; telemetry from this page will be dropped.", trackerModule.error);
      throw new Error("Hexclave analytics: failed to load the analytics runtime");
    }
    const tracker = new trackerModule.data.EventTracker({
      projectId: this._deps.projectId,
      resource: this._deps.resource,
      sendBatch: this._deps.sendEventBatch,
      sessionReplaySegmentId: this._segmentId,
      productAnalyticsEnabled: this._deps.productAnalyticsEnabled,
      registerBackgroundTask: this._deps.registerBackgroundTask,
      getPropagationPolicy: this._deps.getPropagationPolicy,
      integritySignals: this._deps.integritySignals,
      networkCapture: this._deps.networkCapture,
      shouldIgnoreFetchUrl: this._deps.shouldIgnoreFetchUrl,
    });
    this._tracker = tracker;
    tracker.start();
    // Transfer still-live pre-load global spans; they were validated mutually
    // compatible at registration and the fresh tracker has no ambient state to
    // conflict with. NOTE: their handles' end() only cleans the facade's (now
    // empty) registry, so an ended transferred span lingers in the tracker's
    // set — benign, every reader filters on isEnded and the set is soft-capped.
    for (const span of this._preloadGlobalSpans) {
      if (!span.isEnded) tracker.setGlobalSpan(span);
    }
    this._preloadGlobalSpans.clear();

    // Drain the console-capture pre-load queue with each item's original
    // timestamp and parent chain. Same adoption contract as trackCustomEvent:
    // a generation bump (sign-out) between queueing and load drops the item.
    for (const item of this._pendingConsoleLogs.splice(0)) {
      if (item.generation !== this._bufferGeneration) continue;
      // Fire-and-forget (pre-caught): delivery failures already warn inside
      // the tracker's flush path.
      tracker.trackLogEvent(item.log, item.log.data, { root: true, parentIds: item.parentIds }, { eventAtMs: item.eventAtMs }).catch(() => {});
    }

    if (recorderImport !== null) {
      const recorderModule = await recorderImport;
      if (recorderModule.status === "error") {
        console.warn("Hexclave analytics: failed to load the session replay runtime; this page will not be recorded.", recorderModule.error);
      } else {
        this._recorder = new recorderModule.data.SessionRecorder({
          projectId: this._deps.projectId,
          resource: this._deps.resource,
          sendBatch: this._deps.sendReplayBatch,
          sessionReplaySegmentId: this._segmentId,
        }, this._deps.replayOptions);
        this._recorder.start();
      }
    }
    return tracker;
  }

  private _preloadAmbientRefs(): SpanRef[] {
    const refs: SpanRef[] = [];
    for (const span of this._preloadGlobalSpans) {
      if (!span.isEnded) refs.push(span.ref());
    }
    refs.push(...getAmbientSpanRefs());
    return refs;
  }

  /** See EventTracker.getAmbientParentRefs — used by cross-tier span propagation. */
  getAmbientParentRefs(): SpanRef[] {
    return this._tracker !== null ? this._tracker.getAmbientParentRefs() : this._preloadAmbientRefs();
  }

  getSessionReplaySegmentId(): string {
    return this._tracker?.getSessionReplaySegmentId() ?? this._segmentId;
  }

  getCurrentPageViewSpanId(): string | null {
    return this._tracker?.getCurrentPageViewSpanId() ?? null;
  }

  setSessionReplaySegmentId(id: string): void {
    this._segmentId = id;
    this._tracker?.setSessionReplaySegmentId(id);
    this._recorder?.setSessionReplaySegmentId(id);
  }

  clearBuffer(): void {
    this._bufferGeneration += 1;
    for (const control of this._preloadSpanControls) {
      control.markInert();
    }
    this._preloadSpanControls.clear();
    this._preloadGlobalSpans.clear();
    // Queued console mirrors belong to the pre-sign-out identity; the
    // generation check would drop them at drain anyway, clearing now just
    // frees them eagerly.
    this._pendingConsoleLogs.length = 0;
    this._tracker?.clearBuffer();
    this._recorder?.clearBuffer();
  }

  trackCustomEvent(eventType: string, data?: Record<string, unknown>, options?: TrackOptions): Promise<void> {
    if (this._tracker !== null) {
      return this._tracker.trackCustomEvent(eventType, data, options);
    }
    // Pre-load: validate and resolve parents NOW — the browser sync-stack
    // ambient frames (the withSpan fallback) close at the first await, so
    // resolution cannot be deferred until after the module loads.
    const nameError = getCustomTelemetryNameError("event", eventType);
    if (nameError) return rejectedPreCaught(nameError);
    const dataError = getCustomTelemetryDataError(data);
    if (dataError) return rejectedPreCaught(dataError);
    const resolved = resolveParentIds({
      explicit: options?.parentIds,
      ambient: this._preloadAmbientRefs(),
      root: options?.root,
      exclude: options?.excludeParentIds,
    });
    if ("error" in resolved) return rejectedPreCaught(resolved.error);
    const eventAtMs = Date.now();
    const generation = this._bufferGeneration;
    return preCaught((async () => {
      const tracker = await this._ensureLoaded();
      if (generation !== this._bufferGeneration) {
        throw new Error("Hexclave analytics: analytics buffer cleared");
      }
      // Re-submit with the pre-resolved chain as explicit raw parents plus
      // root: raw ids reconstruct the exact path (declared-next in array
      // order), and root drops the tracker's ambient context, which may have
      // changed since this call happened.
      await tracker.trackCustomEvent(eventType, data, { root: true, parentIds: resolved.ids }, { eventAtMs });
    })());
  }

  /**
   * `$log` delivery for `app.logger` (see logs.ts). Pre-load follows the exact
   * trackCustomEvent contract: parents and timestamp are captured
   * synchronously, the item re-submits to the tracker on arrival, and a
   * sign-out during the load window (generation bump) drops it.
   */
  trackLogEvent(log: LogEmitItem): Promise<void> {
    if (this._tracker !== null) {
      return this._tracker.trackLogEvent(log, log.data);
    }
    const dataError = getCustomTelemetryDataError(log.data);
    if (dataError) return rejectedPreCaught(dataError);
    const resolved = resolveParentIds({ ambient: this._preloadAmbientRefs() });
    if ("error" in resolved) return rejectedPreCaught(resolved.error);
    const eventAtMs = Date.now();
    const generation = this._bufferGeneration;
    if (log.origin === "console") {
      // Automatic mirrors wait for the idle-scheduled load instead of forcing
      // it (see PRELOAD_CONSOLE_LOG_CAP). Fire-and-forget by contract: the
      // caller is the console patch, which never awaits.
      if (this._pendingConsoleLogs.length >= PRELOAD_CONSOLE_LOG_CAP) {
        this._pendingConsoleLogs.shift();
      }
      this._pendingConsoleLogs.push({ log, parentIds: resolved.ids, eventAtMs, generation });
      return preCaught(Promise.resolve());
    }
    return preCaught((async () => {
      const tracker = await this._ensureLoaded();
      if (generation !== this._bufferGeneration) {
        throw new Error("Hexclave analytics: analytics buffer cleared");
      }
      await tracker.trackLogEvent(log, log.data, { root: true, parentIds: resolved.ids }, { eventAtMs });
    })());
  }

  /**
   * `$error` delivery for the global error-capture module. Fire-and-forget
   * (system-event semantics); pre-load captures adopt with their real
   * timestamp, and a sign-out during the load window silently drops them
   * (dropping is the intent there, not an error worth surfacing).
   */
  trackErrorEvent(data: Record<string, unknown>): void {
    if (this._tracker !== null) {
      this._tracker.trackErrorEvent(data);
      return;
    }
    const eventAtMs = Date.now();
    const generation = this._bufferGeneration;
    runAsynchronously(async () => {
      const tracker = await this._ensureLoaded();
      if (generation !== this._bufferGeneration) return;
      tracker.trackErrorEvent(data, { eventAtMs });
    }, { noErrorLogging: true }); // _doLoad already warns with context
  }

  startSpan(spanType: string, options?: StartSpanOptions): Span {
    if (this._tracker !== null) {
      return this._tracker.startSpan(spanType, options);
    }
    assertValidSpanStartInput(spanType, options);
    const resolved = resolveParentIds({
      explicit: options?.parentIds,
      ambient: this._preloadAmbientRefs(),
      root: options?.root,
      exclude: options?.excludeParentIds,
    });
    if ("error" in resolved) {
      throw new Error(`Hexclave analytics: ${resolved.error}`);
    }
    // Kick the load immediately: the very first row of this span already needs
    // the tracker, and starting the fetch now minimizes the pre-load window.
    runAsynchronously(async () => {
      await this._ensureLoaded();
    }, { noErrorLogging: true });

    let handle!: { span: Span, markInert: () => void };
    const control = { markInert: () => handle.markInert() };
    handle = createSpanHandle({
      spanId: generateUuid(),
      spanType,
      startedAtMs: options?.startedAtMs ?? Date.now(),
      parentSpanIds: resolved.ids,
      // Pre-load spans predate the tab's first $page-view span — see the
      // module comment.
      pageViewSpanId: null,
      initialData: { ...options?.data ?? {} },
      validateData: getCustomTelemetryDataError,
      enqueueRow: (row) => this._adoptRowWhenLoaded(row),
      onEnded: () => {
        this._preloadGlobalSpans.delete(handle.span);
        this._preloadSpanControls.delete(control);
      },
      capabilities: {
        // These route through the facade, so they transparently switch to the
        // tracker once it arrives.
        trackEvent: (childEventType, childData, trackOptions) => this.trackCustomEvent(childEventType, childData, trackOptions),
        startChildSpan: (childType, childOptions) => this.startSpan(childType, childOptions),
        getSpanPropagationHeaders: (span) => ({ [SPAN_CONTEXT_HEADER]: encodeSpanContextHeader(this._spanPropagationContext(span)) }),
        fetch: (span, input, init) => this._spanFetch(span, input, init),
      },
    });
    this._preloadSpanControls.add(control);
    return handle.span;
  }

  /**
   * `beginRequestSpan` provider hook for the fetch/XHR wrappers. The wrappers
   * install EAGERLY at app construction, so this must work before the tracker
   * module arrives: pre-load `$http-client` spans are built on the shared
   * keep/drop core with their rows adopted via enqueueSpanUpdate — the same
   * machinery as other pre-load spans (generation-checked, so sign-out during
   * the load window drops them). Pre-load spans predate the tab's first
   * $page-view span, so they carry no page ancestry; the per-page-view volume
   * cap starts with the tracker (the pre-load window is bounded by module
   * fetch latency, so it cannot amass meaningful volume).
   */
  beginHttpRequestSpan(info: RequestSpanInfo): HttpRequestSpanHandle | null {
    if (this._tracker !== null) {
      return this._tracker.beginHttpRequestSpan(info);
    }
    if (this._deps.shouldIgnoreFetchUrl(info.url)) return null;
    const sanitizedUrl = sanitizeHttpClientUrl(info.url);
    if (sanitizedUrl === null) return null;
    // sanitizeHttpClientUrl parsed the same string successfully, so this
    // cannot throw.
    const target = new URL(info.url);
    if (!shouldCaptureNetworkRequest(this._deps.networkCapture, target)) return null;

    // A request this early is also worth loading the runtime for.
    runAsynchronously(async () => {
      await this._ensureLoaded();
    }, { noErrorLogging: true });

    const resolved = resolveParentIds({ ambient: this._preloadAmbientRefs() });
    const parentSpanIds = "error" in resolved ? [] : resolved.ids;

    // `handle` is assigned synchronously below; the closures can only fire after.
    let handle!: HttpRequestSpanHandle;
    const control = { markInert: () => handle.markInert() };
    handle = beginHttpClientSpanCore({
      config: this._deps.networkCapture,
      sanitizedUrl,
      method: info.method,
      transport: info.transport,
      parentSpanIds,
      pageViewSpanId: null,
      enqueueRow: (row) => this._adoptRowWhenLoaded(row),
      onEnded: () => this._preloadSpanControls.delete(control),
    });
    this._preloadSpanControls.add(control);
    return handle;
  }

  private _adoptRowWhenLoaded(row: SpanUpdateRow): Promise<void> {
    const generation = this._bufferGeneration;
    return preCaught((async () => {
      const tracker = await this._ensureLoaded();
      if (generation !== this._bufferGeneration) {
        throw new Error("Hexclave analytics: analytics buffer cleared");
      }
      await tracker.enqueueSpanUpdate(row);
    })());
  }

  // Mirrors EventTracker._spanPropagationContext / _spanFetch for pre-load
  // handles: same frozen-chain pinning, same origin policy — just without a
  // page ancestry (pre-load spans have none) and with the facade's segment id.
  private _spanPropagationContext(span: Span) {
    const ref = span.ref();
    return {
      projectId: this._deps.projectId,
      sessionReplaySegmentId: this.getSessionReplaySegmentId(),
      customParentSpanIds: [...ref.parentSpanIds, ref.spanId],
    };
  }

  private _spanFetch(span: Span, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      const policy = this._deps.getPropagationPolicy();
      const initWithHeader = buildFetchInitWithSpanContext({
        input,
        init,
        headerValue: encodeSpanContextHeader(this._spanPropagationContext(span)),
        selfOrigin: policy.selfOrigin,
        allowedOrigins: policy.allowedOrigins,
        allowLocalhost: policy.allowLocalhost,
      });
      return globalThis.fetch(input, initWithHeader ?? init);
    } catch {
      // Propagation must never break the caller's actual request.
      return globalThis.fetch(input, init);
    }
  }

  setGlobalSpan(span: Span): void {
    if (this._tracker !== null) {
      this._tracker.setGlobalSpan(span);
      return;
    }
    if (span.isEnded) {
      console.warn("Hexclave analytics: setGlobalSpan() called with an already-ended span; ignoring");
      return;
    }
    const existing = [...this._preloadGlobalSpans].filter((candidate) => !candidate.isEnded).map((candidate) => candidate.ref());
    const resolved = resolveParentIds({ ambient: [...existing, span.ref()] });
    if ("error" in resolved) {
      throw new Error(`Hexclave analytics: ${resolved.error}`);
    }
    this._preloadGlobalSpans.add(span);
  }

  clearGlobalSpan(span: Span): void {
    this._tracker?.clearGlobalSpan(span);
    this._preloadGlobalSpans.delete(span);
  }

  /**
   * Sends everything buffered right now. Loading the runtime is part of the
   * delivery guarantee — anything queued pre-load can only ship through it.
   */
  async flush(): Promise<void> {
    const tracker = await preCaught(this._ensureLoaded());
    await tracker.flush();
  }
}
