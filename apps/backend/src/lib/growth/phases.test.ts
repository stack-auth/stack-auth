import { describe, expect, it } from "vitest";
import { getGrowthPhaseDescription, getGrowthPhaseDisplayIndex, getGrowthPhaseLabel, getInitialPhaseKeysForRun, GROWTH_COMPUTE_METRICS_PHASE_KEY, GROWTH_INTEGRATIONS_PHASE_KEY, GROWTH_INTERVIEW_QUESTIONS_PHASE_KEY, GROWTH_REPORT_PHASE_KEY, isGrowthAnalysisTopicPhaseKey } from "./phases";
import { GROWTH_ANALYSIS_TOPICS } from "./analysis-topics";

describe("getInitialPhaseKeysForRun", () => {
  it("starts with compute-metrics, then integrations, then the fixed phases, one phase per analysis topic, and ends with interview then report", () => {
    const keys = getInitialPhaseKeysForRun();
    expect(keys[0]).toBe(GROWTH_COMPUTE_METRICS_PHASE_KEY);
    expect(keys[1]).toBe(GROWTH_INTEGRATIONS_PHASE_KEY);
    expect(keys[2]).toBe("website-research");
    expect(keys[3]).toBe("data-analysis");
    expect(keys.filter(isGrowthAnalysisTopicPhaseKey)).toHaveLength(GROWTH_ANALYSIS_TOPICS.size);
    expect(keys[keys.length - 2]).toBe(GROWTH_INTERVIEW_QUESTIONS_PHASE_KEY);
    expect(keys[keys.length - 1]).toBe(GROWTH_REPORT_PHASE_KEY);
  });

  it("has no duplicate keys", () => {
    const keys = getInitialPhaseKeysForRun();
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("getGrowthPhaseDisplayIndex", () => {
  // This exists because the DB cannot order these rows: a run's phases are inserted by one
  // createMany in one transaction, so every row's `createdAt` is the same transaction timestamp and
  // `ORDER BY "createdAt"` is a total tie. Postgres then returns them in heap order, which shifts on
  // every status update — the dashboard checklist visibly reshuffled between polls.
  it("indexes every initial phase key in the registry's declared display order", () => {
    const keys = getInitialPhaseKeysForRun();
    expect(keys.map(getGrowthPhaseDisplayIndex)).toEqual(keys.map((_, index) => index));
  });

  it("restores the declared order from any input order", () => {
    const keys = getInitialPhaseKeysForRun();
    // Reversed rather than randomly shuffled so the test cannot flake, and because reversal is the
    // worst case: it shares no adjacency with the correct answer.
    const scrambled = [...keys].reverse();
    const sorted = [...scrambled].sort((a, b) => getGrowthPhaseDisplayIndex(a) - getGrowthPhaseDisplayIndex(b));
    expect(sorted).toEqual(keys);
  });

  it("orders interview-questions after every phase it depends on", () => {
    // The regression that prompted this: `interview-questions` is the last phase to run, but it was
    // also the only row nothing had updated yet, so heap order floated it to the TOP of the list.
    const interviewIndex = getGrowthPhaseDisplayIndex(GROWTH_INTERVIEW_QUESTIONS_PHASE_KEY);
    const analysisIndexes = getInitialPhaseKeysForRun()
      .filter(isGrowthAnalysisTopicPhaseKey)
      .map(getGrowthPhaseDisplayIndex);
    expect(analysisIndexes.length).toBeGreaterThan(0);
    for (const index of analysisIndexes) {
      expect(index).toBeLessThan(interviewIndex);
    }
    expect(interviewIndex).toBeLessThan(getGrowthPhaseDisplayIndex(GROWTH_REPORT_PHASE_KEY));
  });

  it("throws for a key the registry does not know, rather than silently sorting it first or last", () => {
    // A phase row can outlive its registry entry (a removed analysis topic). Sorting such a row to
    // an arbitrary position would hide the stale row; the label/description lookups already throw.
    expect(() => getGrowthPhaseDisplayIndex("analysis:removed-topic")).toThrow(/Unknown growth phase key/);
  });
});

describe("getGrowthPhaseLabel", () => {
  it("labels every initial phase key", () => {
    for (const key of getInitialPhaseKeysForRun()) {
      expect(getGrowthPhaseLabel(key).length).toBeGreaterThan(0);
    }
  });

  it("labels analysis-topic phases with the topic title", () => {
    expect(getGrowthPhaseLabel("analysis:seo-aeo-strategy")).toBe("SEO & AEO strategy");
  });

  it("labels the compute-metrics phase", () => {
    expect(getGrowthPhaseLabel(GROWTH_COMPUTE_METRICS_PHASE_KEY)).toBe("Computing metrics");
  });

  it("labels the integrations phase", () => {
    expect(getGrowthPhaseLabel(GROWTH_INTEGRATIONS_PHASE_KEY)).toBe("Integrations");
  });

  it("fails loudly for unknown keys", () => {
    expect(() => getGrowthPhaseLabel("nonsense")).toThrow();
    expect(() => getGrowthPhaseLabel("analysis:nonsense")).toThrow();
  });
});

describe("getGrowthPhaseDescription", () => {
  // The dashboard renders whatever this returns as the row's hover explanation, so a phase or analysis
  // topic added without one would ship a checklist row nobody can find out anything about.
  it("describes every initial phase key in two or more sentences", () => {
    for (const key of getInitialPhaseKeysForRun()) {
      const description = getGrowthPhaseDescription(key);
      expect(description.length).toBeGreaterThan(80);
      // Sentence-count proxy: the copy contract is 2-3 sentences, and one sentence reads as a label
      // rather than an explanation.
      expect(description.split(". ").length).toBeGreaterThanOrEqual(2);
    }
  });

  it("describes analysis-topic phases from the topic registry", () => {
    expect(getGrowthPhaseDescription("analysis:traffic-quality"))
      .toBe(GROWTH_ANALYSIS_TOPICS.get("traffic-quality")?.description);
  });

  it("fails loudly for unknown keys", () => {
    expect(() => getGrowthPhaseDescription("nonsense")).toThrow();
    expect(() => getGrowthPhaseDescription("analysis:nonsense")).toThrow();
  });
});
