// Pure trace-tree construction for the Spans & Events page. Operates on
// already-parsed rows (epoch ms, not ClickHouse date strings) so the module
// stays dependency-free and unit-testable.

export type SpanInput = {
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

export function isSystemSpanType(spanType: string): boolean {
  return spanType.startsWith("$");
}

/**
 * The parent a row renders under is its nearest ANCESTOR THAT WAS FETCHED, not
 * its literal last parent id — intermediate spans can fall outside the queried
 * time window (or be filtered out) without orphaning their whole subtree.
 * parent_span_ids is root-first, so we scan from the end.
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

  const childrenOf = new Map<string, SpanInput[]>();
  const roots: SpanInput[] = [];
  for (const span of byId.values()) {
    const parentId = nearestFetchedAncestor(span.parentSpanIds, byId, span.id);
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
    // Cycle guard: hand-crafted parent ids could form a loop; a span may only
    // appear once per trace.
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
      for (const event of node.events) latestMs = Math.max(latestMs, event.atMs);
      stack.push(...node.children);
    }

    return {
      root,
      spanCount,
      eventCount,
      startMs,
      endMs: hasOpenSpan ? null : maxEndMs,
      latestMs,
    } satisfies Trace;
  });

  traces.sort((a, b) => b.startMs - a.startMs);
  return { traces, unattachedEvents };
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
