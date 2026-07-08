"use client";

// Charts-as-figures for the BROADSHEET variation. Ink-on-paper styling:
// currentColor strokes so light and dark editions both print correctly.

import { cn } from "@/components/ui";
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { fmtShortDay } from "../../mock-data";
import { PLAYS, PLAY_TOTAL_MIN, REVENUE_FIGURE, type Play } from "./fixtures";
import { FigCaption, INK, MUTED, RULE } from "./primitives";

// FIG. 1 — 30-day revenue line, dotted forecast, anomaly dot.
export function RevenueFigure({ caption }: { caption: string }) {
  const { points, anomaly } = REVENUE_FIGURE;
  return (
    <figure className={cn("border-y", RULE, "py-3", INK)}>
      <div className="h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--np-rule)" strokeDasharray="1 3" />
            <XAxis
              dataKey="dayMs"
              tickFormatter={(v: number) => fmtShortDay(v).toUpperCase()}
              ticks={[points[0].dayMs, points[10].dayMs, points[20].dayMs, anomaly.dayMs]}
              tick={{ fontSize: 8, fill: "var(--np-muted)", fontFamily: "var(--font-mono, ui-monospace, monospace)", letterSpacing: "0.14em" }}
              axisLine={{ stroke: "var(--np-rule)" }}
              tickLine={false}
            />
            <YAxis hide domain={["dataMin - 4000", "dataMax + 4000"]} />
            <Line
              type="monotone"
              dataKey="actual"
              stroke="var(--np-ink)"
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="forecast"
              stroke="var(--np-muted)"
              strokeWidth={1.5}
              strokeDasharray="2 4"
              dot={false}
              isAnimationActive={false}
            />
            <ReferenceDot
              x={anomaly.dayMs}
              y={anomaly.value}
              r={4}
              fill="var(--np-accent)"
              stroke="var(--np-paper)"
              strokeWidth={1.5}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <FigCaption>{caption}</FigCaption>
    </figure>
  );
}

// FIG. 2 — incident play-by-play as a mini waterfall (hand-set, sharper in
// print than any charting library).
export function WaterfallFigure({ caption }: { caption: string }) {
  return (
    <figure className={cn("border-y", RULE, "py-3")}>
      <div className="flex flex-col gap-2.5">
        {PLAYS.map((play) => (
          <WaterfallRow key={play.id} play={play} />
        ))}
      </div>
      <FigCaption>{caption}</FigCaption>
    </figure>
  );
}

function WaterfallRow({ play }: { play: Play }) {
  const left = (play.startMin / PLAY_TOTAL_MIN) * 100;
  const width = Math.max(3, (play.durMin / PLAY_TOTAL_MIN) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("font-mono text-[9px] font-bold tracking-[0.12em]", INK)}>{play.time}</span>
        <span className={cn("min-w-0 flex-1 truncate text-right font-mono text-[9px] tracking-[0.06em]", MUTED)}>
          {play.label.toUpperCase()}
        </span>
      </div>
      <div className={cn("relative mt-1 h-2.5 border", RULE)}>
        <div
          className={play.accent ? "absolute inset-y-0 bg-[color:var(--np-accent)]" : "absolute inset-y-0 bg-[color:var(--np-ink)]"}
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      </div>
    </div>
  );
}
