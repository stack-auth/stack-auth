import { isBrowserLike } from "@stackframe/stack-shared/dist/utils/env";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { generateUuid } from "./session-replay";

const FLUSH_INTERVAL_MS = 10_000;
const MAX_EVENTS_PER_BATCH = 50;
const MAX_APPROX_BYTES_PER_BATCH = 64_000;

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

function cssEscapeIdent(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

// Pixel quantization factor for x/y/viewport in stored click events. Matches the
// SCALE_FACTOR used by the ClickHouse clickmap_events MV — keep them in sync.
const CLICKMAP_SCALE_FACTOR = 16;
const ELEMENTS_CHAIN_MAX_DEPTH = 8;
const ELEMENTS_CHAIN_TEXT_MAX = 80;
const ELEMENTS_CHAIN_ATTR_MAX = 200;
const HEXCLAVE_DEV_TOOL_ROOT_ID = "__hexclave-dev-tool-root";
// Attributes we serialise into elements_chain. Mirrors the set PostHog persists:
// stable identifiers (id, data-testid), semantics (role, type, name, aria-label),
// and a few we expect downstream tooling to want to match against.
const ELEMENTS_CHAIN_ATTRS = [
  "id",
  "data-testid",
  "data-test-id",
  "data-hexclave-id",
  "name",
  "type",
  "role",
  "aria-label",
  "placeholder",
  "title",
] as const;

function escapeElementsChainValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Class tokens are written into the unquoted, dot-joined prefix of a segment, so
// any "." or ":" inside a class (e.g. Tailwind variants like `md:hover:bg-blue-500`
// or arbitrary values like `w-[1.5rem]`) must be escaped to round-trip through the
// overlay parser, which splits the prefix on unescaped "." and the segment on
// unescaped ":".
function escapeElementsChainClass(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\./g, "\\.").replace(/:/g, "\\:");
}

function getElementClasses(element: Element): string[] {
  const className = (element as HTMLElement).className;
  if (typeof className !== "string" || className.trim() === "") {
    return [];
  }
  return className.trim().split(/\s+/).filter(Boolean).slice(0, 4);
}

function getNthChildIndex(element: Element): number | null {
  const parent = element.parentElement;
  if (parent == null) return null;
  const index = Array.prototype.indexOf.call(parent.children, element);
  return index >= 0 ? index + 1 : null;
}

function getNthOfTypeIndex(element: Element): number | null {
  const parent = element.parentElement;
  if (parent == null) return null;
  const tagName = element.tagName;
  const siblings = Array.from(parent.children).filter((child) => child.tagName === tagName);
  if (siblings.length <= 1) return null;
  const index = siblings.indexOf(element);
  return index >= 0 ? index + 1 : null;
}

// Serialise one DOM element into a PostHog-compatible elements_chain segment.
//   tag.class1.class2:nth-child="2":nth-of-type="1":text="Save":attr__id="save-btn":href="..."
// Segments are joined with ";" from leaf to root so downstream matchers can
// LIKE against any ancestor cheaply.
function serializeElementsChainSegment(element: Element): string {
  const parts: string[] = [];
  parts.push(element.tagName.toLowerCase());
  const classes = getElementClasses(element);
  if (classes.length > 0) {
    parts.push(`.${classes.map(escapeElementsChainClass).join(".")}`);
  }
  const text = element.textContent.trim().replace(/\s+/g, " ").slice(0, ELEMENTS_CHAIN_TEXT_MAX);
  const nthChild = getNthChildIndex(element);
  const nthOfType = getNthOfTypeIndex(element);
  const attrPairs: string[] = [];
  if (nthChild != null) attrPairs.push(`nth-child="${nthChild}"`);
  if (nthOfType != null) attrPairs.push(`nth-of-type="${nthOfType}"`);
  if (text !== "") attrPairs.push(`text="${escapeElementsChainValue(text)}"`);
  for (const attrName of ELEMENTS_CHAIN_ATTRS) {
    const value = element.getAttribute(attrName);
    if (value == null || value === "") continue;
    attrPairs.push(`attr__${attrName}="${escapeElementsChainValue(value.slice(0, ELEMENTS_CHAIN_ATTR_MAX))}"`);
  }
  if (element.tagName === "A") {
    const href = element.getAttribute("href");
    if (href != null && href !== "") {
      attrPairs.push(`href="${escapeElementsChainValue(href.slice(0, ELEMENTS_CHAIN_ATTR_MAX))}"`);
    }
  }
  if (attrPairs.length > 0) {
    parts.push(`:${attrPairs.join(":")}`);
  }
  return parts.join("");
}

function buildElementsChain(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  while (current != null && depth < ELEMENTS_CHAIN_MAX_DEPTH && current !== document.documentElement) {
    segments.push(serializeElementsChainSegment(current));
    current = current.parentElement;
    depth += 1;
  }
  return segments.join(";");
}

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

function isInsideHexclaveDevTool(element: Element): boolean {
  return element.closest(`#${cssEscapeIdent(HEXCLAVE_DEV_TOOL_ROOT_ID)}`) != null;
}

export type EventTrackerDeps = {
  projectId: string,
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
  private _lastUrl: string | null = null;
  private readonly _sessionReplaySegmentId: string;
  private readonly _deps: EventTrackerDeps;

  private _originalPushState: History["pushState"] | null = null;
  private _originalReplaceState: History["replaceState"] | null = null;

  constructor(deps: EventTrackerDeps) {
    this._deps = deps;
    this._sessionReplaySegmentId = generateUuid();
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
    this._events = [];
    this._approxBytes = 0;
  }

  private _pushEvent(event: TrackedEvent) {
    this._events.push(event);
    this._approxBytes += JSON.stringify(event).length;
    if (this._events.length >= MAX_EVENTS_PER_BATCH || this._approxBytes >= MAX_APPROX_BYTES_PER_BATCH) {
      runAsynchronously(() => this._flush({ keepalive: false }));
    }
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
    if (isInsideHexclaveDevTool(target)) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const pointerTargetFixed = isPointerTargetFixed(target);
    // Pre-scale at ingest so old + new rows land in identical buckets in CH.
    const xScaled = Math.round(event.pageX / CLICKMAP_SCALE_FACTOR);
    const yScaled = Math.round(event.pageY / CLICKMAP_SCALE_FACTOR);
    const clientYScaled = Math.round(event.clientY / CLICKMAP_SCALE_FACTOR);
    const relativeX = viewportWidth > 0 ? event.clientX / viewportWidth : 0;

    this._pushEvent({
      event_type: "$click",
      event_at_ms: Date.now(),
      data: {
        tag_name: target.tagName.toLowerCase(),
        text: target.textContent.trim().substring(0, 200),
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
    });
  };

  private _setupClickCapture() {
    document.addEventListener("click", this._onClickCapture, { capture: true });
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

    this._events = [];
    this._approxBytes = 0;
  }

  private async _flush(options: { keepalive: boolean }) {
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
    if (this._events.length > 0) {
      runAsynchronously(() => this._flush({ keepalive: false }));
    }
  }
}
