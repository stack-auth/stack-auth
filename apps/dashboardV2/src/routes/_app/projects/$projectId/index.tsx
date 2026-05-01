/**
 * Project overview / dashboard.
 *
 * Pulls the rich `/internal/metrics` payload via `useMetrics` (see
 * `apps/backend/.../internal/metrics/route.tsx` and the `MetricsResponse`
 * shape in `packages/stack-shared/src/interface/admin-metrics.ts`). The
 * endpoint returns a 30-day window of:
 *   - daily_users (sign-ups), daily_active_users, auth_overview.daily_active_users_split
 *     (new/retained/reactivated DAU)
 *   - total_users, live_users (last ~2min), auth_overview (verified, unverified, anonymous, MAU, total_teams)
 *   - login_methods, users_by_country
 *   - email_overview (deliverability, daily emails by status)
 *   - payments_overview (MRR, revenue, subscriptions, conversion) — only meaningful when payments app installed
 *   - analytics_overview (visitors, page views, top referrers, avg session) — only when analytics app installed
 *   - recently_registered (slim user projection)
 */

import { Suspense, useMemo, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChartBarIcon,
  ChartLineIcon,
  CheckIcon,
  CopyIcon,
  EnvelopeSimpleIcon,
  GlobeHemisphereWestIcon,
  PulseIcon,
  ShieldCheckIcon,
  TrendUpIcon,
  UserPlusIcon,
  UsersIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"

import type { ChartConfig } from "@/components/ui/chart"
import type {
  MetricsActivitySplit,
  MetricsDataPoint,
  MetricsResponse,
} from "@stackframe/stack-shared/dist/interface/admin-metrics"
import type { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema"
import type { AdminProject, InternalApiKey } from "@stackframe/tanstack-start"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  ProjectPage,
  ProjectPageHeader,
  ProjectPageMain,
} from "@/components/console/project-page"
import { ProjectUserDrawerLink } from "@/components/console/project-entity-drawer-link"
import { useAdminApp } from "@/lib/stack/admin-app"
import { useFavicon } from "@/hooks/use-favicon"
import {
  useAdminProject,
  useInternalApiKeysQuery,
  useLoadedAdminProjectConfig,
  useMetricsQuery,
} from "@/lib/stack/react-query"

export const Route = createFileRoute("/_app/projects/$projectId/")({
  component: ProjectOverviewPage,
})

function ProjectOverviewPage() {
  return (
    <Suspense fallback={<ProjectOverviewSkeleton />}>
      <ProjectOverviewContent />
    </Suspense>
  )
}

function ProjectOverviewContent() {
  const adminApp = useAdminApp()
  const project = useAdminProject(adminApp)
  const config = useLoadedAdminProjectConfig(project)
  const apiKeysQuery = useInternalApiKeysQuery(adminApp)
  const metricsQuery = useMetricsQuery(adminApp, false)
  const apiKeys = apiKeysQuery.data
  const metrics = metricsQuery.data

  if (apiKeys == null || metrics == null) {
    return <ProjectOverviewSkeleton />
  }

  return (
    <ProjectOverviewLoaded
      project={project}
      config={config}
      apiKeys={apiKeys}
      metrics={metrics}
    />
  )
}

function ProjectOverviewLoaded({
  project,
  config,
  apiKeys,
  metrics,
}: {
  project: AdminProject,
  config: CompleteConfig,
  apiKeys: Array<InternalApiKey>,
  metrics: MetricsResponse,
}) {
  const installedApps = useMemo(() => {
    const installed = config.apps.installed as Record<string, { enabled?: boolean } | undefined>
    const out = new Set<string>()
    for (const [id, v] of Object.entries(installed)) {
      if (v?.enabled === true) out.add(id)
    }
    return out
  }, [config.apps.installed])
  const paymentsEnabled = installedApps.has("payments")
  const analyticsEnabled = installedApps.has("analytics")

  const auth = metrics.auth_overview
  const dauSplit = auth.daily_active_users_split
  const dauStacked = useMemo(() => stackSplit(dauSplit), [dauSplit])
  const [dauChartType, setDauChartType] = useState<"area" | "bar">("area")
  const [dauVisible, setDauVisible] = useState<Array<DauSeries>>([
    "retained",
    "new",
    "reactivated",
  ])

  const signupStats = useMemo(() => computeWindowDelta(metrics.daily_users, 7), [metrics.daily_users])
  const dauTodayStats = useMemo(() => {
    const last = metrics.daily_active_users.at(-1)
    const prev = metrics.daily_active_users.at(-2)
    return {
      today: last?.activity ?? 0,
      delta: prev != null && prev.activity > 0 ? ((last?.activity ?? 0) - prev.activity) / prev.activity * 100 : null,
    }
  }, [metrics.daily_active_users])

  const totalLogins = useMemo(
    () => metrics.login_methods.reduce((sum, m) => sum + m.count, 0),
    [metrics.login_methods],
  )

  const topCountries = useMemo(() => topCountriesFrom(metrics.users_by_country, 5), [metrics.users_by_country])

  return (
    <ProjectPage>
      <ProjectPageHeader
        title={project.displayName}
        badge={<LiveDot count={metrics.live_users} />}
        actions={<CopyableId value={project.id} />}
      />

      <ProjectPageMain className="space-y-6 py-6">
        {/* KPI strip */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <KpiCard
            label="Live now"
            value={metrics.live_users.toLocaleString()}
            Icon={PulseIcon}
            tone="live"
            hint={metrics.live_users > 0 ? "Active in last 2m" : "No active sessions"}
          />
          <KpiCard
            label="Total users"
            value={metrics.total_users.toLocaleString()}
            Icon={UsersIcon}
            hint={`${auth.verified_users.toLocaleString()} verified`}
          />
          <KpiCard
            label="MAU"
            value={auth.mau.toLocaleString()}
            Icon={ShieldCheckIcon}
            hint="Monthly active"
          />
          <KpiCard
            label="DAU today"
            value={dauTodayStats.today.toLocaleString()}
            Icon={TrendUpIcon}
            delta={dauTodayStats.delta}
            deltaLabel="vs yesterday"
          />
          <KpiCard
            label="Sign-ups (7d)"
            value={signupStats.windowSum.toLocaleString()}
            Icon={UserPlusIcon}
            delta={signupStats.deltaPct}
            deltaLabel="vs prior 7d"
          />
          <KpiCard
            label="Teams"
            value={auth.total_teams.toLocaleString()}
            Icon={UsersThreeIcon}
            hint={`${apiKeys.length} API ${apiKeys.length === 1 ? "key" : "keys"}`}
          />
        </section>

        {/* Activity chart — stacked DAU split */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm">Active users</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-1.5">
                {DAU_SERIES.map((s) => {
                  const active = dauVisible.includes(s.key)
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => {
                        setDauVisible((prev) =>
                          prev.includes(s.key)
                            ? prev.filter((k) => k !== s.key)
                            : [...prev, s.key],
                        )
                      }}
                      aria-pressed={active}
                      className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-xs transition-colors hover:bg-muted/60 aria-pressed:border-foreground/10 aria-pressed:bg-muted/40 data-[active=false]:opacity-50"
                      data-active={active}
                    >
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{ backgroundColor: active ? s.color : "var(--muted-foreground)" }}
                      />
                      <span className={active ? "" : "text-muted-foreground"}>{s.label}</span>
                    </button>
                  )
                })}
              </CardDescription>
              <CardAction>
                <ToggleGroup
                  size="sm"
                  variant="outline"
                  value={[dauChartType]}
                  onValueChange={(v) => {
                    const next = v[0]
                    if (next === "area" || next === "bar") setDauChartType(next)
                  }}
                  aria-label="Chart type"
                >
                  <ToggleGroupItem value="area" aria-label="Line chart">
                    <ChartLineIcon />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="bar" aria-label="Bar chart">
                    <ChartBarIcon />
                  </ToggleGroupItem>
                </ToggleGroup>
              </CardAction>
            </CardHeader>
            <CardContent>
              {dauStacked.length === 0 || dauVisible.length === 0 ? (
                <ChartEmpty />
              ) : (
                <DauSplitChart
                  data={dauStacked}
                  chartType={dauChartType}
                  visible={dauVisible}
                />
              )}
            </CardContent>
          </Card>

          <ChartCard
            title="Sign-ups"
            description="New users per day, last 30 days."
          >
            {metrics.daily_users.length === 0 ? (
              <ChartEmpty />
            ) : (
              <SignupsChart data={metrics.daily_users} />
            )}
          </ChartCard>
        </section>

        {/* Composition row */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Login methods</CardTitle>
              <CardDescription className="text-xs">
                {totalLogins.toLocaleString()} total identities linked.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {metrics.login_methods.length === 0 ? (
                <EmptyHint>No sign-ins yet.</EmptyHint>
              ) : (
                <ul className="space-y-2.5">
                  {metrics.login_methods
                    .slice()
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 6)
                    .map((m) => (
                      <li key={m.method} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="capitalize">{prettyMethod(m.method)}</span>
                          <span className="font-mono text-muted-foreground">
                            {m.count.toLocaleString()}
                          </span>
                        </div>
                        <Progress
                          value={totalLogins > 0 ? (m.count / totalLogins) * 100 : 0}
                          className="h-1.5"
                        />
                      </li>
                    ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Top countries</CardTitle>
              <CardDescription className="text-xs">
                Where your users are coming from.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {topCountries.length === 0 ? (
                <EmptyHint>
                  <span className="inline-flex items-center gap-1.5">
                    <GlobeHemisphereWestIcon className="size-3.5" />
                    No location data yet.
                  </span>
                </EmptyHint>
              ) : (
                <ul className="space-y-2.5">
                  {topCountries.map((c) => (
                    <li key={c.code} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="inline-flex items-center gap-2">
                          <span aria-hidden className="text-base leading-none">
                            {flagEmoji(c.code)}
                          </span>
                          <span className="font-mono uppercase">{c.code}</span>
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {c.count.toLocaleString()}
                        </span>
                      </div>
                      <Progress value={c.share} className="h-1.5" />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">User composition</CardTitle>
              <CardDescription className="text-xs">
                Verified, unverified, and anonymous users.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CompositionBars
                segments={[
                  { label: "Verified", value: auth.verified_users, color: "var(--chart-1)" },
                  { label: "Unverified", value: auth.unverified_users, color: "var(--chart-3)" },
                  { label: "Anonymous", value: auth.anonymous_users, color: "var(--chart-4)" },
                ]}
              />
            </CardContent>
          </Card>
        </section>

        {/* Conditional: email + payments + analytics */}
        <ConditionalRow
          metrics={metrics}
          paymentsEnabled={paymentsEnabled}
          analyticsEnabled={analyticsEnabled}
        />

        {/* Recent sign-ups */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-sm font-medium tracking-tight">
              Latest sign-ups
            </h2>
            <Link
              to="/projects/$projectId/users"
              params={{ projectId: project.id }}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground hover:transition-none"
            >
              View all users
            </Link>
          </div>
          <Card>
            <CardContent className="p-0">
              {metrics.recently_registered.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  No users yet.
                </div>
              ) : (
                <ul className="divide-y">
                  {metrics.recently_registered.slice(0, 6).map((user) => (
                    <li key={user.id}>
                      <ProjectUserDrawerLink
                        userId={user.id}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left text-foreground transition-colors hover:bg-muted/40 hover:no-underline hover:transition-none"
                      >
                        <Avatar size="sm">
                          {user.profile_image_url ? (
                            <AvatarImage
                              src={user.profile_image_url}
                              alt={user.display_name ?? user.primary_email ?? user.id}
                            />
                          ) : null}
                          <AvatarFallback>
                            {initials(user.display_name, user.primary_email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {user.display_name ?? user.primary_email ?? "Unnamed user"}
                          </p>
                          {user.primary_email && user.display_name ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {user.primary_email}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <UserPlusIcon className="size-3.5" />
                          <span>{formatRelative(new Date(user.signed_up_at_millis))}</span>
                        </div>
                      </ProjectUserDrawerLink>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Metadata */}
        <section className="space-y-3">
          <h2 className="font-heading text-sm font-medium tracking-tight">
            Details
          </h2>
          <Card>
            <CardHeader>
              <CardTitle>Project metadata</CardTitle>
              <CardDescription>
                Basic information about this project.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <DetailRow label="Project ID">
                <CopyableId value={project.id} />
              </DetailRow>
              <DetailRow label="Display name">
                <span className="text-sm">{project.displayName}</span>
              </DetailRow>
              <DetailRow label="Description">
                <span className="text-sm text-muted-foreground">
                  {project.description ?? "No description"}
                </span>
              </DetailRow>
              <DetailRow label="Created">
                <span className="text-sm">
                  {new Date(project.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </DetailRow>
            </CardContent>
          </Card>
        </section>
      </ProjectPageMain>
    </ProjectPage>
  )
}

function ProjectOverviewSkeleton() {
  return (
    <ProjectPage>
      <ProjectPageHeader
        title={<Skeleton className="h-5 w-36" />}
        badge={<Skeleton className="h-5 w-16 rounded-full" />}
        actions={(
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="size-8 rounded-md" />
          </div>
        )}
      />

      <ProjectPageMain className="space-y-6 py-6">
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_kpi, i) => (
            <Card key={i} size="sm">
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="size-3.5 rounded-sm" />
                </div>
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-24" />
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <OverviewChartSkeleton className="lg:col-span-2" />
          <OverviewChartSkeleton />
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_card, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-44" />
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.from({ length: 4 }).map((_rowSkeleton, row) => (
                  <div key={row} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-10" />
                    </div>
                    <Skeleton className="h-1.5 w-full rounded-full" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {Array.from({ length: 5 }).map((_user, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-3">
                    <Skeleton className="size-8 rounded-full" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-56" />
                    </div>
                    <Skeleton className="h-4 w-20" />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <Skeleton className="h-5 w-16" />
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-52" />
            </CardHeader>
            <CardContent className="space-y-4">
              {Array.from({ length: 4 }).map((_detail, i) => (
                <div key={i} className="grid grid-cols-[8rem_1fr] items-center gap-3">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-5 w-48" />
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </ProjectPageMain>
    </ProjectPage>
  )
}

function OverviewChartSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <div className="flex gap-1.5">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex h-60 items-end gap-2 border-b border-l px-3 pb-3">
          {[46, 72, 54, 86, 64, 92, 58, 76, 68, 82, 60, 74].map((height, i) => (
            <Skeleton
              key={i}
              className="flex-1 rounded-t-sm"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Conditional row (email / payments / analytics) ────────────────────────

function ConditionalRow({
  metrics,
  paymentsEnabled,
  analyticsEnabled,
}: {
  metrics: MetricsResponse,
  paymentsEnabled: boolean,
  analyticsEnabled: boolean,
}) {
  const email = metrics.email_overview
  const payments = metrics.payments_overview
  const analytics = metrics.analytics_overview

  const hasEmailActivity = email.total_emails > 0
  const cards: Array<React.ReactNode> = []

  if (hasEmailActivity) {
    cards.push(
      <Card key="email">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <EnvelopeSimpleIcon className="size-4" />
            Email deliverability
          </CardTitle>
          <CardDescription className="text-xs">
            {email.total_emails.toLocaleString()} emails in the last 30 days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="font-heading text-3xl font-semibold tracking-tight tabular-nums">
                {(email.deliverability_rate * 100).toFixed(1)}%
              </p>
              <p className="text-[11px] text-muted-foreground">delivered</p>
            </div>
            <div className="space-y-1 text-right text-[11px]">
              <div className="text-muted-foreground">
                Bounce <span className="font-mono text-foreground">{(email.bounce_rate * 100).toFixed(1)}%</span>
              </div>
              <div className="text-muted-foreground">
                Click <span className="font-mono text-foreground">{(email.click_rate * 100).toFixed(1)}%</span>
              </div>
            </div>
          </div>
          <CompositionBars
            segments={[
              { label: "Delivered", value: email.deliverability_status.delivered, color: "var(--chart-1)" },
              { label: "Bounced", value: email.deliverability_status.bounced, color: "var(--chart-3)" },
              { label: "Error", value: email.deliverability_status.error, color: "var(--destructive)" },
              { label: "Pending", value: email.deliverability_status.in_progress, color: "var(--chart-4)" },
            ]}
          />
        </CardContent>
      </Card>,
    )
  }

  if (paymentsEnabled) {
    cards.push(
      <Card key="payments">
        <CardHeader>
          <CardTitle className="text-sm">Revenue</CardTitle>
          <CardDescription className="text-xs">
            {payments.active_subscription_count.toLocaleString()} active subscriptions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="MRR" value={formatCents(payments.mrr_cents)} />
            <Stat label="Revenue (30d)" value={formatCents(payments.revenue_cents)} />
            <Stat label="Orders" value={payments.total_orders.toLocaleString()} />
            <Stat
              label="Conversion"
              value={`${(payments.checkout_conversion_rate * 100).toFixed(1)}%`}
            />
          </div>
          {analytics.daily_revenue.length > 0 ? (
            <RevenueSpark data={analytics.daily_revenue} />
          ) : null}
        </CardContent>
      </Card>,
    )
  }

  if (analyticsEnabled) {
    cards.push(
      <Card key="analytics">
        <CardHeader>
          <CardTitle className="text-sm">Traffic</CardTitle>
          <CardDescription className="text-xs">
            {analytics.visitors.toLocaleString()} visitors in the last 30 days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Online now" value={analytics.online_live.toLocaleString()} />
            <Stat
              label="Avg session"
              value={formatDuration(analytics.avg_session_seconds)}
            />
          </div>
          {analytics.top_referrers.length > 0 ? (
            <div className="space-y-1.5">
              <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                Top referrers
              </p>
              <ul className="space-y-1">
                {(() => {
                  const top = analytics.top_referrers.slice(0, 4)
                  const max = Math.max(...top.map((r) => r.visitors), 1)
                  return top.map((r) => (
                    <ReferrerRow
                      key={r.referrer}
                      referrer={r.referrer}
                      visitors={r.visitors}
                      ratio={r.visitors / max}
                    />
                  ))
                })()}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>,
    )
  }

  if (cards.length === 0) return null
  return (
    <section
      className={
        cards.length === 1
          ? "grid grid-cols-1"
          : cards.length === 2
            ? "grid grid-cols-1 gap-4 lg:grid-cols-2"
            : "grid grid-cols-1 gap-4 lg:grid-cols-3"
      }
    >
      {cards}
    </section>
  )
}

// ── Charts ────────────────────────────────────────────────────────────────

type DauSeries = "retained" | "new" | "reactivated"

const DAU_SERIES: ReadonlyArray<{ key: DauSeries, label: string, color: string }> = [
  { key: "retained", label: "Retained", color: "var(--chart-1)" },
  { key: "new", label: "New", color: "var(--chart-2)" },
  { key: "reactivated", label: "Reactivated", color: "var(--chart-4)" },
]

const dauChartConfig = {
  retained: { label: "Retained", color: "var(--chart-1)" },
  new: { label: "New", color: "var(--chart-2)" },
  reactivated: { label: "Reactivated", color: "var(--chart-4)" },
} satisfies ChartConfig

type StackedDauPoint = { date: string, new: number, retained: number, reactivated: number }

function DauSplitChart({
  data,
  chartType,
  visible,
}: {
  data: Array<StackedDauPoint>,
  chartType: "area" | "bar",
  visible: Array<DauSeries>,
}) {
  const visibleSeries = DAU_SERIES.filter((s) => visible.includes(s.key))
  return (
    <ChartContainer id="project-overview-dau-split" config={dauChartConfig} className="h-60 w-full">
      {chartType === "area" ? (
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {visibleSeries.map((s) => (
              <linearGradient key={s.key} id={`dau-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={`var(--color-${s.key})`} stopOpacity={0.6} />
                <stop offset="95%" stopColor={`var(--color-${s.key})`} stopOpacity={0.1} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={formatDayTick}
            minTickGap={24}
          />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} width={28} />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelFormatter={(value) => formatDayTooltip(String(value))}
              />
            }
          />
          {visibleSeries.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stackId="dau"
              stroke={`var(--color-${s.key})`}
              fill={`url(#dau-${s.key})`}
              strokeWidth={1.5}
            />
          ))}
        </AreaChart>
      ) : (
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={formatDayTick}
            minTickGap={24}
          />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} width={28} />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelFormatter={(value) => formatDayTooltip(String(value))}
              />
            }
          />
          {visibleSeries.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="dau"
              fill={`var(--color-${s.key})`}
              radius={i === visibleSeries.length - 1 ? [4, 4, 0, 0] : 0}
            />
          ))}
        </BarChart>
      )}
    </ChartContainer>
  )
}

const signupsChartConfig = {
  activity: { label: "Sign-ups", color: "var(--chart-2)" },
} satisfies ChartConfig

function SignupsChart({ data }: { data: Array<MetricsDataPoint> }) {
  return (
    <ChartContainer id="project-overview-signups" config={signupsChartConfig} className="h-60 w-full">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={formatDayTick}
          minTickGap={24}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} width={28} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(value) => formatDayTooltip(String(value))}
            />
          }
        />
        <Bar dataKey="activity" fill="var(--color-activity)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  )
}

const revenueChartConfig = {
  new_cents: { label: "Revenue", color: "var(--chart-1)" },
} satisfies ChartConfig

function RevenueSpark({ data }: { data: Array<{ date: string, new_cents: number }> }) {
  return (
    <ChartContainer id="project-overview-revenue" config={revenueChartConfig} className="h-20 w-full">
      <LineChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <Line
          type="monotone"
          dataKey="new_cents"
          stroke="var(--color-new_cents)"
          strokeWidth={2}
          dot={false}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(value) => formatDayTooltip(String(value))}
              formatter={(v) => formatCents(Number(v))}
            />
          }
        />
        <XAxis dataKey="date" hide />
      </LineChart>
    </ChartContainer>
  )
}

// ── Building blocks ───────────────────────────────────────────────────────

type KpiTone = "default" | "live"
type KpiCardProps = {
  label: string,
  value: string,
  Icon: typeof UsersIcon,
  delta?: number | null,
  deltaLabel?: string,
  hint?: string,
  tone?: KpiTone,
}

function KpiCard({ label, value, Icon, delta, deltaLabel, hint, tone }: KpiCardProps) {
  const showDelta = typeof delta === "number" && Number.isFinite(delta)
  const positive = showDelta && delta >= 0
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase truncate">
            {label}
          </p>
          <Icon
            className={
              tone === "live"
                ? "size-3.5 shrink-0 text-success"
                : "size-3.5 shrink-0 text-muted-foreground"
            }
          />
        </div>
        <p className="font-heading text-2xl font-semibold tracking-tight tabular-nums leading-none">
          {value}
        </p>
        <div className="min-h-[1rem] text-[11px] leading-tight">
          {showDelta ? (
            <p className="flex items-center gap-1 truncate">
              <span
                className={
                  positive
                    ? "inline-flex items-center gap-0.5 leading-none text-success"
                    : "inline-flex items-center gap-0.5 leading-none text-destructive"
                }
              >
                {positive ? (
                  <ArrowUpIcon className="size-3" weight="bold" />
                ) : (
                  <ArrowDownIcon className="size-3" weight="bold" />
                )}
                {Math.abs(delta).toFixed(0)}%
              </span>
              {deltaLabel ? (
                <span className="truncate leading-none text-muted-foreground">{deltaLabel}</span>
              ) : null}
            </p>
          ) : hint ? (
            <p className="truncate text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function ChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string,
  description: string,
  children: React.ReactNode,
  className?: string,
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function ChartEmpty() {
  return (
    <div className="flex h-60 items-center justify-center text-xs text-muted-foreground">
      Not enough data yet.
    </div>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}

function CompositionBars({
  segments,
}: {
  segments: Array<{ label: string, value: number, color: string }>,
}) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  if (total === 0) {
    return <EmptyHint>No data yet.</EmptyHint>
  }
  return (
    <div className="space-y-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((s) => {
          const pct = (s.value / total) * 100
          if (pct === 0) return null
          return (
            <div
              key={s.label}
              style={{ width: `${pct}%`, backgroundColor: s.color }}
              title={`${s.label}: ${s.value.toLocaleString()}`}
            />
          )
        })}
      </div>
      <ul className="space-y-1.5">
        {segments.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0
          return (
            <li key={s.label} className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span>{s.label}</span>
              </span>
              <span className="font-mono text-muted-foreground">
                {s.value.toLocaleString()}
                <span className="ml-1 text-foreground/60">{pct.toFixed(0)}%</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ReferrerRow({ referrer, visitors, ratio }: { referrer: string, visitors: number, ratio: number }) {
  const { hostname, src, onError } = useFavicon(referrer, { size: 64 })
  const label = hostname ?? (referrer || "Direct")
  const fallback = (hostname ?? "·").slice(0, 2).toUpperCase()
  const pct = Math.max(0, Math.min(100, ratio * 100))
  return (
    <li className="relative flex items-center justify-between gap-2 overflow-hidden rounded-md px-1.5 py-1 text-xs">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 rounded-md bg-accent"
        style={{ width: `${pct}%` }}
      />
      <div className="relative flex min-w-0 items-center gap-2">
        <Avatar className="size-4 rounded-sm">
          {src ? <AvatarImage src={src} alt="" onError={onError} /> : null}
          <AvatarFallback className="rounded-sm text-[8px]">{fallback}</AvatarFallback>
        </Avatar>
        <span className="truncate">{label}</span>
      </div>
      <span className="relative ml-2 font-mono text-muted-foreground">
        {visitors.toLocaleString()}
      </span>
    </li>
  )
}

function Stat({ label, value }: { label: string, value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <p className="font-heading text-lg font-semibold tracking-tight tabular-nums">{value}</p>
    </div>
  )
}

function LiveDot({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <Badge variant="secondary" className="gap-1.5 font-mono text-[10px] tracking-wider uppercase">
      <span className="relative inline-flex size-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
        <span className="relative inline-flex size-1.5 rounded-full bg-success" />
      </span>
      {count.toLocaleString()} live
    </Badge>
  )
}

function DetailRow({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-3">
      <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex items-center gap-2">
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? "Copied" : "Copy project ID"}
        onClick={() => {
          void onCopy()
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function stackSplit(split: MetricsActivitySplit): Array<StackedDauPoint> {
  const dates = new Set<string>([
    ...split.new.map((d) => d.date),
    ...split.retained.map((d) => d.date),
    ...split.reactivated.map((d) => d.date),
  ])
  const newMap = new Map(split.new.map((d) => [d.date, d.activity]))
  const retainedMap = new Map(split.retained.map((d) => [d.date, d.activity]))
  const reactivatedMap = new Map(split.reactivated.map((d) => [d.date, d.activity]))
  return [...dates]
    .sort()
    .map((date) => ({
      date,
      new: newMap.get(date) ?? 0,
      retained: retainedMap.get(date) ?? 0,
      reactivated: reactivatedMap.get(date) ?? 0,
    }))
}

function computeWindowDelta(
  data: Array<MetricsDataPoint>,
  windowDays: number,
): { windowSum: number, deltaPct: number | null } {
  if (data.length === 0) return { windowSum: 0, deltaPct: null }
  const sortedTail = data.slice(-windowDays * 2)
  const last = sortedTail.slice(-windowDays).reduce((s, p) => s + p.activity, 0)
  const prior = sortedTail.slice(0, sortedTail.length - windowDays).reduce((s, p) => s + p.activity, 0)
  if (prior === 0) return { windowSum: last, deltaPct: null }
  return { windowSum: last, deltaPct: ((last - prior) / prior) * 100 }
}

function topCountriesFrom(
  byCountry: Record<string, number>,
  limit: number,
): Array<{ code: string, count: number, share: number }> {
  const entries: Array<[string, number]> = []
  let total = 0
  for (const [code, count] of Object.entries(byCountry)) {
    if (!code || !Number.isFinite(count) || count <= 0) continue
    entries.push([code.toUpperCase(), count])
    total += count
  }
  entries.sort((a, b) => b[1] - a[1])
  return entries.slice(0, limit).map(([code, count]) => ({
    code,
    count,
    share: total > 0 ? (count / total) * 100 : 0,
  }))
}

function flagEmoji(countryCode: string): string {
  if (countryCode.length !== 2) return "🌐"
  const A = 0x1f1e6
  const a = "A".charCodeAt(0)
  const upper = countryCode.toUpperCase()
  const c0 = upper.charCodeAt(0)
  const c1 = upper.charCodeAt(1)
  if (c0 < a || c0 > a + 25 || c1 < a || c1 > a + 25) return "🌐"
  return String.fromCodePoint(A + (c0 - a)) + String.fromCodePoint(A + (c1 - a))
}

function prettyMethod(method: string): string {
  if (method === "otp") return "Magic link / OTP"
  if (method === "passkey") return "Passkey"
  if (method === "password") return "Password"
  return method.replace(/[-_]/g, " ")
}

function formatCents(cents: number): string {
  const dollars = cents / 100
  if (dollars >= 1000) {
    return `$${(dollars / 1000).toFixed(dollars >= 10_000 ? 0 : 1)}k`
  }
  return `$${dollars.toFixed(dollars % 1 === 0 ? 0 : 2)}`
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—"
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  if (minutes < 60) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function formatDayTick(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatDayTooltip(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

function initials(displayName: string | null, email: string | null): string {
  const source = displayName ?? email ?? ""
  const trimmed = source.trim()
  if (trimmed.length === 0) return "?"
  const parts = trimmed.split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return trimmed.slice(0, 2).toUpperCase()
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
