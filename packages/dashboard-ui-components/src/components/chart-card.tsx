"use client";

import { cn } from "@stackframe/stack-ui";
import React from "react";

type DesignChartCardGradient = "blue" | "cyan" | "purple" | "green" | "orange" | "default";

const hoverTintClasses = new Map<DesignChartCardGradient, string>([
  ["blue", "group-hover:bg-blue-500/[0.03]"],
  ["cyan", "group-hover:bg-cyan-500/[0.03]"],
  ["purple", "group-hover:bg-purple-500/[0.03]"],
  ["green", "group-hover:bg-emerald-500/[0.03]"],
  ["orange", "group-hover:bg-orange-500/[0.03]"],
  ["default", "group-hover:bg-slate-500/[0.02]"],
]);

export type DesignChartCardProps = {
  gradient?: DesignChartCardGradient,
  title?: React.ReactNode,
  description?: React.ReactNode,
} & Omit<React.ComponentProps<"div">, "title">;

/**
 * Card chrome (title + description + border) for a chart. Wrap every
 * `AnalyticsChart` in this so the chart has context. Also used around raw
 * Recharts components paired with `DesignChartContainer` for non-time-series
 * fallbacks.
 *
 * ```tsx
 * // Time-series chart (preferred):
 * <DesignChartCard title="Signups" description="Last 30 days">
 *   <AnalyticsChart data={data} state={state} onChange={setState} />
 * </DesignChartCard>
 *
 * // Non-time-series fallback (static ranking, distribution, etc.):
 * <DesignChartCard title="Top referrers" description="This month">
 *   <DesignChartContainer config={chartConfig} maxHeight={300}>
 *     <Recharts.BarChart data={data}>
 *       <Recharts.CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
 *       <Recharts.XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
 *       <Recharts.YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
 *       <Recharts.Tooltip content={<DesignChartTooltipContent />} />
 *       <Recharts.Bar dataKey="count" fill={getDesignChartColor(0)} radius={[4, 4, 0, 0]} />
 *     </Recharts.BarChart>
 *   </DesignChartContainer>
 * </DesignChartCard>
 * ```
 *
 * `chartConfig` for `DesignChartContainer` maps each `dataKey` to its label and color:
 * `{ count: { label: "Count", color: getDesignChartColor(0) } }`.
 */
export function DesignChartCard({
  gradient = "default",
  title,
  description,
  className,
  children,
  ...props
}: DesignChartCardProps) {
  const hoverTintClass = hoverTintClasses.get(gradient) ?? "group-hover:bg-slate-500/[0.02]";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        .design-chart-card-tooltip-escape .recharts-tooltip-wrapper {
          z-index: 9999 !important;
          overflow: visible !important;
        }
        .design-chart-card-tooltip-escape .recharts-tooltip-wrapper > * {
          overflow: visible !important;
        }
      ` }} />
      <div
        className={cn(
          "group relative rounded-2xl bg-white/90 dark:bg-background/60 backdrop-blur-xl transition-all duration-150 hover:transition-none design-chart-card-tooltip-escape",
          "ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
          "shadow-sm hover:shadow-md hover:z-10",
          className
        )}
        {...props}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.04] dark:from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
        <div
          className={cn(
            "absolute inset-0 transition-colors duration-150 group-hover:transition-none pointer-events-none rounded-2xl overflow-hidden",
            hoverTintClass
          )}
        />
        <div className="relative h-full flex flex-col p-4">
          {(title || description) && (
            <div className="mb-3">
              {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
              {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
            </div>
          )}
          {children}
        </div>
      </div>
    </>
  );
}
