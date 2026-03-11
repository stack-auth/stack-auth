'use client';

import { AppIcon } from "@/components/app-square";
import { Link } from "@/components/link";
import { useRouter } from "@/components/router";
import { cn, Typography } from "@/components/ui";
import { ALL_APPS_FRONTEND, type AppId, getAppPath } from "@/lib/apps-frontend";
import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { DesignListItemRow } from "@/components/design-components/list";
import { DesignAnalyticsCard, DesignCategoryTabs, DesignChartLegend, useInfiniteListWindow } from "@/components/design-components";
import { CompassIcon, EnvelopeIcon, EnvelopeOpenIcon, GlobeIcon, SquaresFourIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import useResizeObserver from '@react-hook/resize-observer';
import { useUser } from "@stackframe/stack";
import { ALL_APPS } from "@stackframe/stack-shared/dist/apps/apps-config";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp, useProjectId } from "../use-admin-app";
import { GlobeSectionWithData } from "./globe-section-with-data";
import {
  ComposedAnalyticsChart,
  ComposedDataPoint,
  CustomDateRange,
  DataPoint,
  DonutChartDisplay,
  EmailStackedBarChartDisplay,
  EmailStackedDataPoint,
  filterDatapointsByTimeRange,
  filterStackedDatapointsByTimeRange,
  GradientColor,
  LineChartDisplayConfig,
  RevenueHoverChart,
  RevenueHoverDataPoint,
  StackedBarChartDisplay,
  StackedDataPoint,
  TabbedMetricsCard,
  TimeRange,
  TimeRangeToggle,
  VisitorsHoverChart,
  VisitorsHoverDataPoint,
} from "./line-chart";
import { MetricsLoadingFallback } from "./metrics-loading";

// ── Chart configs ────────────────────────────────────────────────────────────

const dailySignUpsConfig: LineChartDisplayConfig = {
  name: 'Daily Sign-Ups',
  chart: {
    activity: {
      label: "Sign-Ups",
      theme: { light: "hsl(221, 83%, 53%)", dark: "hsl(240, 71%, 70%)" },
    },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function sumRange(points: DataPoint[], range: TimeRange, customDateRange: CustomDateRange | null): number {
  return filterDatapointsByTimeRange(points, range, customDateRange).reduce((s, p) => s + p.activity, 0);
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function calculatePeriodDelta(currentValue: number, previousValue: number): number | undefined {
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
    return undefined;
  }
  if (previousValue === 0) {
    return currentValue === 0 ? 0 : undefined;
  }
  return Number((((currentValue - previousValue) / previousValue) * 100).toFixed(1));
}

// ── Compact dual-value stat card ─────────────────────────────────────────────

function DualStatCard({
  label,
  value,
  subLabel,
  subValue,
  gradientColor = "blue",
}: {
  label: string,
  value: string | number,
  subLabel: string,
  subValue: string | number,
  gradientColor?: GradientColor,
}) {
  return (
    <DesignAnalyticsCard gradient={gradientColor} chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}>
      <div className="p-4 flex flex-col gap-1.5 h-full justify-between">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
          {label}
        </span>
        <div>
          <div className="text-2xl font-bold tabular-nums text-foreground leading-none">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-muted-foreground">
            <span>{subLabel}</span>
            <span className="font-semibold text-foreground tabular-nums">
              {typeof subValue === 'number' ? subValue.toLocaleString() : subValue}
            </span>
          </div>
        </div>
      </div>
    </DesignAnalyticsCard>
  );
}

// ── Hero analytics widget (stat pills + composed bar+line chart) ─────────────

type AnalyticsStatPill = {
  label: string,
  value: string,
  delta?: number,
};

function StatCard({
  stat,
  compact = false,
}: {
  stat: AnalyticsStatPill,
  compact?: boolean,
}) {
  return (
    <DesignAnalyticsCard gradient="blue" className="h-full" chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}>
      <div className={cn(
        "flex flex-col justify-between h-full",
        compact ? "px-4 py-3" : "px-5 py-4",
      )}>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
          {stat.label}
        </span>
        <div className="flex items-baseline gap-1.5 mt-1.5">
          <span className="text-xl font-bold tabular-nums text-foreground leading-none">
            {stat.value}
          </span>
          {stat.delta != null && (
            <span className={cn(
              "text-[10px] font-medium tabular-nums leading-none shrink-0",
              stat.delta > 0 ? "text-emerald-600 dark:text-emerald-400" : stat.delta < 0 ? "text-red-500 dark:text-red-400" : "text-muted-foreground"
            )}>
              {stat.delta > 0 ? "+" : ""}{stat.delta}%
            </span>
          )}
        </div>
      </div>
    </DesignAnalyticsCard>
  );
}

type HeroChartMode = 'default' | 'dau' | 'visitors' | 'revenue';

