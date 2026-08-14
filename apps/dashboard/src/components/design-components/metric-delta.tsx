"use client";

import { cn } from "@/lib/utils";
import { MinusIcon, TrendDownIcon, TrendUpIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export type DesignMetricDeltaProps = {
  /** Short metric name shown above the value, e.g. "New signups". */
  label: string,
  /** The current/primary value. A ReactNode so callers can pass formatted strings, currency, etc. */
  value: ReactNode,
  /** Secondary line under the value describing what the delta compares against, e.g. "vs. 14 days before". */
  comparisonLabel?: string,
  /**
   * Relative change of `value` against its comparison window. The caller computes this (typically a
   * percentage, see `calculatePeriodDelta` in the overview metrics page for the canonical computation);
   * the component is purely presentational:
   *   - positive → emerald chip with an upwards trend icon
   *   - negative → red chip with a downwards trend icon
   *   - `0`      → muted chip ("no change")
   *   - `null`/`undefined` → muted em-dash chip ("not computable", e.g. no baseline data)
   */
  delta?: number | null,
  /**
   * Formats the delta magnitude inside the chip. Receives the raw (possibly negative) delta; the default
   * renders the absolute value as a percentage (direction is already conveyed by color + icon).
   */
  format?: (n: number) => string,
  className?: string,
};

function defaultDeltaFormat(n: number): string {
  return `${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function DeltaChip(props: { delta: number | null, format: (n: number) => string }) {
  const { delta, format } = props;
  const chipBase = "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums";
  if (delta == null) {
    return (
      <span className={cn(chipBase, "bg-foreground/[0.05] text-muted-foreground")} aria-label="No comparison available">
        —
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className={cn(chipBase, "bg-foreground/[0.05] text-muted-foreground")}>
        <MinusIcon className="size-3" />
        {format(delta)}
      </span>
    );
  }
  if (delta > 0) {
    return (
      <span className={cn(chipBase, "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400")}>
        <TrendUpIcon weight="bold" className="size-3" />
        {format(delta)}
      </span>
    );
  }
  return (
    <span className={cn(chipBase, "bg-red-500/10 text-red-600 dark:text-red-400")}>
      <TrendDownIcon weight="bold" className="size-3" />
      {format(delta)}
    </span>
  );
}

/**
 * A compact stat tile: metric label, big tabular-numeral value, and an optional colored delta chip
 * comparing the value against a previous window. Designed for before/after comparisons (growth action
 * metrics, daily briefs, overview stat strips). The component never computes deltas itself — pass the
 * precomputed change so every surface keeps a single computation (and a single null-semantics) source.
 */
export function DesignMetricDelta({
  label,
  value,
  comparisonLabel,
  delta,
  format = defaultDeltaFormat,
  className,
}: DesignMetricDeltaProps) {
  return (
    <div className={cn("rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] px-4 py-3", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className="text-2xl font-semibold tabular-nums text-foreground">{value}</span>
        <DeltaChip delta={delta ?? null} format={format} />
      </div>
      {comparisonLabel != null && (
        <p className="mt-1 text-[11px] text-muted-foreground/70">{comparisonLabel}</p>
      )}
    </div>
  );
}
