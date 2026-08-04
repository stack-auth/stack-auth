// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Trace, WaterfallRow } from "./trace-utils";
import { computeRowOffsets, computeRowWindow, shouldShowCollapseControl, TraceWaterfall, type TraceWaterfallRow } from "./waterfall";

afterEach(cleanup);

function spanRow(id: string): WaterfallRow {
  return {
    kind: "span",
    node: {
      span: { traceId: "trace", id, spanType: "op", startMs: 0, endMs: 1, parentSpanId: null, raw: {} },
      depth: 0,
      children: [],
      events: [],
    },
  };
}

function eventRow(): WaterfallRow {
  return {
    kind: "event",
    depth: 1,
    event: { traceId: null, eventType: "checkout", atMs: 0, spanId: null, raw: {} },
  };
}

function linkRow(): TraceWaterfallRow {
  return {
    kind: "link",
    depth: 1,
    link: {
      ownerSpanId: "owner",
      linkedTraceId: "0123456789abcdef0123456789abcdef",
      linkedSpanId: "fedcba9876543210",
      linkedProjectId: "internal",
      linkedBranchId: "main",
      targetIsSameScope: true,
    },
  };
}

function waterfallProps(trace: Trace) {
  return {
    trace,
    services: [],
    nowMs: 1010,
    needle: "",
    unattachedEventCount: 0,
    links: [],
    onSelectSpan: () => {},
    onSelectEvent: () => {},
    onOpenLink: () => {},
  };
}

describe("shouldShowCollapseControl", () => {
  it("only exposes collapse controls when the active mode honors collapsed state", () => {
    expect(shouldShowCollapseControl("signal", true)).toBe(false);
    expect(shouldShowCollapseControl("all", true)).toBe(true);
    expect(shouldShowCollapseControl("all", false)).toBe(false);
  });
});

describe("TraceWaterfall span names", () => {
  it("renders a library operation without exposing the internal $lib-span discriminator", () => {
    const librarySpan = {
      traceId: "trace",
      id: "library-root",
      spanType: "$lib-span",
      startMs: 1000,
      endMs: 1010,
      parentSpanId: null,
      raw: {
        producer: "sdk",
        data: {
          name: "prisma:client:db_query",
          tracer_name: "prisma",
        },
      },
    };
    const trace: Trace = {
      root: {
        span: librarySpan,
        depth: 0,
        children: [],
        events: [],
      },
      spanCount: 1,
      eventCount: 0,
      startMs: 1000,
      endMs: 1010,
      latestMs: 1010,
    };

    render(createElement(TraceWaterfall, waterfallProps(trace)));

    expect(screen.getAllByText("prisma:client:db_query")).toHaveLength(2);
    expect(screen.queryByText("$lib-span")).toBeNull();
  });

  it("shows a linked span directly beneath its owner and opens it", () => {
    const openLink = vi.fn();
    const trace: Trace = {
      root: {
        span: { traceId: "server-trace", id: "server-span", spanType: "request", startMs: 1000, endMs: 1010, parentSpanId: null, raw: {} },
        depth: 0,
        children: [],
        events: [],
      },
      spanCount: 1,
      eventCount: 0,
      startMs: 1000,
      endMs: 1010,
      latestMs: 1010,
    };
    const link = {
      ownerSpanId: "server-span",
      linkedTraceId: "0123456789abcdef0123456789abcdef",
      linkedSpanId: "fedcba9876543210",
      linkedProjectId: "internal",
      linkedBranchId: "main",
      targetIsSameScope: true,
    };

    render(createElement(TraceWaterfall, {
      ...waterfallProps(trace),
      links: [link],
      onOpenLink: openLink,
    }));

    const linkRow = screen.getByRole("button", { name: "Open linked span fedcba9876543210 in trace 0123456789abcdef0123456789abcdef" });
    expect(linkRow.textContent).toContain("01234567/fedcba");
    linkRow.click();
    expect(openLink).toHaveBeenCalledWith(link);
  });

  it("shows a cross-scope link but refuses to navigate to it", () => {
    const openLink = vi.fn();
    const trace: Trace = {
      root: {
        span: { traceId: "server-trace", id: "server-span", spanType: "request", startMs: 1000, endMs: 1010, parentSpanId: null, raw: {} },
        depth: 0,
        children: [],
        events: [],
      },
      spanCount: 1,
      eventCount: 0,
      startMs: 1000,
      endMs: 1010,
      latestMs: 1010,
    };
    // A link whose target lives in another project/branch is still worth showing — the
    // correlation is real — but this page only queries the current scope, so following it
    // would always dead-end. The row stays disabled instead of resolving to nothing.
    const link = {
      ownerSpanId: "server-span",
      linkedTraceId: "0123456789abcdef0123456789abcdef",
      linkedSpanId: "fedcba9876543210",
      linkedProjectId: "other-project",
      linkedBranchId: "main",
      targetIsSameScope: false,
    };

    render(createElement(TraceWaterfall, {
      ...waterfallProps(trace),
      links: [link],
      onOpenLink: openLink,
    }));

    const linkRow = screen.getByRole("button", { name: "Linked span belongs to other-project/main" });
    expect(linkRow.hasAttribute("disabled")).toBe(true);
    linkRow.click();
    expect(openLink).not.toHaveBeenCalled();
  });
});

describe("computeRowOffsets", () => {
  it("accumulates the fixed span/event/link row heights", () => {
    expect(computeRowOffsets([spanRow("a"), eventRow(), linkRow(), eventRow(), spanRow("b")])).toEqual([0, 32, 60, 88, 116, 148]);
  });

  it("returns a single zero offset for an empty row list", () => {
    expect(computeRowOffsets([])).toEqual([0]);
  });

});

describe("computeRowWindow", () => {
  const spanOffsets = computeRowOffsets(Array.from({ length: 10 }, (_, i) => spanRow(`s${i}`)));

  it("windows the rows overlapping the scrollport", () => {
    expect(computeRowWindow(spanOffsets, 0, 100, 0)).toEqual({ startIndex: 0, endIndex: 4 });
  });

  it("extends the window by the overscan on both edges", () => {
    expect(computeRowWindow(spanOffsets, 100, 200, 2)).toEqual({ startIndex: 1, endIndex: 9 });
  });

  it("clamps a scrollport past the end of the list", () => {
    expect(computeRowWindow(spanOffsets, 1000, 1200, 2)).toEqual({ startIndex: 8, endIndex: 10 });
  });

  it("clamps a scrollport above the start of the list", () => {
    expect(computeRowWindow(spanOffsets, -1000, -500, 2)).toEqual({ startIndex: 0, endIndex: 2 });
  });

  it("windows mixed span/event heights at their exact boundaries", () => {
    const offsets = computeRowOffsets([spanRow("a"), eventRow(), eventRow(), spanRow("b")]);
    expect(computeRowWindow(offsets, 59, 61, 0)).toEqual({ startIndex: 1, endIndex: 3 });
  });

  it("never produces an inverted window when the viewport collapses", () => {
    expect(computeRowWindow(spanOffsets, 100, 50, 0)).toEqual({ startIndex: 3, endIndex: 4 });
  });

  it("returns an empty window for an empty row list", () => {
    expect(computeRowWindow(computeRowOffsets([]), 0, 1000, 20)).toEqual({ startIndex: 0, endIndex: 0 });
  });
});
