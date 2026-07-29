// Pure trace-tree construction for the Traces page. Operates on
// already-parsed rows (epoch ms, not ClickHouse date strings) so the module
// stays focused and unit-testable.

import { stringCompare } from "@hexclave/shared/dist/utils/strings";

export type SpanInput = {
  traceId: string,
  id: string,
  spanType: string,
  startMs: number,
  endMs: number | null,
  parentSpanIds: string[],
  raw: Record<string, unknown>,
};

export type EventInput = {
  eventType: string,
  atMs: number,
  parentSpanIds: string[],
  raw: Record<string, unknown>,
};

export type TraceNode = {
  span: SpanInput,
  depth: number,
  children: TraceNode[],
  events: EventInput[],
};

export type Trace = {
  root: TraceNode,
  spanCount: number,
  eventCount: number,
  startMs: number,
  endMs: number | null, // null while any span in the trace is still open
  latestMs: number, // max timestamp observed anywhere in the trace
};

export type WaterfallRow =
  | { kind: "span", node: TraceNode }
  | { kind: "event", event: EventInput, depth: number };

const HTTP_CLIENT_SPAN_ID_PREFIX = "hc-";
const GENERIC_HTTP_METHOD_SPAN = /^(?:DELETE|GET|HEAD|OPTIONS|PATCH|POST|PUT)$/;

function objectStringProperty(value: unknown, property: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const propertyValue = Object.getOwnPropertyDescriptor(value, property)?.value;
  return typeof propertyValue === "string" && propertyValue !== "" ? propertyValue : null;
}

/**
 * Next's server instrumentation sometimes leaves the span name as only the
 * HTTP method while preserving the useful route in semantic attributes. Show
 * that path in the inbox, but never include query strings or fragments because
 * they can contain credentials and high-cardinality customer data.
 */
export function traceSpanDisplayName(span: SpanInput): string {
  if (!GENERIC_HTTP_METHOD_SPAN.test(span.spanType)) return span.spanType;
  const target = objectStringProperty(span.raw.data, "http.route")
    ?? objectStringProperty(span.raw.data, "http.target")
    ?? objectStringProperty(span.raw.data, "url.path");
  if (target == null) return span.spanType;
  const safePath = target.replace(/[?#].*$/, "");
  return safePath === "" ? span.spanType : `${span.spanType} ${safePath}`;
}

/**
 * The W3C trace id a `$http-client` bridge span's own id derives (the uuid
 * after `hc-`, dash-stripped — a uuid is exactly 16 bytes). The SDK sent this
 * exact value as `traceparent`, so the backend sub-trace this fetch produced
 * stores it as its `trace_id`. Must mirror uuidToW3cTraceId in
 * @hexclave/shared analytics-wire.
 */
export function deriveW3cTraceIdFromHcSpanId(spanId: string): string | null {
  if (!spanId.startsWith(HTTP_CLIENT_SPAN_ID_PREFIX)) return null;
  const hex = spanId.slice(HTTP_CLIENT_SPAN_ID_PREFIX.length).toLowerCase().replaceAll("-", "");
  return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
}

/**
 * Reparents backend spans (stored under W3C trace ids) under the client
 * `$http-client` span that caused them, purely at read time: any span whose (32-hex) trace id is
 * derivable from a bridge span's own id gets the bridge's ancestry chain
 * prefixed onto its parents, so `nearestFetchedAncestor` attaches the W3C
 * sub-trace's root under the bridge and the waterfall renders page-view →
 * $http-client → backend request → db spans as ONE tree. Native and W3C id
 * namespaces are disjoint (prefixed vs raw hex), so no collisions or duplicate
 * parent ids are possible. Run before buildTraces.
 */
export function spliceBridgedSubtraces(spans: SpanInput[]): SpanInput[] {
  const bridgeByW3cTraceId = new Map<string, SpanInput>();
  for (const span of spans) {
    const w3cTraceId = deriveW3cTraceIdFromHcSpanId(span.id);
    if (w3cTraceId !== null && !bridgeByW3cTraceId.has(w3cTraceId)) {
      bridgeByW3cTraceId.set(w3cTraceId, span);
    }
  }
  if (bridgeByW3cTraceId.size === 0) return spans;
  return spans.map((span) => {
    const bridge = bridgeByW3cTraceId.get(span.traceId);
    if (bridge === undefined || bridge.id === span.id) return span;
    return { ...span, parentSpanIds: [...bridge.parentSpanIds, bridge.id, ...span.parentSpanIds] };
  });
}

export function spanHasError(span: SpanInput): boolean {
  return span.raw.status_code === "error";
}

export function traceErrorCount(trace: Trace): number {
  let count = 0;
  const stack = [trace.root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node == null) break;
    if (spanHasError(node.span)) count += 1;
    stack.push(...node.children);
  }
  return count;
}

export function traceContainsSpanId(trace: Trace, spanId: string): boolean {
  const stack = [trace.root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node == null) break;
    if (node.span.id === spanId) return true;
    stack.push(...node.children);
  }
  return false;
}

