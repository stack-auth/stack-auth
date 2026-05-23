"use client";

import { useId } from "react";
import { DesignAnalyticsCard, type AnalyticsCardGradient } from "@/components/design-components";

type UserPageMetricCardDelta = {
  current: number,
  previous: number,
  comparisonLabel: string,
};

type UserPageMetricCardSpark = {
  values: number[],
};

type UserPageMetricCardProps = {
  label: string,
  value: string | number,
  description: string,
  gradient: AnalyticsCardGradient,
  delta?: UserPageMetricCardDelta,
  spark?: UserPageMetricCardSpark,
};

function formatDelta({ current, previous }: UserPageMetricCardDelta): { text: string, tone: "up" | "down" | "flat" } {
  if (previous === 0) {
    if (current === 0) return { text: "0%", tone: "flat" };
    // No comparable baseline — a percentage would be misleading (0→1 and 0→1M
    // would render identically as +100%).
    return { text: "New", tone: "up" };
  }
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(pct);
  if (rounded === 0) return { text: "0%", tone: "flat" };
  const sign = rounded > 0 ? "+" : "";
  return { text: `${sign}${rounded}%`, tone: rounded > 0 ? "up" : "down" };
}

// Solid stroke color per gradient family. The DesignAnalyticsCard background
// already carries the soft gradient, so the sparkline only needs an opaque
// line + a matching translucent fill.
const GRADIENT_STROKE: Record<AnalyticsCardGradient, string> = {
  blue: "rgb(59 130 246)",
  cyan: "rgb(6 182 212)",
  green: "rgb(16 185 129)",
  purple: "rgb(168 85 247)",
  orange: "rgb(249 115 22)",
  slate: "rgb(100 116 139)",
};

function Sparkline({ values, color }: { values: number[], color: string }) {
  const gradId = `metric-spark-${useId()}`;
  if (values.length < 2) return null;
  const w = 100;
  const h = 32;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const flat = max === min;
  const range = flat ? 1 : max - min;
  const step = w / (values.length - 1);
  const coords = values.map((v, i) => {
    const x = i * step;
    // Reserve 1px top/bottom so the stroke isn't clipped.
    const y = flat ? h / 2 : h - 1 - ((v - min) / range) * (h - 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const linePath = `M${coords.join(" L")}`;
  const areaPath = `${linePath} L${w},${h} L0,${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-8 w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function UserPageMetricCard({
  label,
  value,
  description,
  gradient,
  delta,
  spark,
}: UserPageMetricCardProps) {
  const deltaInfo = delta ? formatDelta(delta) : null;
  const strokeColor = GRADIENT_STROKE[gradient];
  const showSpark = spark != null && spark.values.length >= 2;

  return (
    <DesignAnalyticsCard
      gradient={gradient}
      chart={{ type: showSpark ? "line" : "none", tooltipType: "none", highlightMode: "none" }}
    >
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
            {label}
          </span>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xl font-bold tabular-nums text-foreground leading-none">
              {value}
            </span>
            {deltaInfo && (
              <span
                className={
                  "text-[10px] font-semibold tabular-nums leading-none " +
                  (deltaInfo.tone === "up"
                    ? "text-emerald-500"
                    : deltaInfo.tone === "down"
                      ? "text-red-500"
                      : "text-muted-foreground")
                }
                title={delta ? `${delta.current} ${delta.comparisonLabel} (was ${delta.previous})` : undefined}
              >
                {deltaInfo.text}
              </span>
            )}
            <span className="truncate text-[10px] font-medium text-muted-foreground leading-none">
              {description}
            </span>
          </div>
        </div>
        {showSpark && <Sparkline values={spark.values} color={strokeColor} />}
      </div>
    </DesignAnalyticsCard>
  );
}