function HeroInChartPill({
  label,
  value,
  delta,
  color,
  isHovered,
  onMouseEnter,
}: {
  label: string,
  value: string,
  delta?: number,
  color: string,
  isHovered: boolean,
  onMouseEnter: () => void,
}) {
  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      className={cn(
        "group/pill flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-colors hover:transition-none cursor-default select-none flex-1",
        isHovered
          ? "bg-foreground/[0.06] ring-1 ring-foreground/[0.09]"
          : "hover:bg-foreground/[0.03]"
      )}
    >
      {/* Color dot */}
      <span
        className={cn(
          "h-2 w-2 rounded-full shrink-0 transition-transform",
          isHovered ? "scale-125" : ""
        )}
        style={{ backgroundColor: color }}
      />
      {/* Label + value stacked */}
      <div className="flex flex-col gap-0.5 text-left min-w-0">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-none">
          {label}
        </span>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-bold tabular-nums text-foreground leading-none">
            {value}
          </span>
          {delta != null && (
            <span className={cn(
              "text-[10px] font-semibold tabular-nums leading-none shrink-0",
              delta > 0 ? "text-emerald-500 dark:text-emerald-400" : delta < 0 ? "text-red-500 dark:text-red-400" : "text-muted-foreground"
            )}>
              {delta > 0 ? "+" : ""}{delta}%
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function HeroAnalyticsWidget({
  composedData,
  dauStackedData,
  visitorsData,
  revenueData,
  outerStats,
  dauLabel,
  dauTotal,
  visitorsLabel,
  revenueLabel,
  dauDelta,
  visitorsTotal,
  revenueTotal,
  visitorsDelta,
  revenueDelta,
  compact = false,
}: {
  composedData: ComposedDataPoint[],
  dauStackedData: StackedDataPoint[],
  visitorsData: VisitorsHoverDataPoint[],
  revenueData: RevenueHoverDataPoint[],
  outerStats: AnalyticsStatPill[],
  dauLabel: string,
  dauTotal: string,
  visitorsLabel: string,
  revenueLabel: string,
  dauDelta?: number,
  visitorsTotal: string,
  revenueTotal: string,
  visitorsDelta?: number,
  revenueDelta?: number,
  compact?: boolean,
}) {
  const [chartMode, setChartMode] = useState<HeroChartMode>('default');
  const [fadingOut, setFadingOut] = useState(false);
  const [displayMode, setDisplayMode] = useState<HeroChartMode>('default');
  const [fadingIn, setFadingIn] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeInRaf1Ref = useRef<number | null>(null);
  const fadeInRaf2Ref = useRef<number | null>(null);
  const FADE_OUT_MS = 140;

  const switchToMode = (mode: HeroChartMode) => {
    if (mode === displayMode) return;
    if (fadeTimerRef.current != null) {
      clearTimeout(fadeTimerRef.current);
    }
    setFadingOut(true);
    fadeTimerRef.current = setTimeout(() => {
      setDisplayMode(mode);
      setFadingOut(false);
      setFadingIn(true);
      // Let the browser paint the new chart at opacity-0 first, then fade in
      fadeInRaf1Ref.current = requestAnimationFrame(() => {
        fadeInRaf2Ref.current = requestAnimationFrame(() => {
          setFadingIn(false);
          fadeInRaf2Ref.current = null;
        });
        fadeInRaf1Ref.current = null;
      });
      fadeTimerRef.current = null;
    }, FADE_OUT_MS);
  };

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current != null) {
        clearTimeout(fadeTimerRef.current);
      }
      if (fadeInRaf1Ref.current != null) {
        cancelAnimationFrame(fadeInRaf1Ref.current);
      }
      if (fadeInRaf2Ref.current != null) {
        cancelAnimationFrame(fadeInRaf2Ref.current);
      }
    };
  }, []);

  const handlePillMouseEnter = (mode: 'dau' | 'visitors' | 'revenue') => {
    setChartMode(mode);
    switchToMode(mode);
  };

  const handlePillMouseLeave = () => {
    setChartMode('default');
    switchToMode('default');
  };

  const dauColor = "hsl(152, 38%, 52%)";
  const visitorsColor = "hsl(210, 84%, 64%)";
  const revenueColor = "hsl(268, 82%, 66%)";

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Outer stat cards row */}
      <div className={cn(
        "grid gap-3",
        outerStats.length > 3 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3",
      )}>
        {outerStats.map((stat) => (
          <StatCard key={stat.label} stat={stat} compact={compact} />
        ))}
      </div>

      {/* Chart card with in-card pills */}
      <DesignAnalyticsCard
        gradient="blue"
        className="flex-1 min-h-0"
        chart={{
          type: displayMode === "dau" ? "stacked-bar" : displayMode === "default" ? "composed" : "bar",
          tooltipType: displayMode === "dau"
            ? "stacked"
            : displayMode === "visitors"
              ? "visitors"
              : displayMode === "revenue"
                ? "revenue"
                : "composed",
          highlightMode: "mixed",
          averages: { movingAverage: true, sevenDayAverage: true },
        }}
      >
        <div
          className={cn(
            "flex-1 min-h-0 flex flex-col",
            compact ? "px-4 pt-2 pb-2" : "px-4 pt-3 pb-3",
          )}
          onMouseLeave={handlePillMouseLeave}
        >
          {/* In-card pills row */}
          <div className="flex items-stretch mb-2 -mx-1">
            <HeroInChartPill
              label={dauLabel}
              value={dauTotal}
              delta={dauDelta}
              color={dauColor}
              isHovered={chartMode === 'dau'}
              onMouseEnter={() => handlePillMouseEnter('dau')}
            />
            <div className="w-px bg-foreground/[0.07] shrink-0 my-1.5 mx-1" />
            <HeroInChartPill
              label={visitorsLabel}
              value={visitorsTotal}
              delta={visitorsDelta}
              color={visitorsColor}
              isHovered={chartMode === 'visitors'}
              onMouseEnter={() => handlePillMouseEnter('visitors')}
            />
            <div className="w-px bg-foreground/[0.07] shrink-0 my-1.5 mx-1" />
            <HeroInChartPill
              label={revenueLabel}
              value={revenueTotal}
              delta={revenueDelta}
              color={revenueColor}
              isHovered={chartMode === 'revenue'}
              onMouseEnter={() => handlePillMouseEnter('revenue')}
            />
          </div>

          {/* Chart area with fade transition */}
          <div className="flex-1 min-h-0 relative" style={{ minHeight: 0 }}>
            <div
              className={cn(
                "h-full flex flex-col",
                fadingOut
                  ? "opacity-0 -translate-y-0.5 transition-[opacity,transform] duration-[140ms] ease-in"
                  : fadingIn
                    ? "opacity-0 translate-y-0.5"
                    : "opacity-100 translate-y-0 transition-[opacity,transform] duration-[260ms] ease-out",
              )}
            >
              {displayMode === 'default' && (
                composedData.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <Typography variant="secondary" className="text-xs">No data available</Typography>
                  </div>
                ) : (
                  <ComposedAnalyticsChart
                    datapoints={composedData}
                    compact={compact}
                  />
                )
              )}
              {displayMode === 'dau' && (
                dauStackedData.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <Typography variant="secondary" className="text-xs">No daily active user data available</Typography>
                  </div>
                ) : (
                  <StackedBarChartDisplay
                    datapoints={dauStackedData}
                    compact={compact}
                  />
                )
              )}
              {displayMode === 'visitors' && (
                visitorsData.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <Typography variant="secondary" className="text-xs">No visitor data available</Typography>
                  </div>
                ) : (
                  <VisitorsHoverChart
                    datapoints={visitorsData}
                    compact={compact}
                  />
                )
              )}
              {displayMode === 'revenue' && (
                revenueData.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <Typography variant="secondary" className="text-xs">No revenue data available</Typography>
                  </div>
                ) : (
                  <RevenueHoverChart
                    datapoints={revenueData}
                    compact={compact}
                  />
                )
              )}
            </div>
          </div>
        </div>
      </DesignAnalyticsCard>
    </div>
  );
}

