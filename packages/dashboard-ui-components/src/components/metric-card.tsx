"use client";

import { cn } from "@stackframe/stack-ui";
import React from "react";

type DesignMetricCardGradient = "blue" | "cyan" | "purple" | "green" | "orange" | "default";

const hoverTintClasses = new Map<DesignMetricCardGradient, string>([
  ["blue", "group-hover:bg-blue-500/[0.03]"],
  ["cyan", "group-hover:bg-cyan-500/[0.03]"],
  ["purple", "group-hover:bg-purple-500/[0.03]"],
  ["green", "group-hover:bg-emerald-500/[0.03]"],
  ["orange", "group-hover:bg-orange-500/[0.03]"],
  ["default", "group-hover:bg-slate-500/[0.02]"],
]);

export type DesignMetricCardTrend = {
  value: number,
  direction: "up" | "down",
  label?: string,
};

export type DesignMetricCardProps = {
  label: string,
  value: string | number,
  description?: string,
  trend?: DesignMetricCardTrend,
  icon?: React.ElementType,
  gradient?: DesignMetricCardGradient,
} & Omit<React.ComponentProps<"div">, "children">;

/**
 * KPI card for big-number metrics (users, revenue, signups, etc.).
 * Use this instead of a plain `DesignCard` when the value is the focal point.
 *
 * ```tsx
 * <DesignMetricCard
 *   label="Total Users"
 *   value="1,234"
 *   description="+12% from last month"
 *   trend={{ direction: "up", value: 12, label: "vs. last period" }}
 *   icon={UsersIcon}
 *   gradient="blue"
 * />
 * ```
 *
 * Notes:
 * - `label` is the short caption (NOT `title`).
 * - `value` can be a pre-formatted string ("1,234") or a number — prefer
 *   strings so you control the format.
 * - `description` is the subline (NOT `subtitle`).
 * - `trend.value` is a NUMBER, not a pre-formatted "12%" string. The card
 *   renders the arrow and formatting.
 * - `icon` is a component type (e.g. `UsersIcon`), not a rendered node.
 */
export function DesignMetricCard({
  label,
  value,
  description,
  trend,
  icon: Icon,
  gradient = "default",
  className,
  ...props
}: DesignMetricCardProps) {
  const hoverTintClass = hoverTintClasses.get(gradient) ?? "group-hover:bg-slate-500/[0.02]";

  return (
    <div
      className={cn(
        "group relative rounded-2xl bg-white/90 dark:bg-background/60 backdrop-blur-xl transition-all duration-150 hover:transition-none overflow-hidden",
        "ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
        "shadow-sm hover:shadow-md",
        className
      )}
      {...props}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.04] dark:from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl" />
      <div
        className={cn(
          "absolute inset-0 transition-colors duration-150 group-hover:transition-none pointer-events-none rounded-2xl",
          hoverTintClass
        )}
      />
      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {Icon && (
                <div className="p-1.5 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.04]">
                  <Icon className="h-3.5 w-3.5 text-foreground/70 dark:text-muted-foreground" />
                </div>
              )}
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {label}
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums text-foreground">
                {typeof value === "number" ? value.toLocaleString() : value}
              </span>
              {trend && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 text-xs font-medium",
                    trend.direction === "up"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  )}
                >
                  <svg
                    className={cn("h-3 w-3", trend.direction === "down" && "rotate-180")}
                    viewBox="0 0 12 12"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M6 2.5V9.5M6 2.5L3 5.5M6 2.5L9 5.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {trend.value}%
                  {trend.label && (
                    <span className="text-muted-foreground ml-0.5">{trend.label}</span>
                  )}
                </span>
              )}
            </div>
            {description && (
              <p className="mt-1 text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
