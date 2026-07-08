"use client";

import { DesignDialog } from "@/components/design-components";
import { cn } from "@/lib/utils";
import { ArrowRightIcon, CheckIcon, LinkSimpleIcon, TrendDownIcon, TrendUpIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, animate, motion, useAnimationFrame, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminApp } from "./use-admin-app";

const AUTO_ADVANCE_MS = 8000;

type StatChart =
  | { variant: "bars", series: { label: string, value: number }[] }
  | { variant: "line", series: number[], startLabel: string, endLabel: string, endValueLabel: string };

type ChecklistItem = {
  tag: "issue" | "suggestion",
  text: string,
};

type AdChannel = {
  name: string,
  spend: string,
  signups: number,
  activatedUsers: number,
  activationPct: number,
  costPerActivatedUser: string,
  trend: string,
};

type BriefingSlide = {
  id: string,
  eyebrow: string,
  title: string,
  accent: string,
  wash: string,
} & (
  | { kind: "cover", heading: string, body: string }
  | { kind: "stat", prefix?: string, value: number, unit: string, delta: string, chart: StatChart }
  | { kind: "ring", percent: number, caption: string }
  | { kind: "ads", channels: AdChannel[], edgeLabel: string, recommendation: string, insight: string }
  | { kind: "insight", quote: string, action: string }
  | { kind: "checklist", items: ChecklistItem[] }
);

function getBriefingSlides(projectName: string): BriefingSlide[] {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return [
    {
      id: "cover",
      kind: "cover",
      eyebrow: "Daily briefing",
      title: today,
      accent: "#67e8f9",
      wash: "radial-gradient(120% 90% at 15% 0%, #22d3ee 0%, transparent 55%), radial-gradient(120% 110% at 100% 30%, #6366f1 0%, transparent 60%), radial-gradient(140% 120% at 40% 110%, #10b981 0%, transparent 55%), #0b3b66",
      heading: "Good morning.",
      body: `While you were away, ${projectName} kept moving. Here's the signal — noise already filtered.`,
    },
    {
      id: "growth",
      kind: "stat",
      eyebrow: "Growth",
      title: "Product Hunt is your top channel",
      accent: "#fda4af",
      wash: "radial-gradient(120% 90% at 10% 0%, #fb923c 0%, transparent 55%), radial-gradient(130% 110% at 100% 25%, #e11d48 0%, transparent 60%), radial-gradient(140% 130% at 30% 115%, #7c3aed 0%, transparent 60%), #57123c",
      value: 312,
      unit: "new users yesterday",
      delta: "+41% vs last week",
      chart: {
        variant: "bars",
        series: [
          { label: "Tue", value: 121 },
          { label: "Wed", value: 98 },
          { label: "Thu", value: 156 },
          { label: "Fri", value: 174 },
          { label: "Sat", value: 148 },
          { label: "Sun", value: 221 },
          { label: "Mon", value: 312 },
        ],
      },
    },
    {
      id: "revenue",
      kind: "stat",
      eyebrow: "Revenue",
      title: "Dunning recovered 3 failed payments",
      accent: "#fcd34d",
      wash: "radial-gradient(120% 90% at 15% 0%, #facc15 0%, transparent 52%), radial-gradient(130% 110% at 100% 30%, #f97316 0%, transparent 60%), radial-gradient(150% 130% at 40% 115%, #10b981 0%, transparent 55%), #713f12",
      prefix: "$",
      value: 4210,
      unit: "added to MRR",
      delta: "12 new subscribers",
      chart: {
        variant: "line",
        series: [8.4, 8.6, 8.5, 8.9, 9.2, 9.1, 9.6, 10.1, 9.8, 10.4, 10.9, 11.2, 11.8, 12.4],
        startLabel: "4 weeks ago",
        endLabel: "today",
        endValueLabel: "$12.4k MRR",
      },
    },
    {
      id: "ads",
      kind: "ads",
      eyebrow: "Ad pulse",
      title: "Meta converts 2.4× better than X",
      accent: "#7dd3fc",
      wash: "radial-gradient(120% 90% at 12% 0%, #38bdf8 0%, transparent 55%), radial-gradient(130% 110% at 100% 28%, #2563eb 0%, transparent 60%), radial-gradient(150% 130% at 40% 115%, #64748b 0%, transparent 55%), #0f1d3a",
      channels: [
        { name: "Meta Ads", spend: "$1.9k", signups: 186, activatedUsers: 58, activationPct: 31, costPerActivatedUser: "$33", trend: "+8 pts WoW" },
        { name: "X Ads", spend: "$1.4k", signups: 71, activatedUsers: 9, activationPct: 13, costPerActivatedUser: "$156", trend: "-4 pts WoW" },
      ],
      edgeLabel: "2.4× activation edge",
      recommendation: "Move 15% of X prospecting spend into Meta retargeting today.",
      insight: "Hexclave joined ad clicks with auth outcomes, so the winner is based on activated users, not just click volume.",
    },
    {
      id: "security",
      kind: "ring",
      eyebrow: "Security pulse",
      title: "Access changes, reviewed",
      accent: "#6ee7b7",
      wash: "radial-gradient(120% 90% at 20% 0%, #34d399 0%, transparent 55%), radial-gradient(130% 110% at 100% 35%, #0d9488 0%, transparent 62%), radial-gradient(140% 120% at 45% 115%, #0ea5e9 0%, transparent 58%), #06403e",
      percent: 100,
      caption: "checks passed",
    },
    {
      id: "insight",
      kind: "insight",
      eyebrow: "AI insight",
      title: "Magic links are slipping on mobile",
      accent: "#a5b4fc",
      wash: "radial-gradient(120% 90% at 15% 0%, #60a5fa 0%, transparent 55%), radial-gradient(130% 110% at 100% 30%, #4f46e5 0%, transparent 60%), radial-gradient(150% 130% at 35% 115%, #06b6d4 0%, transparent 58%), #1e2a78",
      quote: "Magic-link conversion fell 18% this week — and 9 out of 10 drop-offs happened on mobile Safari.",
      action: "Ask Hex for a diagnostic query",
    },
    {
      id: "today",
      kind: "checklist",
      eyebrow: "Today",
      title: "Your checklist for today",
      accent: "#f0abfc",
      wash: "radial-gradient(120% 90% at 15% 0%, #c084fc 0%, transparent 55%), radial-gradient(130% 110% at 100% 30%, #db2777 0%, transparent 60%), radial-gradient(150% 130% at 40% 115%, #f97316 0%, transparent 55%), #4a044e",
      items: [
        { tag: "issue", text: "3 webhook deliveries failed overnight — retry them." },
        { tag: "issue", text: "Custom domain setup is one DNS record from done." },
        { tag: "suggestion", text: "Enable passkeys — your growth cohort is on mobile." },
        { tag: "suggestion", text: "Send a promo code to 14 abandoned checkouts." },
      ],
    },
  ];
}

