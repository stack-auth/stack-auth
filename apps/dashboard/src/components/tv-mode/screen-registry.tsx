"use client";

import {
  ActivityIcon,
  ChartLineUpIcon,
  CheckCircleIcon,
  CurrencyDollarIcon,
  EnvelopeSimpleIcon,
  ShieldWarningIcon,
} from "@phosphor-icons/react";
import { useId, type ComponentType, type ReactNode } from "react";
import type {
  TvAudienceMomentumScreen,
  TvEmailHealthScreen,
  TvLivePulseScreen,
  TvRevenuePaymentsScreen,
  TvScreenId,
  TvScreenSnapshot,
  TvStackedTrendPoint,
  TvTrendPoint,
} from "@/lib/tv-mode/types";

export type TvScreenDefinition = {
  id: TvScreenId,
  displayName: string,
  description: string,
  sourceLabel: string,
  defaultDurationSeconds: number,
  icon: ComponentType<{ className?: string, weight?: "regular" | "fill" | "bold" }>,
  accentClassName: string,
};

export const TV_SCREEN_REGISTRY = new Map<TvScreenId, TvScreenDefinition>([
  ["live-pulse", {
    id: "live-pulse", displayName: "Live Pulse",
    description: "Current activity and monitored source status.",
    sourceLabel: "Hexclave activity", defaultDurationSeconds: 15,
    icon: ActivityIcon, accentClassName: "text-cyan-300",
  }],
  ["audience-momentum", {
    id: "audience-momentum", displayName: "Audience Momentum",
    description: "Seven-day growth and returning-user momentum.",
    sourceLabel: "Hexclave users & analytics", defaultDurationSeconds: 20,
    icon: ChartLineUpIcon, accentClassName: "text-violet-300",
  }],
  ["revenue-payments", {
    id: "revenue-payments", displayName: "Revenue & Payments",
    description: "Thirty-day paid revenue and payment collection.",
    sourceLabel: "Hexclave payments", defaultDurationSeconds: 18,
    icon: CurrencyDollarIcon, accentClassName: "text-emerald-300",
  }],
  ["email-health", {
    id: "email-health", displayName: "Email Health",
    description: "Seven-day delivery reliability and sending volume.",
    sourceLabel: "Hexclave email", defaultDurationSeconds: 18,
    icon: EnvelopeSimpleIcon, accentClassName: "text-amber-300",
  }],
]);

export function getTvScreenDefinition(screenId: TvScreenId): TvScreenDefinition {
  const definition = TV_SCREEN_REGISTRY.get(screenId);
  if (definition == null) throw new Error(`Missing TV screen definition for "${screenId}"`);
  return definition;
}

function formatCompact(value: number): string {
  return Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatUsd(cents: number): string {
  return Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function getNiceChartScale(maximumValue: number): { maximum: number, ticks: number[] } {
  const roughStep = maximumValue / 3;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(roughStep, 1)));
  const normalizedStep = roughStep / magnitude;
  const multiplier = normalizedStep <= 1.5 ? 1 : normalizedStep <= 3 ? 2 : normalizedStep <= 7 ? 5 : 10;
  const step = multiplier * magnitude;
  const maximum = Math.ceil(maximumValue / step) * step;
  const tickCount = Math.round(maximum / step);
  return {
    maximum,
    ticks: Array.from({ length: tickCount + 1 }, (_, index) => maximum - index * step),
  };
}

function TvMetric({ label, value, detail, hero = false }: {
  label: string,
  value: string,
  detail?: string,
  hero?: boolean,
}) {
  return (
    <div className="min-w-0">
      <p className="text-[clamp(0.68rem,0.8vw,2rem)] font-semibold uppercase tracking-[0.18em] text-white/42">{label}</p>
      <p className={`${hero ? "mt-3 text-[clamp(3.5rem,6.8vw,17rem)]" : "mt-2 text-[clamp(1.45rem,2.2vw,5.6rem)]"} font-semibold leading-none tabular-nums tracking-[-0.055em] text-white`}>
        {value}
      </p>
      {detail == null ? null : <p className="mt-3 text-[clamp(0.75rem,0.95vw,2.3rem)] text-white/45">{detail}</p>}
    </div>
  );
}

