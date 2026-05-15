"use client";

import {
  DesignAlert,
  DesignAnalyticsCard,
  DesignAnalyticsCardHeader,
  DesignButton,
  DesignPillToggle,
} from "@/components/design-components";
import { cn, Typography } from "@/components/ui";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  ChartLineIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { type CSSProperties, type ReactNode, useId, useMemo, useState } from "react";
import {
  formatDelta,
  formatValue,
  TrendPill,
  type FormatKind,
} from "@stackframe/dashboard-ui-components";
import { TABLE_ROWS, type TableRow } from "./fixtures";

export { TrendPill };

export function SectionHeading({
  index,
  label,
  caption,
  right,
}: {
  index: string,
  label: string,
  caption: ReactNode,
  right?: ReactNode,
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div className="flex items-baseline gap-3 min-w-0">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70 tabular-nums">
          {index}
        </span>
        <div className="min-w-0">
          <Typography type="h3" className="text-xs font-semibold uppercase tracking-wider">
            {label}
          </Typography>
          <Typography variant="secondary" className="text-[11px] mt-0.5 truncate">
            {caption}
          </Typography>
        </div>
      </div>
      {right != null && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function Sparkline({
  values,
  width = 90,
  height = 22,
  padding = 0,
  showArea = false,
  stroke,
  strokeDark,
  strokeWidth = 1.5,
  className,
  ariaHidden = true,
}: {
  values: number[],
  width?: number,
  height?: number,
  padding?: number,
  showArea?: boolean,
  stroke: string,
  strokeDark: string,
  strokeWidth?: number,
  className?: string,
  ariaHidden?: boolean,
}) {
  const iw = width - padding * 2;
  const ih = height - padding * 2;
  const min = Math.min(...values);
  const max = Math.max(...values) * (showArea ? 1.1 : 1);
  const range = (max - min) || 1;
  const n = values.length - 1 || 1;
  const points = values
    .map((v, i) => {
      const x = padding + (i / n) * iw;
      const y = padding + ih - ((v - min) / range) * ih;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const viewBox = `0 0 ${width} ${height}`;
  const style = { "--s-l": stroke, "--s-d": strokeDark } as CSSProperties;
  const areaPath = showArea
    ? `M${points.split(" ").join(" L")} L${(padding + iw).toFixed(1)},${(padding + ih).toFixed(1)} L${padding.toFixed(1)},${(padding + ih).toFixed(1)} Z`
    : null;
  const gradientId = `spark-${useId().replace(/:/g, "")}`;

  return (
    <svg
      viewBox={viewBox}
      className={cn("block", className)}
      style={style}
      aria-hidden={ariaHidden || undefined}
    >
      {areaPath && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--s-l)" stopOpacity="0.25" className="dark:[stop-color:var(--s-d)]" />
              <stop offset="100%" stopColor="var(--s-l)" stopOpacity="0" className="dark:[stop-color:var(--s-d)]" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} />
        </>
      )}
      <polyline
        points={points}
        fill="none"
        stroke="var(--s-l)"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        className="dark:[stroke:var(--s-d)]"
      />
    </svg>
  );
}

export function KpiBlock({
  label,
  current,
  previous,
  formatKind,
  gradient,
  periodLabel = "30d",
  previousPeriodLabel = "prev 30d",
}: {
  label: string,
  current: number,
  previous: number,
  formatKind: FormatKind,
  gradient: "blue" | "cyan" | "green" | "orange" | "purple",
  periodLabel?: string,
  previousPeriodLabel?: string,
}) {
  const delta = formatDelta(current, previous);
  const currentLabel = formatValue(current, formatKind);
  const previousLabel = formatValue(previous, formatKind);
  return (
    <DesignAnalyticsCard
      gradient={gradient}
      chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}
    >
      <div className="group relative flex h-full flex-col justify-between px-5 py-4">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="font-mono text-3xl font-semibold tabular-nums leading-none text-foreground">
            {currentLabel}
          </span>
          <TrendPill delta={delta} size="md" />
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="font-mono tabular-nums">{previousLabel}</span>
          <span>previous period</span>
        </div>
        <div
          role="tooltip"
          className="pointer-events-none absolute left-4 right-4 top-full z-20 mt-1.5 rounded-xl border border-foreground/10 bg-background/95 p-3 opacity-0 shadow-[0_12px_28px_rgba(15,23,42,0.18)] backdrop-blur-xl transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 dark:shadow-[0_12px_28px_rgba(0,0,0,0.55)]"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Current · {periodLabel}
              </span>
              <span className="font-mono text-base font-semibold tabular-nums text-foreground">
                {currentLabel}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                {previousPeriodLabel}
              </span>
              <span className="font-mono text-base tabular-nums text-muted-foreground">
                {previousLabel}
              </span>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-foreground/[0.06] pt-2">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Change
            </span>
            <TrendPill delta={delta} size="sm" />
          </div>
        </div>
      </div>
    </DesignAnalyticsCard>
  );
}

export function FormatterPanel() {
  const rows: { sample: number, kind: FormatKind, hint: string }[] = [
    { sample: 48_271, kind: { type: "numeric", decimals: 0 }, hint: "Locale grouping (en-US)" },
    { sample: 48_271, kind: { type: "numeric", decimals: 2 }, hint: "Locale grouping · 2 decimals" },
    { sample: 4_827_104, kind: { type: "short", precision: 1 }, hint: "Compact (K / M / B)" },
    { sample: 482_701, kind: { type: "currency", currency: "USD", divisor: 100 }, hint: "USD · cents → dollars" },
    { sample: 482_701, kind: { type: "currency", currency: "EUR", divisor: 100 }, hint: "EUR · cents → euros" },
    { sample: 4_271, kind: { type: "duration", unit: "s" }, hint: "1h 11m 11s (seconds)" },
    { sample: 1_240, kind: { type: "duration", unit: "ms" }, hint: "1s 240ms (milliseconds)" },
    { sample: Date.UTC(2026, 2, 17), kind: { type: "datetime", style: "short" }, hint: "Short date" },
    { sample: Date.UTC(2026, 2, 17), kind: { type: "datetime", style: "long" }, hint: "Long date+time" },
    { sample: Date.UTC(2026, 2, 17), kind: { type: "datetime", style: "iso" }, hint: "ISO-8601" },
    { sample: Date.now() - 7_200_000, kind: { type: "datetime", style: "relative" }, hint: "Relative" },
    { sample: 0.482, kind: { type: "percent", source: "fraction", decimals: 1 }, hint: "Fraction → percent" },
    { sample: 4_827, kind: { type: "percent", source: "basis", decimals: 2 }, hint: "Basis points → percent" },
  ];
  return (
    <DesignAnalyticsCard
      gradient="purple"
      chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}
    >
      <DesignAnalyticsCardHeader label="Pluggable value rendering" />
      <div className="px-5 py-4">
        <ul className="divide-y divide-foreground/[0.05] rounded-lg bg-foreground/[0.02] ring-1 ring-foreground/[0.05]">
          {rows.map((r, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-4 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {r.kind.type}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {r.hint}
                </span>
              </div>
              <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-foreground">
                {formatValue(r.sample, r.kind)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </DesignAnalyticsCard>
  );
}

type PanelState = "data" | "loading" | "empty" | "error";

export function ThreeStatePanel() {
  const [state, setState] = useState<PanelState>("data");
  const data = useMemo(
    () => Array.from({ length: 24 }, (_, i) => 30 + Math.sin(i * 0.5) * 18 + i * 3),
    [],
  );

  return (
    <DesignAnalyticsCard
      gradient="orange"
      chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}
    >
      <DesignAnalyticsCardHeader
        label="State shim"
        right={
          <DesignPillToggle
            size="sm"
            gradient="default"
            options={[
              { id: "data", label: "Data" },
              { id: "loading", label: "Loading" },
              { id: "empty", label: "Empty" },
              { id: "error", label: "Error" },
            ]}
            selected={state}
            onSelect={(id) => setState(id as PanelState)}
          />
        }
      />
      <div
        className="relative flex h-[200px] items-center justify-center px-5 py-4"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {state === "data" && (
          <Sparkline
            values={data}
            width={520}
            height={160}
            padding={16}
            showArea
            stroke="#2563eb"
            strokeDark="#60a5fa"
            strokeWidth={2}
            className="w-full h-full"
          />
        )}
        {state === "loading" && (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <SpinnerGapIcon
              weight="bold"
              className="size-7 animate-spin text-blue-600 motion-reduce:animate-none dark:text-blue-400"
              aria-hidden="true"
            />
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-xs font-medium text-foreground">Computing…</span>
              <span className="font-mono text-[10px] uppercase tracking-wider">
                Querying 14 days · 4 breakdowns
              </span>
            </div>
          </div>
        )}
        {state === "empty" && (
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <div className="grid size-10 place-items-center rounded-full bg-foreground/[0.06]">
              <ChartLineIcon weight="bold" className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-xs font-medium text-foreground">No matching events</span>
              <span className="text-[11px] text-muted-foreground">
                Widen the date range or remove breakdown filters to see more.
              </span>
            </div>
          </div>
        )}
        {state === "error" && (
          <div className="w-full">
            <DesignAlert
              variant="error"
              title="Query failed"
              description={
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[11px] tabular-nums">
                    HOGQL:42 · aggregation timeout after 12.4s
                  </span>
                  <DesignButton
                    variant="outline"
                    size="sm"
                    onClick={() => setState("loading")}
                  >
                    <ArrowsClockwiseIcon weight="bold" className="size-3" aria-hidden="true" />
                    Retry
                  </DesignButton>
                </div>
              }
            />
          </div>
        )}
      </div>
    </DesignAnalyticsCard>
  );
}

type SortKey = "current" | "previous" | "delta" | "label";
type SortDir = "asc" | "desc";

export function InsightsTablePanel() {
  const [sortKey, setSortKey] = useState<SortKey>("current");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const rows = [...TABLE_ROWS];
    rows.sort((a, b) => {
      const av = sortKey === "label" ? a.label
        : sortKey === "current" ? a.current
          : sortKey === "previous" ? a.previous
            : formatDelta(a.current, a.previous).pct ?? 0;
      const bv = sortKey === "label" ? b.label
        : sortKey === "current" ? b.current
          : sortKey === "previous" ? b.previous
            : formatDelta(b.current, b.previous).pct ?? 0;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "label" ? "asc" : "desc");
    }
  };

  const headCell = (key: SortKey, label: string, align: "left" | "right" = "right") => {
    const sortState = sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none";
    return (
      <th
        scope="col"
        aria-sort={sortState}
        className={cn("px-3 py-2", align === "right" ? "text-right" : "text-left")}
      >
        <button
          type="button"
          onClick={() => toggleSort(key)}
          className={cn(
            "inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors duration-150 hover:text-foreground hover:transition-none focus-visible:outline-none focus-visible:underline",
            sortKey === key && "text-foreground",
          )}
        >
          {label}
          {sortKey === key && (
            sortDir === "asc"
              ? <ArrowUpIcon weight="bold" className="size-2.5" aria-hidden="true" />
              : <ArrowDownIcon weight="bold" className="size-2.5" aria-hidden="true" />
          )}
        </button>
      </th>
    );
  };

  return (
    <DesignAnalyticsCard
      gradient="slate"
      chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}
    >
      <DesignAnalyticsCardHeader
        label="Top referrers"
        right={
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Click a header to sort
          </span>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-foreground/[0.05]">
              {headCell("label", "Source", "left")}
              <th scope="col" className="px-3 py-2 text-left">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Trend
                </span>
              </th>
              {headCell("current", "Current")}
              {headCell("previous", "Previous")}
              {headCell("delta", "Δ")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r: TableRow) => {
              const delta = formatDelta(r.current, r.previous);
              return (
                <tr
                  key={r.key}
                  className="border-b border-foreground/[0.04] last:border-0 transition-colors duration-150 hover:bg-foreground/[0.03] hover:transition-none"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="size-2 rounded-full shrink-0 bg-[var(--c-l)] dark:bg-[var(--c-d)]"
                        style={{ "--c-l": r.light, "--c-d": r.dark } as CSSProperties}
                      />
                      <span className="text-[12px] font-medium text-foreground">{r.label}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 w-[110px]">
                    <Sparkline
                      values={r.trend}
                      width={90}
                      height={22}
                      stroke={r.light}
                      strokeDark={r.dark}
                      className="h-[22px] w-[90px]"
                    />
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[12px] font-semibold tabular-nums text-foreground">
                    {r.current.toLocaleString("en-US")}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {r.previous.toLocaleString("en-US")}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <TrendPill delta={delta} size="sm" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DesignAnalyticsCard>
  );
}