function AnimatedNumber(props: { value: number, prefix?: string }) {
  const prefersReducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(prefersReducedMotion ? props.value : 0);

  useEffect(() => {
    if (prefersReducedMotion) {
      setDisplay(props.value);
      return;
    }
    const controls = animate(0, props.value, {
      duration: 1.4,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setDisplay(Math.round(latest)),
    });
    return () => controls.stop();
  }, [props.value, prefersReducedMotion]);

  return (
    <span className="tabular-nums">
      {props.prefix}
      {display.toLocaleString("en-US")}
    </span>
  );
}

function BarsChartFigure(props: { series: { label: string, value: number }[], accent: string }) {
  const prefersReducedMotion = useReducedMotion();
  const max = Math.max(...props.series.map((point) => point.value));

  return (
    <div>
      <div className="flex h-20 items-end gap-1.5">
        {props.series.map((point, index) => {
          const isLast = index === props.series.length - 1;
          const barHeight = Math.max((point.value / max) * 80, 4);
          return (
            <motion.div
              key={point.label}
              initial={{ height: prefersReducedMotion ? barHeight : 0 }}
              animate={{ height: barHeight }}
              transition={{ duration: 0.7, delay: prefersReducedMotion ? 0 : 0.4 + index * 0.07, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 rounded"
              style={{ background: isLast ? "#fff" : "rgba(255,255,255,0.42)" }}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {props.series.map((point, index) => (
          <div
            key={point.label}
            className={cn(
              "flex-1 text-center text-[9px] font-semibold uppercase tracking-wide",
              index === props.series.length - 1 ? "font-bold text-white" : "text-white/55",
            )}
          >
            {point.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChartFigure(props: {
  series: number[],
  startLabel: string,
  endLabel: string,
  endValueLabel: string,
}) {
  const prefersReducedMotion = useReducedMotion();
  const width = 320;
  const height = 80;
  const padding = 6;

  const min = Math.min(...props.series);
  const max = Math.max(...props.series);
  const points = props.series.map((value, index) => {
    const x = padding + (index / (props.series.length - 1)) * (width - padding * 2);
    const y = padding + (1 - (value - min) / (max - min)) * (height - padding * 2);
    return [x, y] as const;
  });
  const linePath = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1][0].toFixed(1)} ${height} L ${points[0][0].toFixed(1)} ${height} Z`;
  const [endX, endY] = points[points.length - 1];

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-20 w-full" role="img" aria-label={`MRR trend, ending at ${props.endValueLabel}`}>
          <motion.path
            d={areaPath}
            fill="rgba(255,255,255,0.16)"
            initial={{ opacity: prefersReducedMotion ? 1 : 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: prefersReducedMotion ? 0 : 1.1 }}
          />
          <motion.path
            d={linePath}
            fill="none"
            stroke="#fff"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: prefersReducedMotion ? 1 : 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, delay: prefersReducedMotion ? 0 : 0.4, ease: "easeInOut" }}
          />
          <motion.circle
            cx={endX}
            cy={endY}
            r={4.5}
            fill="#fff"
            initial={{ scale: prefersReducedMotion ? 1 : 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 18, delay: prefersReducedMotion ? 0 : 1.4 }}
          />
        </svg>
        <motion.div
          initial={{ opacity: prefersReducedMotion ? 1 : 0, y: prefersReducedMotion ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: prefersReducedMotion ? 0 : 1.5 }}
          className="absolute -top-1 right-0 text-[10px] font-bold text-white"
        >
          {props.endValueLabel}
        </motion.div>
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] font-semibold uppercase tracking-wide text-white/55">
        <span>{props.startLabel}</span>
        <span>{props.endLabel}</span>
      </div>
    </div>
  );
}

function RingFigure(props: { percent: number, caption: string }) {
  const prefersReducedMotion = useReducedMotion();
  const size = 168;
  const strokeWidth = 11;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={strokeWidth} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#fff"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: prefersReducedMotion ? circumference * (1 - props.percent / 100) : circumference }}
          animate={{ strokeDashoffset: circumference * (1 - props.percent / 100) }}
          transition={{ duration: 1.3, delay: prefersReducedMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-4xl font-extrabold tracking-tight text-white">
          <AnimatedNumber value={props.percent} />%
        </div>
        <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-white/75">
          {props.caption}
        </div>
      </div>
    </div>
  );
}

function ActivationBar(props: { percent: number }) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/25">
      <motion.div
        className="h-full rounded-full bg-white"
        initial={{ width: prefersReducedMotion ? `${props.percent}%` : "0%" }}
        animate={{ width: `${props.percent}%` }}
        transition={{ duration: 0.9, delay: prefersReducedMotion ? 0 : 0.6, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}

function AdsChannelCard(props: { channel: AdChannel, isWinner: boolean }) {
  const channel = props.channel;
  const trendDown = channel.trend.startsWith("-");

  return (
    <motion.div
      variants={revealVariants}
      className={cn(
        "relative overflow-hidden rounded-2xl p-3.5 ring-1",
        props.isWinner
          ? "bg-gradient-to-b from-white/[0.24] to-white/[0.10] shadow-[0_18px_60px_rgba(125,211,252,0.25)] ring-white/40"
          : "bg-white/[0.08] ring-white/15",
      )}
    >
      {props.isWinner && (
        <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-sky-300/30 blur-2xl" />
      )}
      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <div className={cn("truncate text-[11px] font-extrabold tracking-tight", props.isWinner ? "text-white" : "text-white/70")}>
            {channel.name}
          </div>
          <div
            className={cn(
              "flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[8px] font-bold tabular-nums ring-1",
              trendDown ? "bg-rose-400/15 text-rose-200 ring-rose-200/25" : "bg-emerald-400/15 text-emerald-200 ring-emerald-200/25",
            )}
          >
            {trendDown
              ? <TrendDownIcon className="h-2.5 w-2.5" weight="bold" />
              : <TrendUpIcon className="h-2.5 w-2.5" weight="bold" />}
            {channel.trend}
          </div>
        </div>

        <div className="mt-3 text-[2rem] font-extrabold leading-none tracking-tight text-white tabular-nums">
          <AnimatedNumber value={channel.activationPct} />%
        </div>
        <div className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-white/60">
          {channel.activatedUsers} of {channel.signups} signups activated
        </div>
        <div className="mt-2">
          <ActivationBar percent={channel.activationPct} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/15 pt-2">
          <div>
            <div className="text-xs font-extrabold text-white tabular-nums">{channel.spend}</div>
            <div className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-white/55">spend</div>
          </div>
          <div className="text-right">
            <div className="text-xs font-extrabold text-white tabular-nums">{channel.costPerActivatedUser}</div>
            <div className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-white/55">per activated</div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const revealVariants = {
  enter: { opacity: 0, y: 18 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

function ChecklistRow(props: {
  item: ChecklistItem,
  checked: boolean,
  accent: string,
  onToggle: () => void,
}) {
  return (
    <motion.button
      variants={revealVariants}
      type="button"
      role="checkbox"
      aria-checked={props.checked}
      onClick={props.onToggle}
      className="pointer-events-auto flex w-full items-center gap-2.5 rounded-xl bg-white/15 px-3 py-2 text-left ring-1 ring-white/20 transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
    >
      <span
        className={cn(
          "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full transition-colors",
          props.checked ? "bg-white" : "ring-[1.4px] ring-inset ring-white/60",
        )}
      >
        {props.checked && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}>
            <CheckIcon className="h-3 w-3 text-zinc-900" weight="bold" />
          </motion.span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-xs font-semibold leading-5 transition-colors", props.checked ? "text-white/45 line-through" : "text-white")}>
          {props.item.text}
        </span>
      </span>
      <span
        className="shrink-0 text-[8px] font-bold uppercase tracking-[0.14em]"
        style={{ color: props.item.tag === "issue" ? "#fcd34d" : props.accent }}
      >
        {props.item.tag}
      </span>
    </motion.button>
  );
}

function SlideContent(props: {
  slide: BriefingSlide,
  checkedItems: ReadonlySet<string>,
  onToggleItem: (text: string) => void,
  onDone: () => void,
}) {
  const slide = props.slide;

  switch (slide.kind) {
    case "cover": {
      return (
        <div className="flex h-full flex-col justify-center gap-3 p-6">
          <motion.h2 variants={revealVariants} className="text-4xl font-extrabold tracking-tight text-white">
            {slide.heading}
          </motion.h2>
          <motion.p variants={revealVariants} className="max-w-[17rem] text-sm leading-6 text-white/80">
            {slide.body}
          </motion.p>
        </div>
      );
    }
    case "stat": {
      return (
        <div className="flex h-full flex-col justify-between p-6">
          <div className="space-y-2">
            <motion.div variants={revealVariants} className="text-5xl font-extrabold leading-none tracking-tight text-white">
              <AnimatedNumber value={slide.value} prefix={slide.prefix} />
            </motion.div>
            <motion.div variants={revealVariants} className="text-[10px] font-semibold uppercase tracking-wider text-white/80">
              {slide.unit}
            </motion.div>
            <motion.div variants={revealVariants}>
              <span className="inline-flex items-center rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-bold text-white ring-1 ring-white/25">
                {slide.delta}
              </span>
            </motion.div>
          </div>
          <motion.div variants={revealVariants}>
            {slide.chart.variant === "bars" ? (
              <BarsChartFigure series={slide.chart.series} accent={slide.accent} />
            ) : (
              <LineChartFigure
                series={slide.chart.series}
                startLabel={slide.chart.startLabel}
                endLabel={slide.chart.endLabel}
                endValueLabel={slide.chart.endValueLabel}
              />
            )}
          </motion.div>
        </div>
      );
    }
    case "ads": {
      return (
        <div className="flex h-full flex-col justify-center gap-2.5 p-5">
          <motion.div variants={revealVariants} className="rounded-2xl bg-white/[0.14] p-3 ring-1 ring-white/20">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/65">
                  winner signal
                </div>
                <div className="mt-1 text-sm font-extrabold tracking-tight text-white">
                  {slide.edgeLabel}
                </div>
              </div>
              <div className="rounded-full bg-white px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-950">
                budget move
              </div>
            </div>
            <div className="mt-2 text-xs font-semibold leading-5 text-white/82">
              {slide.recommendation}
            </div>
          </motion.div>
          <div className="relative grid grid-cols-2 gap-2.5">
            {slide.channels.map((channel, index) => (
              <AdsChannelCard key={channel.name} channel={channel} isWinner={index === 0} />
            ))}
            <motion.div
              variants={revealVariants}
              className="absolute left-1/2 top-1/2 z-10 -ml-3 -mt-3 flex h-6 w-6 items-center justify-center rounded-full bg-slate-950/70 text-[8px] font-extrabold tracking-wide text-white ring-1 ring-white/30 backdrop-blur-sm"
            >
              VS
            </motion.div>
          </div>
          <motion.p variants={revealVariants} className="flex items-start gap-1.5 text-xs leading-5 text-white/85">
            <LinkSimpleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: slide.accent }} weight="bold" />
            {slide.insight}
          </motion.p>
        </div>
      );
    }
    case "ring": {
      return (
        <motion.div variants={revealVariants} className="flex h-full items-center justify-center">
          <RingFigure percent={slide.percent} caption={slide.caption} />
        </motion.div>
      );
    }
    case "insight": {
      return (
        <div className="flex h-full flex-col justify-center gap-4 p-6">
          <motion.blockquote variants={revealVariants} className="text-xl font-bold leading-snug tracking-tight text-white">
            &ldquo;{slide.quote}&rdquo;
          </motion.blockquote>
          <motion.div variants={revealVariants} className="flex items-center gap-1.5 text-xs font-bold" style={{ color: slide.accent }}>
            <ArrowRightIcon className="h-3.5 w-3.5 shrink-0" weight="bold" />
            {slide.action}
          </motion.div>
        </div>
      );
    }
    case "checklist": {
      const doneCount = slide.items.filter((item) => props.checkedItems.has(item.text)).length;
      return (
        <div className="flex h-full flex-col justify-center gap-2 p-5">
          <motion.div variants={revealVariants} className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/70">
            {doneCount} of {slide.items.length} done
          </motion.div>
          {slide.items.map((item) => (
            <ChecklistRow
              key={item.text}
              item={item}
              checked={props.checkedItems.has(item.text)}
              accent={slide.accent}
              onToggle={() => props.onToggleItem(item.text)}
            />
          ))}
          <motion.div variants={revealVariants} className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={props.onDone}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-zinc-900 transition-transform hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              Start my day
              <ArrowRightIcon className="h-3.5 w-3.5" weight="bold" />
            </button>
          </motion.div>
        </div>
      );
    }
  }
}

function StripDots(props: {
  slides: BriefingSlide[],
  currentIndex: number,
  fillWidth: ReturnType<typeof useTransform<number, string>>,
  onSelect: (index: number) => void,
}) {
  return (
    <div className="pointer-events-auto flex shrink-0 items-center gap-1">
      {props.slides.map((slide, index) => {
        const isCurrent = index === props.currentIndex;
        return (
          <button
            key={slide.id}
            type="button"
            aria-label={`Go to card ${index + 1} of ${props.slides.length}`}
            aria-current={isCurrent ? "step" : undefined}
            onClick={() => props.onSelect(index)}
            className={cn(
              "h-1 overflow-hidden rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
              isCurrent ? "w-4 bg-white/25" : "w-1 bg-white/30 hover:bg-white/60",
            )}
          >
            {isCurrent && (
              <motion.div className="h-full rounded-full bg-white" style={{ width: props.fillWidth }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function DailyBriefingDialog() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const slides = useMemo(() => getBriefingSlides(project.displayName), [project.displayName]);
  const prefersReducedMotion = useReducedMotion();

  const [open, setOpen] = useState(true);
  const [[currentIndex, direction], setIndexState] = useState<[number, number]>([0, 0]);
  const [isHolding, setIsHolding] = useState(false);
  const [checkedItems, setCheckedItems] = useState<ReadonlySet<string>>(new Set());

  const isLastSlide = currentIndex === slides.length - 1;
  const shouldAutoAdvance = open && !prefersReducedMotion && !isLastSlide;

  const progress = useMotionValue(0);
  const fillWidth = useTransform(progress, (latest) => `${latest * 100}%`);

  const goTo = useCallback((target: number) => {
    setIndexState(([current]) => {
      const clamped = Math.min(Math.max(target, 0), slides.length - 1);
      return [clamped, clamped >= current ? 1 : -1];
    });
  }, [slides.length]);

  const toggleItem = useCallback((text: string) => {
    setCheckedItems((current) => {
      const next = new Set(current);
      if (next.has(text)) {
        next.delete(text);
      } else {
        next.add(text);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    progress.set(shouldAutoAdvance ? 0 : 1);
  }, [currentIndex, shouldAutoAdvance, progress]);

  useAnimationFrame((_, delta) => {
    if (!shouldAutoAdvance || isHolding) return;
    const next = progress.get() + delta / AUTO_ADVANCE_MS;
    if (next >= 1) {
      goTo(currentIndex + 1);
    } else {
      progress.set(next);
    }
  });

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") goTo(currentIndex + 1);
      if (event.key === "ArrowLeft") goTo(currentIndex - 1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, currentIndex, goTo]);

  const slide = slides[currentIndex];

  return (
    <DesignDialog
      open={open}
      onOpenChange={setOpen}
      size="md"
      title="Daily briefing"
      headerClassName="sr-only"
      hideTopCloseButton
      noBodyPadding
      className="max-h-none max-w-[30rem] bg-[#141417] ring-white/[0.08] dark:bg-[#141417] dark:ring-white/[0.08]"
      bodyClassName="overflow-hidden"
    >
      {/* Dark backdrop so card edges never expose the white dialog surface mid-transition. */}
      <div
        className="relative aspect-square w-full select-none overflow-hidden bg-[#141417]"
        onPointerDown={() => setIsHolding(true)}
        onPointerUp={() => setIsHolding(false)}
        onPointerCancel={() => setIsHolding(false)}
        onPointerLeave={() => setIsHolding(false)}
      >
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={slide.id}
            custom={direction}
            variants={{
              enter: (dir: number) => ({ x: dir * 32, scale: 0.97, opacity: 0 }),
              center: { x: 0, scale: 1, opacity: 1, transition: { staggerChildren: 0.09, delayChildren: 0.08 } },
              exit: (dir: number) => ({ x: dir * -32, scale: 0.97, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: prefersReducedMotion ? 0 : 0.45, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-0 flex flex-col"
          >
            {/* Image area: gradient wash + hero + viz, like the iMessage demo cards. */}
            <div className="relative min-h-0 flex-1" style={{ background: slide.wash }}>
              {/* Story-style tap zones: left third goes back, the rest goes forward. */}
              <button
                type="button"
                aria-label="Previous card"
                onClick={() => goTo(currentIndex - 1)}
                className="absolute inset-y-0 left-0 z-10 w-1/3 cursor-w-resize focus:outline-none"
              />
              <button
                type="button"
                aria-label="Next card"
                onClick={() => goTo(currentIndex + 1)}
                className="absolute inset-y-0 right-0 z-10 w-2/3 cursor-e-resize focus:outline-none"
              />

              <div className="pointer-events-none relative z-20 h-full">
                <SlideContent
                  slide={slide}
                  checkedItems={checkedItems}
                  onToggleItem={toggleItem}
                  onDone={() => setOpen(false)}
                />
              </div>
            </div>

            {/* Text strip: eyebrow + title on the left, progress dots on the right. */}
            <div className="flex h-16 shrink-0 items-center justify-between gap-3 bg-[#1b1b20] px-4">
              <div className="min-w-0">
                <div className="truncate text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: slide.accent }}>
                  {slide.eyebrow}
                </div>
                <div className="truncate text-[13px] font-semibold text-white">{slide.title}</div>
              </div>
              <StripDots
                slides={slides}
                currentIndex={currentIndex}
                fillWidth={fillWidth}
                onSelect={goTo}
              />
            </div>
          </motion.div>
        </AnimatePresence>

        <button
          type="button"
          aria-label="Dismiss daily briefing"
          onClick={() => setOpen(false)}
          className="absolute right-3 top-3 z-30 flex h-7 w-7 items-center justify-center rounded-full bg-black/25 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <XIcon className="h-3.5 w-3.5" weight="bold" />
        </button>
      </div>
    </DesignDialog>
  );
}
