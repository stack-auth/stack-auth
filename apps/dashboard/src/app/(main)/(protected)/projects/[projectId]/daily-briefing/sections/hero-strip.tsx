"use client";

import { cn } from "@/components/ui";
import { TrendDownIcon, TrendUpIcon } from "@phosphor-icons/react";
import { fmtDay, formatHeroStat, BRIEFING_NOW_MS, HERO_STATS, MOCK_HEADLINE, MOCK_VIEWER } from "../mock-data";
import { greetingForTimeOfDay, useTimeOfDay } from "../intro/ambient-gradient";

// Editorial masthead, Dia-brief style: a painterly banner with a huge serif
// title, a standfirst line underneath, and a hairline stat strip. The weekday
// comes from the fixed mock anchor so SSR stays deterministic.

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(BRIEFING_NOW_MS));
const DATE_STAMP = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
  .format(new Date(BRIEFING_NOW_MS))
  .toUpperCase();

export function HeroStrip() {
  const timeOfDay = useTimeOfDay();

  return (
    <div className="flex flex-col gap-8">
      {/* Painterly banner */}
      <div className="relative overflow-hidden rounded-3xl ring-1 ring-black/[0.07] dark:ring-white/[0.08]">
        {/* Layered gradient "canvas" — Monet by way of CSS */}
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_20%_10%,rgba(253,230,138,0.55),transparent_55%),radial-gradient(90%_80%_at_80%_20%,rgba(186,230,253,0.5),transparent_50%),radial-gradient(100%_100%_at_50%_100%,rgba(233,213,255,0.45),transparent_60%),linear-gradient(180deg,#faf7f0,#f3efe6)] dark:bg-[radial-gradient(120%_90%_at_20%_10%,rgba(217,119,6,0.16),transparent_55%),radial-gradient(90%_80%_at_80%_20%,rgba(14,116,144,0.14),transparent_50%),radial-gradient(100%_100%_at_50%_100%,rgba(126,34,206,0.12),transparent_60%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background)))]" />
        <div className="absolute inset-0 opacity-[0.35] mix-blend-overlay [background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%22160%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22/></filter><rect width=%22160%22 height=%22160%22 filter=%22url(%23n)%22 opacity=%220.4%22/></svg>')]" />

        <div className="relative flex flex-col items-center px-6 py-14 text-center sm:py-20">
          <span className="font-mono text-[11px] tracking-[0.35em] text-foreground/45">
            {DATE_STAMP} — {MOCK_VIEWER.projectName.toUpperCase()}
          </span>
          <h1 className="mt-5 text-6xl leading-[0.95] tracking-tight text-foreground sm:text-7xl lg:text-8xl [font-family:var(--font-briefing-serif),Georgia,serif]">
            <span className="block text-3xl text-foreground/60 sm:text-4xl">The</span>
            {WEEKDAY} Brief
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-foreground/70 sm:text-lg [font-family:var(--font-briefing-serif),Georgia,serif]">
            {greetingForTimeOfDay(timeOfDay)}, {MOCK_VIEWER.firstName}. {MOCK_HEADLINE}
          </p>
          <span className="mt-8 font-mono text-[10px] tracking-[0.25em] text-foreground/35">
            MORNING HAZE — GENERATED 06:12 FOR {MOCK_VIEWER.firstName.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Hairline stat strip — deltas vs yesterday, editorial not card-y */}
      <div className="grid grid-cols-2 divide-black/[0.07] rounded-none sm:grid-cols-5 sm:divide-x dark:divide-white/[0.08]">
        {HERO_STATS.map((stat) => (
          <div key={stat.id} className="flex flex-col gap-1 px-4 py-3 first:pl-0 last:pr-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/45">
              {stat.label}
            </span>
            <span className="font-mono text-2xl font-medium tabular-nums tracking-tight text-foreground">
              {formatHeroStat(stat)}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-medium",
                stat.deltaPct > 0 && "text-emerald-600 dark:text-emerald-400",
                stat.deltaPct < 0 && "text-red-600 dark:text-red-400",
                stat.deltaPct === 0 && "text-foreground/40",
              )}
            >
              {stat.deltaPct > 0 && <TrendUpIcon className="h-3 w-3" weight="bold" />}
              {stat.deltaPct < 0 && <TrendDownIcon className="h-3 w-3" weight="bold" />}
              {stat.deltaPct === 0 ? "steady" : `${stat.deltaPct > 0 ? "+" : ""}${stat.deltaPct}%`}
            </span>
          </div>
        ))}
      </div>

      <span className="sr-only">{fmtDay(BRIEFING_NOW_MS)}</span>
    </div>
  );
}
