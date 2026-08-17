"use client";

import { EntityKpiCards } from "@/components/entity-kpi-cards";
import type { MetricsResponse } from "@/lib/hexclave-app-internals";

export function UsersKpiCards(props: {
  metrics?: MetricsResponse,
}) {
  return (
    <EntityKpiCards
      errorTag="users-kpi-cards-error-boundary"
      metrics={props.metrics}
      source={(metrics) => ({
        dailyNew: metrics.daily_users.map((p) => p.activity),
        splitTotal: metrics.auth_overview.daily_active_users_split.total.map((p) => p.activity),
        splitNew: metrics.auth_overview.daily_active_users_split.new.map((p) => p.activity),
        totalCount: metrics.auth_overview.total_users_filtered,
      })}
      labels={{
        newCard: { label: "New Sign-ups", comparisonLabel: "signups" },
        activeCard: { label: "Daily Active Users", comparisonLabel: "DAU" },
        returningCard: { label: "Returning User Rate" },
        totalCard: { label: "Total Users", comparisonLabel: "total users" },
      }}
    />
  );
}
