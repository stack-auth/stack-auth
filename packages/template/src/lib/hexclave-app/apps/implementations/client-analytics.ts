import { trace as otelTrace, type Context } from "@opentelemetry/api";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { Result } from "@hexclave/shared/dist/utils/results";
import type { AnalyticsReplayOptions } from "./analytics-config";
import { buildCapturedEventData, buildErrorEventData, generateErrorEventId, installClientErrorCapture, type ClientErrorCapture, type NormalizedErrorCaptureOptions } from "./error-capture";
import type { CapturedErrorEvent, CaptureEvent, CaptureExceptionOptions, CaptureMessageOptions, ErrorAttachmentInput, ErrorAttachmentTransport, ErrorBreadcrumb, ErrorEventId, ErrorScopeData, PendingErrorAttachment } from "../interfaces/error-capture";
import type { EventTracker } from "./event-tracker";
import type { TelemetryResource } from "./telemetry-config";
import type { NetworkCaptureConfig } from "./network-capture";
import type { SessionRecorder } from "./session-replay";
import { buildAmbientSessionContext, getActiveOtelSpanContext } from "./otel-context";
// Runtime-safe: span-propagation only imports TYPES from the telemetry modules.
import { buildFetchInitWithSpanContext, buildPropagationHeaderValues } from "./span-propagation";
import { getCustomTelemetryDataError, getCustomTelemetryNameError, preCaught, rejectedPreCaught, resolveSpanParent, type Span, type SpanContext, type StartSpanOptions, type TrackOptions } from "./telemetry-core";
import { getActiveErrorScope, mergeErrorScopeData } from "./error-scope";
import { generateUuid } from "./telemetry-transport";
import { createOtelSpanFacade } from "./otel-span-facade";
import { emitHexclaveOtelError, emitHexclaveOtelEvent } from "./otel-log-facade";
import { registerManagedBrowserOtel, type BrowserManagedOtelRegistration } from "./browser-otel-sdk";
import { processErrorEvent, type ErrorProcessingResult } from "./error-processors";
import { createLogger, installConsoleCapture, type ConsoleCaptureLevel, type LogEmitItem } from "./logs";
import { createDefaultErrorIntegrationRegistry, type ErrorIntegrationRegistry, type ErrorIntegrationRuntime } from "./integration-registry";
import { assertErrorAttachmentDeliveryConfigured, deliverErrorAttachments, getErrorAttachmentInputs } from "./error-attachments";
import { installBrowserResourceErrorCapture } from "./browser-resource-errors";

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
 *   its rows queue behind the load and are adopted by the tracker. When the
 *   cached refresh-token root is available, pre-load spans use it as their
 *   session parent even though they predate the tab's first `$page-view`.
 * - Browser Fetch/XHR instrumentation is different: it is held until the
 *   authenticated root lookup settles when no cached root exists. An official
 *   HTTP instrumentation span cannot be reparented after creation, so letting
 *   it start in that window would permanently create the random roots this
 *   facade is specifically meant to avoid.
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

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return value !== null
    && (typeof value === "object" || typeof value === "function")
    && typeof Reflect.get(value, "then") === "function";
}

