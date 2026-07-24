import { describe, expect, it } from "vitest";
import { buildTraces, flattenTrace, formatDuration, getTraceScaleEnd, isSystemSpanType, panViewWindow, subtreeMatches, traceErrorCount, traceSignalSpanIds, zoomViewWindow, type EventInput, type SpanInput } from "./trace-utils";

function span(id: string, opts: Partial<SpanInput> = {}): SpanInput {
  return {
    traceId: opts.traceId ?? "test-trace",
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

  it("nests OpenTelemetry spans that reference only their immediate parent", () => {
    const { traces } = buildTraces([
      span("otel-trace-root"),
      span("otel-child", { parentSpanIds: ["otel-trace-root"] }),
      span("otel-grandchild", { parentSpanIds: ["otel-child"] }),
    ], []);

    expect(traces).toHaveLength(1);
    expect(traces[0].root.span.id).toBe("otel-trace-root");
    expect(traces[0].root.children[0].span.id).toBe("otel-child");
    expect(traces[0].root.children[0].children[0].span.id).toBe("otel-grandchild");
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

  it("widens startMs to include events that precede their span's start", () => {
    // Events and replay chunks batch independently, so an attached event can
    // predate the span row's own started_at.
    const { traces } = buildTraces(
      [span("root", { startMs: 5000, endMs: 9000 })],
      [event("early", { atMs: 3000, parentSpanIds: ["root"] })],
    );
    expect(traces[0].startMs).toBe(3000);
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
    expect(traces).toHaveLength(1);
    expect(seen).toEqual(new Set(["x", "y"]));
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

describe("getTraceScaleEnd", () => {
  it("extends an open trace through now even when its latest observation is at the start", () => {
    expect(getTraceScaleEnd({ startMs: 1000, endMs: null, latestMs: 1000 }, 10_000)).toBe(10_000);
  });

  it("includes late observations, clamps future ends to now, and preserves a non-zero scale", () => {
    expect(getTraceScaleEnd({ startMs: 1000, endMs: 5000, latestMs: 7000 }, 10_000)).toBe(7000);
    expect(getTraceScaleEnd({ startMs: 1000, endMs: 50_000, latestMs: 5000 }, 10_000)).toBe(10_000);
    expect(getTraceScaleEnd({ startMs: 1000, endMs: 1000, latestMs: 1000 }, 10_000)).toBe(1001);
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

describe("zoomViewWindow / panViewWindow", () => {
  it("zooms in around the anchor point and keeps it fixed", () => {
    const zoomed = zoomViewWindow({ start: 0, end: 1 }, 0.5, 0.5);
    expect(zoomed.start).toBeCloseTo(0.25);
    expect(zoomed.end).toBeCloseTo(0.75);
    // Anchor at 0.5 of the view maps to the same absolute position after zoom.
    const anchorAbsBefore = 0 + 0.5 * 1;
    const anchorAbsAfter = zoomed.start + 0.5 * (zoomed.end - zoomed.start);
    expect(anchorAbsAfter).toBeCloseTo(anchorAbsBefore);
  });

  it("clamps zoom-out to the full timeline and zoom position to [0, 1]", () => {
    expect(zoomViewWindow({ start: 0.25, end: 0.75 }, 0.5, 10)).toEqual({ start: 0, end: 1 });
    const nearEdge = zoomViewWindow({ start: 0, end: 1 }, 0, 0.5);
    expect(nearEdge.start).toBe(0);
    expect(nearEdge.end).toBeCloseTo(0.5);
  });

  it("pans by a fraction of the view width and clamps at the edges", () => {
    const panned = panViewWindow({ start: 0.2, end: 0.4 }, 0.5);
    expect(panned.start).toBeCloseTo(0.3);
    expect(panned.end).toBeCloseTo(0.5);
    expect(panViewWindow({ start: 0.8, end: 1 }, 5)).toEqual({ start: 0.8, end: 1 });
    expect(panViewWindow({ start: 0, end: 0.2 }, -5)).toEqual({ start: 0, end: 0.2 });
  });
});

describe("subtreeMatches", () => {
  it("matches span types, event types, and descendants", () => {
    const { traces } = buildTraces(
      [span("a", { spanType: "checkout" }), span("b", { spanType: "payment", parentSpanIds: ["a"] })],
      [event("card_declined", { parentSpanIds: ["a", "b"] })],
    );
    expect(subtreeMatches(traces[0].root, "payment")).toBe(true);
    expect(subtreeMatches(traces[0].root, "card_")).toBe(true);
    expect(subtreeMatches(traces[0].root, "refund")).toBe(false);
    expect(subtreeMatches(traces[0].root.children[0], "checkout")).toBe(false);
  });
});

describe("trace signal selection", () => {
  it("keeps causal paths to errors, events, custom spans, and slow client operations", () => {
    const spans = [
      span("otel-root", { startMs: 0, endMs: 1000 }),
      span("otel-fast", { startMs: 10, endMs: 11, parentSpanIds: ["otel-root"] }),
      span("otel-client", {
        startMs: 20,
        endMs: 900,
        parentSpanIds: ["otel-root", "otel-fast"],
        raw: { data: { "otel.span_kind": "client" } },
      }),
      span("otel-error-parent", { startMs: 30, endMs: 40, parentSpanIds: ["otel-root"] }),
      span("otel-error", {
        startMs: 31,
        endMs: 32,
        parentSpanIds: ["otel-root", "otel-error-parent"],
        raw: { status_code: "error" },
      }),
      span("cs-checkout", { startMs: 50, endMs: 60, parentSpanIds: ["otel-root"] }),
      span("otel-event-owner", { startMs: 70, endMs: 80, parentSpanIds: ["otel-root"] }),
      span("otel-noise", { startMs: 90, endMs: 91, parentSpanIds: ["otel-root"] }),
    ];
    const events = [event("cart.updated", { atMs: 75, parentSpanIds: ["otel-root", "otel-event-owner"] })];
    const { traces } = buildTraces(spans, events);

    expect([...traceSignalSpanIds(traces[0], 1)]).toMatchInlineSnapshot(`
      [
        "otel-root",
        "otel-error",
        "otel-error-parent",
        "cs-checkout",
        "otel-event-owner",
        "otel-client",
        "otel-fast",
      ]
    `);
    expect(traceErrorCount(traces[0])).toBe(1);
    expect([...traceSignalSpanIds(traces[0], 0, "noise")]).toEqual([
      "otel-root",
      "otel-error",
      "otel-error-parent",
      "cs-checkout",
      "otel-event-owner",
      "otel-noise",
    ]);
  });

  it("reduces a 3,000-span instrumentation fan-out to the root and 20 slow spans", () => {
    const spans = [
      span("otel-root", { startMs: 0, endMs: 10_000 }),
      ...Array.from({ length: 2999 }, (_, index) => span(`otel-noise-${index}`, {
        startMs: index + 1,
        endMs: index + 2,
        parentSpanIds: ["otel-root"],
      })),
    ];
    const { traces } = buildTraces(spans, []);

    expect(traces[0].spanCount).toBe(3000);
    expect([...traceSignalSpanIds(traces[0])]).toEqual([
      "otel-root",
      ...Array.from({ length: 20 }, (_, index) => `otel-noise-${index}`),
    ]);
  });
});

describe("formatDuration", () => {
  it("formats across magnitudes", () => {
    expect(formatDuration(0)).toBe("0s");
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
