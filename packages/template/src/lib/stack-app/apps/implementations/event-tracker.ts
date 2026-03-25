import { isBrowserLike } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { generateUuid } from "./session-replay";
import type { AnalyticsBatchEvent } from "@stackframe/stack-shared/dist/interface/crud/analytics";
import {
  type AnalyticsReplayLinkOptions,
  type AutoCapturedAnalyticsEventType,
  assertValidAnalyticsEventName,
  normalizeAnalyticsEventAt,
  normalizeAnalyticsEventPayload,
  normalizeAnalyticsReplayLinkOptions,
} from "./analytics-events";
import { getActiveSpan, getErrorMetadata } from "./tracing";
export { parseStackFrames } from "./parse-stack-frames";

const FLUSH_INTERVAL_MS = 10_000;
const MAX_EVENTS_PER_BATCH = 50;
const MAX_APPROX_BYTES_PER_BATCH = 64_000;
const DEFAULT_RAGE_CLICK_THRESHOLD = 3;
const DEFAULT_RAGE_CLICK_WINDOW_MS = 1_000;
const DEFAULT_RAGE_CLICK_RADIUS_PX = 24;
const DEFAULT_SCROLL_DEPTH_STEP_PERCENT = 25;
const MAX_CLIPBOARD_TYPE_COUNT = 10;

type TrackerCaptureConfig = {
  rageClickThreshold: number,
  rageClickWindowMs: number,
  rageClickRadiusPx: number,
  scrollDepthStepPercent: number,
};

type RecentClick = {
  selector: string,
  x: number,
  y: number,
  monotonicTimeMs: number,
};

function parseIntegerPublicEnv(
  name: string,
  defaultValue: number,
  options: { min: number, max: number },
) {
  const raw = process.env[name];
  if (raw == null || raw === "") {
    return defaultValue;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < options.min || parsed > options.max) {
    throw new StackAssertionError(
      `Invalid ${name} environment variable: expected an integer between ${options.min} and ${options.max}, received ${raw}`,
    );
  }

  return parsed;
}

function getTrackerCaptureConfig(): TrackerCaptureConfig {
  return {
    rageClickThreshold: parseIntegerPublicEnv("NEXT_PUBLIC_STACK_ANALYTICS_RAGE_CLICK_THRESHOLD", DEFAULT_RAGE_CLICK_THRESHOLD, { min: 2, max: 20 }),
    rageClickWindowMs: parseIntegerPublicEnv("NEXT_PUBLIC_STACK_ANALYTICS_RAGE_CLICK_WINDOW_MS", DEFAULT_RAGE_CLICK_WINDOW_MS, { min: 100, max: 10_000 }),
    rageClickRadiusPx: parseIntegerPublicEnv("NEXT_PUBLIC_STACK_ANALYTICS_RAGE_CLICK_RADIUS_PX", DEFAULT_RAGE_CLICK_RADIUS_PX, { min: 1, max: 500 }),
    scrollDepthStepPercent: parseIntegerPublicEnv("NEXT_PUBLIC_STACK_ANALYTICS_SCROLL_DEPTH_STEP_PERCENT", DEFAULT_SCROLL_DEPTH_STEP_PERCENT, { min: 1, max: 100 }),
  };
}