function TvScreenFrame({ eyebrow, title, description, icon, accentClassName, children }: {
  eyebrow: string,
  title: string,
  description: string,
  icon: ReactNode,
  accentClassName: string,
  children: ReactNode,
}) {
  return (
    <section className="flex h-full min-h-0 flex-col px-[clamp(2rem,5vw,14rem)] pb-[clamp(3rem,6vh,12rem)] pt-[clamp(5rem,8vh,16rem)]">
      <header className="shrink-0">
        <div>
          <div className={`mb-3 flex items-center gap-3 text-[clamp(0.7rem,0.82vw,2rem)] font-semibold uppercase tracking-[0.22em] ${accentClassName}`}>
            {icon}{eyebrow}
          </div>
          <h1 className="text-[clamp(2.2rem,4vw,10rem)] font-semibold leading-none tracking-[-0.05em] text-white">{title}</h1>
          <p className="mt-[clamp(0.55rem,1.2vh,1.5rem)] max-w-[clamp(32rem,42vw,84rem)] text-[clamp(0.8rem,1vw,2.5rem)] leading-relaxed text-white/46">{description}</p>
        </div>
      </header>
      <div className="mt-[clamp(1.5rem,4vh,8rem)] min-h-0 flex-1">{children}</div>
    </section>
  );
}

function TvChartHeader({
  title,
  subtitle,
  accentClassName,
  trailing,
}: {
  title: string,
  subtitle: string,
  accentClassName: string,
  trailing?: ReactNode,
}) {
  return (
    <div className="flex items-end justify-between">
      <div>
        <p className={`text-[clamp(0.68rem,0.8vw,2rem)] font-semibold uppercase tracking-[0.18em] ${accentClassName}`}>{title}</p>
        <p className="mt-1 text-[clamp(0.75rem,0.9vw,2.2rem)] text-white/38">{subtitle}</p>
      </div>
      {trailing}
    </div>
  );
}

function TvLineChart({ points, color, label }: { points: TvTrendPoint[], color: string, label: string }) {
  const gradientId = useId().replaceAll(":", "");
  const maximumValue = Math.max(...points.map((point) => point.value), 1);
  const scale = getNiceChartScale(maximumValue);
  const chartMaximum = scale.maximum;
  const coordinates = points.map((point, index) =>
    `${points.length === 1 ? 50 : (index / (points.length - 1)) * 100},${88 - (point.value / chartMaximum) * 76}`,
  ).join(" ");
  const yAxisValues = scale.ticks;
  return (
    <div className="relative h-full min-h-[11rem] pl-[clamp(2.4rem,2.8vw,6rem)]" role="img" aria-label={label}>
      <div className="absolute bottom-[12%] left-0 top-[12%] flex flex-col justify-between text-right text-[clamp(0.66rem,0.72vw,1.75rem)] font-medium tabular-nums text-white/38">
        {yAxisValues.map((value) => <span key={value}>{formatCompact(Math.round(value))}</span>)}
      </div>
      <div className="relative h-full">
        {yAxisValues.map((value) => <div key={value} className="absolute inset-x-0 border-t border-dashed border-white/[0.075]" style={{ top: `${12 + (1 - value / chartMaximum) * 76}%` }} />)}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.32" />
              <stop offset="65%" stopColor={color} stopOpacity="0.08" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`0,100 ${coordinates} 100,100`} fill={`url(#${gradientId})`} />
          <polyline points={coordinates} fill="none" stroke={color} strokeWidth="2.4" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="absolute inset-x-0 bottom-0 flex justify-between text-[clamp(0.68rem,0.76vw,1.85rem)] font-medium text-white/48">
          {points.map((point) => <span key={point.label}>{point.label}</span>)}
        </div>
      </div>
    </div>
  );
}

