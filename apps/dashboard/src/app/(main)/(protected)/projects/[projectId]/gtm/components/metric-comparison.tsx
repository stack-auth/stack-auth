"use client";

import {
  DesignAnalyticsCard,
  DesignAnalyticsCardHeader,
  DesignBadge,
  DesignChartLegend,
  DesignMetricDelta,
} from "@/components/design-components";
import { Typography } from "@/components/ui";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import type { GrowthActionMetricSeries } from "@/lib/growth/growth-types";
import type { TooltipProps } from "recharts";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  type MetricComparisonRow,
  computeDeltaPercent,
  getGrowthMetricLabel,
  mergeMetricSeries,
  sumMetricSeries,
} from "./metric-comparison-data";

// The pure computation/fixture helpers live in metric-comparison-data.ts (UI-import-free so they can
// be unit-tested without the design-system package); re-export them so consumers have one entrypoint.
export {
  GROWTH_METRIC_LABELS,
  buildGrowthDemoActionMetrics,
  computeDeltaPercent,
  getGrowthMetricLabel,
  mergeMetricSeries,
  sumMetricSeries,
} from "./metric-comparison-data";

// Baseline is a muted slate so the "after" line carries the visual weight; both resolve via chart
// CSS variables so light/dark stay readable.
const comparisonChartConfig: ChartConfig = {
  baseline: { label: "Before", theme: { light: "hsl(215, 16%, 55%)", dark: "hsl(215, 16%, 62%)" } },
  current: { label: "After", theme: { light: "hsl(152, 38%, 45%)", dark: "hsl(152, 38%, 60%)" } },
};

const COMPARISON_LEGEND_ITEMS = [
  { key: "baseline", label: "Before (baseline)", color: "hsl(215, 16%, 55%)" },
  { key: "current", label: "After activation", color: "hsl(152, 38%, 52%)" },
];

function formatComparisonTick(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return `${date.toLocaleDateString("en-US", { month: "short" })} ${date.getDate()}`;
}

// Matches the tooltip surface used by the overview charts in (overview)/line-chart.tsx.
const tooltipSurfaceClass = "rounded-xl bg-white dark:bg-background shadow-[0_10px_24px_rgba(15,23,42,0.14)] dark:shadow-lg ring-1 ring-slate-900/10 dark:ring-foreground/[0.12]";

function ComparisonTooltip({ active, payload }: TooltipProps<number, string>) {
  if (active !== true || payload == null || payload.length === 0) return null;
  const row = payload[0].payload as MetricComparisonRow;
  return (
    <div className={`${tooltipSurfaceClass} px-3.5 py-2.5`} style={{ zIndex: 9999 }}>
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
          {formatComparisonTick(row.date)}
        </span>
        {([["baseline", row.baseline], ["current", row.current]] as const).map(([key, value]) => value == null ? null : (
          <div key={key} className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full ring-2 ring-white/20" style={{ backgroundColor: `var(--color-${key})` }} />
            <span className="text-[11px] text-muted-foreground">{key === "baseline" ? "Before" : "After"}</span>
            <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
              {value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One watched metric of an action: a two-line before/after chart (baseline dashed, current solid) plus
 * a DesignMetricDelta tile comparing the two windows' totals. For unactivated actions there is no
 * "after" window yet, so the card renders the baseline preview with explanatory copy instead.
 */
export function GrowthMetricComparisonCard(props: { series: GrowthActionMetricSeries }) {
  const { series } = props;
  const label = getGrowthMetricLabel(series.metricId);
  const hasAfter = series.after.length > 0;
  const hasAnyData = series.before.length > 0 || hasAfter;
  const rows = mergeMetricSeries(series.before, series.after);
  const beforeTotal = sumMetricSeries(series.before);
  const afterTotal = sumMetricSeries(series.after);

  return (
    <DesignAnalyticsCard gradient="cyan" className="flex min-h-0 flex-col" chart={{ type: "line", tooltipType: "default", highlightMode: "dot-hover" }}>
      <DesignAnalyticsCardHeader
        label={label}
        right={<DesignBadge label={`${series.windowDays}d window`} color="cyan" size="sm" />}
      />
      {hasAnyData ? (
        <>
          {hasAfter && <DesignChartLegend items={COMPARISON_LEGEND_ITEMS} />}
          <div className="px-5 pb-2 pt-3">
            <ChartContainer
              config={comparisonChartConfig}
              className="aspect-auto w-full !overflow-visible [&_.recharts-wrapper]:!overflow-visible"
              maxHeight={180}
            >
              <LineChart data={rows} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid horizontal vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <ChartTooltip
                  content={<ComparisonTooltip />}
                  cursor={{ stroke: "hsl(var(--foreground))", strokeOpacity: 0.32, strokeWidth: 1 }}
                  offset={20}
                  allowEscapeViewBox={{ x: true, y: true }}
                  wrapperStyle={{ zIndex: 9999, pointerEvents: "none" }}
                />
                <Line
                  dataKey="baseline"
                  type="monotone"
                  stroke="var(--color-baseline)"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                  activeDot={{ r: 3.5, fill: "var(--color-baseline)", stroke: "hsl(var(--background))", strokeWidth: 1.5 }}
                  connectNulls={false}
                />
                <Line
                  dataKey="current"
                  type="monotone"
                  stroke="var(--color-current)"
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 3.5, fill: "var(--color-current)", stroke: "hsl(var(--background))", strokeWidth: 1.5 }}
                  connectNulls={false}
                />
                <YAxis tickLine={false} axisLine={false} width={50} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  tickMargin={6}
                  axisLine={false}
                  interval={rows.length <= 7 ? 0 : "equidistantPreserveStart"}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  tickFormatter={formatComparisonTick}
                />
              </LineChart>
            </ChartContainer>
          </div>
          <div className="px-5 pb-4">
            {hasAfter ? (
              <DesignMetricDelta
                label={`${label} since activation`}
                value={afterTotal.toLocaleString()}
                comparisonLabel={`vs. ${beforeTotal.toLocaleString()} in the ${series.windowDays} days before`}
                delta={computeDeltaPercent(afterTotal, beforeTotal)}
              />
            ) : (
              <DesignMetricDelta
                label={`${label} baseline`}
                value={beforeTotal.toLocaleString()}
                comparisonLabel={`Last ${series.windowDays} days — activate this action to start the before/after comparison.`}
                delta={null}
              />
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center px-5 py-10">
          <Typography variant="secondary" className="text-xs">
            No data captured for this metric yet.
          </Typography>
        </div>
      )}
    </DesignAnalyticsCard>
  );
}