/**
 * Select the spans that explain a trace without flooding the first view with
 * instrumentation detail. Errors, native custom spans, event owners, and the
 * trace root are always retained. The slowest operations add performance
 * context, then their ancestor paths are restored so causality is still
 * readable. The full trace remains available through the UI's All mode.
 */
export function traceSignalSpanIds(trace: Trace, slowSpanLimit = 20, needle = ""): Set<string> {
  const selected = new Set<string>([trace.root.span.id]);
  const candidates: TraceNode[] = [];

  const visit = (node: TraceNode, ancestors: TraceNode[]) => {
    const matchesSearch = needle !== "" && (
      node.span.spanType.toLowerCase().includes(needle)
      || node.events.some((event) => event.eventType.toLowerCase().includes(needle))
    );
    const alwaysKeep = spanHasError(node.span)
      || node.span.id.startsWith("cs-")
      || node.events.length > 0
      || matchesSearch;
    if (alwaysKeep) {
      selected.add(node.span.id);
      for (const ancestor of ancestors) selected.add(ancestor.span.id);
    }
    if (node.span.id !== trace.root.span.id) {
      candidates.push(node);
    }
    for (const child of node.children) visit(child, [...ancestors, node]);
  };
  visit(trace.root, []);

  candidates.sort((left, right) => {
    const leftDuration = left.span.endMs == null ? Infinity : left.span.endMs - left.span.startMs;
    const rightDuration = right.span.endMs == null ? Infinity : right.span.endMs - right.span.startMs;
    return rightDuration - leftDuration || left.span.startMs - right.span.startMs;
  });
  const candidateIds = new Set(candidates.slice(0, slowSpanLimit).map((node) => node.span.id));

  const restoreSelectedPaths = (node: TraceNode, ancestors: TraceNode[]) => {
    if (candidateIds.has(node.span.id)) {
      selected.add(node.span.id);
      for (const ancestor of ancestors) selected.add(ancestor.span.id);
    }
    for (const child of node.children) restoreSelectedPaths(child, [...ancestors, node]);
  };
  restoreSelectedPaths(trace.root, []);
  return selected;
}

export function isSystemSpanType(spanType: string): boolean {
  return spanType.startsWith("$");
}

/** True if the span, any of its events, or any descendant matches the needle (lowercase). */
export function subtreeMatches(node: TraceNode, needle: string): boolean {
  if (node.span.spanType.toLowerCase().includes(needle)) return true;
  if (node.events.some((event) => event.eventType.toLowerCase().includes(needle))) return true;
  return node.children.some((child) => subtreeMatches(child, needle));
}

/**
 * Waterfall zoom viewport as fractions of the full trace timeline
 * (0 = trace start, 1 = trace end). {start: 0, end: 1} means unzoomed.
 */
