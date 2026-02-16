import { isBrowserLike } from "@stackframe/stack-shared/dist/utils/env";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import {
  FLUSH_INTERVAL_MS,
  MAX_APPROX_BYTES_PER_BATCH,
  MAX_EVENTS_PER_BATCH,
  MAX_PREAUTH_BUFFER_BYTES,
  MAX_PREAUTH_BUFFER_EVENTS,
  type StoredSession,
  generateSessionUuid,
  getOrRotateSession,
  makeStorageKey,
} from "./session-shared";

export type EventTrackerDeps = {
  projectId: string,
  getAccessToken: () => Promise<string | null>,
  sendBatch: (body: string, options: { keepalive: boolean }) => Promise<Result<Response, Error>>,
};

type TrackedEvent = {
  event_type: string,
  event_at_ms: number,
  data: Record<string, unknown>,
};

export class EventTracker {
  private _started = false;
  private _cancelled = false;
  private _flushTimer: ReturnType<typeof setInterval> | null = null;
  private _events: TrackedEvent[] = [];
  private _approxBytes = 0;
  private _lastKnownAccessToken: string | null = null;
  private _wasAuthenticated = false;
  private _originalPushState: typeof history.pushState | null = null;
  private _originalReplaceState: typeof history.replaceState | null = null;
  private _popstateHandler: (() => void) | null = null;
  private _clickHandler: ((e: MouseEvent) => void) | null = null;
  private _pagehideHandler: (() => void) | null = null;
  private _visibilityHandler: (() => void) | null = null;
  private readonly _tabId: string;
  private readonly _storageKey: string;
  private readonly _deps: EventTrackerDeps;

  constructor(deps: EventTrackerDeps) {
    this._deps = deps;
    this._tabId = generateSessionUuid();
    this._storageKey = makeStorageKey(deps.projectId);
  }

