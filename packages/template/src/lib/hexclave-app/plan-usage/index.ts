export type PlanUsageKind = "current" | "metered" | "capability";
export type PlanUsagePlanId = "free" | "team" | "growth";
export type PlanUsageNextPlanId = "team" | "growth";

export type PlanUsageRow = {
  itemId: string,
  displayName: string,
  kind: PlanUsageKind,
  used: number | null,
  limit: number | null,
  remaining: number | null,
  overage: number | null,
  isUnlimited: boolean,
};

export type PlanUsage = {
  ownerTeamId: string,
  ownerTeamDisplayName: string,
  planId: PlanUsagePlanId,
  planDisplayName: string,
  periodStart: Date,
  periodEnd: Date,
  nextPlanId: PlanUsageNextPlanId | null,
  rows: PlanUsageRow[],
};
