import { describe, expect, it } from "vitest";
import { assertGrowthAnalysisTopicId, GROWTH_ANALYSIS_TOPICS } from "./analysis-topics";

describe("GROWTH_ANALYSIS_TOPICS", () => {
  it("keys every entry by its own id", () => {
    for (const [key, topic] of GROWTH_ANALYSIS_TOPICS) {
      expect(topic.id).toBe(key);
      expect(topic.title.length).toBeGreaterThan(0);
    }
  });

  // Every topic renders as a checklist row whose hover text is this description; a topic added without
  // one would be an unexplained line in the middle of a twenty-minute analysis.
  it("gives every topic a multi-sentence description", () => {
    for (const [, topic] of GROWTH_ANALYSIS_TOPICS) {
      expect(topic.description.length).toBeGreaterThan(80);
      expect(topic.description.split(". ").length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("assertGrowthAnalysisTopicId", () => {
  it("accepts known ids and rejects unknown ones with a 400", () => {
    expect(() => assertGrowthAnalysisTopicId("first-screen-audit")).not.toThrow();
    expect(() => assertGrowthAnalysisTopicId("traffic-quality")).not.toThrow();
    expect(() => assertGrowthAnalysisTopicId("nonsense")).toThrow(/Unknown growth analysis topic id/);
  });
});