export type ViewWindow = { start: number, end: number };

const MIN_VIEW_SPAN = 1e-8;

/** Zoom by `factor` (<1 zooms in) keeping the point at `anchorFrac` of the current view fixed. */
export function zoomViewWindow(view: ViewWindow, anchorFrac: number, factor: number): ViewWindow {
  const span = view.end - view.start;
  const newSpan = Math.min(Math.max(span * factor, MIN_VIEW_SPAN), 1);
  const anchorAbs = view.start + anchorFrac * span;
  const start = Math.min(Math.max(anchorAbs - anchorFrac * newSpan, 0), 1 - newSpan);
  return { start, end: start + newSpan };
}

/** Shift the view by `deltaFrac` of its own width, clamped to the timeline. */
export function panViewWindow(view: ViewWindow, deltaFrac: number): ViewWindow {
  const span = view.end - view.start;
  const start = Math.min(Math.max(view.start + deltaFrac * span, 0), 1 - span);
  return { start, end: start + span };
}

/** Timeline end clamped to now; an open trace continues through now. */
export function getTraceScaleEnd(trace: Pick<Trace, "startMs" | "endMs" | "latestMs">, nowMs: number): number {
  const observedEnd = trace.endMs == null ? nowMs : Math.max(trace.endMs, trace.latestMs);
  return Math.max(Math.min(observedEnd, nowMs), trace.startMs + 1);
}

/**
 * The parent a row renders under is its nearest ANCESTOR THAT WAS FETCHED, not
 * its literal last parent id — intermediate spans can fall outside the queried
 * time window (or be filtered out) without orphaning their whole subtree.
 * parent_span_ids is farthest-known first and nearest-known last, so we scan
 * from the end.
 */
function nearestFetchedAncestor(parentSpanIds: string[], byId: Map<string, SpanInput>, selfId: string | null): string | null {
  for (let i = parentSpanIds.length - 1; i >= 0; i--) {
    const id = parentSpanIds[i];
    if (id !== selfId && byId.has(id)) return id;
  }
  return null;
}

export function buildTraces(spans: SpanInput[], events: EventInput[]): { traces: Trace[], unattachedEvents: EventInput[] } {
  const byId = new Map<string, SpanInput>();
  for (const span of spans) {
    if (!byId.has(span.id)) byId.set(span.id, span);
  }

  // Each span has at most one nearest fetched parent. Hand-crafted input can
  // still form a cycle, so deterministically cut one edge per cycle before
  // constructing children; otherwise a fully cyclic component has no root and
  // silently disappears from the UI.
  const parentOf = new Map<string, string | null>();
  for (const span of byId.values()) {
    parentOf.set(span.id, nearestFetchedAncestor(span.parentSpanIds, byId, span.id));
  }
  const resolved = new Set<string>();
  for (const span of byId.values()) {
    if (resolved.has(span.id)) continue;
    const path: string[] = [];
    const indexInPath = new Map<string, number>();
    let currentId: string | null = span.id;
    while (currentId != null && !resolved.has(currentId)) {
      const cycleStart = indexInPath.get(currentId);
      if (cycleStart !== undefined) {
        const cycleIds = path.slice(cycleStart);
        cycleIds.sort((leftId, rightId) => {
          const left = byId.get(leftId);
          const right = byId.get(rightId);
          if (left == null || right == null) {
            throw new Error("Cycle detection referenced a span outside the fetched span map");
          }
          return left.startMs - right.startMs || stringCompare(left.id, right.id);
        });
        const cycleRootId = cycleIds.at(0);
        if (cycleRootId == null) {
          throw new Error("Cycle detection found an empty cycle");
        }
        parentOf.set(cycleRootId, null);
        break;
      }
      indexInPath.set(currentId, path.length);
      path.push(currentId);
      currentId = parentOf.get(currentId) ?? null;
    }
    for (const id of path) resolved.add(id);
  }

  const childrenOf = new Map<string, SpanInput[]>();
  const roots: SpanInput[] = [];
  for (const span of byId.values()) {
    const parentId = parentOf.get(span.id) ?? null;
    if (parentId == null) {
      roots.push(span);
    } else {
      const siblings = childrenOf.get(parentId) ?? [];
      siblings.push(span);
      childrenOf.set(parentId, siblings);
    }
  }

  const eventsOf = new Map<string, EventInput[]>();
  const unattachedEvents: EventInput[] = [];
  for (const event of events) {
    const parentId = nearestFetchedAncestor(event.parentSpanIds, byId, null);
    if (parentId == null) {
      unattachedEvents.push(event);
    } else {
      const attached = eventsOf.get(parentId) ?? [];
      attached.push(event);
      eventsOf.set(parentId, attached);
    }
  }

  const traces = roots.map((rootSpan) => {
    // Defense in depth for malformed input: a span may only appear once per trace.
    const visited = new Set<string>();

    const buildNode = (span: SpanInput, depth: number): TraceNode => {
      visited.add(span.id);
      const ownEvents = [...(eventsOf.get(span.id) ?? [])].sort((a, b) => a.atMs - b.atMs);
      const childSpans = [...(childrenOf.get(span.id) ?? [])]
        .filter((child) => !visited.has(child.id))
        .sort((a, b) => a.startMs - b.startMs);
      return {
        span,
        depth,
        events: ownEvents,
        children: childSpans.map((child) => buildNode(child, depth + 1)),
      };
    };

    const root = buildNode(rootSpan, 0);
    return { root, ...computeTraceAggregates(root) } satisfies Trace;
  });

  traces.sort((a, b) => b.startMs - a.startMs);
  return { traces, unattachedEvents };
}