export type ClientAnalyticsDeps = {
  projectId: string,
  resource: TelemetryResource,
  sendReplayBatch: (body: string, options: { keepalive: boolean }) => Promise<Result<Response, Error>>,
  /** Resolves the stable refresh-token root before the browser tracker starts. */
  getSessionRootContext: () => Promise<SpanContext>,
  /** Returns a validated cached refresh-token root without doing I/O, when one is already available. */
  getCachedSessionRootContext?: () => SpanContext | null,
  /** Replay options incl. the enabled flag; the recorder module is not even fetched when disabled. */
  replayOptions: AnalyticsReplayOptions,
  /** Enables product autocapture independently from the shared telemetry transport. */
  productAnalyticsEnabled: boolean,
  registerBackgroundTask?: (promise: Promise<unknown>) => void,
  getPropagationPolicy: () => { selfOrigin: string | null, allowedOrigins: readonly string[], allowLocalhost: boolean },
  integritySignals: boolean,
  /** Normalized URL policy for the official browser HTTP instrumentations. */
  networkCapture: NetworkCaptureConfig,
  /** Shared deterministic healthy-trace rate used by propagation and flush. */
  traceSampleRate: number,
  /** Normalized ObservabilityOptions.errorCapture — the global $error capture installs eagerly from this facade. */
  errorCapture: NormalizedErrorCaptureOptions,
  /** Resource service.version / deployment environment and SDK version, stamped on $error events. */
  release: string | null,
  environment: string | null,
  sdkVersion: string,
  analyticsBaseUrl: string,
  openTelemetryProvider: "managed" | "existing-provider" | "disabled",
  /** When false, automatic hooks/load are deferred until an explicit call. */
  automaticSideEffects?: boolean,
  /** Existing console instrumentation configuration, bridged into breadcrumbs. */
  consoleCaptureLevels?: readonly ConsoleCaptureLevel[],
  /** Existing OTel log sink used by the console instrumentation bridge. */
  emitLog?: (item: LogEmitItem) => "ok" | "unavailable",
  /** Receives every accepted local error identity, including automatic captures. */
  onErrorEventId?: (eventId: ErrorEventId) => void,
  errorAttachmentTransport?: ErrorAttachmentTransport,
  onAttachmentPending?: (attachment: PendingErrorAttachment) => void | PromiseLike<void>,
  getOtlpRequestHeaders: () => Promise<Record<string, string>>,
};

export class ClientAnalytics {
  private readonly _deps: ClientAnalyticsDeps;
  private _segmentId: string;
  private _tracker: EventTracker | null = null;
  private _recorder: SessionRecorder | null = null;
  private _loadPromise: Promise<EventTracker> | null = null;
  // Pre-load mirrors of the tracker's registries; transferred on adoption.
  private readonly _preloadGlobalSpans = new Set<Span>();
  // Bumped by clearBuffer (sign-out): pre-load items queued under an older
  // generation must never be delivered under the next user's identity.
  private _bufferGeneration = 0;
  // The installed global error capture (null when disabled or non-browser).
  // Kept for tests and owned by the same explicit integration lifecycle as the
  // registry below.
  private _errorCapture: ClientErrorCapture | null = null;
  private _errorIntegrationRegistry: ErrorIntegrationRegistry | null = null;
  // Browser breadcrumbs are page-local state. They are intentionally owned by
  // this facade rather than a module/global slot, so separate app instances and
  // authentication generations cannot share capture context.
  private readonly _integrationBreadcrumbs: ErrorBreadcrumb[] = [];
  private _browserOtelRegistration: BrowserManagedOtelRegistration | null;
  // Async processors are part of the capture's delivery lifecycle. Keeping
  // their promises here prevents flush/sign-out from rotating credentials or
  // shutting down the provider before a beforeSend decision has completed.
  private readonly _pendingErrorProcessing = new Set<Promise<void>>();
  // Eagerly-resolved refresh-token session root (managed OTel mode only) and
  // the ambient Context built from it — the pre-load anchor, see
  // _preTrackerAmbientContext.
  private _resolvedSessionRoot: SpanContext | null = null;
  private _preTrackerAmbient: { segmentId: string, context: Context } | null = null;
  // Share the one session lookup between the eager browser-instrumentation
  // gate and the lazy EventTracker load. Starting both independently widens
  // the exact race this gate is meant to close and can issue two auth reads
  // during dashboard bootstrap.
  private _sessionRootResultPromise: Promise<Result<SpanContext, unknown>> | null = null;

