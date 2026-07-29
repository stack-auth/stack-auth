import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import type { WaterfallRow } from "./trace-utils";
import { computeRowOffsets, computeRowWindow, shouldShowCollapseControl } from "./waterfall";

function spanRow(id: string): WaterfallRow {
  return {
    kind: "span",
    node: {
      span: { traceId: "trace", id, spanType: "op", startMs: 0, endMs: 1, parentSpanIds: [], raw: {} },
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
    event: { eventType: "checkout", atMs: 0, parentSpanIds: [], raw: {} },
  };
}

describe("shouldShowCollapseControl", () => {
  it("only exposes collapse controls when the active mode honors collapsed state", () => {
    expect(shouldShowCollapseControl("signal", true)).toBe(false);
    expect(shouldShowCollapseControl("all", true)).toBe(true);
    expect(shouldShowCollapseControl("all", false)).toBe(false);
  });
});

describe("computeRowOffsets", () => {
  it("accumulates the fixed span/event row heights", () => {
    expect(computeRowOffsets([spanRow("a"), eventRow(), eventRow(), spanRow("b")])).toEqual([0, 32, 60, 88, 120]);
  });

  it("returns a single zero offset for an empty row list", () => {
    expect(computeRowOffsets([])).toEqual([0]);
  });

  it("keeps the windowing heights in sync with the row classes", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(testDir, "waterfall.tsx"), "utf-8");
    expect(source).toContain("export const SPAN_ROW_HEIGHT_PX = 32");
    expect(source).toContain("export const EVENT_ROW_HEIGHT_PX = 28");
    expect(source).toContain("items-center h-8 border-b");
    expect(source).toContain("items-center h-7 border-b");
    // The old click-to-load pagination must stay gone: the windowed renderer
    // replaces it entirely.
    expect(source).not.toContain("INITIAL_ROW_COUNT");
    expect(source).not.toContain("Show ");
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