  start() {
    if (this._started) return;
    if (!isBrowserLike()) return;
    this._started = true;

    // Fire initial page view
    this._capturePageView("initial");

    // Monkey-patch history methods for SPA navigation detection
    this._originalPushState = history.pushState.bind(history);
    this._originalReplaceState = history.replaceState.bind(history);

    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      this._originalPushState!(...args);
      this._capturePageView("push");
    };

    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      this._originalReplaceState!(...args);
      this._capturePageView("replace");
    };

    // Back/forward navigation
    this._popstateHandler = () => this._capturePageView("pop");
    window.addEventListener("popstate", this._popstateHandler);

    // Document-level click listener (capture phase)
    this._clickHandler = (e: MouseEvent) => this._captureClick(e);
    document.addEventListener("click", this._clickHandler, true);

    // Flush on page hide / visibility change
    this._pagehideHandler = () => {
      runAsynchronously(() => this._flush({ keepalive: true }), { noErrorLogging: true });
    };
    this._visibilityHandler = () => {
      runAsynchronously(() => this._flush({ keepalive: true }), { noErrorLogging: true });
    };
    window.addEventListener("pagehide", this._pagehideHandler);
    document.addEventListener("visibilitychange", this._visibilityHandler);

    // Periodic flush + token refresh
    this._flushTimer = setInterval(() => this._tick(), FLUSH_INTERVAL_MS);
  }

  stop() {
    this._cancelled = true;

    if (this._flushTimer !== null) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }

    // Flush remaining events
    runAsynchronously(() => this._flush({ keepalive: true }), { noErrorLogging: true });

    // Restore history methods
    if (this._originalPushState) {
      history.pushState = this._originalPushState;
      this._originalPushState = null;
    }
    if (this._originalReplaceState) {
      history.replaceState = this._originalReplaceState;
      this._originalReplaceState = null;
    }

    // Remove listeners
    if (this._popstateHandler) {
      window.removeEventListener("popstate", this._popstateHandler);
      this._popstateHandler = null;
    }
    if (this._clickHandler) {
      document.removeEventListener("click", this._clickHandler, true);
      this._clickHandler = null;
    }
    if (this._pagehideHandler) {
      window.removeEventListener("pagehide", this._pagehideHandler);
      this._pagehideHandler = null;
    }
    if (this._visibilityHandler) {
      document.removeEventListener("visibilitychange", this._visibilityHandler);
      this._visibilityHandler = null;
    }

    this._events = [];
    this._approxBytes = 0;
  }

  private _pushEvent(event: TrackedEvent) {
    this._events.push(event);
    this._approxBytes += JSON.stringify(event).length;

    if (this._events.length >= MAX_EVENTS_PER_BATCH || this._approxBytes >= MAX_APPROX_BYTES_PER_BATCH) {
      runAsynchronously(() => this._flush({ keepalive: false }), { noErrorLogging: true });
    }

    // Cap pre-auth buffer
    if (!this._lastKnownAccessToken && (this._events.length > MAX_PREAUTH_BUFFER_EVENTS || this._approxBytes > MAX_PREAUTH_BUFFER_BYTES)) {
      this._events = [];
      this._approxBytes = 0;
    }
  }

  private _capturePageView(entryType: "initial" | "push" | "pop" | "replace") {
    this._pushEvent({
      event_type: "$page-view",
      event_at_ms: Date.now(),
      data: {
        url: location.href,
        path: location.pathname,
        referrer: document.referrer,
        title: document.title,
        entry_type: entryType,
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
        screen_width: screen.width,
        screen_height: screen.height,
      },
    });
  }

  private _captureClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const tagName = target.tagName;
    const text = (target.textContent || "").trim().slice(0, 200);
    const href = this._findHref(target);
    const selector = this._buildSelector(target);

    this._pushEvent({
      event_type: "$click",
      event_at_ms: Date.now(),
      data: {
        tag_name: tagName,
        text,
        href,
        selector,
        x: event.clientX,
        y: event.clientY,
        page_x: event.pageX,
        page_y: event.pageY,
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
      },
    });
  }

  private _findHref(el: Element): string | null {
    let current: Element | null = el;
    while (current) {
      if (current instanceof HTMLAnchorElement && current.href) {
        return current.href;
      }
      current = current.parentElement;
    }
    return null;
  }

  private _buildSelector(el: Element): string {
    const parts: string[] = [];
    let current: Element | null = el;
    let depth = 0;

    while (current && depth < 5) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${current.id}`;
        parts.unshift(part);
        break;
      }
      if (current.className && typeof current.className === "string") {
        const classes = current.className.trim().split(/\s+/).slice(0, 3);
        if (classes.length > 0 && classes[0] !== "") {
          part += `.${classes.join(".")}`;
        }
      }
      parts.unshift(part);
      current = current.parentElement;
      depth++;
    }

    return parts.join(" > ");
  }

  private async _flush(options: { keepalive: boolean }) {
    if (!this._lastKnownAccessToken) return;
    if (this._events.length === 0) return;

    const nowMs = Date.now();
    const stored = getOrRotateSession({ key: this._storageKey, nowMs });

    // Persist activity
    const updated: StoredSession = { ...stored, last_activity_ms: nowMs };
    localStorage.setItem(this._storageKey, JSON.stringify(updated));

    const batchId = generateSessionUuid();
    const payload = {
      browser_session_id: stored.session_id,
      tab_id: this._tabId,
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

    // Refresh the cached access token
    runAsynchronously(async () => {
      this._lastKnownAccessToken = await this._deps.getAccessToken();
    }, { noErrorLogging: true });

    const hasAuth = !!this._lastKnownAccessToken;
    // Clear buffer on logout to prevent cross-user event leakage
    if (this._wasAuthenticated && !hasAuth) {
      this._events = [];
      this._approxBytes = 0;
    }
    this._wasAuthenticated = hasAuth;
    if (hasAuth && this._events.length > 0) {
      runAsynchronously(() => this._flush({ keepalive: false }), { noErrorLogging: true });
    }
  }
}
