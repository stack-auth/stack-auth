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

  it("gives every suggestion a written timeline, since nothing generates one", () => {
    // The dashboard renders a suggestion's timeline entries verbatim and shows an empty state when there are
    // none, so a fixture that forgets its entries silently makes demo mode look broken.
    const dataset = buildGtmDemoDataset(1_800_000_000_000);
    const timelines = [
      ...dataset.insights.map((insight) => insight.timeline),
      ...dataset.actions.map((action) => action.timeline),
    ];

    expect(timelines.every((timeline) => timeline != null && timeline.length > 0)).toBe(true);
    expect(timelines.flat().every((entry) => entry != null
      && entry.label.length > 0
      && entry.title.length > 0
      && entry.body.length > 0
      && Number.isFinite(entry.dateMillis))).toBe(true);
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
