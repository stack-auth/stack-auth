"use client";

import { cn } from "@/components/ui";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCompact, fmtShortDay } from "../../mock-data";
import {
  ANOMALY_POINT,
  CHURNED_USERS,
  NOTABLE_SIGNUPS,
  REVENUE_SERIES,
} from "./fixtures";
import { Caption, GhostAction, Hairline, Monogram, SERIF } from "./primitives";

// 02 · Metrics that matter — revenue line with dotted projection and
// confidence band, notable signups, and a churn autopsy.

const LINE_COLOR = "#6366f1"; // indigo-500 — reads on both parchment and ink

function ChartTooltip({ active, payload, label }: {
  active?: boolean,
  payload?: { dataKey?: string | number, value?: number | [number, number] }[],
  label?: number,
}) {
  if (!active || !payload || payload.length === 0 || typeof label !== "number") return null;
  const actual = payload.find((p) => p.dataKey === "actual")?.value;
  const projected = payload.find((p) => p.dataKey === "projected")?.value;
  const value = typeof actual === "number" ? actual : typeof projected === "number" ? projected : null;
  if (value === null) return null;
  return (
    <div className="border border-foreground/15 bg-background px-3 py-2 shadow-sm">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/45">
        {fmtShortDay(label)}
        {typeof actual !== "number" && " — projected"}
      </div>
      <div className="mt-0.5 font-mono text-sm tabular-nums text-foreground">${fmtCompact(value)}</div>
    </div>
  );
}

function RevenueChart() {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Caption>Revenue · last 30 days, next 7 projected</Caption>
        <span className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/40">
            <span className="h-px w-5 bg-[#6366f1]" /> actual
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/40">
            <span className="h-px w-5 border-t border-dashed border-[#6366f1]" /> projected
          </span>
        </span>
      </div>
      <div className="mt-4 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={REVENUE_SERIES} margin={{ top: 24, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="dayMs"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v: number) => fmtShortDay(v)}
              tick={{ fontSize: 10, fill: "currentColor", opacity: 0.4 }}
              tickLine={false}
              axisLine={{ stroke: "currentColor", opacity: 0.12 }}
              ticks={[REVENUE_SERIES[0].dayMs, ANOMALY_POINT.dayMs, REVENUE_SERIES[29].dayMs, REVENUE_SERIES[36].dayMs]}
            />
            <YAxis
              width={44}
              tickFormatter={(v: number) => `$${fmtCompact(v)}`}
              tick={{ fontSize: 10, fill: "currentColor", opacity: 0.4 }}
              tickLine={false}
              axisLine={false}
              domain={["auto", "auto"]}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "currentColor", strokeOpacity: 0.15 }} />
            {/* Translucent confidence band under the projection */}
            <Area
              dataKey="band"
              stroke="none"
              fill={LINE_COLOR}
              fillOpacity={0.09}
              connectNulls={false}
              isAnimationActive={false}
              activeDot={false}
            />
            <Line
              dataKey="actual"
              stroke={LINE_COLOR}
              strokeWidth={1.75}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="projected"
              stroke={LINE_COLOR}
              strokeWidth={1.5}
              strokeDasharray="2 5"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <ReferenceDot
              x={ANOMALY_POINT.dayMs}
              y={ANOMALY_POINT.value}
              r={4}
              fill={LINE_COLOR}
              stroke="hsl(var(--background))"
              strokeWidth={2}
              label={{
                value: "Acme Corp upgrade",
                position: "top",
                offset: 10,
                fontSize: 10,
                fontFamily: "monospace",
                fill: "currentColor",
                opacity: 0.6,
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
        Yesterday&apos;s +42% spike is one event, not a trend: Acme Corp moved to Enterprise. Strip it out and
        revenue still grew 6.1% week-over-week — the projection band assumes the boring version continues.
      </p>
    </div>
  );
}

function NotableSignups() {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <Caption>Notable signups · last 24h</Caption>
        <Caption className="text-foreground/30">Enriched from 6 sources</Caption>
      </div>
      <div className="mt-4 grid gap-x-10 gap-y-6 sm:grid-cols-2">
        {NOTABLE_SIGNUPS.map((signup) => (
          <div key={signup.id} className="flex gap-4">
            <Monogram letters={signup.monogram} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={cn("text-lg leading-tight text-foreground", SERIF)}>{signup.company}</span>
                <span className="font-mono text-[10px] tracking-[0.08em] text-foreground/40">{signup.contact}</span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{signup.blurb}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChurnAutopsy() {
  return (
    <div>
      <Caption>Churn autopsy · 3 accounts lost this week</Caption>
      <div className="mt-4 flex flex-col">
        {CHURNED_USERS.map((user, i) => (
          <div key={user.id}>
            {i > 0 && <Hairline />}
            <div className="grid gap-x-10 gap-y-4 py-5 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-[15px] font-medium text-foreground">{user.name}</span>
                  <span className="text-sm text-foreground/55">{user.company}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/35">{user.plan}</span>
                </div>
                <p className="mt-1.5 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">{user.reason}</p>
                <GhostAction className="mt-3">Draft win-back</GhostAction>
              </div>
              {/* Mini funnel — final week of usage */}
              <div className="flex flex-col gap-1.5 self-center">
                {user.funnel.map((step) => (
                  <div key={step.label} className="grid grid-cols-[86px_1fr_34px] items-center gap-2">
                    <span className="truncate font-mono text-[9px] uppercase tracking-[0.1em] text-foreground/40">
                      {step.label}
                    </span>
                    <span className="h-1.5 bg-foreground/[0.07] dark:bg-foreground/[0.1]">
                      <span
                        className="block h-full bg-foreground/45"
                        style={{ width: `${step.pct}%` }}
                      />
                    </span>
                    <span className="text-right font-mono text-[9px] tabular-nums text-foreground/40">{step.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MetricsChapter() {
  return (
    <div className="flex flex-col gap-12">
      <RevenueChart />
      <NotableSignups />
      <ChurnAutopsy />
    </div>
  );
}
