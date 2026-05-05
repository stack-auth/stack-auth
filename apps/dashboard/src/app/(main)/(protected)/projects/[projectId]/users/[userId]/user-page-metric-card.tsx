"use client";

import { DesignAnalyticsCard, type AnalyticsCardGradient } from "@/components/design-components";

type UserPageMetricCardProps = {
  label: string,
  value: string | number,
  description: string,
  gradient: AnalyticsCardGradient,
};

export function UserPageMetricCard({
  label,
  value,
  description,
  gradient,
}: UserPageMetricCardProps) {
  return (
    <DesignAnalyticsCard gradient={gradient} chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}>
      <div className="flex min-h-16 flex-col justify-between px-4 py-3">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
          {label}
        </span>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-xl font-bold tabular-nums text-foreground leading-none">
            {value}
          </span>
          <span className="truncate text-[10px] font-medium text-muted-foreground leading-none">
            {description}
          </span>
        </div>
      </div>
    </DesignAnalyticsCard>
  );
}
