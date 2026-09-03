"use client";

import { cn } from "./cn";

/**
 * Bar fills for the hand-rolled charts. The names are the hues callers ask for; the values map onto
 * the theme's chart tokens so a bar keeps its meaning (and its contrast) in both light and dark
 * without per-theme overrides at the call site. Several names intentionally share a token — the
 * carbon palette has six categorical hues, not eleven.
 */
export const chartColors = {
  blue: "bg-chart-1",
  cyan: "bg-chart-1/70",
  emerald: "bg-chart-3",
  green: "bg-chart-3/70",
  amber: "bg-chart-4",
  orange: "bg-chart-4/70",
  red: "bg-chart-5",
  purple: "bg-chart-2",
  indigo: "bg-chart-2/70",
  pink: "bg-chart-5/70",
  neutral: "bg-chart-6/60",
} as const;

export type ChartColor = keyof typeof chartColors;

/** Neutral track a horizontal bar is drawn on. */
export const chartTrackClass = "bg-panel-raised";

/** Horizontal "label — bar — value" row, used by every distribution list in the tool. */
export function BarRow({
  label,
  labelClassName,
  barClassName,
  pct,
  value,
  extra,
  title,
}: {
  label: React.ReactNode,
  labelClassName?: string,
  barClassName: string,
  pct: number,
  value: React.ReactNode,
  extra?: React.ReactNode,
  title?: string,
}) {
  return (
    <div className="flex items-center gap-2" title={title}>
      <span className={cn("truncate text-[11px] text-muted-foreground", labelClassName)}>{label}</span>
      <div className={cn("h-2.5 flex-1 overflow-hidden rounded-full", chartTrackClass)}>
        <div className={cn("h-full rounded-full transition-[width] duration-500", barClassName)} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular w-10 text-right text-[11px] text-foreground">{value}</span>
      {extra}
    </div>
  );
}

/** Legend swatch + caption pair shown under the stacked time-series charts. */
export function LegendItem({ colorClass, children }: { colorClass: string, children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className={cn("inline-block size-1.5 rounded-full", colorClass)} />
      {children}
    </span>
  );
}
