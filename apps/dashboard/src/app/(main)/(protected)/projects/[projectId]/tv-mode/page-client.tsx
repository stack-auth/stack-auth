"use client";

import { DesignAlert, DesignButton } from "@/components/design-components";
import { useMetricsOrThrow } from "@/lib/hexclave-app-internals";
import { ArrowsOutIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { Suspense, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

function lastActivity(points: readonly { activity: number }[]): number {
  return points[points.length - 1]?.activity ?? 0;
}

function TvMetric({ label, value, hint }: { label: string, value: string, hint: string }) {
  return (
    <div className="rounded-2xl bg-foreground/[0.03] px-5 py-6 ring-1 ring-foreground/[0.08]">
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-3 text-5xl font-semibold tabular-nums tracking-tight text-foreground sm:text-6xl">{value}</div>
      <div className="mt-2 text-sm text-muted-foreground">{hint}</div>
    </div>
  );
}

function TvMetrics() {
  const adminApp = useAdminApp();
  const metrics = useMetricsOrThrow(adminApp, false);
  const analytics = metrics.analytics_overview;
  const auth = metrics.auth_overview;
  const payments = metrics.payments_overview;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <TvMetric label="Online now" value={formatCompact(metrics.live_users)} hint="Token refreshes in the last ~2 minutes" />
      <TvMetric label="Visitors" value={formatCompact(analytics.visitors)} hint="Unique visitors in the current analytics window" />
      <TvMetric label="MAU" value={formatCompact(auth.mau)} hint="Monthly active users" />
      <TvMetric label="Page views today" value={formatCompact(lastActivity(analytics.daily_page_views))} hint="Last daily page-view bucket" />
      <TvMetric label="Revenue" value={formatUsdFromCents(payments.revenue_cents)} hint="All-time captured revenue" />
      <TvMetric label="MRR" value={formatUsdFromCents(payments.mrr_cents)} hint="Monthly recurring revenue" />
    </div>
  );
}

export default function PageClient() {
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

  const toggleFullscreen = async () => {
    setFullscreenError(null);
    try {
      if (document.fullscreenElement != null) {
        await document.exitFullscreen();
        return;
      }
      await document.documentElement.requestFullscreen();
    } catch (caught) {
      setFullscreenError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <AppEnabledGuard appId="tv-mode">
      <PageLayout
        title="TV mode"
        description="Large-screen metrics for a wall display. Fullscreen hides browser chrome; the dashboard sidebar stays unless you hide it from the layout."
        fillWidth
        actions={<DesignButton size="sm" variant="secondary" className="gap-1.5" onClick={toggleFullscreen}><ArrowsOutIcon className="h-3.5 w-3.5" />Fullscreen</DesignButton>}
      >
        {fullscreenError != null && (
          <DesignAlert variant="error" title="Couldn't enter fullscreen" description={fullscreenError} />
        )}
        <Suspense fallback={(
          <div className="flex items-center gap-2 py-24 text-sm text-muted-foreground">
            <SpinnerGapIcon className="h-4 w-4 animate-spin" /> Loading live metrics…
          </div>
        )}>
          <TvMetrics />
        </Suspense>
      </PageLayout>
    </AppEnabledGuard>
  );
}
