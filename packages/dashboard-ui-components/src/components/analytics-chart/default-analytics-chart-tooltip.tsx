import { cn } from "@stackframe/stack-ui";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CursorClickIcon,
  MinusIcon,
  PushPinSimpleIcon,
} from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import type { AnalyticsChartStrings } from "./strings";
import type { AnalyticsChartDelta, Point } from "./types";

/** Trend pill — small rounded badge with an up/down/flat arrow, a signed
 * percentage, and an optional trailing label. Shared between the default
 * tooltip, the pie view, and the demo panels (which re-export it). */
export function TrendPill({
  delta,
  label,
  size = "sm",
}: {
  delta: AnalyticsChartDelta,
  label?: string,
  size?: "sm" | "md",
}) {
  const { pct, sign } = delta;
  const tone =
    sign === "up" ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
      : sign === "down" ? "text-rose-600 dark:text-rose-400 bg-rose-500/10"
        : "text-muted-foreground bg-foreground/[0.06]";
  const Icon = sign === "up" ? ArrowUpIcon : sign === "down" ? ArrowDownIcon : MinusIcon;
  const text = pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full font-mono tabular-nums font-medium",
      size === "md" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-[1px] text-[10px]",
      tone,
    )}>
      <Icon weight="bold" className={size === "md" ? "size-3" : "size-2.5"} aria-hidden="true" />
      {text}
      {label && <span className="ml-0.5 text-muted-foreground font-normal">{label}</span>}
    </span>
  );
}

export type AnalyticsChartTooltipSegmentRow = {
  key: string,
  label: string,
  value: number,
  /** Light-theme color for the dot / swatch. */
  color: string,
  /** Dark-theme color for the dot / swatch. */
  colorDark: string,
};

export type AnalyticsChartTooltipLayerView = {
  /** Stable layer id (e.g. `"signups"`, `"previous"`). */
  id: string,
  /** Consumer-provided layer label. */
  label: string,
  /** Resolved layer color (light theme). */
  color: string,
  /** Resolved layer color (dark theme). */
  colorDark: string,
  /** Flat total for this layer at the hovered index. Populated regardless
   * of segmentation so consumers can render the same number in either mode. */
  total: number,
  /** True iff this layer is rendered as a stacked breakdown. */
  segmented: boolean,
  /** Per-segment rows — empty when `segmented === false`. Order matches
   * `segmentSeries`. */
  segments: AnalyticsChartTooltipSegmentRow[],
};

export type AnalyticsChartTooltipContext = {
  /** Index into the visible window. */
  activeIndex: number,
  /** Raw point at `activeIndex` — convenient for `.ts` access. */
  point: Point,
  /** True when the tooltip is pinned (via click) and stable under hover. */
  isPinned: boolean,
  /** Primary layer view or null when the primary layer is hidden. */
  primary: AnalyticsChartTooltipLayerView | null,
  /** Compare layer view or null when the compare layer is hidden. */
  compare: AnalyticsChartTooltipLayerView | null,
  /** Flat-mode delta between primary and compare totals. Null when either
   * side is hidden. Consumers should feed this into their trend pill. */
  delta: AnalyticsChartDelta | null,
  /** Pre-bound value formatter for y-axis values. */
  formatValue: (v: number) => string,
  /** Pre-bound formatter for x-axis values. */
  formatDate: (ts: number) => string,
  /** Resolved strings — already merged with defaults. */
  strings: AnalyticsChartStrings,
};

export type DefaultAnalyticsChartTooltipProps = {
  ctx: AnalyticsChartTooltipContext,
};

/** The default tooltip body. The tooltip is rendered as an
 * absolutely-positioned sibling of `<ChartContainer>`, which means it sits
 * OUTSIDE the `[data-chart=…]` subtree that scopes shadcn's `--color-${key}`
 * CSS variables. We therefore cannot reference those variables for segment
 * swatches — instead, every swatch uses a single span with `--c-l`/`--c-d`
 * custom properties + Tailwind arbitrary variants so one DOM element covers
 * both themes. */
