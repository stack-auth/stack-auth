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
  /** W3C scalar parent. `null` means this span is the root of its trace. */
  parentSpanId: string | null,
  raw: Record<string, unknown>,
};

export type EventInput = {
  /** The W3C trace containing `spanId`; null when the event happened outside a span. */
  traceId: string | null,
  eventType: string,
  atMs: number,
  /**
   * The span this event happened inside, when there was one. Events are not
   * part of the span hierarchy: they name their enclosing span and nothing else.
   */
  spanId: string | null,
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

const GENERIC_HTTP_METHOD_SPAN = /^(?:DELETE|GET|HEAD|OPTIONS|PATCH|POST|PUT)$/;
// This SDK-native boundary deliberately keeps its semantic operation name so
// the cross-tier tree reads naturally, but it is framework instrumentation —
// not a custom span authored by the application using the SDK. Without this
// distinction, every backend request and its ancestor path is promoted into
// Signal mode, turning the compact view into a near-copy of All spans.
const INTERNAL_SDK_SPAN_TYPES = new Set(["hexclave.api.request"]);

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
  // Instrumentation scope identifies library-generated spans. Their indexed
  // span_type is a normalized operation key, while data.name preserves the
  // exact human-readable OTel operation.
  if (span.raw.scope_name != null) {
    return objectStringProperty(span.raw.data, "name") ?? span.spanType;
  }
  if (!GENERIC_HTTP_METHOD_SPAN.test(span.spanType)) return span.spanType;
  const target = objectStringProperty(span.raw.data, "http.route")
    ?? objectStringProperty(span.raw.data, "http.target")
    ?? objectStringProperty(span.raw.data, "url.path");
  if (target == null) return span.spanType;
  const safePath = target.replace(/[?#].*$/, "");
  return safePath === "" ? span.spanType : `${span.spanType} ${safePath}`;
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

export type TraceEventHighlight = {
  spanId: string | null,
  eventType: string | null,
  eventAtMs: number | null,
};

/**
 * Product events have no durable id. A shareable highlight is the enclosing
 * span plus the event's type and epoch-ms; any subset still has to match.
 */
export function eventMatchesHighlight(event: EventInput, highlight: TraceEventHighlight): boolean {
  if (highlight.eventType == null && highlight.eventAtMs == null) return false;
  if (highlight.spanId != null && event.spanId !== highlight.spanId) return false;
  if (highlight.eventType != null && event.eventType !== highlight.eventType) return false;
  if (highlight.eventAtMs != null && event.atMs !== highlight.eventAtMs) return false;
  return true;
}

/** Ancestor span ids from the root down to (but not including) `spanId`. */
export function spanAncestorIds(root: TraceNode, spanId: string): string[] | null {
  const walk = (node: TraceNode, ancestors: string[]): string[] | null => {
    if (node.span.id === spanId) return ancestors;
    for (const child of node.children) {
      const found = walk(child, [...ancestors, node.span.id]);
      if (found != null) return found;
    }
    return null;
  };
  return walk(root, []);
}

function findSpanIdOwningHighlightedEvent(root: TraceNode, highlight: TraceEventHighlight): string | null {
  const walk = (node: TraceNode): string | null => {
    if (node.events.some((event) => eventMatchesHighlight(event, highlight))) return node.span.id;
    for (const child of node.children) {
      const found = walk(child);
      if (found != null) return found;
    }
    return null;
  };
  return walk(root);
}

/**
 * Spans that must be expanded in All mode so a highlighted event/span is
 * actually visible: the owning span (its events are hidden while collapsed)
 * and every ancestor on the path from the root.
 */
export function spanIdsToExpandForHighlight(root: TraceNode, highlight: TraceEventHighlight): string[] {
  const spanId = highlight.spanId ?? findSpanIdOwningHighlightedEvent(root, highlight);
  if (spanId == null) return [];
  const ancestors = spanAncestorIds(root, spanId);
  if (ancestors == null) return [];
  return [...ancestors, spanId];
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
 * instrumentation detail. Errors, spans the customer's own code authored, event
 * owners, and the trace root are always retained. The slowest operations add
 * performance context, then their ancestor paths are restored so causality is
 * still readable. The full trace remains available through the UI's All mode.
 *
 * "Authored by the customer" means a non-`$` SDK span with no instrumentation
 * scope. Both halves matter: `$` types are Hexclave's own autocapture, while
 * `scope_name` separates a deliberate `startSpan("checkout")` from an
 * auto-instrumented `prisma:client:db_query` with the same SDK producer.
 */
export function traceSignalSpanIds(trace: Trace, slowSpanLimit = 20, needle = ""): Set<string> {
  const selected = new Set<string>([trace.root.span.id]);
  const candidates: TraceNode[] = [];

  const selectWithAncestors = (node: TraceNode, ancestors: TraceNode[]) => {
    selected.add(node.span.id);
    for (const ancestor of ancestors) selected.add(ancestor.span.id);
  };

  const visit = (node: TraceNode, ancestors: TraceNode[]) => {
    const matchesSearch = needle !== "" && (
      traceSpanDisplayName(node.span).toLowerCase().includes(needle)
      || node.events.some((event) => event.eventType.toLowerCase().includes(needle))
    );
    const hasAutomaticSignal = spanHasError(node.span)
      || isCustomerAuthoredSpan(node.span)
      || node.events.length > 0;

    if (matchesSearch) {
      // Explicit search is the escape hatch for inspecting an internal server
      // operation without switching the whole trace to All spans.
      selectWithAncestors(node, ancestors);
    } else if (hasAutomaticSignal) {
      selectWithAncestors(node, ancestors);
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

/**
 * Whether the customer's own code deliberately created this span, as opposed to
 * Hexclave autocapture (`$` types) or a library the OTel bridge picked up
 * (`scope_name` is non-null). Used by signal mode; see traceSignalSpanIds for
 * why the instrumentation scope is load-bearing rather than redundant with the
 * type check.
 */
export function isCustomerAuthoredSpan(span: SpanInput): boolean {
  return !isSystemSpanType(span.spanType)
    && !INTERNAL_SDK_SPAN_TYPES.has(span.spanType)
    && span.raw.producer === "sdk"
    && span.raw.scope_name == null;
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

function spanTreeKey(traceId: string, spanId: string): string {
  // W3C ids are lowercase hex and therefore cannot contain the separator.
  return `${traceId}:${spanId}`;
}

export function buildTraces(spans: SpanInput[], events: EventInput[]): { traces: Trace[], unattachedEvents: EventInput[] } {
  // This is the old tree-building contract applied to the new scalar schema:
  // use the parent only when that exact row was fetched; otherwise the real span
  // becomes a root. Never invent hierarchy that is absent from ClickHouse.
  // W3C span ids are scoped to a trace, so every index uses the identity pair.
  const byKey = new Map<string, SpanInput>();
  for (const span of spans) {
    const key = spanTreeKey(span.traceId, span.id);
    if (!byKey.has(key)) byKey.set(key, span);
  }

  // Each span has at most one fetched parent. Hand-crafted input can still form
  // a cycle, so deterministically cut one edge per cycle before constructing
  // children; otherwise a fully cyclic component has no root and disappears.
  const parentOf = new Map<string, string | null>();
  for (const [key, span] of byKey) {
    const parentKey = span.parentSpanId == null || span.parentSpanId === span.id
      ? null
      : spanTreeKey(span.traceId, span.parentSpanId);
    parentOf.set(key, parentKey != null && byKey.has(parentKey) ? parentKey : null);
  }
  const resolved = new Set<string>();
  for (const key of byKey.keys()) {
    if (resolved.has(key)) continue;
    const path: string[] = [];
    const indexInPath = new Map<string, number>();
    let currentKey: string | null = key;
    while (currentKey != null && !resolved.has(currentKey)) {
      const cycleStart = indexInPath.get(currentKey);
      if (cycleStart !== undefined) {
        const cycleKeys = path.slice(cycleStart);
        cycleKeys.sort((leftKey, rightKey) => {
          const left = byKey.get(leftKey);
          const right = byKey.get(rightKey);
          if (left == null || right == null) {
            throw new Error("Cycle detection referenced a span outside the fetched span map");
          }
          return left.startMs - right.startMs || stringCompare(left.id, right.id);
        });
        const cycleRootKey = cycleKeys.at(0);
        if (cycleRootKey == null) {
          throw new Error("Cycle detection found an empty cycle");
        }
        parentOf.set(cycleRootKey, null);
        break;
      }
      indexInPath.set(currentKey, path.length);
      path.push(currentKey);
      currentKey = parentOf.get(currentKey) ?? null;
    }
    for (const pathKey of path) resolved.add(pathKey);
  }

  const childrenOf = new Map<string, SpanInput[]>();
  const roots: SpanInput[] = [];
  for (const [key, span] of byKey) {
    const parentKey = parentOf.get(key) ?? null;
    if (parentKey == null) {
      roots.push(span);
    } else {
      const siblings = childrenOf.get(parentKey) ?? [];
      siblings.push(span);
      childrenOf.set(parentKey, siblings);
    }
  }

  const eventsOf = new Map<string, EventInput[]>();
  const unattachedEvents: EventInput[] = [];
  for (const event of events) {
    const ownerKey = event.traceId == null || event.spanId == null
      ? null
      : spanTreeKey(event.traceId, event.spanId);
    if (ownerKey == null || !byKey.has(ownerKey)) {
      unattachedEvents.push(event);
    } else {
      const attached = eventsOf.get(ownerKey) ?? [];
      attached.push(event);
      eventsOf.set(ownerKey, attached);
    }
  }

  const traces = roots.map((rootSpan) => {
    // Defense in depth for malformed input: a span may only appear once per trace.
    const visited = new Set<string>();

    const buildNode = (span: SpanInput, depth: number): TraceNode => {
      const key = spanTreeKey(span.traceId, span.id);
      visited.add(key);
      const ownEvents = [...(eventsOf.get(key) ?? [])].sort((a, b) => a.atMs - b.atMs);
      const childSpans = [...(childrenOf.get(key) ?? [])]
        .filter((child) => !visited.has(spanTreeKey(child.traceId, child.id)))
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

/**
 * The tree to show when a trace id is selected. A fragmented trace produces
 * SEVERAL trees sharing one trace id: any span whose parent row is missing
 * (not yet exported, dropped on page unload, cut by the row cap) becomes a
 * fragment root. `traces` is sorted newest-first for the inbox, so a plain
 * `.find()` by trace id used to return whichever fragment started most
 * recently — usually some backend request subtree instead of the session's
 * actual root. Prefer the tree anchored at a TRUE root (parent_span_id NULL,
 * e.g. the $refresh-token session root), then the earliest and largest tree,
 * so the selection is deterministic.
 */
export function selectPrimaryTrace(traces: Trace[], traceId: string): Trace | null {
  return traces
    .filter((trace) => trace.root.span.traceId === traceId)
    .sort((a, b) =>
      Number(b.root.span.parentSpanId == null) - Number(a.root.span.parentSpanId == null)
      || a.startMs - b.startMs
      || b.spanCount - a.spanCount,
    )[0] ?? null;
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

// Duration rendering is shared with the services page — see ../format.ts for why
// it does not live here.
export { formatDuration } from "../format";