function distanceBetweenPoints(a: { x: number, y: number }, b: { x: number, y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getClipboardTypes(clipboardData: DataTransfer | null | undefined): string[] {
  if (!clipboardData) return [];
  return Array.from(clipboardData.types).slice(0, MAX_CLIPBOARD_TYPE_COUNT);
}


export type EventTrackerDeps = {
  projectId: string,
  release?: string | null,
  getAccessToken: () => Promise<string | null>,
  getReplayLinkOptions?: () => AnalyticsReplayLinkOptions | null,
  getSuperProperties?: () => Record<string, unknown>,
  sendBatch: (body: string, options: { keepalive: boolean }) => Promise<Result<Response, Error>>,
};

export class EventTracker {
  private _started = false;
  private _cancelled = false;
  private _detachListeners: (() => void) | null = null;
  private _flushTimer: ReturnType<typeof setInterval> | null = null;
  private _events: AnalyticsBatchEvent[] = [];
  private _approxBytes = 0;
  private _lastKnownAccessToken: string | null = null;
  private _lastUrl: string | null = null;
  private _lastVisibilityState: DocumentVisibilityState | null = null;
  private _recentClicks: RecentClick[] = [];
  private _emittedScrollDepthThresholds = new Set<number>();
  private readonly _fallbackSessionReplaySegmentId: string;
  private readonly _deps: EventTrackerDeps;
  private readonly _captureConfig: TrackerCaptureConfig;

  private _originalPushState: typeof history.pushState | null = null;
  private _originalReplaceState: typeof history.replaceState | null = null;

  constructor(deps: EventTrackerDeps) {
    this._deps = deps;
    this._fallbackSessionReplaySegmentId = generateUuid();
    this._captureConfig = getTrackerCaptureConfig();
  }

  start() {
    if (this._started) return;
    if (!isBrowserLike()) return;
    this._started = true;

    this._setupPageViewCapture();
    this._setupClickCapture();
    this._setupLifecycleListeners();

    this._flushTimer = setInterval(() => this._tick(), FLUSH_INTERVAL_MS);
  }

  stop() {
    this._cancelled = true;
    if (this._flushTimer !== null) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    runAsynchronously(() => this._flush({ keepalive: true }), { noErrorLogging: true });
    this._teardown();
  }

  clearBuffer() {
    this._events = [];
    this._approxBytes = 0;
  }

  async flush(): Promise<void> {
    await this._flush({ keepalive: false });
  }

  captureException(error: unknown, extraData?: Record<string, unknown>) {
    this._pushAutoCapturedEvent("$error", {
      source: "manual",
      ...getErrorMetadata(error),
      ...(this._deps.release ? { release: this._deps.release } : {}),
      ...(isBrowserLike() ? {
        path: window.location.pathname,
        url: window.location.href,
        title: document.title,
      } : {}),
      ...extraData,
    });
  }

  trackEvent(eventType: string, data: Record<string, unknown> = {}, options?: { at?: Date | number } & AnalyticsReplayLinkOptions) {
    assertValidAnalyticsEventName(eventType);
    this._enqueueEvent(eventType, data, {
      at: options?.at,
      sessionReplayId: options?.sessionReplayId,
      sessionReplaySegmentId: options?.sessionReplaySegmentId,
    });
  }

  private _pushAutoCapturedEvent(eventType: AutoCapturedAnalyticsEventType, data: Record<string, unknown>) {
    assertValidAnalyticsEventName(eventType, { allowAutoCapturedReservedType: true });
    this._enqueueEvent(eventType, data);
  }

  private _enqueueEvent(eventType: string, data: Record<string, unknown>, options?: { at?: Date | number } & AnalyticsReplayLinkOptions) {
    const defaults = this._getDefaultReplayLinkOptions();
    const replayLinkOptions = normalizeAnalyticsReplayLinkOptions({
      sessionReplayId: options?.sessionReplayId ?? defaults.sessionReplayId,
      sessionReplaySegmentId: options?.sessionReplaySegmentId ?? defaults.sessionReplaySegmentId,
    });
    const segmentSpanId = replayLinkOptions.session_replay_segment_id;
    const activeSpan = getActiveSpan();
    const parentSpanIds = [
      ...(activeSpan ? [activeSpan.spanId] : []),
      ...(segmentSpanId ? [segmentSpanId] : []),
    ];
    const superProps = this._deps.getSuperProperties?.() ?? {};
    const normalizedData = normalizeAnalyticsEventPayload(data);
    const event: AnalyticsBatchEvent = {
      event_type: eventType,
      event_id: generateUuid(),
      // only set trace_id when inside an active span
      trace_id: activeSpan?.traceId ?? undefined,
      event_at_ms: normalizeAnalyticsEventAt(options?.at),
      ...(parentSpanIds.length > 0 ? { parent_span_ids: parentSpanIds } : {}),
      data: Object.keys(superProps).length > 0 ? { ...superProps, ...normalizedData } : normalizedData,
      ...replayLinkOptions,
    };
    this._events.push(event);
    this._approxBytes += JSON.stringify(event).length;
    if (this._events.length >= MAX_EVENTS_PER_BATCH || this._approxBytes >= MAX_APPROX_BYTES_PER_BATCH) {
      runAsynchronously(() => this._flush({ keepalive: false }), { noErrorLogging: true });
    }
  }

  private _getDefaultReplayLinkOptions(): AnalyticsReplayLinkOptions {
    const replayLinkOptions = this._deps.getReplayLinkOptions?.() ?? null;
    return {
      sessionReplayId: replayLinkOptions?.sessionReplayId ?? undefined,
      sessionReplaySegmentId: replayLinkOptions?.sessionReplaySegmentId ?? this._fallbackSessionReplaySegmentId,
    };
  }

  private _capturePageView(entryType: "initial" | "push" | "replace" | "pop") {
    const url = window.location.href;
    if (url === this._lastUrl && entryType !== "initial") return;
    this._lastUrl = url;
    this._recentClicks = [];
    this._emittedScrollDepthThresholds.clear();

    this._pushAutoCapturedEvent("$page-view", {
      url,
      path: window.location.pathname,
      referrer: document.referrer,
      title: document.title,
      entry_type: entryType,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      screen_width: window.screen.width,
      screen_height: window.screen.height,
    });
  }

  private _setupPageViewCapture() {
    // Fire initial page-view
    this._capturePageView("initial");

    // Monkey-patch history.pushState
    this._originalPushState = history.pushState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      this._originalPushState!(...args);
      this._capturePageView("push");
    };

    // Monkey-patch history.replaceState
    this._originalReplaceState = history.replaceState.bind(history);
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      this._originalReplaceState!(...args);
      this._capturePageView("replace");
    };

    // Listen for popstate (back/forward navigation)
    window.addEventListener("popstate", this._onPopState);
  }

  private readonly _onPopState = () => {
    this._capturePageView("pop");
  };

  private _getElementTextPreview(element: Element): string {
    const textContent = element.textContent;
    return typeof textContent === "string" ? textContent.trim().substring(0, 200) : "";
  }

  private _buildSelector(element: Element): string {
    const parts: string[] = [];
    let current: Element | null = element;
    let depth = 0;

    while (current && depth < 5) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${current.id}`;
        parts.unshift(part);
        break;
      }
      if (current.className && typeof current.className === "string") {
        const classes = current.className.trim().split(/\s+/).filter(Boolean);
        if (classes.length > 0) {
          part += `.${classes.join(".")}`;
        }
      }
      parts.unshift(part);
      current = current.parentElement;
      depth++;
    }

    return parts.join(" > ");
  }

  private _getElementContext(element: Element | null) {
    return {
      tag_name: element?.tagName.toLowerCase() ?? null,
      selector: element ? this._buildSelector(element) : null,
    };
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

    this._pushAutoCapturedEvent("$click", {
      ...this._getElementContext(target),
      text: this._getElementTextPreview(target),
      href: this._findNearestAnchorHref(target),
      x: event.clientX,
      y: event.clientY,
      page_x: event.pageX,
      page_y: event.pageY,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
    });

    this._maybeCaptureRageClick(target, event);
  };

  private _setupClickCapture() {
    document.addEventListener("click", this._onClickCapture, { capture: true });
  }

  private _maybeCaptureRageClick(target: Element, event: MouseEvent) {
    const monotonicTimeMs = performance.now();
    const selector = this._buildSelector(target);
    const radiusPx = this._captureConfig.rageClickRadiusPx;
    const windowMs = this._captureConfig.rageClickWindowMs;

    this._recentClicks = this._recentClicks.filter((click) => monotonicTimeMs - click.monotonicTimeMs <= windowMs);

    const click: RecentClick = {
      selector,
      x: event.clientX,
      y: event.clientY,
      monotonicTimeMs,
    };
    this._recentClicks.push(click);

    const matchingClicks = this._recentClicks.filter((recentClick) =>
      recentClick.selector === selector
      && distanceBetweenPoints(recentClick, click) <= radiusPx,
    );

    if (matchingClicks.length !== this._captureConfig.rageClickThreshold) return;

    this._pushAutoCapturedEvent("$rage-click", {
      ...this._getElementContext(target),
      text: this._getElementTextPreview(target),
      click_count: matchingClicks.length,
      window_ms: windowMs,
      radius_px: radiusPx,
      x: event.clientX,
      y: event.clientY,
      page_x: event.pageX,
      page_y: event.pageY,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
    });
  }

  private _captureTabVisibilityChange(eventType: "$tab-in" | "$tab-out") {
    this._pushAutoCapturedEvent(eventType, {
      url: window.location.href,
      path: window.location.pathname,
      title: document.title,
      visibility_state: document.visibilityState,
      hidden: document.hidden,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      screen_width: window.screen.width,
      screen_height: window.screen.height,
    });
  }

  private _captureWindowFocusChange(eventType: "$window-focus" | "$window-blur") {
    this._pushAutoCapturedEvent(eventType, {
      url: window.location.href,
      path: window.location.pathname,
      title: document.title,
      visibility_state: document.visibilityState,
      hidden: document.hidden,
      has_focus: document.hasFocus(),
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      screen_width: window.screen.width,
      screen_height: window.screen.height,
    });
  }

  private readonly _onWindowFocus = () => {
    this._captureWindowFocusChange("$window-focus");
  };

  private readonly _onWindowBlur = () => {
    this._captureWindowFocusChange("$window-blur");
  };

  private readonly _onSubmitCapture = (event: SubmitEvent) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    const submitter = event.submitter instanceof Element ? event.submitter : null;
    this._pushAutoCapturedEvent("$submit", {
      ...this._getElementContext(form),
      action: form.action || window.location.href,
      method: form.method.toLowerCase() || "get",
      field_count: form.elements.length,
      submitter_tag_name: submitter?.tagName.toLowerCase() ?? null,
      submitter_selector: submitter ? this._buildSelector(submitter) : null,
      submitter_text: submitter ? this._getElementTextPreview(submitter) : null,
      path: window.location.pathname,
      url: window.location.href,
      title: document.title,
    });
  };

  private readonly _onCopyCapture = (event: ClipboardEvent) => {
    const target = event.target instanceof Element ? event.target : document.activeElement instanceof Element ? document.activeElement : null;
    this._pushAutoCapturedEvent("$copy", {
      ...this._getElementContext(target),
      clipboard_types: getClipboardTypes(event.clipboardData),
      has_selection: window.getSelection()?.isCollapsed === false,
      path: window.location.pathname,
      url: window.location.href,
      title: document.title,
    });
  };

  private readonly _onPasteCapture = (event: ClipboardEvent) => {
    const target = event.target instanceof Element ? event.target : document.activeElement instanceof Element ? document.activeElement : null;
    this._pushAutoCapturedEvent("$paste", {
      ...this._getElementContext(target),
      clipboard_types: getClipboardTypes(event.clipboardData),
      path: window.location.pathname,
      url: window.location.href,
      title: document.title,
    });
  };

  private _getScrollDepthPercent() {
    const documentElement = document.documentElement;
    const scrollHeight = documentElement.scrollHeight;
    if (scrollHeight <= 0) return 0;

    const viewedBottomPx = window.scrollY + window.innerHeight;
    return Math.max(0, Math.min(100, Math.floor((viewedBottomPx / scrollHeight) * 100)));
  }

  private readonly _onScroll = () => {
    const actualDepthPercent = this._getScrollDepthPercent();
    if (actualDepthPercent <= 0) return;

    const thresholds: number[] = [];
    for (let threshold = this._captureConfig.scrollDepthStepPercent; threshold <= 100; threshold += this._captureConfig.scrollDepthStepPercent) {
      thresholds.push(threshold);
    }
    if (thresholds[thresholds.length - 1] !== 100) {
      thresholds.push(100);
    }

    for (const threshold of thresholds) {
      if (actualDepthPercent < threshold || this._emittedScrollDepthThresholds.has(threshold)) continue;
      this._emittedScrollDepthThresholds.add(threshold);
      this._pushAutoCapturedEvent("$scroll-depth", {
        depth_percent: threshold,
        actual_depth_percent: actualDepthPercent,
        step_percent: this._captureConfig.scrollDepthStepPercent,
        path: window.location.pathname,
        url: window.location.href,
        title: document.title,
      });
    }
  };

  private readonly _onWindowError = (event: ErrorEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    this._pushAutoCapturedEvent("$error", {
      source: "window-error",
      ...getErrorMetadata(event.error ?? event.message),
      ...(this._deps.release ? { release: this._deps.release } : {}),
      filename: event.filename || null,
      lineno: event.lineno || null,
      colno: event.colno || null,
      resource_tag_name: target?.tagName.toLowerCase() ?? null,
      resource_selector: target ? this._buildSelector(target) : null,
      path: window.location.pathname,
      url: window.location.href,
      title: document.title,
    });
  };

  private readonly _onUnhandledRejection = (event: PromiseRejectionEvent) => {
    this._pushAutoCapturedEvent("$error", {
      source: "unhandled-rejection",
      ...getErrorMetadata(event.reason),
      ...(this._deps.release ? { release: this._deps.release } : {}),
      path: window.location.pathname,
      url: window.location.href,
      title: document.title,
    });
  };

  private readonly _onPageHide = () => {
    runAsynchronously(() => this._flush({ keepalive: true }), { noErrorLogging: true });
  };

  private readonly _onVisibilityChange = () => {
    const visibilityState = document.visibilityState;
    if (visibilityState === this._lastVisibilityState) return;
    this._lastVisibilityState = visibilityState;

    if (visibilityState === "hidden") {
      this._captureTabVisibilityChange("$tab-out");
    } else {
      this._captureTabVisibilityChange("$tab-in");
    }

    runAsynchronously(() => this._flush({ keepalive: true }), { noErrorLogging: true });
  };

  private _setupLifecycleListeners() {
    this._lastVisibilityState = document.visibilityState;
    window.addEventListener("focus", this._onWindowFocus);
    window.addEventListener("blur", this._onWindowBlur);
    window.addEventListener("scroll", this._onScroll, { passive: true });
    window.addEventListener("error", this._onWindowError);
    window.addEventListener("unhandledrejection", this._onUnhandledRejection);
    window.addEventListener("pagehide", this._onPageHide);
    document.addEventListener("visibilitychange", this._onVisibilityChange);
    document.addEventListener("submit", this._onSubmitCapture, { capture: true });
    document.addEventListener("copy", this._onCopyCapture, { capture: true });
    document.addEventListener("paste", this._onPasteCapture, { capture: true });
    this._detachListeners = () => {
      window.removeEventListener("focus", this._onWindowFocus);
      window.removeEventListener("blur", this._onWindowBlur);
      window.removeEventListener("scroll", this._onScroll);
      window.removeEventListener("error", this._onWindowError);
      window.removeEventListener("unhandledrejection", this._onUnhandledRejection);
      window.removeEventListener("pagehide", this._onPageHide);
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
      document.removeEventListener("submit", this._onSubmitCapture, { capture: true });
      document.removeEventListener("copy", this._onCopyCapture, { capture: true });
      document.removeEventListener("paste", this._onPasteCapture, { capture: true });
    };
  }

  private _teardown() {
    if (this._detachListeners) {
      this._detachListeners();
      this._detachListeners = null;
    }

    // Restore history methods
    if (this._originalPushState) {
      history.pushState = this._originalPushState;
      this._originalPushState = null;
    }
    if (this._originalReplaceState) {
      history.replaceState = this._originalReplaceState;
      this._originalReplaceState = null;
    }

    window.removeEventListener("popstate", this._onPopState);
    document.removeEventListener("click", this._onClickCapture, { capture: true });

    this._events = [];
    this._approxBytes = 0;
    this._recentClicks = [];
    this._emittedScrollDepthThresholds.clear();
  }

  private async _flush(options: { keepalive: boolean }) {
    if (!this._lastKnownAccessToken) return;
    if (this._events.length === 0) return;

    const nowMs = Date.now();

    const batchId = generateUuid();
    const defaultReplayLinkOptions = normalizeAnalyticsReplayLinkOptions(this._getDefaultReplayLinkOptions());
    const payload = {
      ...defaultReplayLinkOptions,
      batch_id: batchId,
      sent_at_ms: nowMs,
      events: this._events,
    };

    this._events = [];
    this._approxBytes = 0;

    const res = await this._deps.sendBatch(
      JSON.stringify(payload),
      { keepalive: options.keepalive },
    );

    if (res.status === "error") {
      console.warn("EventTracker flush failed:", res.error);
      return;
    }

    if (!res.data.ok) {
      console.warn("EventTracker flush failed:", res.data.status, await res.data.text());
    }
  }

  private _tick() {
    if (this._cancelled) return;

    runAsynchronously(async () => {
      this._lastKnownAccessToken = await this._deps.getAccessToken();
    }, { noErrorLogging: true });

    const hasAuth = !!this._lastKnownAccessToken;
    if (hasAuth && this._events.length > 0) {
      runAsynchronously(() => this._flush({ keepalive: false }), { noErrorLogging: true });
    }
  }
}
