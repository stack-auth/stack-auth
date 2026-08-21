import { describe, expect, it } from "vitest";
import { assertGrowthActionTypeId, GROWTH_ACTION_ITEM_TYPES, GROWTH_METRIC_IDS } from "./action-item-types";

describe("GROWTH_ACTION_ITEM_TYPES", () => {
  it("keys every entry by its own id", () => {
    for (const [key, type] of GROWTH_ACTION_ITEM_TYPES) {
      expect(type.id).toBe(key);
    }
  });

  it("only declares watched metrics from the metric registry", () => {
    const validIds = new Set<string>(GROWTH_METRIC_IDS);
    for (const type of GROWTH_ACTION_ITEM_TYPES.values()) {
      expect(type.defaultWatchedMetrics.length).toBeGreaterThan(0);
      for (const watched of type.defaultWatchedMetrics) {
        expect(validIds.has(watched.metricId)).toBe(true);
        expect(watched.windowDays).toBeGreaterThan(0);
      }
    }
  });

  it("marks run_ads as a stub — this build has no ad platform to spend through", () => {
    expect(assertGrowthActionTypeId("run_ads").executor).toBe("stub");
  });

  it("grants no type an executor that causes external side effects", () => {
    // The guard that matters while there is no ad platform integration: nothing here may claim a
    // real-world side effect, because no code path exists to produce one. Flipping run_ads to
    // "external_reviewed" must happen together with that integration and its admin-only activation
    // route — see the executor doc on GrowthActionItemType.
    for (const type of GROWTH_ACTION_ITEM_TYPES.values()) {
      expect(type.executor).not.toBe("external_reviewed");
    }
  });
});

describe("assertGrowthActionTypeId", () => {
  it("returns known types and rejects unknown ones with a 400", () => {
    expect(assertGrowthActionTypeId("publish_blog").id).toBe("publish_blog");
    expect(() => assertGrowthActionTypeId("nonsense")).toThrow(/Unknown growth action item type/);
  });
});
