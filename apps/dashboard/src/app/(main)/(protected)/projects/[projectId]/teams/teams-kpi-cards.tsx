"use client";

import { EntityKpiCards } from "@/components/entity-kpi-cards";

export function TeamsKpiCards() {
  return (
    <EntityKpiCards
      errorTag="teams-kpi-cards-error-boundary"
      source={(metrics) => ({
        // No pure team-creation series exists; new-active teams is the closest
        // proxy and matches the activity-split semantics used by cards 2 & 3.
        dailyNew: metrics.auth_overview.daily_active_teams_split.new.map((p) => p.activity),
        splitTotal: metrics.auth_overview.daily_active_teams_split.total.map((p) => p.activity),
        splitNew: metrics.auth_overview.daily_active_teams_split.new.map((p) => p.activity),
        totalCount: metrics.auth_overview.total_teams,
      })}
      labels={{
        newCard: { label: "New Active Teams", comparisonLabel: "new teams" },
        activeCard: { label: "Daily Active Teams", comparisonLabel: "DAT" },
        returningCard: { label: "Returning Team Rate" },
        totalCard: { label: "Total Teams", comparisonLabel: "total teams" },
      }}
    />
  );
}
