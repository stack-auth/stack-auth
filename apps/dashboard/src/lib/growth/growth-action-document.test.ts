import { describe, expect, it } from "vitest";
import type { GrowthDocument } from "./growth-document";
import { getGrowthActionNarrativeSections } from "./growth-action-document";

describe("getGrowthActionNarrativeSections", () => {
  it("keeps only the fixed hypothesis, evidence, and experiment content", () => {
    const document: GrowthDocument = {
      format: "growth-mdx-v1",
      sourceMdx: "unused in this test",
      data: [],
      blocks: [
        { type: "heading", level: 2, children: [{ type: "text", value: "AI-authored heading" }] },
        { type: "component", name: "Experiment", dataId: null, confidence: null, actionId: null, children: [] },
        { type: "paragraph", children: [{ type: "text", value: "Free-standing AI prose" }] },
        { type: "component", name: "Evidence", dataId: null, confidence: null, actionId: null, children: [] },
        { type: "component", name: "Hypothesis", dataId: null, confidence: "high", actionId: null, children: [] },
        { type: "component", name: "DataGap", dataId: null, confidence: null, actionId: null, children: [] },
        { type: "component", name: "Metric", dataId: "activation", confidence: null, actionId: null, children: [] },
      ],
    };

    const sections = getGrowthActionNarrativeSections(document);

    expect(sections.hypothesis.map((block) => block.type === "component" ? block.name : null)).toEqual(["Hypothesis"]);
    expect(sections.evidence.map((block) => block.type === "component" ? block.name : null)).toEqual(["Evidence", "Metric"]);
    expect(sections.experiment.map((block) => block.type === "component" ? block.name : null)).toEqual(["Experiment"]);
  });
});
