import { describe, expect, it } from "vitest";
import { GROWTH_METRIC_IDS } from "./action-item-types";
import { assertUserMilestoneStatusTransition, getDefaultGrowthMilestones, growthMilestoneToWire } from "./milestones";

// DB-dependent behavior (seedDefaultGrowthMilestones skipping when any row exists, CRUD scoping) is
// covered by the e2e suite (milestones-tasks.test.ts); these tests pin the pure pieces.

describe("getDefaultGrowthMilestones", () => {
  it("returns the 10/100/1000 total_users ladder", () => {
    expect(getDefaultGrowthMilestones()).toEqual([
      { metricId: "total_users", threshold: 10 },
      { metricId: "total_users", threshold: 100 },
      { metricId: "total_users", threshold: 1000 },
    ]);
  });

  it("only uses metric ids from the registry", () => {
    const validIds = new Set<string>(GROWTH_METRIC_IDS);
    for (const milestone of getDefaultGrowthMilestones()) {
      expect(validIds.has(milestone.metricId)).toBe(true);
    }
  });
});

describe("assertUserMilestoneStatusTransition", () => {
  it("allows armed <-> disabled in both directions (including idempotent no-ops)", () => {
    expect(() => assertUserMilestoneStatusTransition("armed", "disabled")).not.toThrow();
    expect(() => assertUserMilestoneStatusTransition("disabled", "armed")).not.toThrow();
    expect(() => assertUserMilestoneStatusTransition("armed", "armed")).not.toThrow();
    expect(() => assertUserMilestoneStatusTransition("disabled", "disabled")).not.toThrow();
  });

  it("rejects setting engine-owned or unknown statuses", () => {
    expect(() => assertUserMilestoneStatusTransition("armed", "reached")).toThrow(/only "armed" and "disabled"/);
    expect(() => assertUserMilestoneStatusTransition("armed", "nonsense")).toThrow(/only "armed" and "disabled"/);
  });

  it("treats reached milestones as final", () => {
    expect(() => assertUserMilestoneStatusTransition("reached", "armed")).toThrow(/has been reached/);
    expect(() => assertUserMilestoneStatusTransition("reached", "disabled")).toThrow(/has been reached/);
  });
});

describe("growthMilestoneToWire", () => {
  it("maps a row to the frozen snake_case wire shape", () => {
    expect(growthMilestoneToWire({
      id: "5b13b6a4-6dd8-4a5e-b1a4-6ffdbabf9001",
      metricId: "total_users",
      comparator: "gte",
      threshold: 100,
      source: "default",
      status: "armed",
      createdAt: new Date(1_700_000_000_000),
    })).toEqual({
      id: "5b13b6a4-6dd8-4a5e-b1a4-6ffdbabf9001",
      metric_id: "total_users",
      comparator: "gte",
      threshold: 100,
      source: "default",
      status: "armed",
      created_at_millis: 1_700_000_000_000,
    });
  });

  it("fails loudly on values outside the fixed sets", () => {
    expect(() => growthMilestoneToWire({
      id: "5b13b6a4-6dd8-4a5e-b1a4-6ffdbabf9001",
      metricId: "not_a_metric",
      comparator: "gte",
      threshold: 100,
      source: "default",
      status: "armed",
      createdAt: new Date(1_700_000_000_000),
    })).toThrow(/unknown value/);
  });
});