export function DefaultAnalyticsChartTooltip({ ctx }: DefaultAnalyticsChartTooltipProps) {
  const { point, isPinned, primary, compare, delta, formatValue: fv, formatDate: fd, strings } = ctx;
  const anySegmented = (primary?.segmented ?? false) || (compare?.segmented ?? false);
  return (
    <div className="rounded-xl border border-foreground/10 bg-background/95 px-3 py-2.5 shadow-[0_10px_28px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:shadow-[0_10px_28px_rgba(0,0,0,0.55)] min-w-[180px]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {fd(point.ts)}
        </span>
        {isPinned && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-300">
            <PushPinSimpleIcon weight="fill" className="size-2.5" aria-hidden="true" />
            {strings.pinnedBadge}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        <TooltipLayerRows view={primary} keyPrefix="p" fv={fv} muted={false} />
        <TooltipLayerRows view={compare} keyPrefix="c" fv={fv} muted />
      </div>
      {anySegmented && (
        <div className="mt-2 flex flex-col gap-1 border-t border-foreground/[0.07] pt-2">
          {primary?.segmented && (
            <LayerSummaryRow
              label={`${primary.label}${strings.layerTotalSuffix}`}
              value={fv(primary.total)}
              muted={false}
            />
          )}
          {compare?.segmented && (
            <LayerSummaryRow
              label={`${compare.label}${strings.layerTotalSuffix}`}
              value={fv(compare.total)}
              muted
            />
          )}
          {primary?.segmented && compare?.segmented && delta && (
            <div className="mt-1 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {strings.deltaVsPrev}
              </span>
              <TrendPill delta={delta} size="sm" />
            </div>
          )}
        </div>
      )}
      {!anySegmented && delta && primary && compare && (
        <div className="mt-2 flex items-center justify-between border-t border-foreground/[0.07] pt-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {strings.deltaVsPrev}
          </span>
          <TrendPill delta={delta} size="sm" />
        </div>
      )}
      <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
        <CursorClickIcon weight="bold" className="size-2.5" aria-hidden="true" />
        <span>{isPinned ? strings.hintClickAnywhereUnpin : strings.hintClickToPin}</span>
      </div>
    </div>
  );
}

/** Render either a single flat row or the per-segment breakdown rows for
 * one tooltip layer view. Collapses what were formerly two parallel
 * primary/compare branches into one component. */
function TooltipLayerRows({
  view,
  keyPrefix,
  fv,
  muted,
}: {
  view: AnalyticsChartTooltipLayerView | null,
  keyPrefix: string,
  fv: (v: number) => string,
  muted: boolean,
}) {
  if (!view) return null;
  if (!view.segmented) {
    return (
      <LayerTotalRow
        light={view.color}
        dark={view.colorDark}
        label={view.label}
        value={fv(view.total)}
        muted={muted}
      />
    );
  }
  return (
    <>
      {view.segments.map((s) => (
        <LayerTotalRow
          key={`${keyPrefix}-${s.key}`}
          light={s.color}
          dark={s.colorDark}
          label={s.label}
          value={fv(s.value)}
          muted={muted}
        />
      ))}
    </>
  );
}

/** Single row: swatch + label + value. One DOM element for the swatch —
 * dark-mode color is picked up via `--c-d`. */
function LayerTotalRow({
  light,
  dark,
  label,
  value,
  muted,
}: {
  light: string,
  dark: string,
  label: string,
  value: string,
  muted: boolean,
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="size-2 rounded-full bg-[var(--c-l)] dark:bg-[var(--c-d)]"
        style={{ "--c-l": light, "--c-d": dark } as CSSProperties}
      />
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn(
        "ml-auto font-mono text-xs tabular-nums",
        muted ? "text-muted-foreground" : "font-semibold text-foreground",
      )}>
        {value}
      </span>
    </div>
  );
}

function LayerSummaryRow({
  label,
  value,
  muted,
}: {
  label: string,
  value: string,
  muted: boolean,
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={cn(
        "font-mono text-xs tabular-nums",
        muted ? "text-muted-foreground" : "font-semibold text-foreground",
      )}>
        {value}
      </span>
    </div>
  );
}