// ── Email list row ────────────────────────────────────────────────────────────

type EmailItem = { id: string, subject: string, status: string };

const emailStatusConfig = new Map<string, {
  label: string,
  icon: React.ElementType,
  bg: string,
  text: string,
  dot: string,
}>([
  ['sent',         { label: 'Sent',       icon: EnvelopeIcon,      bg: 'bg-blue-500/10 dark:bg-blue-500/15',    text: 'text-blue-600 dark:text-blue-400',    dot: 'bg-blue-500' }],
  ['opened',       { label: 'Opened',     icon: EnvelopeOpenIcon,  bg: 'bg-emerald-500/10 dark:bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' }],
  ['delivered',    { label: 'Delivered',  icon: EnvelopeIcon,      bg: 'bg-emerald-500/10 dark:bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' }],
  ['bounced',      { label: 'Bounced',    icon: XCircleIcon,       bg: 'bg-red-500/10 dark:bg-red-500/15',      text: 'text-red-600 dark:text-red-400',      dot: 'bg-red-500' }],
  ['error',        { label: 'Error',      icon: WarningCircleIcon, bg: 'bg-amber-500/10 dark:bg-amber-500/15',  text: 'text-amber-600 dark:text-amber-400',  dot: 'bg-amber-500' }],
  ['in_progress',  { label: 'Sending',    icon: EnvelopeIcon,      bg: 'bg-sky-500/10 dark:bg-sky-500/15',      text: 'text-sky-600 dark:text-sky-400',      dot: 'bg-sky-400' }],
]);

const fallbackEmailStatus = { label: 'Unknown', icon: EnvelopeIcon, bg: 'bg-foreground/[0.06]', text: 'text-muted-foreground', dot: 'bg-muted-foreground' };

function EmailListRow({ email }: { email: EmailItem }) {
  const key = email.status.toLowerCase().replace(/\s+/g, '_');
  const cfg = emailStatusConfig.get(key) ?? fallbackEmailStatus;
  const StatusIcon = cfg.icon;

  return (
    <div className="flex items-center gap-3 px-1 py-2.5 group">
      {/* Icon badge */}
      <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0", cfg.bg)}>
        <StatusIcon className={cn("h-3.5 w-3.5", cfg.text)} weight="fill" />
      </div>

      {/* Subject */}
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium truncate text-foreground leading-tight">
          {email.subject}
        </div>
      </div>

      {/* Status pill */}
      <div className={cn(
        "shrink-0 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        cfg.bg, cfg.text
      )}>
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
        {cfg.label}
      </div>
    </div>
  );
}

// ── Tabbed Emails card (stacked bar chart + recent list) ─────────────────────

const emailLegendItems = [
  { key: 'ok',          label: 'Delivered', color: 'hsl(168, 38%, 48%)' },
  { key: 'in_progress', label: 'Sending',   color: 'hsl(213, 38%, 52%)' },
  { key: 'error',       label: 'Error',     color: 'hsl(355, 45%, 52%)' },
] as const;