  constructor(deps: ClientAnalyticsDeps) {
    this._deps = deps;
    // One per-tab id shared by the SessionRecorder and EventTracker, so replay
    // chunks and analytics events from the same tab report the same
    // session_replay_segment_id. Minted here (eagerly) because the fetch
    // propagation wrapper needs it from the first instrumented request on.
    this._segmentId = generateUuid();
    // Sentry starts its page-load transaction during SDK initialization, so
    // the first application fetch is never parentless merely because the
    // capture module is lazy. We cannot create the full page-view span here
    // without loading that module, but a cached, already-validated access
    // token gives the pre-load window the same stable session anchor. Never
    // guess from a raw refresh token: the access-token payload is what proves
    // which refresh-token identity owns the session.
    this._resolvedSessionRoot = deps.openTelemetryProvider === "managed"
      && deps.automaticSideEffects !== false
      ? deps.getCachedSessionRootContext?.() ?? null
      : null;
    this._browserOtelRegistration = deps.openTelemetryProvider === "managed" && deps.automaticSideEffects !== false
      ? this._registerManagedBrowserOtel()
      : null;

    if (this._browserOtelRegistration !== null) {
      // Resolve the session root eagerly after construction returns: the app's
      // bootstrap requests (users/me, projects/current) fire long before the
      // lazily-loaded tracker mints the first $page-view, and without an
      // ambient anchor each one roots a single-span trace in the inbox. The
      // microtask boundary is intentional: callers finish installing their
      // token/session hooks before this lookup starts, while the HTTP gate
      // still keeps bootstrap requests from creating an unrepairable root.
      queueMicrotask(() => runAsynchronously(async () => {
        const sessionRootResult = await this._getSessionRootResult();
        if (sessionRootResult.status === "ok") {
          this._resolvedSessionRoot = sessionRootResult.data;
          this._preTrackerAmbient = null;
        }
        // If the session is anonymous or the lookup fails, there is no safe
        // authenticated parent to use. Enable ordinary root tracing only after
        // that fact is known; an authenticated request must never be emitted
        // as a random root merely because auth resolution is still pending.
        this._browserOtelRegistration?.enableHttpInstrumentation();
      }, { noErrorLogging: true }));
    }

    if (deps.automaticSideEffects !== false) {
      const kickOff = () => runAsynchronously(async () => {
        await this._ensureLoaded();
      }, { noErrorLogging: true }); // _doLoad already warns with context
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(kickOff, { timeout: IDLE_LOAD_TIMEOUT_MS });
      } else {
        setTimeout(kickOff, FALLBACK_LOAD_DELAY_MS);
      }
    }