function computeTraceAggregates(root: TraceNode): Omit<Trace, "root"> {
  let spanCount = 0;
  let eventCount = 0;
  let startMs = Infinity;
  let latestMs = -Infinity;
  let hasOpenSpan = false;
  let maxEndMs: number | null = null;
  const stack: TraceNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node == null) break;
    spanCount++;
    startMs = Math.min(startMs, node.span.startMs);
    latestMs = Math.max(latestMs, node.span.startMs);
    if (node.span.endMs == null) {
      hasOpenSpan = true;
    } else {
      maxEndMs = maxEndMs == null ? node.span.endMs : Math.max(maxEndMs, node.span.endMs);
      latestMs = Math.max(latestMs, node.span.endMs);
    }
    eventCount += node.events.length;
    for (const event of node.events) {
      // Events can precede their span's own start (events and replay chunks
      // are batched independently) — widen the window so they stay on-scale.
      startMs = Math.min(startMs, event.atMs);
      latestMs = Math.max(latestMs, event.atMs);
    }
    stack.push(...node.children);
  }
  return {
    spanCount,
    eventCount,
    startMs,
    endMs: hasOpenSpan ? null : maxEndMs,
    latestMs,
  };
}

/**
 * Depth-first flattening for the waterfall: each span row is followed by its
 * own events and child spans interleaved chronologically.
 */
export function flattenTrace(trace: Trace): WaterfallRow[] {
  const rows: WaterfallRow[] = [];
  const walk = (node: TraceNode) => {
    rows.push({ kind: "span", node });
    const items: { atMs: number, row: () => void }[] = [
      ...node.events.map((event) => ({ atMs: event.atMs, row: () => rows.push({ kind: "event", event, depth: node.depth + 1 }) })),
      ...node.children.map((child) => ({ atMs: child.span.startMs, row: () => walk(child) })),
    ];
    items.sort((a, b) => a.atMs - b.atMs);
    for (const item of items) item.row();
  };
  walk(trace.root);
  return rows;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms === 0) return "0s";
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  if (ms < 3_600_000) {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }
  if (ms < 86_400_000) {
    const totalMinutes = Math.round(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  const totalHours = Math.round(ms / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}