function TabbedEmailsCard({
  stackedChartData,
  recentEmails,
  timeRange,
  customDateRange = null,
  compact = false,
}: {
  stackedChartData: EmailStackedDataPoint[],
  recentEmails: Array<{ id: string, subject: string, status: string }>,
  timeRange: TimeRange,
  customDateRange?: CustomDateRange | null,
  compact?: boolean,
}) {
  const [view, setView] = useState<'chart' | 'list'>('chart');
  const filteredDatapoints = filterStackedDatapointsByTimeRange(stackedChartData, timeRange, customDateRange);

  const listWindow = useInfiniteListWindow(recentEmails.length, view === "list" ? "list" : "chart", view === "list");

  return (
    <DesignAnalyticsCard
      gradient="orange"
      className="h-full min-h-0 flex flex-col"
      chart={{
        type: view === "chart" ? "stacked-bar" : "none",
        tooltipType: view === "chart" ? "stacked" : "none",
        highlightMode: view === "chart" ? "bar-segment" : "none",
      }}
    >
      <div className={cn("flex items-center justify-between border-b border-foreground/[0.05]", compact ? "px-4" : "px-5")}>
        <DesignCategoryTabs
          categories={[
            { id: "chart", label: "Emails Sent" },
            { id: "list", label: "Recent Emails" },
          ]}
          selectedCategory={view}
          onSelect={(selectedId) => {
            if (selectedId === "chart" || selectedId === "list") {
              setView(selectedId);
              return;
            }
            throw new Error(`Unsupported emails tab selected: ${selectedId}`);
          }}
          showBadge={false}
          size="sm"
          glassmorphic={false}
          gradient="blue"
          className="flex-1 min-w-0 border-0 [&>button]:rounded-none [&>button]:px-3 [&>button]:py-3.5 [&>button]:text-xs"
        />
      </div>
      {view === 'chart' && (
        <DesignChartLegend items={emailLegendItems} compact={compact} />
      )}
      <div className={cn(
        view === 'chart'
          ? (compact ? "px-4 pt-1.5 pb-1" : "px-5 pt-2 pb-2")
          : (compact ? "px-4 pt-1 pb-2" : "px-5 pt-2 pb-3"),
        "flex flex-col flex-1 min-h-0",
        view === 'chart' ? "overflow-visible" : "overflow-hidden"
      )}>
        {view === 'chart' ? (
          filteredDatapoints.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <Typography variant="secondary" className="text-xs">No email data for this period</Typography>
            </div>
          ) : (
            <EmailStackedBarChartDisplay datapoints={filteredDatapoints} compact={compact} />
          )
        ) : (
          <div ref={listWindow.scrollRef} className="flex-1 overflow-y-auto min-h-0 pr-1 -mr-1">
            {recentEmails.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <Typography variant="secondary" className="text-xs">No recent emails</Typography>
              </div>
            ) : (
              <div className="divide-y divide-foreground/[0.04]">
                {recentEmails.slice(0, listWindow.visibleCount).map((email) => (
                  <EmailListRow key={email.id} email={email} />
                ))}
                {listWindow.hasMore && (
                  <div ref={listWindow.sentinelRef} className="py-2 text-center">
                    <Typography variant="secondary" className="text-[10px]">
                      Loading more...
                    </Typography>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </DesignAnalyticsCard>
  );
}

// ── Email breakdown with rate footer ─────────────────────────────────────────

function EmailBreakdownCard({
  deliverabilityStatus,
  bounceRate,
  clickRate,
}: {
  deliverabilityStatus: Record<string, number>,
  bounceRate: number,
  clickRate: number,
}) {
  const items = [
    { label: 'Delivered', count: deliverabilityStatus.delivered, color: '#10b981' },
    { label: 'Bounced', count: deliverabilityStatus.bounced, color: '#ef4444' },
    { label: 'In Progress', count: deliverabilityStatus.in_progress, color: '#06b6d4' },
    { label: 'Error', count: deliverabilityStatus.error, color: '#f59e0b' },
  ];
  const total = items.reduce((s, i) => s + i.count, 0);

  return (
    <DesignAnalyticsCard gradient="orange" className="h-full" chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}>
      <div className="px-4 py-3 border-b border-foreground/[0.05]">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email Delivery</span>
      </div>
      <div className="p-4 pt-3 flex-1 flex flex-col gap-2.5">
        {total === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <Typography variant="secondary" className="text-xs">No email data</Typography>
          </div>
        ) : (
          <>
            <div className="flex h-2 rounded-full overflow-hidden gap-px">
              {items.filter(i => i.count > 0).map((item, idx) => (
                <div key={idx} style={{ width: `${(item.count / total) * 100}%`, backgroundColor: item.color }} />
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              {items.filter(i => i.count > 0).map((item, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                    <span className="text-[11px] text-foreground">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {((item.count / total) * 100).toFixed(0)}%
                    </span>
                    <span className="text-[11px] font-medium text-foreground tabular-nums">
                      {item.count.toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="mt-auto pt-2 border-t border-foreground/[0.05] grid grid-cols-2 gap-2 text-center">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Bounce Rate</div>
            <div className="text-sm font-semibold tabular-nums">{bounceRate}%</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Click Rate</div>
            <div className="text-sm font-semibold tabular-nums">{clickRate}%</div>
          </div>
        </div>
      </div>
    </DesignAnalyticsCard>
  );
}

// ── Tabbed DAU stacked chart + recently active list ──────────────────────────
// ── Top Referrers with analytics footer ──────────────────────────────────────

function ReferrersWithAnalyticsCard({
  topReferrers,
}: {
  topReferrers: Array<{ referrer: string, visitors: number }>,
}) {
  const listWindow = useInfiniteListWindow(topReferrers.length);

  return (
    <DesignAnalyticsCard gradient="purple" className="h-full" chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}>
      <div className="px-4 py-3 border-b border-foreground/[0.05]">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Top Referrers</span>
      </div>
      <div ref={listWindow.scrollRef} className="p-4 pt-3 flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
        {topReferrers.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <Typography variant="secondary" className="text-xs">No referrer data</Typography>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {topReferrers.slice(0, listWindow.visibleCount).map((item) => {
              const max = topReferrers[0].visitors;
              return (
                <div key={item.referrer} className="relative flex items-center justify-between rounded-lg px-2.5 py-1.5 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-lg bg-purple-500/10 dark:bg-purple-400/10"
                    style={{ width: max > 0 ? `${(item.visitors / max) * 100}%` : '0%' }}
                  />
                  <span className="relative text-[11px] text-foreground truncate max-w-[65%]">{item.referrer}</span>
                  <span className="relative text-[11px] font-medium text-foreground tabular-nums">{item.visitors.toLocaleString()}</span>
                </div>
              );
            })}
            {listWindow.hasMore && (
              <div ref={listWindow.sentinelRef} className="py-2 text-center">
                <Typography variant="secondary" className="text-[10px]">
                  Loading more...
                </Typography>
              </div>
            )}
          </div>
        )}
      </div>
    </DesignAnalyticsCard>
  );
}

// ── Quick Access Apps ──────────────────────────────────────────────────────────

function QuickAccessApps({ projectId, installedApps }: { projectId: string, installedApps: AppId[] }) {
  return (
    <div className="shrink-0">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-lg bg-foreground/[0.04]">
          <SquaresFourIcon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Quick Access
        </span>
      </div>

      {installedApps.length === 0 ? (
        <div className="flex items-center justify-center py-8 rounded-xl bg-foreground/[0.02] ring-1 ring-foreground/[0.06]">
          <Typography variant="secondary" className="text-sm text-center">
            No apps installed
          </Typography>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2">
          {installedApps.map((appId) => {
            const appFrontend = ALL_APPS_FRONTEND[appId];
            const appPath = getAppPath(projectId, appFrontend);
            const app = ALL_APPS[appId];
            return (
              <Link
                key={appId}
                href={appPath}
                className="group flex flex-col items-center gap-2.5 pt-3 pb-2 rounded-xl hover:bg-foreground/[0.03] transition-all duration-150 hover:transition-none"
                title={app.displayName}
              >
                <div className="relative transition-transform duration-150 group-hover:transition-none group-hover:scale-105">
                  <AppIcon
                    appId={appId}
                    variant="installed"
                    className="shadow-sm group-hover:shadow-[0_0_20px_rgba(59,130,246,0.45)] group-hover:brightness-110 group-hover:saturate-110 transition-all duration-150 group-hover:transition-none"
                  />
                </div>
                <span
                  className="text-[11px] font-medium text-center group-hover:text-foreground transition-colors duration-150 group-hover:transition-none leading-tight w-full"
                  title={app.displayName}
                >
                  {app.displayName}
                </span>
              </Link>
            );
          })}

          <Link
            href={`/projects/${projectId}/apps`}
            className="group flex flex-col items-center gap-2.5 pt-3 pb-2 rounded-xl hover:bg-foreground/[0.03] transition-all duration-150 hover:transition-none"
            title="Explore apps"
          >
            <div className="relative transition-transform duration-150 group-hover:transition-none group-hover:scale-105">
              <div className="flex items-center justify-center w-[72px] h-[72px]">
                <CompassIcon className="w-[30px] h-[30px] text-muted-foreground group-hover:text-foreground transition-colors duration-150 group-hover:transition-none" />
              </div>
            </div>
            <span className="text-[11px] font-medium text-center text-muted-foreground group-hover:text-foreground transition-colors duration-150 group-hover:transition-none leading-tight w-full">
              Explore
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MetricsPage(props: { toSetup: () => void }) {
  const includeAnonymous = false;
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [customDateRange, setCustomDateRange] = useState<CustomDateRange | null>(null);
  const user = useUser();

  const displayName = user?.displayName || user?.primaryEmail || "User";
  const truncatedName = displayName.length > 30 ? `${displayName.slice(0, 30)}...` : displayName;

  return (
    <PageLayout
      title={`Welcome back, ${truncatedName}!`}
      actions={
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <TimeRangeToggle
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
            customDateRange={customDateRange}
            onCustomDateRangeChange={setCustomDateRange}
          />
        </div>
      }
      fillWidth
    >
      <Suspense fallback={<MetricsLoadingFallback />}>
        <MetricsContent includeAnonymous={includeAnonymous} timeRange={timeRange} customDateRange={customDateRange} />
      </Suspense>
    </PageLayout>
  );
}

// ── Metrics content ──────────────────────────────────────────────────────────

function MetricsContent({
  includeAnonymous,
  timeRange,
  customDateRange,
}: {
  includeAnonymous: boolean,
  timeRange: TimeRange,
  customDateRange: CustomDateRange | null,
}) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const projectId = useProjectId();
  const router = useRouter();
  const data = (adminApp as any)[stackAppInternalsSymbol].useMetrics(includeAnonymous);
  const installedApps = useMemo(
    () => typedEntries(config.apps.installed)
      .filter(([_, appConfig]) => appConfig?.enabled === true)
      .map(([appId]) => appId as AppId),
    [config.apps.installed]
  );

  const auth = data.auth_overview ?? {};
  const payments = data.payments_overview ?? {};
  const email = data.email_overview ?? {};
  const analytics = data.analytics_overview ?? {};

  const recentEmails = (email.recent_emails ?? []) as Array<{ id: string, subject: string, status: string }>;
  const topReferrers = (analytics.top_referrers ?? []) as Array<{ referrer: string, visitors: number }>;

  const signUpsInRange = sumRange(data.daily_users ?? [], timeRange, customDateRange);

  // ── DAU split stacked data for sign-ups chart ─────────────────────────────
  const dauSplit = (auth.daily_active_users_split ?? {}) as {
    new?: DataPoint[],
    retained?: DataPoint[],
    reactivated?: DataPoint[],
  };
  const dauStackedData = useMemo<StackedDataPoint[]>(() => {
    const newPoints = dauSplit.new ?? [];
    const retainedPoints = dauSplit.retained ?? [];
    const reactivatedPoints = dauSplit.reactivated ?? [];
    const dateSet = new Set([
      ...newPoints.map(d => d.date),
      ...retainedPoints.map(d => d.date),
      ...reactivatedPoints.map(d => d.date),
    ]);
    const newMap = new Map(newPoints.map(d => [d.date, d.activity]));
    const retainedMap = new Map(retainedPoints.map(d => [d.date, d.activity]));
    const reactivatedMap = new Map(reactivatedPoints.map(d => [d.date, d.activity]));
    return [...dateSet].sort().map(date => ({
      date,
      new: newMap.get(date) ?? 0,
      retained: retainedMap.get(date) ?? 0,
      reactivated: reactivatedMap.get(date) ?? 0,
    }));
  }, [dauSplit.new, dauSplit.retained, dauSplit.reactivated]);
  const signUpsStackedData = useMemo<StackedDataPoint[]>(
    () => (data.daily_users ?? []).map((point: DataPoint) => ({
      date: point.date,
      new: point.activity,
      retained: 0,
      reactivated: 0,
    })),
    [data.daily_users],
  );
  const filteredDauStackedData = useMemo<StackedDataPoint[]>(
    () => filterStackedDatapointsByTimeRange(dauStackedData, timeRange, customDateRange),
    [dauStackedData, timeRange, customDateRange],
  );
  const dauTotalsByDate = useMemo<Map<string, number>>(
    () => new Map(dauStackedData.map((point) => [point.date, point.new + point.retained + point.reactivated])),
    [dauStackedData],
  );

  // ── Email stacked data (ok/error/in_progress per day) ────────────────────
  const emailStackedData = useMemo<EmailStackedDataPoint[]>(() => {
    return (email.daily_emails_by_status ?? []) as EmailStackedDataPoint[];
  }, [email.daily_emails_by_status]);

  // ── Composed chart data (visitors bars + revenue line) ───────────────────
  const allComposedData = useMemo<ComposedDataPoint[]>(() => {
    const analyticsObj = data.analytics_overview ?? {};
    const dailyRev = (analyticsObj.daily_revenue ?? []) as Array<{ date: string, new_cents: number, refund_cents: number }>;
    const dailyVis = (analyticsObj.daily_visitors ?? []) as DataPoint[];

    const visitorMap = new Map(dailyVis.map(d => [d.date, d.activity]));
    const revenueMap = new Map(dailyRev.map(d => [d.date, d]));

    const allDates = new Set([
      ...dailyVis.map(d => d.date),
      ...dailyRev.map(d => d.date),
      ...dauStackedData.map(d => d.date),
    ]);

    const points = [...allDates].map(date => ({
      date,
      visitors: visitorMap.get(date) ?? 0,
      new_cents: revenueMap.get(date)?.new_cents ?? 0,
      refund_cents: revenueMap.get(date)?.refund_cents ?? 0,
      dau: dauTotalsByDate.get(date) ?? 0,
    })).sort((a, b) => stringCompare(a.date, b.date));

    return points;
  }, [data.analytics_overview, dauStackedData, dauTotalsByDate]);
  const composedData = useMemo<ComposedDataPoint[]>(
    () => filterStackedDatapointsByTimeRange(allComposedData, timeRange, customDateRange),
    [allComposedData, timeRange, customDateRange],
  );

  const topCountries = useMemo<Array<{ country_code: string, count: number }>>(() => {
    const rawCountryCounts = data.users_by_country;
    if (typeof rawCountryCounts !== "object" || rawCountryCounts == null) {
      return [];
    }

    const countries: Array<{ country_code: string, count: number }> = [];
    for (const [countryCode, count] of Object.entries(rawCountryCounts)) {
      if (typeof countryCode !== "string" || countryCode.length === 0) continue;
      if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) continue;
      countries.push({ country_code: countryCode.toUpperCase(), count });
    }

    countries.sort((a, b) => b.count - a.count || stringCompare(a.country_code, b.country_code));
    return countries.slice(0, 3);
  }, [data.users_by_country]);

  // ── Visitors hover chart data (page views with top countries) ─────────────
  const visitorsHoverData = useMemo<VisitorsHoverDataPoint[]>(() => {
    const analyticsObj = data.analytics_overview ?? {};
    const dailyPv = (analyticsObj.daily_page_views ?? []) as DataPoint[];

    const pvMap = new Map(dailyPv.map(d => [d.date, d.activity]));
    const allDates = new Set(dailyPv.map(d => d.date));

    const points = [...allDates].map(date => ({
      date,
      page_views: pvMap.get(date) ?? 0,
      top_countries: topCountries,
    })).sort((a, b) => stringCompare(a.date, b.date));

    return filterStackedDatapointsByTimeRange(points, timeRange, customDateRange);
  }, [data.analytics_overview, timeRange, customDateRange, topCountries]);

  // ── Revenue hover chart data (new_cents + refund_cents) ───────────────────
  const revenueHoverData = useMemo<RevenueHoverDataPoint[]>(() => {
    const analyticsObj = data.analytics_overview ?? {};
    const dailyRev = (analyticsObj.daily_revenue ?? []) as Array<{ date: string, new_cents: number, refund_cents: number }>;

    const points = dailyRev.map(d => ({
      date: d.date,
      new_cents: d.new_cents,
      refund_cents: d.refund_cents,
    })).sort((a, b) => stringCompare(a.date, b.date));

    return filterStackedDatapointsByTimeRange(points, timeRange, customDateRange);
  }, [data.analytics_overview, timeRange, customDateRange]);

  // ── Hero outer stats: MAUs, Total Emails sent, Session time ───────────────
  const heroOuterStats = useMemo<AnalyticsStatPill[]>(() => {
    const analyticsObj = data.analytics_overview ?? {};
    const deltasObj = (analyticsObj.deltas ?? {}) as Record<string, number>;
    const mau = (auth.mau ?? 0) as number;
    const totalEmailsSent = (email.emails_sent ?? 0) as number;
    return [
      {
        label: "Monthly active users",
        value: formatCompact(mau),
      },
      {
        label: "Total Emails Sent",
        value: formatCompact(totalEmailsSent),
      },
      {
        label: "Avg. Session time",
        value: formatSeconds(analyticsObj.avg_session_seconds ?? 0),
      },
    ];
  }, [auth.mau, email.emails_sent, data.analytics_overview]);

  // ── In-chart pill values: Visitors and Revenue ────────────────────────────
  const inChartPillValues = useMemo(() => {
    const latestDauPoint = dauStackedData.at(-1);
    const latestDau = latestDauPoint == null
      ? 0
      : latestDauPoint.new + latestDauPoint.retained + latestDauPoint.reactivated;
    const previousDauPoint = dauStackedData.at(-2);
    const previousDau = previousDauPoint == null
      ? undefined
      : previousDauPoint.new + previousDauPoint.retained + previousDauPoint.reactivated;
    const visitorsTotalInRange = composedData.reduce((sum, row) => sum + row.visitors, 0);
    const totalRevenueCentsInRange = composedData.reduce((sum, row) => sum + row.new_cents, 0);

    const composedIndexByDate = new Map(allComposedData.map((row, index) => [row.date, index]));
    const firstComposedPoint = composedData.at(0);
    const composedCurrentStartIndex = firstComposedPoint == null ? -1 : (composedIndexByDate.get(firstComposedPoint.date) ?? -1);
    const composedCurrentLength = composedData.length;
    const composedPreviousStartIndex = composedCurrentStartIndex - composedCurrentLength;
    const composedPreviousEndIndex = composedCurrentStartIndex - 1;
    const previousComposedWindow = composedPreviousStartIndex < 0
      ? []
      : allComposedData.slice(composedPreviousStartIndex, composedPreviousEndIndex + 1);
    const hasFullPreviousComposedWindow = previousComposedWindow.length === composedCurrentLength && composedCurrentLength > 0;
    const previousVisitorsTotal = previousComposedWindow.reduce((sum, row) => sum + row.visitors, 0);
    const previousRevenueTotalCents = previousComposedWindow.reduce((sum, row) => sum + row.new_cents, 0);

    return {
      // This pill is a point-in-time metric (latest day), not a range aggregate.
      dauTotal: formatCompact(latestDau),
      dauLabel: "Daily Active Users",
      // DAU delta is day-over-day and independent from the selected time range.
      dauDelta: previousDau == null ? undefined : calculatePeriodDelta(latestDau, previousDau),
      visitorsTotal: formatCompact(visitorsTotalInRange),
      visitorsLabel: "Unique Visitors",
      visitorsDelta: hasFullPreviousComposedWindow ? calculatePeriodDelta(visitorsTotalInRange, previousVisitorsTotal) : undefined,
      revenueTotal: formatUsdFromCents(totalRevenueCentsInRange),
      revenueLabel: "Revenue",
      revenueDelta: hasFullPreviousComposedWindow ? calculatePeriodDelta(totalRevenueCentsInRange, previousRevenueTotalCents) : undefined,
    };
  }, [allComposedData, composedData, dauStackedData]);

  // ── Globe visibility ──────────────────────────────────────────────────────
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [gridContainerWidth, setGridContainerWidth] = useState(0);
  const [isLgViewport, setIsLgViewport] = useState(false);
  useLayoutEffect(() => {
    setGridContainerWidth(gridContainerRef.current?.getBoundingClientRect().width ?? 0);
  }, []);
  useLayoutEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const updateViewportMatch = () => {
      setIsLgViewport(mediaQuery.matches);
    };

    updateViewportMatch();
    mediaQuery.addEventListener("change", updateViewportMatch);
    return () => {
      mediaQuery.removeEventListener("change", updateViewportMatch);
    };
  }, []);
  useResizeObserver(gridContainerRef, (entry) => setGridContainerWidth(entry.contentRect.width));

  // Show the globe when the 5-column slot is wide enough to look good
  const GLOBE_MIN_WIDTH = 352.5;
  const globeColumnWidth = (() => {
    if (!gridContainerWidth) return 0;
    const gap = 20;
    const availableWidth = gridContainerWidth - gap * 11;
    return (availableWidth / 12) * 5 + gap * 4;
  })();
  const shouldShowGlobe = isLgViewport && globeColumnWidth >= GLOBE_MIN_WIDTH;
  const heroOuterStatsForLayout = useMemo<AnalyticsStatPill[]>(() => {
    if (shouldShowGlobe) {
      return heroOuterStats;
    }

    return [
      {
        label: "Total Users",
        value: formatCompact(data.total_users ?? 0),
      },
      ...heroOuterStats,
    ];
  }, [shouldShowGlobe, heroOuterStats, data.total_users]);

  return (
    <div className="pb-6 flex flex-col gap-5">

      {/* ──────────────────────────────────────────────────────────────────────
          HERO — Globe + KPIs + Daily Active Users (stacked bar)
         ────────────────────────────────────────────────────────────────────── */}
      <div
        ref={gridContainerRef}
        className={cn(
          "grid gap-4 sm:gap-5 grid-cols-1 lg:grid-cols-12",
        )}
        style={shouldShowGlobe
          ? { minHeight: Math.max(400, Math.round(globeColumnWidth)) }
          : { minHeight: 400 }}
      >
        {shouldShowGlobe && (
          <div className="hidden lg:flex lg:col-span-5 h-full relative">
            <div className="absolute inset-0 flex items-start justify-center">
              <GlobeSectionWithData includeAnonymous={includeAnonymous} />
            </div>
            <div className="absolute top-0 left-0 px-1 z-10">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-foreground/[0.04]">
                  <GlobeIcon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Total Users
                </span>
              </div>
              <div className="text-4xl font-bold tracking-tight text-foreground pl-0.5">
                {(data.total_users ?? 0).toLocaleString()}
              </div>
            </div>
          </div>
        )}

        <div className={cn(
          "h-full",
          shouldShowGlobe ? "lg:col-span-7" : "lg:col-span-12",
        )}>
          <HeroAnalyticsWidget
            composedData={composedData}
            dauStackedData={filteredDauStackedData}
            visitorsData={visitorsHoverData}
            revenueData={revenueHoverData}
            outerStats={heroOuterStatsForLayout}
            dauLabel={inChartPillValues.dauLabel}
            dauTotal={inChartPillValues.dauTotal}
            visitorsLabel={inChartPillValues.visitorsLabel}
            revenueLabel={inChartPillValues.revenueLabel}
            dauDelta={inChartPillValues.dauDelta}
            visitorsTotal={inChartPillValues.visitorsTotal}
            revenueTotal={inChartPillValues.revenueTotal}
            visitorsDelta={inChartPillValues.visitorsDelta}
            revenueDelta={inChartPillValues.revenueDelta}
            compact={shouldShowGlobe}
          />
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────
          QUICK ACCESS — App shortcuts
         ────────────────────────────────────────────────────────────────────── */}
      <QuickAccessApps projectId={projectId} installedApps={installedApps} />

      {/* ──────────────────────────────────────────────────────────────────────
          ROW 2 — Daily Sign-ups + Emails trend
         ────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0 lg:h-[340px]">
        <div className="min-h-[340px] lg:min-h-0 lg:h-full">
          <TabbedMetricsCard
            config={dailySignUpsConfig}
            chartData={data.daily_users ?? []}
            stackedChartData={signUpsStackedData}
            stackedLegendItems={[
              { key: "new", label: "Sign-Ups", color: "hsl(152, 38%, 52%)" },
            ]}
            listData={data.recently_registered ?? []}
            listTitle="Recent Sign-Ups"
            projectId={projectId}
            router={router}
            compact
            gradientColor="blue"
            timeRange={timeRange}
            customDateRange={customDateRange}
          />
        </div>
        <div className="min-h-[340px] lg:min-h-0 lg:h-full">
          <TabbedEmailsCard
            stackedChartData={emailStackedData}
            recentEmails={recentEmails}
            timeRange={timeRange}
            customDateRange={customDateRange}
            compact
          />
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────
          ROW 3 — Breakdown
         ────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DonutChartDisplay
          datapoints={(data.login_methods ?? []) as { method: string, count: number }[]}
          compact
          height={180}
          gradientColor="blue"
        />
        <EmailBreakdownCard
          deliverabilityStatus={email.deliverability_status ?? {}}
          bounceRate={email.bounce_rate ?? 0}
          clickRate={email.click_rate ?? 0}
        />
        <ReferrersWithAnalyticsCard
          topReferrers={topReferrers}
        />
      </div>
    </div>
  );
}