    // Global error capture and the registry's existing console seam install
    // EAGERLY (here, not in the lazily-loaded tracker): errors thrown before
    // the tracker module arrives — often the most interesting ones, e.g. a
    // broken hydration — must still capture. Both remain gated by the explicit
    // automatic-side-effects switch.
    if (deps.automaticSideEffects !== false && deps.errorCapture.enabled) {
      this._installClientErrorCapture();
      this._installErrorIntegrations();
    }
  }

  private _installClientErrorCapture(): void {
    if (this._errorCapture !== null) return;
    if (this._deps.openTelemetryProvider === "disabled" || !this._deps.errorCapture.enabled) return;
    this._errorCapture = installClientErrorCapture({
      emit: (data, scope) => this.trackErrorEvent(data, scope),
      ignoreErrors: this._deps.errorCapture.ignoreErrors,
      release: this._deps.release,
      environment: this._deps.environment,
      sdkVersion: this._deps.sdkVersion,
      getCurrentPageViewSpanId: () => this.getCurrentPageViewSpanId(),
    });
  }

  private _createErrorIntegrationRuntime(): ErrorIntegrationRuntime | null {
    const levels = this._deps.consoleCaptureLevels;
    const emitLog = this._deps.emitLog;
    if (
      this._deps.openTelemetryProvider === "disabled"
      || !this._deps.errorCapture.enabled
    ) {
      return null;
    }

    const browser: NonNullable<ErrorIntegrationRuntime["browser"]> = {
      onResourceError: (handler) => installBrowserResourceErrorCapture(handler, {
        networkCapture: this._deps.networkCapture,
      }),
    };
    if (levels !== undefined && levels.length > 0 && emitLog !== undefined) {
      browser.onConsole = (handler) => installConsoleCapture({
        levels,
        logger: createLogger({
          emit: (item) => {
            handler({
              level: item.level === "warn"
                ? "warn"
                : item.level === "error"
                  ? "error"
                  : item.level === "debug"
                    ? "debug"
                    : "info",
              message: item.message,
            });
            return emitLog(item);
          },
          origin: "console",
        }),
        projectId: this._deps.projectId,
        serviceName: this._deps.resource.service.name,
        captureError: (error) => this.captureConsoleError(error),
      });
    }

    return {
      captureException: (error, options) => this.captureException(error, options, getActiveErrorScope()?.snapshot()),
      addBreadcrumb: (breadcrumb) => this._addIntegrationBreadcrumb(breadcrumb),
      browser,
    };
  }

  private _installErrorIntegrations(): void {
    if (this._errorIntegrationRegistry !== null) return;
    const runtime = this._createErrorIntegrationRuntime();
    if (runtime === null) return;
    const registry = createDefaultErrorIntegrationRegistry(runtime);
    registry.installDefaults();
    this._errorIntegrationRegistry = registry;
  }

  private _addIntegrationBreadcrumb(breadcrumb: ErrorBreadcrumb): void {
    this._integrationBreadcrumbs.push(breadcrumb);
    if (this._integrationBreadcrumbs.length > 100) this._integrationBreadcrumbs.shift();
  }

  /**
   * Tears down all automatic browser error hooks owned by this facade. This is
   * intentionally explicit: authentication rotation clears breadcrumb state,
   * while lifecycle owners decide when the actual global hooks should leave.
   */
  uninstallErrorIntegrations(): void {
    this._errorIntegrationRegistry?.uninstallAll();
    this._errorIntegrationRegistry = null;
    this._errorCapture?.uninstall();
    this._errorCapture = null;
    this._integrationBreadcrumbs.length = 0;
  }

  private _registerManagedBrowserOtel(): BrowserManagedOtelRegistration {
    const deps = this._deps;
    return registerManagedBrowserOtel({
      analyticsBaseUrl: deps.analyticsBaseUrl,
      projectId: deps.projectId,
      clientVersion: deps.sdkVersion,
      traceSampleRate: deps.traceSampleRate,
      resource: deps.resource,
      getRequestHeaders: deps.getOtlpRequestHeaders,
      networkCapture: deps.networkCapture,
      getPropagationPolicy: () => {
        const policy = deps.getPropagationPolicy();
        return { allowedOrigins: policy.allowedOrigins, allowLocalhost: policy.allowLocalhost };
      },
      installHttpInstrumentationImmediately: this._resolvedSessionRoot !== null,
      // Late-bound through `this`: the tracker only exists once the lazy
      // module loads, and auth rotation re-registers with this same options
      // object, so the ambient base survives both without re-wiring. A
      // ternary rather than `??`: once the tracker is live, its null (the
      // sign-out safety window) must NOT fall through to the pre-load anchor.
      getAmbientOtelContext: () => this._tracker !== null
        ? this._tracker.getAmbientOtelContext()
        : this._preTrackerAmbientContext(),
    });
  }

  private _getSessionRootResult(): Promise<Result<SpanContext, unknown>> {
    if (this._sessionRootResultPromise === null) {
      this._sessionRootResultPromise = Result.fromPromise(this._deps.getSessionRootContext());
    }
    return this._sessionRootResultPromise;
  }

  /**
   * Ambient base for the pre-load window: the tracker (and with it the
   * `$page-view` anchor) arrives up to seconds after construction, but the
   * app's bootstrap requests fire immediately. Anchoring them on the
   * refresh-token session root keeps them inside the session trace. The
   * tracker takes over the moment it loads (see the getAmbientOtelContext
   * wiring above), so this anchor can only serve the first seconds of a page —
   * a window in which the session identity cannot have rotated.
   */
  private _preTrackerAmbientContext(): Context | null {
    const root = this._resolvedSessionRoot;
    if (root === null) return null;
    const cache = this._preTrackerAmbient;
    if (cache !== null && cache.segmentId === this._segmentId) return cache.context;
    const context = buildAmbientSessionContext({ anchor: root, sessionReplaySegmentId: this._segmentId });
    this._preTrackerAmbient = { segmentId: this._segmentId, context };
    return context;
  }

  /** The installed global error capture, or null. Exposed for tests. */
  getErrorCapture(): ClientErrorCapture | null {
    return this._errorCapture;
  }

  updateOtelPropagationPolicy(): void {
    this._browserOtelRegistration?.updatePropagationPolicy();
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
    const sessionRootResultPromise = this._getSessionRootResult();

    const trackerModule = await trackerImport;
    if (trackerModule.status === "error") {
      console.warn("Hexclave analytics: failed to load the analytics runtime; telemetry from this page will be dropped.", trackerModule.error);
      throw new Error("Hexclave analytics: failed to load the analytics runtime");
    }
    // The first page view is the hierarchy anchor for every browser span on the
    // page. Resolve the session root before starting the tracker so the initial
    // page view cannot be emitted as a temporary local root and then duplicated
    // under the refresh-token trace when authentication finishes resolving.
    const sessionRootResult = await sessionRootResultPromise;
    if (sessionRootResult.status === "error") {
      // There is no safe parent when session resolution genuinely fails. Keep
      // the existing local-root fallback for that failure mode, but do not use
      // it merely because the normal async resolution has not finished yet.
      console.warn("Hexclave analytics: failed to resolve the authenticated session trace; browser capture will continue with local trace roots.", sessionRootResult.error);
    }
    const tracker = new trackerModule.data.EventTracker({
      projectId: this._deps.projectId,
      resource: this._deps.resource,
      clientVersion: this._deps.sdkVersion,
      ...this._browserOtelRegistration === null ? {} : {
        forceFlushOtel: async () => await this._browserOtelRegistration?.forceFlush(),
      },
      sessionReplaySegmentId: this._segmentId,
      ...sessionRootResult.status === "error" ? {} : { sessionRootContext: sessionRootResult.data },
      sessionReplayEnabled: this._deps.replayOptions.enabled,
      productAnalyticsEnabled: this._deps.productAnalyticsEnabled,
      keystrokeCapture: {
        enabled: this._deps.replayOptions.enabled === true && this._deps.replayOptions.captureKeystrokes === true,
        maskAllInputs: this._deps.replayOptions.maskAllInputs ?? true,
        blockClass: this._deps.replayOptions.blockClass,
        blockSelector: this._deps.replayOptions.blockSelector,
      },
      registerBackgroundTask: this._deps.registerBackgroundTask,
      getPropagationPolicy: this._deps.getPropagationPolicy,
      integritySignals: this._deps.integritySignals,
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
          onSessionRotation: () => this.setSessionReplaySegmentId(generateUuid()),
          onSessionReplaySegmentMaterialized: async (segmentId) => {
            const sessionRootContext = await this._deps.getSessionRootContext();
            this._tracker?.markSessionReplaySegmentMaterialized(segmentId, sessionRootContext);
          },
        }, this._deps.replayOptions);
        this._recorder.start();
      }
    }
    return tracker;
  }

  private _preloadAmbientContexts(): SpanContext[] {
    const contexts: SpanContext[] = [];
    if (this._resolvedSessionRoot !== null) contexts.push(this._resolvedSessionRoot);
    for (const span of this._preloadGlobalSpans) {
      if (!span.isEnded) contexts.push(span.spanContext());
    }
    const activeOtelSpanContext = getActiveOtelSpanContext();
    if (activeOtelSpanContext !== null) contexts.push(activeOtelSpanContext);
    return contexts;
  }

  /**
   * The enclosing span for a pre-load EVENT: resolved synchronously because the
   * browser sync-stack ambient frames close at the first await. Null when there is
   * no enclosing span (events never mint a trace of their own).
   */
  private _resolvePreloadEnclosingSpan(options: TrackOptions | undefined): { span: SpanContext | null } | { error: string } {
    const resolved = resolveSpanParent({
      explicit: options?.parent,
      ambient: this.getAmbientSpanContexts(),
      root: options?.root,
    });
    if ("error" in resolved) return resolved;
    return { span: resolved.parentSpanId === null ? null : {
      traceId: resolved.traceId,
      spanId: resolved.parentSpanId,
      ...resolved.traceFlags === undefined ? {} : { traceFlags: resolved.traceFlags },
      ...resolved.traceState === undefined ? {} : { traceState: resolved.traceState },
    } };
  }

  /** See EventTracker.getAmbientSpanContexts — used by cross-tier propagation. */
  getAmbientSpanContexts(): SpanContext[] {
    return this._tracker !== null ? this._tracker.getAmbientSpanContexts() : this._preloadAmbientContexts();
  }

  /** See EventTracker.getPageViewSpanContext. Null pre-load: the tab's first
   * page view is minted by the tracker, so nothing encloses a pre-load request. */
  getPageViewSpanContext(): SpanContext | null {
    return this._tracker?.getPageViewSpanContext() ?? null;
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

  async clearBuffer(): Promise<void> {
    this._bufferGeneration += 1;
    this._preloadGlobalSpans.clear();
    this._integrationBreadcrumbs.length = 0;
    this._tracker?.clearBuffer();
    this._recorder?.clearBuffer();
    await Promise.all([...this._pendingErrorProcessing]);
    if (this._browserOtelRegistration !== null) {
      this._browserOtelRegistration = await this._browserOtelRegistration.flushBeforeAuthenticationChange();
    }
  }

  trackCustomEvent(eventType: string, data?: Record<string, unknown>, options?: TrackOptions): Promise<void> {
    const nameError = getCustomTelemetryNameError("event", eventType);
    if (nameError) return rejectedPreCaught(nameError);
    const dataError = getCustomTelemetryDataError(data);
    if (dataError) return rejectedPreCaught(dataError);
    const enclosing = this._resolvePreloadEnclosingSpan(options);
    if ("error" in enclosing) return rejectedPreCaught(enclosing.error);
    const pageViewSpanId = this.getCurrentPageViewSpanId();
    emitHexclaveOtelEvent({
      eventName: eventType,
      data,
      clientVersion: this._deps.sdkVersion,
      parent: enclosing.span,
      correlationAttributes: {
        "hexclave.session_replay.segment.id": this.getSessionReplaySegmentId(),
        ...pageViewSpanId === null ? {} : { "hexclave.page_view.span_id": pageViewSpanId },
      },
    });
    // Preserve the released acknowledgement contract in managed mode. An
    // existing-provider integration owns its exporter lifecycle, so the SDK
    // can only acknowledge synchronous acceptance by that provider.
    return preCaught(this._browserOtelRegistration?.forceFlush() ?? Promise.resolve());
  }

  captureException(error: unknown, options?: CaptureExceptionOptions, scope?: ErrorScopeData): ErrorEventId {
    this.assertErrorCaptureAvailable();
    this._ensureManualErrorProvider();
    const eventId = generateErrorEventId();
    const mergedScope = mergeErrorScopeData(scope, options);
    this.trackErrorEvent(buildErrorEventData(error, {
      mechanismType: options?.mechanism ?? "captured.exception",
      handled: options?.handled ?? true,
      release: this._deps.release,
      environment: this._deps.environment,
      sdkVersion: this._deps.sdkVersion,
      eventId,
      scope: mergedScope,
    }), mergedScope, error);
    return eventId;
  }

  captureMessage(message: string, options?: CaptureMessageOptions, scope?: ErrorScopeData): ErrorEventId {
    if (message === "") throw new Error("Hexclave captureMessage requires a non-empty message");
    this.assertErrorCaptureAvailable();
    this._ensureManualErrorProvider();
    const eventId = generateErrorEventId();
    const mergedScope = mergeErrorScopeData(scope, options);
    this.trackErrorEvent(buildCapturedEventData({
      message,
      name: "Message",
      handled: true,
      mechanism: options?.mechanism ?? "captured.message",
      ...options,
    }, {
      eventId,
      release: this._deps.release,
      environment: this._deps.environment,
      sdkVersion: this._deps.sdkVersion,
      // The event already carries capture options; pass only the ambient scope
      // here so array-valued attachment data is not merged twice.
      scope,
    }), mergedScope);
    return eventId;
  }

  captureEvent(event: CaptureEvent, scope?: ErrorScopeData): ErrorEventId {
    this.assertErrorCaptureAvailable();
    this._ensureManualErrorProvider();
    const eventId = generateErrorEventId();
    const mergedScope = mergeErrorScopeData(scope, event);
    this.trackErrorEvent(buildCapturedEventData(event, {
      eventId,
      release: this._deps.release,
      environment: this._deps.environment,
      sdkVersion: this._deps.sdkVersion,
      scope,
    }), mergedScope);
    return eventId;
  }

  private assertErrorCaptureAvailable(): void {
    if (this._deps.openTelemetryProvider === "disabled") {
      throw new Error("Hexclave error capture is unavailable because observability is disabled");
    }
  }

  private _ensureManualErrorProvider(): void {
    if (this._deps.openTelemetryProvider === "managed" && this._browserOtelRegistration === null) {
      this._browserOtelRegistration = this._registerManagedBrowserOtel();
    }
    this._installClientErrorCapture();
    this._installErrorIntegrations();
  }

  /** OTel LogRecord delivery after the bounded processor/privacy pipeline. */
  trackErrorEvent(data: CapturedErrorEvent, scope?: ErrorScopeData, originalException?: unknown): void {
    const dataWithIntegrationBreadcrumbs = this._integrationBreadcrumbs.length === 0
      ? data
      : {
        ...data,
        breadcrumbs: [
          ...this._integrationBreadcrumbs,
          ...data.breadcrumbs ?? [],
        ].slice(-100),
      };
    const attachments = getErrorAttachmentInputs(scope);
    assertErrorAttachmentDeliveryConfigured(attachments, this._deps.errorAttachmentTransport, this._deps.onAttachmentPending);
    const processed = processErrorEvent(dataWithIntegrationBreadcrumbs, {
      eventProcessors: this._deps.errorCapture.eventProcessors,
      scopeProcessors: scope?.eventProcessors,
      beforeSend: this._deps.errorCapture.beforeSend,
      hint: {
        eventId: dataWithIntegrationBreadcrumbs.event_id,
        mechanism: typeof dataWithIntegrationBreadcrumbs.mechanism_type === "string" ? dataWithIntegrationBreadcrumbs.mechanism_type : "captured",
        handled: dataWithIntegrationBreadcrumbs.handled === true,
        ...originalException === undefined ? {} : { originalException },
        scope: scope ?? {},
        attachments,
      },
      onFailure: (failure) => {
        console.warn(`Hexclave error processor ${failure.reason} in ${failure.stage} (${failure.processorName}); event dropped`);
      },
    });
    const deliver = (result: ErrorProcessingResult): void => {
      if (result.status === "dropped") return;
      this._trackAcceptedErrorEvent(result.event, attachments);
    };
    if (isPromiseLike(processed)) {
      const pending = Promise.resolve(processed).then(deliver);
      this._pendingErrorProcessing.add(pending);
      runAsynchronously(pending.then(
        () => {
          this._pendingErrorProcessing.delete(pending);
        },
        (error) => {
          this._pendingErrorProcessing.delete(pending);
          throw error;
        },
      ), { noErrorLogging: true });
      return;
    }
    deliver(processed);
  }

  private _trackAcceptedErrorEvent(data: CapturedErrorEvent, attachments: readonly ErrorAttachmentInput[] = []): void {
    this._deps.onErrorEventId?.(data.event_id);
    const enclosing = this._resolvePreloadEnclosingSpan(undefined);
    if ("error" in enclosing) return;
    const pageViewSpanId = this.getCurrentPageViewSpanId();
    emitHexclaveOtelError({
      data,
      clientVersion: this._deps.sdkVersion,
      parent: enclosing.span,
      correlationAttributes: {
        "hexclave.session_replay.segment.id": this.getSessionReplaySegmentId(),
        ...pageViewSpanId === null ? {} : { "hexclave.page_view.span_id": pageViewSpanId },
      },
    });
    const registration = this._browserOtelRegistration;
    if (registration !== null) runAsynchronously(async () => await registration.forceFlush(), { noErrorLogging: true });
    if (attachments.length > 0) {
      const pending = deliverErrorAttachments({
        eventId: data.event_id,
        attachments,
        transport: this._deps.errorAttachmentTransport,
        onPending: this._deps.onAttachmentPending,
      });
      this._pendingErrorProcessing.add(pending);
      runAsynchronously(pending.then(
        () => {
          this._pendingErrorProcessing.delete(pending);
        },
        (error) => {
          this._pendingErrorProcessing.delete(pending);
          throw error;
        },
      ), { noErrorLogging: true });
    }
  }

  /** Promotes a real console.error(Error) call while retaining its $log row. */
  captureConsoleError(error: Error): void {
    this.trackErrorEvent(buildErrorEventData(error, {
      mechanismType: "console.error",
      handled: true,
      release: this._deps.release,
      environment: this._deps.environment,
      sdkVersion: this._deps.sdkVersion,
    }));
  }

  startSpan(spanType: string, options?: StartSpanOptions): Span {
    const ambient = this.getAmbientSpanContexts();
    const resolved = resolveSpanParent({
      explicit: options?.parent,
      ambient,
      links: options?.links,
      fallbackParent: this.getPageViewSpanContext(),
      root: options?.root,
    });
    if ("error" in resolved) {
      throw new Error(`Hexclave analytics: ${resolved.error}`);
    }
    const parent = resolved.parentSpanId === null
      ? undefined
      : {
        traceId: resolved.traceId,
        spanId: resolved.parentSpanId,
        ...resolved.traceFlags === undefined ? {} : { traceFlags: resolved.traceFlags },
        ...resolved.traceState === undefined ? {} : { traceState: resolved.traceState },
      };
    const pageViewSpanId = this.getCurrentPageViewSpanId();
    const span = createOtelSpanFacade({
      tracer: otelTrace.getTracer("@hexclave/sdk-browser", this._deps.sdkVersion),
      spanType,
      startOptions: {
        ...options,
        ...parent === undefined ? { root: true } : { parent, root: false },
        links: resolved.links,
      },
      correlationAttributes: {
        "hexclave.session_replay.segment.id": this.getSessionReplaySegmentId(),
        ...pageViewSpanId === null ? {} : { "hexclave.page_view.span_id": pageViewSpanId },
      },
      capabilities: {
        trackEvent: (eventType, data, trackOptions) => this.trackCustomEvent(eventType, data, trackOptions),
        onEnded: (endedSpan) => this.clearGlobalSpan(endedSpan),
        getSpanPropagationHeaders: (currentSpan) => this._preloadSpanPropagationHeaders(currentSpan),
        fetch: (currentSpan, input, init) => this._preloadSpanFetch(currentSpan, input, init),
      },
    });
    return span;
  }

  // A pre-load custom span is generation-checked just like a pre-load network
  // span: sign-in rotation may discard it before the tracker owns its row.
  // Preserve the useful correlation claim but never promise the span as a
  // remote parent, even if the runtime finishes loading while the handle lives.
  private _preloadSpanPropagationHeaders(_span: Span): Record<string, string> {
    const segmentId = this.getSessionReplaySegmentId();
    return buildPropagationHeaderValues({
      traceparent: null,
      context: {
        ...segmentId ? { sessionReplaySegmentId: segmentId } : {},
      },
    });
  }

  private _preloadSpanFetch(span: Span, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      const policy = this._deps.getPropagationPolicy();
      const initWithHeader = buildFetchInitWithSpanContext({
        input,
        init,
        headerValues: this._preloadSpanPropagationHeaders(span),
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

  setGlobalSpan(span: Span): void {
    if (this._tracker !== null) {
      this._tracker.setGlobalSpan(span);
      return;
    }
    if (span.isEnded) {
      console.warn("Hexclave analytics: setGlobalSpan() called with an already-ended span; ignoring");
      return;
    }
    // No compatibility check: the nearest ambient context wins as parent and any
    // other global span in a different trace becomes a link — see
    // EventTracker.setGlobalSpan.
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
    await Promise.all([...this._pendingErrorProcessing]);
    await Promise.all([
      tracker.flush(),
      this._browserOtelRegistration?.forceFlush() ?? Promise.resolve(),
    ]);
  }
}
