import { describe, expect, it } from "vitest";
import { buildGtmDemoDataset } from "./gtm-demo-data";
import { classifyAction, classifyInsight, classifyNote } from "./gtm-types";

describe("buildGtmDemoDataset", () => {
  it("returns deterministic preview-only content for a fixed clock", () => {
    const now = new Date("2026-07-24T12:00:00.000Z").getTime();
    const first = buildGtmDemoDataset(now);
    const second = buildGtmDemoDataset(now);

    expect(first).toEqual(second);
    expect(first.insights).toHaveLength(10);
    expect(first.actions).toHaveLength(8);
    expect(first.notes).toHaveLength(6);
    expect(first.radar).toEqual(new Map([
      ["product", 69],
      ["users", 78],
      ["ads", 64],
      ["revenue", 74],
      ["outreach", 71],
      ["content", 67],
    ]));
  });

  it("uses stable IDs and derives domains from the fixture records", () => {
    const dataset = buildGtmDemoDataset(1_800_000_000_000);
    const ids = [
      ...dataset.insights.map((insight) => insight.id),
      ...dataset.actions.map((action) => action.id),
      ...dataset.notes.map((note) => note.id),
    ];

    expect(new Set(ids).size).toBe(ids.length);
    expect(dataset.insights.map(classifyInsight)).toEqual([
      "users",
      "revenue",
      "ads",
      "revenue",
      "outreach",
      "product",
      "outreach",
      "product",
      "content",
      "users",
    ]);
    expect(dataset.actions.map(classifyAction)).toEqual([
      "revenue",
      "revenue",
      "outreach",
      "outreach",
      "revenue",
      "product",
      "outreach",
      "revenue",
    ]);
    expect(dataset.notes.map(classifyNote)).toEqual([
      "product",
      "users",
      "revenue",
      "outreach",
      "revenue",
      "outreach",
    ]);
  });
});
