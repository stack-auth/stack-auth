import { describe, expect, it } from "vitest";
import { buildTraces, flattenTrace, formatDuration, isSystemSpanType, type EventInput, type SpanInput } from "./trace-utils";

function span(id: string, opts: Partial<SpanInput> = {}): SpanInput {
  return {
    id,
    spanType: opts.spanType ?? id,
    startMs: opts.startMs ?? 1000,
    endMs: opts.endMs === undefined ? 2000 : opts.endMs,
    parentSpanIds: opts.parentSpanIds ?? [],
    raw: opts.raw ?? {},
  };
}

function event(eventType: string, opts: Partial<EventInput> = {}): EventInput {
  return {
    eventType,
    atMs: opts.atMs ?? 1500,
    parentSpanIds: opts.parentSpanIds ?? [],
    raw: opts.raw ?? {},
  };
}

describe("buildTraces", () => {
  it("builds a tree from root-first parent chains and attaches events to the nearest fetched ancestor", () => {
    const spans = [
      span("cs-root", { startMs: 1000, endMs: 5000 }),
      span("cs-child", { startMs: 2000, endMs: 4000, parentSpanIds: ["cs-root"] }),
      span("cs-grandchild", { startMs: 2500, endMs: 3000, parentSpanIds: ["cs-root", "cs-child"] }),
    ];
    const events = [
      event("added", { atMs: 2600, parentSpanIds: ["cs-root", "cs-child", "cs-grandchild"] }),
      event("started", { atMs: 1100, parentSpanIds: ["cs-root"] }),
    ];

    const { traces, unattachedEvents } = buildTraces(spans, events);
    expect(traces).toHaveLength(1);
    expect(unattachedEvents).toHaveLength(0);

    const trace = traces[0];
    expect(trace.root.span.id).toBe("cs-root");
    expect(trace.root.children.map((c) => c.span.id)).toEqual(["cs-child"]);
    expect(trace.root.children[0].children.map((c) => c.span.id)).toEqual(["cs-grandchild"]);
    expect(trace.root.events.map((e) => e.eventType)).toEqual(["started"]);
    expect(trace.root.children[0].children[0].events.map((e) => e.eventType)).toEqual(["added"]);
    expect(trace.spanCount).toBe(3);
    expect(trace.eventCount).toBe(2);
    expect(trace.startMs).toBe(1000);
    expect(trace.endMs).toBe(5000);
  });

  it("re-parents to the nearest FETCHED ancestor when an intermediate span is missing", () => {
    const spans = [
      span("cs-root", { startMs: 1000 }),
      // "cs-missing" is in the chain but was not fetched (outside time window)
      span("cs-leaf", { startMs: 1200, parentSpanIds: ["cs-root", "cs-missing"] }),
    ];
    const { traces } = buildTraces(spans, []);
    expect(traces).toHaveLength(1);
    expect(traces[0].root.span.id).toBe("cs-root");
    expect(traces[0].root.children.map((c) => c.span.id)).toEqual(["cs-leaf"]);
  });

  it("treats spans with no fetched ancestor as separate traces, newest first", () => {
    const spans = [
      span("a", { startMs: 1000 }),
      span("b", { startMs: 9000, parentSpanIds: ["not-fetched"] }),
    ];
    const { traces } = buildTraces(spans, []);
    expect(traces.map((t) => t.root.span.id)).toEqual(["b", "a"]);
  });

  it("marks a trace open (endMs null) when any span is open and tracks latestMs", () => {
    const spans = [
      span("root", { startMs: 1000, endMs: 8000 }),
      span("open-child", { startMs: 2000, endMs: null, parentSpanIds: ["root"] }),
    ];
    const events = [event("late", { atMs: 9500, parentSpanIds: ["root"] })];
    const { traces } = buildTraces(spans, events);
    expect(traces[0].endMs).toBeNull();
    expect(traces[0].latestMs).toBe(9500);
  });

  it("returns events with no fetched ancestor as unattached", () => {
    const { traces, unattachedEvents } = buildTraces(
      [span("root")],
      [event("orphan", { parentSpanIds: ["rti-not-fetched"] }), event("bare", { parentSpanIds: [] })],
    );
    expect(traces[0].eventCount).toBe(0);
    expect(unattachedEvents.map((e) => e.eventType)).toEqual(["orphan", "bare"]);
  });

  it("survives hand-crafted parent cycles without infinite recursion", () => {
    const spans = [
      span("x", { parentSpanIds: ["y"] }),
      span("y", { parentSpanIds: ["x"] }),
    ];
    const { traces } = buildTraces(spans, []);
    // Both list each other, so both have a "fetched parent" — but the cycle
    // guard must still terminate and every span must appear exactly once.
    const seen = new Set<string>();
    for (const trace of traces) {
      for (const row of flattenTrace(trace)) {
        if (row.kind === "span") {
          expect(seen.has(row.node.span.id)).toBe(false);
          seen.add(row.node.span.id);
        }
      }
    }
  });

  it("dedupes duplicate span ids, keeping the first occurrence", () => {
    const spans = [
      span("dup", { spanType: "kept", startMs: 1000 }),
      span("dup", { spanType: "dropped", startMs: 2000 }),
    ];
    const { traces } = buildTraces(spans, []);
    expect(traces).toHaveLength(1);
    expect(traces[0].root.span.spanType).toBe("kept");
  });
});

describe("flattenTrace", () => {
  it("interleaves a span's events and child spans chronologically at depth+1", () => {
    const spans = [
      span("root", { startMs: 1000, endMs: 9000 }),
      span("child-early", { startMs: 2000, endMs: 3000, parentSpanIds: ["root"] }),
      span("child-late", { startMs: 6000, endMs: 7000, parentSpanIds: ["root"] }),
    ];
    const events = [event("between", { atMs: 4000, parentSpanIds: ["root"] })];
    const { traces } = buildTraces(spans, events);
    const rows = flattenTrace(traces[0]);
    expect(rows.map((r) => (r.kind === "span" ? r.node.span.id : r.event.eventType))).toEqual([
      "root",
      "child-early",
      "between",
      "child-late",
    ]);
    expect(rows.map((r) => (r.kind === "span" ? r.node.depth : r.depth))).toEqual([0, 1, 1, 1]);
  });
});

describe("formatDuration", () => {
  it("formats across magnitudes", () => {
    expect(formatDuration(0.5)).toBe("<1ms");
    expect(formatDuration(42)).toBe("42ms");
    expect(formatDuration(2500)).toBe("2.5s");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(90_000_000)).toBe("1d 1h");
    expect(formatDuration(NaN)).toBe("—");
  });
});

describe("isSystemSpanType", () => {
  it("flags $-prefixed types as system", () => {
    expect(isSystemSpanType("$session-replay")).toBe(true);
    expect(isSystemSpanType("checkout")).toBe(false);
  });
});
