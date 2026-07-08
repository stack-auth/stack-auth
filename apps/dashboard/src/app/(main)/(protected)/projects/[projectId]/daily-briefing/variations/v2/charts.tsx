"use client";

// Chart tiles: the big revenue area (with dotted forecast + anomaly dot),
// a signups sparkline, and a plan-mix donut. All recharts, all mock.

import { ChartLineUpIcon, ChartPieSliceIcon, PulseIcon } from "@phosphor-icons/react";
import {
  Area,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceDot,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCompact, fmtNum, fmtShortDay, fmtUsd } from "../../mock-data";
import { PLAN_MIX, REVENUE_ANOMALY, REVENUE_SERIES, SIGNUPS_SPARK } from "./data";
import { CountUp, DeltaBadge, Tile, TileLabel } from "./tile";

const VIOLET = "#8b5cf6";
const EMERALD = "#10b981";
const AMBER = "#f59e0b";

export function RevenueChartTile(props: { className?: string }) {
  return (
    <Tile accent="purple" className={props.className}>
      <TileLabel
        icon={<ChartLineUpIcon className="h-3.5 w-3.5" weight="bold" />}
        right={
          <span className="inline-flex items-center gap-3 font-mono text-[10px] text-foreground/40">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-[3px] w-4 rounded-full" style={{ background: VIOLET }} />
              actual
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: VIOLET }} />
              forecast
            </span>
          </span>
        }
      >
        Revenue — 14d + forecast
      </TileLabel>

      <div className="mb-2 flex items-baseline gap-3">
        <span className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
          {fmtUsd(REVENUE_SERIES[13].actual! * 100)}
        </span>
        <DeltaBadge pct={12.4} />
        <span className="text-xs text-foreground/45">
          anomaly {fmtShortDay(REVENUE_ANOMALY.dayMs)}: webhook retry storm double-charged, auto-refunded
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={REVENUE_SERIES} margin={{ top: 12, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="v2-rev-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={VIOLET} stopOpacity={0.28} />
                <stop offset="100%" stopColor={VIOLET} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="dayMs"
              tickFormatter={fmtShortDay}
              tick={{ fontSize: 10, fill: "currentColor", opacity: 0.4 }}
              tickLine={false}
              axisLine={false}
              interval={3}
            />
            <YAxis hide domain={["dataMin - 2000", "dataMax + 1500"]} />
            <Area
              type="monotone"
              dataKey="actual"
              stroke={VIOLET}
              strokeWidth={2.25}
              fill="url(#v2-rev-fill)"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="forecast"
              stroke={VIOLET}
              strokeWidth={2}
              strokeDasharray="4 5"
              strokeOpacity={0.7}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
            <ReferenceDot
              x={REVENUE_ANOMALY.dayMs}
              y={REVENUE_ANOMALY.actual ?? 0}
              r={5}
              fill={AMBER}
              stroke="none"
            />
            <ReferenceDot
              x={REVENUE_ANOMALY.dayMs}
              y={REVENUE_ANOMALY.actual ?? 0}
              r={9}
              fill="none"
              stroke={AMBER}
              strokeOpacity={0.45}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Tile>
  );
}

export function SignupsSparkTile(props: { className?: string }) {
  const total = SIGNUPS_SPARK[SIGNUPS_SPARK.length - 1].value;
  return (
    <Tile accent="emerald" className={props.className}>
      <TileLabel icon={<PulseIcon className="h-3.5 w-3.5" weight="bold" />}>Signups / day</TileLabel>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight text-foreground">
          <CountUp to={total} format={fmtNum} />
        </span>
        <DeltaBadge pct={8.1} />
      </div>
      <div className="mt-2 min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={SIGNUPS_SPARK} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="v2-signup-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={EMERALD} stopOpacity={0.3} />
                <stop offset="100%" stopColor={EMERALD} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={["dataMin - 30", "dataMax + 10"]} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={EMERALD}
              strokeWidth={2}
              fill="url(#v2-signup-fill)"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Tile>
  );
}

export function PlanMixTile(props: { className?: string }) {
  const total = PLAN_MIX.reduce((sum, s) => sum + s.value, 0);
  return (
    <Tile accent="blue" className={props.className}>
      <TileLabel icon={<ChartPieSliceIcon className="h-3.5 w-3.5" weight="bold" />}>Plan mix</TileLabel>
      <div className="flex min-h-0 flex-1 items-center gap-4">
        <div className="relative h-full min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={PLAN_MIX}
                dataKey="value"
                nameKey="name"
                innerRadius="68%"
                outerRadius="96%"
                paddingAngle={3}
                strokeWidth={0}
                isAnimationActive={false}
              >
                {PLAN_MIX.map((slice) => (
                  <Cell key={slice.name} fill={slice.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-lg font-semibold tabular-nums text-foreground">{fmtCompact(total)}</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-foreground/40">users</span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {PLAN_MIX.map((slice) => (
            <span key={slice.name} className="inline-flex items-center gap-1.5 text-xs text-foreground/60">
              <span className="h-2 w-2 rounded-full" style={{ background: slice.color }} />
              {slice.name}
              <span className="font-mono tabular-nums text-foreground/40">{fmtCompact(slice.value)}</span>
            </span>
          ))}
        </div>
      </div>
    </Tile>
  );
}
