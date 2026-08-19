import { describe, expect, test } from "vitest";
import {
  GROWTH_ANALYSIS_WORKFLOW_SOURCE,
  GROWTH_DAILY_BRIEF_WORKFLOW_SOURCE,
} from "./workflow-sources";
import {
  GROWTH_EVENT_TYPES,
  GROWTH_WORKFLOW_DEFINITIONS,
  GROWTH_WORKFLOW_IDS,
  isGrowthWorkflowSourceEdited,
} from "./workflows";

// The DB-touching halves (ensureGrowthWorkflows, getGrowthWorkflowStates,
// restoreGrowthWorkflow) are covered by the growth e2e tests; here we pin the
// pure registry + drift-detection contract.

describe("GROWTH_WORKFLOW_DEFINITIONS", () => {
  test("contains exactly the two canonical workflows", () => {
    expect(GROWTH_WORKFLOW_IDS).toEqual(["growth-analysis", "growth-daily-brief"]);
    expect(GROWTH_WORKFLOW_DEFINITIONS.get("growth-analysis")?.source).toBe(GROWTH_ANALYSIS_WORKFLOW_SOURCE);
    expect(GROWTH_WORKFLOW_DEFINITIONS.get("growth-daily-brief")?.source).toBe(GROWTH_DAILY_BRIEF_WORKFLOW_SOURCE);
  });

  test("every definition has a non-empty display name", () => {
    for (const [workflowId, spec] of GROWTH_WORKFLOW_DEFINITIONS) {
      expect(spec.displayName.length, workflowId).toBeGreaterThan(0);
    }
  });
});

describe("GROWTH_EVENT_TYPES", () => {
  test("are the fully-prefixed wire types", () => {
    expect(GROWTH_EVENT_TYPES).toEqual({
      analysisRunActivated: "custom.growth.analysis-run-activated",
      interviewFinished: "custom.growth.interview-finished",
      dailyBriefDue: "custom.growth.daily-brief-due",
    });
  });

  test("match the unprefixed customEvent() names embedded in the sources", () => {
    // customEvent("<name>") subscribes to "custom.<name>"; the enqueue side
    // must use the prefixed wire type or the events never match.
    for (const [wireType, source] of [
      [GROWTH_EVENT_TYPES.analysisRunActivated, GROWTH_ANALYSIS_WORKFLOW_SOURCE],
      [GROWTH_EVENT_TYPES.interviewFinished, GROWTH_ANALYSIS_WORKFLOW_SOURCE],
      [GROWTH_EVENT_TYPES.dailyBriefDue, GROWTH_DAILY_BRIEF_WORKFLOW_SOURCE],
    ] as const) {
      expect(wireType.startsWith("custom.")).toBe(true);
      expect(source).toContain(`customEvent("${wireType.slice("custom.".length)}")`);
    }
  });
});

describe("isGrowthWorkflowSourceEdited", () => {
  test("canonical source is not edited", () => {
    expect(isGrowthWorkflowSourceEdited("growth-analysis", GROWTH_ANALYSIS_WORKFLOW_SOURCE)).toBe(false);
    expect(isGrowthWorkflowSourceEdited("growth-daily-brief", GROWTH_DAILY_BRIEF_WORKFLOW_SOURCE)).toBe(false);
  });

  test("any byte change counts as edited", () => {
    expect(isGrowthWorkflowSourceEdited("growth-analysis", GROWTH_ANALYSIS_WORKFLOW_SOURCE + " ")).toBe(true);
    expect(isGrowthWorkflowSourceEdited("growth-daily-brief", GROWTH_DAILY_BRIEF_WORKFLOW_SOURCE.replace("10 0 * * *", "0 9 * * *"))).toBe(true);
  });

  test("unknown workflow ids throw", () => {
    expect(() => isGrowthWorkflowSourceEdited("growth-nonexistent", "whatever")).toThrow();
  });
});