function TvStackedBars({ points, colors, labels }: {
  points: TvStackedTrendPoint[],
  colors: [string, string, string],
  labels: [string, string, string],
}) {
  const max = Math.max(...points.map((point) => point.primary + point.secondary + point.tertiary), 1);
  const scale = getNiceChartScale(max);
  const chartMaximum = scale.maximum;
  const yAxisValues = scale.ticks;
  return (
    <div className="relative flex h-full min-h-[12rem] flex-col pl-[clamp(2.4rem,2.8vw,6rem)]" role="img" aria-label={`${labels.join(", ")} by day`}>
      <div className="mb-4 flex justify-end gap-5">
        {labels.map((label, index) => (
          <span key={label} className="flex items-center gap-2 text-[clamp(0.65rem,0.75vw,1.8rem)] text-white/45">
            <span className="h-[clamp(0.5rem,0.45vw,1rem)] w-[clamp(0.5rem,0.45vw,1rem)] rounded-full" style={{ backgroundColor: colors[index] }} />{label}
          </span>
        ))}
      </div>
      <div className="absolute bottom-0 left-0 top-[clamp(2rem,3vw,6rem)] flex flex-col justify-between text-right text-[clamp(0.66rem,0.72vw,1.75rem)] font-medium tabular-nums text-white/38">
        {yAxisValues.map((value) => <span key={value}>{formatCompact(Math.round(value))}</span>)}
      </div>
      <div className="relative flex min-h-0 flex-1 items-end justify-around gap-[clamp(0.5rem,1.5vw,2rem)] border-b border-white/[0.08]">
        {yAxisValues.map((value) => <div key={value} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/[0.06]" style={{ bottom: `${(value / chartMaximum) * 100}%` }} />)}
        {points.map((point) => (
          <div key={point.label} className="relative z-10 flex h-full flex-1 flex-col items-center justify-end">
            <div className="flex w-[clamp(1.2rem,2.2vw,6rem)] flex-col-reverse overflow-hidden rounded-t-lg shadow-[0_0_30px_rgba(139,92,246,0.08)]" style={{ height: `${((point.primary + point.secondary + point.tertiary) / chartMaximum) * 88}%` }}>
              {[point.primary, point.secondary, point.tertiary].map((value, index) => (
                <span key={colors[index]} style={{ height: `${(value / (point.primary + point.secondary + point.tertiary)) * 100}%`, backgroundColor: colors[index] }} />
              ))}
            </div>
            <span className="mt-2 text-[clamp(0.68rem,0.76vw,1.85rem)] font-medium text-white/48">{point.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Insight({
  tone,
  children,
}: {
  tone: "cyan" | "violet" | "emerald" | "amber",
  children: ReactNode,
}) {
  const toneClass = {
    cyan: "border-cyan-300/15 bg-cyan-300/[0.055] text-cyan-300",
    violet: "border-violet-300/15 bg-violet-300/[0.055] text-violet-300",
    emerald: "border-emerald-300/15 bg-emerald-300/[0.055] text-emerald-300",
    amber: "border-amber-300/15 bg-amber-300/[0.055] text-amber-300",
  }[tone];
  return (
    <div className={`flex items-start gap-[clamp(0.75rem,0.8vw,2rem)] rounded-[clamp(1rem,1vw,2.5rem)] border px-[clamp(1.25rem,1.3vw,3rem)] py-[clamp(1rem,1.1vw,2.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] backdrop-blur-sm ${toneClass}`}>
      <CheckCircleIcon className="mt-0.5 h-[clamp(1.25rem,1.1vw,2.5rem)] w-[clamp(1.25rem,1.1vw,2.5rem)] shrink-0" weight="fill" />
      <p className="text-[clamp(0.78rem,0.95vw,2.24rem)] leading-relaxed text-white/76">{children}</p>
    </div>
  );
}

function GlassPanel({
  tone,
  className,
  children,
}: {
  tone: "cyan" | "violet" | "emerald" | "amber",
  className?: string,
  children: ReactNode,
}) {
  const toneClass = {
    cyan: "border-cyan-300/12 bg-[radial-gradient(circle_at_12%_8%,rgba(34,211,238,0.13),transparent_42%),linear-gradient(145deg,rgba(34,211,238,0.055),rgba(255,255,255,0.018))] shadow-[0_30px_100px_rgba(8,145,178,0.08)]",
    violet: "border-violet-300/12 bg-[radial-gradient(circle_at_12%_8%,rgba(139,92,246,0.16),transparent_42%),linear-gradient(145deg,rgba(139,92,246,0.065),rgba(255,255,255,0.018))] shadow-[0_30px_100px_rgba(109,40,217,0.09)]",
    emerald: "border-emerald-300/12 bg-[radial-gradient(circle_at_12%_8%,rgba(52,211,153,0.14),transparent_42%),linear-gradient(145deg,rgba(52,211,153,0.055),rgba(255,255,255,0.018))] shadow-[0_30px_100px_rgba(5,150,105,0.08)]",
    amber: "border-amber-300/12 bg-[radial-gradient(circle_at_12%_8%,rgba(251,191,36,0.15),transparent_42%),linear-gradient(145deg,rgba(251,191,36,0.055),rgba(255,255,255,0.018))] shadow-[0_30px_100px_rgba(217,119,6,0.08)]",
  }[tone];
  return (
    <div className={`relative min-h-0 overflow-hidden rounded-[clamp(1.5rem,2vw,5rem)] border backdrop-blur-sm ${toneClass} ${className ?? ""}`}>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.035),transparent_24%)]" />
      <div className="relative h-full min-h-0">{children}</div>
    </div>
  );
}

function LivePulseScreen({
  data,
  insight,
}: {
  data: NonNullable<TvLivePulseScreen["data"]>,
  insight: TvLivePulseScreen["insight"],
}) {
  return (
    <TvScreenFrame eyebrow="Right now" title="Live Pulse" description="Current activity and source-level signals Hexclave can verify." icon={<ActivityIcon className="h-[1.3em] w-[1.3em]" weight="fill" />} accentClassName="text-cyan-300">
      <div className="grid h-full min-h-0 grid-cols-[0.75fr_1.25fr] gap-[clamp(2rem,5vw,12rem)]">
        <GlassPanel tone="cyan" className="h-full">
          <div className="flex h-full min-h-0 flex-col justify-between p-[clamp(1.5rem,2.5vw,6rem)]">
            <div>
              <div className="mb-[clamp(1.5rem,3vh,3rem)] flex items-center gap-3 text-[clamp(0.68rem,0.8vw,2rem)] font-medium text-cyan-100/65">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-45 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-cyan-300" />
                </span>
                Live signal
              </div>
              <TvMetric label="Live now · rolling 2 min" value={data.liveUsers.toLocaleString()} detail="Distinct signed-in users refreshing now" hero />
            </div>
            <div className="grid grid-cols-2 gap-5 border-t border-cyan-100/10 pt-[clamp(1.25rem,2.5vh,3rem)]">
              <TvMetric
                label="Active today · UTC"
                value={data.todayActiveUsers.toLocaleString()}
                detail={insight == null ? "Current UTC day" : `↑ ${insight.evidence.deltaPercent}% vs recent baseline`}
              />
              <TvMetric label="Monitored sources" value={data.sourceHealth.length.toString()} detail="Reporting now" />
            </div>
            {insight == null ? null : <Insight tone="cyan">{insight.message}</Insight>}
          </div>
        </GlassPanel>
        <GlassPanel tone="cyan" className="h-full">
          <div className="grid h-full min-h-0 grid-rows-[auto_1fr_auto] gap-[clamp(1rem,2vh,2.5rem)] p-[clamp(1.25rem,2vw,5rem)]">
            <TvChartHeader
              title="Today’s activity"
              subtitle="Current UTC day"
              accentClassName="text-cyan-200/55"
              trailing={(
                <span className="flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[0.07] px-3 py-1.5 text-[clamp(0.65rem,0.72vw,1.7rem)] font-semibold uppercase tracking-[0.12em] text-emerald-200">
                  <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.85)]" />
                  Live
                </span>
              )}
            />
            <TvLineChart points={data.hourlyActivity} color="#67e8f9" label="Current UTC day activity" />
            <div className="grid grid-cols-3 gap-3">
              {data.sourceHealth.map((fact) => (
                <div key={fact.label} className="rounded-[clamp(1rem,1vw,2.5rem)] border border-cyan-100/[0.09] bg-black/15 p-[clamp(0.8rem,1.2vw,2.8rem)]">
                  <p className="text-[clamp(0.62rem,0.72vw,1.72rem)] font-semibold uppercase tracking-[0.14em] text-cyan-300/80">{fact.label}</p>
                  <p className="mt-3 text-[clamp(1.25rem,1.65vw,4rem)] font-semibold text-white">{fact.value}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-[clamp(0.65rem,0.75vw,1.8rem)] text-emerald-300/80">
                    <CheckCircleIcon className="h-[1em] w-[1em]" weight="fill" />{fact.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </GlassPanel>
      </div>
    </TvScreenFrame>
  );
}

function AudienceMomentumScreen({
  data,
  insight,
}: {
  data: NonNullable<TvAudienceMomentumScreen["data"]>,
  insight: TvAudienceMomentumScreen["insight"],
}) {
  return (
    <TvScreenFrame eyebrow="Seven-day audience" title="Audience Momentum" description="Whether new attention is becoming sustained, returning activity." icon={<ChartLineUpIcon className="h-[1.3em] w-[1.3em]" weight="fill" />} accentClassName="text-violet-300">
      <div className="grid h-full min-h-0 grid-cols-[0.72fr_1.28fr] gap-[clamp(2rem,5vw,12rem)]">
        <GlassPanel tone="violet" className="h-full">
          <div className="flex h-full min-h-0 flex-col justify-between p-[clamp(1.5rem,2.3vw,5.5rem)]">
            <TvMetric label="Total users" value={data.totalUsers.toLocaleString()} detail={`↑ ${data.userGrowthPercent}% vs previous 7 days`} hero />
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              <TvMetric label="New users · 7d" value={`+${data.newUsers}`} />
              <TvMetric label="Monthly active · 30d" value={formatCompact(data.monthlyActiveUsers)} />
              <TvMetric label="Visitors · 7d" value={formatCompact(data.visitors)} />
              <TvMetric label="Avg session · 7d" value={formatDuration(data.averageSessionSeconds)} detail={`${data.verificationRatePercent}% verified`} />
            </div>
            {insight == null ? null : <Insight tone="violet">{insight.message}</Insight>}
          </div>
        </GlassPanel>
        <GlassPanel tone="violet" className="h-full">
          <div className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-[clamp(1rem,2vh,2.5rem)] p-[clamp(1.25rem,2vw,5rem)]">
            <TvChartHeader
              title="Audience lifecycle"
              subtitle="Daily activity · trailing 7 days"
              accentClassName="text-violet-200/55"
            />
            <TvStackedBars points={data.lifecycle} colors={["#a78bfa", "#7c3aed", "#c4b5fd"]} labels={["New", "Retained", "Reactivated"]} />
          </div>
        </GlassPanel>
      </div>
    </TvScreenFrame>
  );
}

function RevenuePaymentsScreen({
  data,
  insight,
}: {
  data: NonNullable<TvRevenuePaymentsScreen["data"]>,
  insight: TvRevenuePaymentsScreen["insight"],
}) {
  const financials = data.financials;
  const trend = financials.visibility === "exact" ? financials.revenueTrend : financials.normalizedRevenueTrend;
  return (
    <TvScreenFrame eyebrow="Trailing 30 days" title="Revenue & Payments" description="Commercial momentum and whether applicable payments are collecting." icon={<CurrencyDollarIcon className="h-[1.3em] w-[1.3em]" weight="fill" />} accentClassName="text-emerald-300">
      <div className="grid h-full min-h-0 grid-cols-[0.78fr_1.22fr] gap-[clamp(2rem,5vw,12rem)]">
        <GlassPanel tone="emerald" className="h-full">
          <div className="flex h-full min-h-0 flex-col justify-between p-[clamp(1.5rem,2.3vw,5.5rem)]">
            <TvMetric label="Paid revenue · 30d" value={financials.visibility === "exact" ? formatUsd(financials.paidRevenueCents) : "Hidden"} detail={`${data.revenueChangePercent >= 0 ? "↑" : "↓"} ${Math.abs(data.revenueChangePercent)}% vs previous 30 days${financials.visibility === "exact" ? "" : " · exact values off"}`} hero />
            <div className="grid grid-cols-2 gap-6">
              <TvMetric label="MRR proxy" value={financials.visibility === "exact" ? formatUsd(financials.mrrProxyCents) : "Hidden"} />
              <TvMetric label="Payment success" value={data.paymentSuccess.percent == null ? "Insufficient data" : `${data.paymentSuccess.percent}%`} detail={`${data.paymentSuccess.applicableAttempts} applicable attempts`} />
              <TvMetric label="Active subscriptions" value={data.activeSubscriptions.toLocaleString()} />
              <TvMetric label="New subscriptions" value={`+${data.newSubscriptions}`} detail={`${data.pastDueSubscriptions} past due`} />
            </div>
            {insight == null ? null : <Insight tone="emerald">{insight.message}</Insight>}
          </div>
        </GlassPanel>
        <GlassPanel tone="emerald" className="h-full">
          <div className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-[clamp(1rem,2vh,2.5rem)] p-[clamp(1.25rem,2vw,5rem)]">
            <TvChartHeader
              title="Paid revenue momentum"
              subtitle="Cumulative daily trend · trailing 30 days"
              accentClassName="text-emerald-200/55"
            />
            <TvLineChart points={trend} color="#6ee7b7" label={financials.visibility === "exact" ? "Daily paid revenue" : "Normalized paid revenue direction"} />
          </div>
        </GlassPanel>
      </div>
    </TvScreenFrame>
  );
}

function EmailHealthScreen({
  data,
  insight,
}: {
  data: NonNullable<TvEmailHealthScreen["data"]>,
  insight: TvEmailHealthScreen["insight"],
}) {
  return (
    <TvScreenFrame eyebrow="Seven-day delivery" title="Email Health" description="Whether customer messages are reaching recipients reliably." icon={<EnvelopeSimpleIcon className="h-[1.3em] w-[1.3em]" weight="fill" />} accentClassName="text-amber-300">
      <div className="grid h-full min-h-0 grid-cols-[0.76fr_1.24fr] gap-[clamp(2rem,5vw,12rem)]">
        <GlassPanel tone="amber" className="h-full">
          <div className="flex h-full min-h-0 flex-col justify-between p-[clamp(1.5rem,2.3vw,5.5rem)]">
            <TvMetric label="Delivery rate · 7d" value={data.deliveryRatePercent == null ? "Insufficient data" : `${data.deliveryRatePercent}%`} detail={data.deliveryRatePercent == null ? "At least 20 finished sends required" : `${data.sent.toLocaleString()} finished sends`} hero />
            <div className="grid grid-cols-2 gap-x-8 gap-y-5">
              <TvMetric label="Delivered" value={formatCompact(data.delivered)} />
              <TvMetric label="Bounced" value={formatCompact(data.bounced)} />
              <TvMetric label="Errors" value={formatCompact(data.errors)} />
              <TvMetric label="In progress" value={formatCompact(data.inProgress)} detail="Current sending state" />
            </div>
            {insight == null ? null : <Insight tone="amber">{insight.message}</Insight>}
          </div>
        </GlassPanel>
        <GlassPanel tone="amber" className="h-full">
          <div className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-[clamp(1rem,2vh,2.5rem)] p-[clamp(1.25rem,2vw,5rem)]">
            <TvChartHeader
              title="Email delivery volume"
              subtitle="Daily send status · trailing 7 days"
              accentClassName="text-amber-200/55"
            />
            <TvStackedBars points={data.statusTrend} colors={["#fbbf24", "#fb7185", "#94a3b8"]} labels={["Delivered", "Error", "In progress"]} />
          </div>
        </GlassPanel>
      </div>
    </TvScreenFrame>
  );
}

type TvTerminalSourceStatus = Extract<TvScreenSnapshot["sourceStatus"], "empty" | "unavailable" | "error">;

export type TvSourceStatePresentation =
  | { type: "content" }
  | {
    type: "terminal",
    status: TvTerminalSourceStatus,
    eyebrow: string,
    message: string,
    detail: string,
  };

export function getTvSourceStatePresentation(
  status: TvScreenSnapshot["sourceStatus"],
): TvSourceStatePresentation {
  switch (status) {
    case "empty": {
      return {
        type: "terminal",
        status,
        eyebrow: "Waiting for activity",
        message: "There is no qualifying activity in this reporting window.",
        detail: "TV Mode will display this screen when qualifying activity arrives.",
      };
    }
    case "unavailable": {
      return {
        type: "terminal",
        status,
        eyebrow: "Source unavailable",
        message: "The required Hexclave app is not enabled for this profile.",
        detail: "Configure the required app to enable this screen.",
      };
    }
    case "error": {
      return {
        type: "terminal",
        status,
        eyebrow: "Source error",
        message: "This source could not be measured. The rest of the presentation will continue.",
        detail: "TV Mode will retry this source automatically.",
      };
    }
    case "ready":
    case "insufficient-data":
    case "stale": {
      return { type: "content" };
    }
  }
}

function SourceStateScreen({
  screen,
  presentation,
}: {
  screen: TvScreenSnapshot,
  presentation: Extract<TvSourceStatePresentation, { type: "terminal" }>,
}) {
  const definition = getTvScreenDefinition(screen.id);
  const Icon = definition.icon;
  return (
    <TvScreenFrame eyebrow={presentation.eyebrow} title={definition.displayName} description={definition.description} icon={<Icon className="h-[1.3em] w-[1.3em]" weight="fill" />} accentClassName="text-rose-300">
      <div className="flex h-full items-center justify-center rounded-[2rem] border border-white/[0.08] bg-white/[0.025]">
        <div className="max-w-3xl text-center">
          <ShieldWarningIcon className="mx-auto h-12 w-12 text-white/25" weight="duotone" />
          <p className="mt-5 text-[clamp(1.5rem,2.8vw,7rem)] font-medium tracking-[-0.03em] text-white/82">{presentation.message}</p>
          <p className="mt-4 text-[clamp(0.75rem,0.95vw,2.2rem)] text-white/38">{screen.sourceLabel} · {presentation.detail}</p>
        </div>
      </div>
    </TvScreenFrame>
  );
}

export function renderTvScreen(screen: TvScreenSnapshot): ReactNode {
  const presentation = getTvSourceStatePresentation(screen.sourceStatus);
  if (presentation.type === "terminal") {
    return <SourceStateScreen screen={screen} presentation={presentation} />;
  }
  if (screen.data == null) {
    throw new Error(`TV source "${screen.id}" is "${screen.sourceStatus}" but has no renderable data`);
  }
  switch (screen.id) {
    case "live-pulse": {
      return <LivePulseScreen data={screen.data} insight={screen.insight} />;
    }
    case "audience-momentum": {
      return <AudienceMomentumScreen data={screen.data} insight={screen.insight} />;
    }
    case "revenue-payments": {
      return <RevenuePaymentsScreen data={screen.data} insight={screen.insight} />;
    }
    case "email-health": {
      return <EmailHealthScreen data={screen.data} insight={screen.insight} />;
    }
  }
}
