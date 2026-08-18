import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const GROWTH_METRIC_IDS = ["new_signups", "returning_users", "transactions", "emails_sent", "total_users", "revenue"] as const;
export type GrowthMetricId = typeof GROWTH_METRIC_IDS[number];

export type GrowthWatchedMetric = {
  metricId: GrowthMetricId,
  windowDays: number,
};

export type GrowthActionItemType = {
  id: string,
  displayName: string,
  /**
   * How activation is executed.
   * - "stub" performs no external side effect at all.
   * - "internal" is fulfilled entirely by Hexclave (e.g. a blog artifact marked published).
   * - "external_reviewed" causes REAL external side effects (ad spend), but only ever through a code
   *   path a human has explicitly reviewed and approved.
   *
   * `run_ads` is "stub" in this build: activating one records the proposal and nothing else, because
   * there is no ad platform integration for it to act through. It becomes "external_reviewed" when
   * that integration lands, and the value must not be flipped before the following hold — they are
   * what makes real spend safe, and each is a construction rather than a matter of trust:
   *   1. An agent authenticated by the shared machine secret may only ever PROPOSE a campaign spec,
   *      never activate one.
   *   2. ACTIVATION — flipping platform objects PAUSED -> ACTIVE, and changing a budget — runs ONLY
   *      on dashboard ADMIN auth. No capability an agent session can hold produces that transition
   *      (see run-token.ts, whose capability set is closed for exactly this reason).
   *   3. The spend-capable mutation seam has NO import path from the machine-authenticated route
   *      trees (internal/growth-agent/**, internal/growth-server/**), asserted by a test rather than
   *      left as a comment. The import-shape rules that protect this are already in place — see
   *      action-item-wire.ts's module comment and watchdog.ts's — so the seam has somewhere safe to
   *      land.
   */
  executor: "stub" | "internal" | "external_reviewed",
  defaultWatchedMetrics: GrowthWatchedMetric[],
};

export const GROWTH_ACTION_ITEM_TYPES = new Map<string, GrowthActionItemType>([
  ["run_ads", {
    id: "run_ads",
    displayName: "Run ads",
    executor: "stub",
    defaultWatchedMetrics: [
      { metricId: "new_signups", windowDays: 14 },
      { metricId: "total_users", windowDays: 14 },
    ],
  }],
  ["publish_blog", {
    id: "publish_blog",
    displayName: "Publish blog post",
    executor: "internal",
    defaultWatchedMetrics: [
      { metricId: "new_signups", windowDays: 14 },
      { metricId: "returning_users", windowDays: 14 },
    ],
  }],
  ["custom", {
    id: "custom",
    displayName: "Custom action",
    executor: "internal",
    defaultWatchedMetrics: [
      { metricId: "new_signups", windowDays: 14 },
    ],
  }],
]);

export function assertGrowthActionTypeId(typeId: string): GrowthActionItemType {
  const type = GROWTH_ACTION_ITEM_TYPES.get(typeId);
  if (type == null) {
    throw new StatusError(400, `Unknown growth action item type: ${typeId}`);
  }
  return type;
}
