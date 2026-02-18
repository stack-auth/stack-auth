import { isBrowserLike } from "@stackframe/stack-shared/dist/utils/env";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { generateUuid } from "./session-replay";

const FLUSH_INTERVAL_MS = 10_000;
const MAX_EVENTS_PER_BATCH = 50;
const MAX_APPROX_BYTES_PER_BATCH = 64_000;

export type EventTrackerDeps = {
  projectId: string,
  getAccessToken: () => Promise<string | null>,
  sendBatch: (body: string, options: { keepalive: boolean }) => Promise<Result<Response, Error>>,
};

type TrackedEvent = {
  event_type: "$page-view" | "$click",
  event_at_ms: number,
  data: Record<string, unknown>,
};

export class EventTracker {
  private _started = false;
  private _cancelled = false;
  private _detachListeners: (() => void) | null = null;
  private _flushTimer: ReturnType<typeof setInterval> | null = null;
  private _events: TrackedEvent[] = [];
  private _approxBytes = 0;
  private _lastKnownAccessToken: string | null = null;
  private _lastUrl: string | null = null;
  private readonly _sessionReplaySegmentId: string;
  private readonly _deps: EventTrackerDeps;

  private _originalPushState: typeof history.pushState | null = null;
  private _originalReplaceState: typeof history.replaceState | null = null;

  constructor(deps: EventTrackerDeps) {
    this._deps = deps;
    this._sessionReplaySegmentId = generateUuid();
  }

  start() {
    if (this._started) return;
    if (!isBrowserLike()) return;
    this._started = true;

    this._setupPageViewCapture();
    this._setupClickCapture();
    this._setupPageHideListeners();

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

  private _pushEvent(event: TrackedEvent) {
    this._events.push(event);
    this._approxBytes += JSON.stringify(event).length;
    if (this._events.length >= MAX_EVENTS_PER_BATCH || this._approxBytes >= MAX_APPROX_BYTES_PER_BATCH) {
      runAsynchronously(() => this._flush({ keepalive: false }), { noErrorLogging: true });
    }


  }

  private _capturePageView(entryType: "initial" | "push" | "replace" | "pop") {
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
        screen_width: window.screen.width,
        screen_height: window.screen.height,
      },
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

    this._pushEvent({
      event_type: "$click",
      event_at_ms: Date.now(),
      data: {
        tag_name: target.tagName.toLowerCase(),
        text: target.textContent?.trim().substring(0, 200) ?? null,
        href: this._findNearestAnchorHref(target),
        selector: this._buildSelector(target),
        x: event.clientX,
        y: event.clientY,
        page_x: event.pageX,
        page_y: event.pageY,
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
      },
    });
  };

  private _setupClickCapture() {
    document.addEventListener("click", this._onClickCapture, { capture: true });
  }

  private readonly _onPageHide = () => {
    runAsynchronously(() => this._flush({ keepalive: true }), { noErrorLogging: true });
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
  }

  private async _flush(options: { keepalive: boolean }) {
    if (!this._lastKnownAccessToken) return;
    if (this._events.length === 0) return;

    const nowMs = Date.now();

    const batchId = generateUuid();
    const payload = {
      session_replay_segment_id: this._sessionReplaySegmentId,
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
