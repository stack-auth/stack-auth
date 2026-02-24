"use client";

import { EditableGrid, type EditableGridItem } from "@/components/editable-grid";
import { Link } from "@/components/link";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  Button,
  Checkbox,
  DataTable,
  DataTableColumnHeader,
  DataTableViewOptions,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Typography,
  cn,
} from "@/components/ui";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { ChartCard, type DataPoint, type LineChartDisplayConfig } from "../../(overview)/line-chart";
import {
  Bell,
  ClockCounterClockwise,
  FunnelSimple,
  Package,
  ShieldCheck,
  SquaresFourIcon,
  UserCircle,
  WarningCircle
} from "@phosphor-icons/react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis, type TooltipProps } from "recharts";
import { isWeekend } from "@stackframe/stack-shared/dist/utils/dates";
import { ColumnDef, Table as TableType } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageLayout } from "../../page-layout";

type IncidentSeverity = "critical" | "high" | "medium";
type ActiveTab = "operations" | "milestones" | "settings";
type StatusBadgeColor = "blue" | "cyan" | "purple" | "green" | "orange" | "red";
type StatusBadgeSize = "sm" | "md";

type IncidentRow = {
  id: string,
  service: string,
  severity: IncidentSeverity,
  owner: string,
  startedAt: string,
  status: "investigating" | "mitigated" | "monitoring",
};

type ReleaseMilestone = {
  id: string,
  title: string,
  owner: string,
  dueDate: string,
  status: "done" | "in_progress" | "blocked",
};

type ActivityEntry = {
  id: string,
  title: string,
  description: string,
  at: string,
};

const STATUS_BADGE_STYLES: Record<StatusBadgeColor, string> = {
  blue: "text-blue-700 dark:text-blue-400 bg-blue-500/20 dark:bg-blue-500/10 ring-1 ring-blue-500/30 dark:ring-blue-500/20",
  cyan: "text-cyan-700 dark:text-cyan-400 bg-cyan-500/20 dark:bg-cyan-500/10 ring-1 ring-cyan-500/30 dark:ring-cyan-500/20",
  purple: "text-purple-700 dark:text-purple-400 bg-purple-500/20 dark:bg-purple-500/10 ring-1 ring-purple-500/30 dark:ring-purple-500/20",
  green: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/20 dark:bg-emerald-500/10 ring-1 ring-emerald-500/30 dark:ring-emerald-500/20",
  orange: "text-amber-700 dark:text-amber-300 bg-amber-500/20 dark:bg-amber-500/10 ring-1 ring-amber-500/30 dark:ring-amber-500/20",
  red: "text-red-700 dark:text-red-400 bg-red-500/20 dark:bg-red-500/10 ring-1 ring-red-500/30 dark:ring-red-500/20",
};

const INCIDENTS: IncidentRow[] = [
  {
    id: "inc_1024",
    service: "Email Delivery Pipeline",
    severity: "high",
    owner: "Nia Ramirez",
    startedAt: "8m ago",
    status: "investigating",
  },
  {
    id: "inc_1017",
    service: "OAuth Token Refresh",
    severity: "medium",
    owner: "Dylan Park",
    startedAt: "22m ago",
    status: "monitoring",
  },
  {
    id: "inc_1009",
    service: "Team Invite Webhooks",
    severity: "critical",
    owner: "Avery Shah",
    startedAt: "43m ago",
    status: "mitigated",
  },
  {
    id: "inc_1006",
    service: "Dashboard Audit Export",
    severity: "medium",
    owner: "Mia Johnson",
    startedAt: "1h ago",
    status: "monitoring",
  },
];

const MILESTONES: ReleaseMilestone[] = [
  { id: "m_1", title: "Rotate signing keys", owner: "Security", dueDate: "Today", status: "in_progress" },
  { id: "m_2", title: "Staging load test", owner: "Platform", dueDate: "Feb 7", status: "done" },
  { id: "m_3", title: "Update SSO docs", owner: "Docs", dueDate: "Feb 8", status: "blocked" },
  { id: "m_4", title: "Rollout feature flag", owner: "Auth", dueDate: "Feb 9", status: "in_progress" },
];

const DEPLOYMENT_ACTIVITY_CONFIG = {
  name: "Deployment Activity",
  description: "Throughput trend over the selected time window",
  chart: {
    activity: {
      label: "Activity",
      theme: {
        light: "hsl(221, 83%, 53%)",
        dark: "hsl(217, 91%, 60%)",
      },
    },
  },
} satisfies LineChartDisplayConfig;

const DEPLOYMENT_ACTIVITY_DATA: DataPoint[] = [
  { date: "2026-01-20", activity: 12 },
  { date: "2026-01-21", activity: 18 },
  { date: "2026-01-22", activity: 14 },
  { date: "2026-01-23", activity: 22 },
  { date: "2026-01-24", activity: 19 },
  { date: "2026-01-25", activity: 8 },
  { date: "2026-01-26", activity: 6 },
  { date: "2026-01-27", activity: 21 },
  { date: "2026-01-28", activity: 25 },
  { date: "2026-01-29", activity: 17 },
  { date: "2026-01-30", activity: 23 },
];

const RECENT_ACTIVITY: ActivityEntry[] = [
  {
    id: "a_1",
    title: "Traffic ramped to 25%",
    description: "Auth API p95 stayed under 220ms",
    at: "4m ago",
  },
  {
    id: "a_2",
    title: "Webhook retries normalized",
    description: "Team invite delivery error rate dropped to baseline",
    at: "12m ago",
  },
  {
    id: "a_3",
    title: "Signing key checksum verified",
    description: "Staging and production fingerprints match",
    at: "23m ago",
  },
];

const SEVERITY_META = new Map<IncidentSeverity, { label: string, color: StatusBadgeColor }>([
  ["critical", { label: "Critical", color: "red" }],
  ["high", { label: "High", color: "orange" }],
  ["medium", { label: "Medium", color: "cyan" }],
]);

const INCIDENT_STATUS_META = new Map<IncidentRow["status"], { label: string, color: StatusBadgeColor }>([
  ["investigating", { label: "Investigating", color: "orange" }],
  ["mitigated", { label: "Mitigated", color: "green" }],
  ["monitoring", { label: "Monitoring", color: "blue" }],
]);

const MILESTONE_META = new Map<ReleaseMilestone["status"], { label: string, color: StatusBadgeColor }>([
  ["done", { label: "Done", color: "green" }],
  ["in_progress", { label: "In progress", color: "blue" }],
  ["blocked", { label: "Blocked", color: "red" }],
]);

function DemoChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload as DataPoint;
  const date = new Date(data.date);
  const formattedDate = !isNaN(date.getTime())
    ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : data.date;
  return (
    <div className="rounded-xl bg-background/95 px-3.5 py-2.5 shadow-lg backdrop-blur-xl ring-1 ring-foreground/[0.08]">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-medium text-muted-foreground tracking-wide">{formattedDate}</span>
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full ring-2 ring-white/20" style={{ backgroundColor: "var(--color-activity)" }} />
          <span className="text-[11px] text-muted-foreground">Activity</span>
          <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
            {typeof data.activity === "number" ? data.activity.toLocaleString() : data.activity}
          </span>
        </div>
      </div>
    </div>
  );
}

function GlassCard({
  children,
  className,
  gradientColor = "default",
}: {
  children: React.ReactNode,
  className?: string,
  gradientColor?: "blue" | "purple" | "green" | "orange" | "default" | "cyan",
}) {
  const hoverTints: Record<string, string> = {
    blue: "group-hover:bg-blue-500/[0.03]",
    purple: "group-hover:bg-purple-500/[0.03]",
    green: "group-hover:bg-emerald-500/[0.03]",
    orange: "group-hover:bg-orange-500/[0.03]",
    default: "group-hover:bg-slate-500/[0.02]",
    cyan: "group-hover:bg-cyan-500/[0.03]",
  };

  return (
    <div className={cn(
      "group relative rounded-2xl bg-white/90 dark:bg-background/60 backdrop-blur-xl transition-all duration-150 hover:transition-none",
      "ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
      "shadow-sm hover:shadow-md",
      className
    )}>
      <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.04] dark:from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
      <div className={cn(
        "absolute inset-0 transition-colors duration-150 group-hover:transition-none pointer-events-none rounded-2xl overflow-hidden",
        hoverTints[gradientColor]
      )} />
      <div className="relative">{children}</div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType, title: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="p-1.5 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.04]">
        <Icon className="h-3.5 w-3.5 text-foreground/70 dark:text-muted-foreground" />
      </div>
      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">{title}</span>
    </div>
  );
}

function StatusBadge({
  label,
  color,
  icon,
  size = "md",
}: {
  label: string,
  color: StatusBadgeColor,
  icon?: React.ElementType,
  size?: StatusBadgeSize,
}) {
  const Icon = icon;
  const sizeClasses = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]";

  return (
    <div className={cn("inline-flex items-center gap-1.5 rounded-full font-medium", STATUS_BADGE_STYLES[color], sizeClasses)}>
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </div>
  );
}

function CategoryTabs({
  categories,
  selectedCategory,
  onSelect,
}: {
  categories: Array<{ id: string, label: string, count: number }>,
  selectedCategory: string,
  onSelect: (id: string) => void,
}) {
  return (
    <div className="flex items-center gap-1 border-b border-gray-300 dark:border-gray-800 overflow-x-auto flex-nowrap [&::-webkit-scrollbar]:hidden">
      {categories.map((category) => {
        const isActive = selectedCategory === category.id;

        return (
          <button
            key={category.id}
            onClick={() => onSelect(category.id)}
            className={cn(
              "px-4 py-3 text-sm font-medium transition-all relative flex-shrink-0 whitespace-nowrap",
              "hover:text-gray-900 dark:hover:text-gray-100",
              isActive ? "text-blue-700 dark:text-blue-400" : "text-gray-700 dark:text-gray-400"
            )}
          >
            <span className="flex items-center gap-2">
              {category.label}
              <span className={cn(
                "text-xs px-1.5 py-0.5 rounded-full",
                isActive
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                  : "bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
              )}>
                {category.count}
              </span>
            </span>
            {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-700 dark:bg-blue-400" />}
          </button>
        );
      })}
    </div>
  );
}

function TableInstanceBridge<T>({
  tableInstance,
  onTableInstance,
  onVisibilityChange,
}: {
  tableInstance: TableType<T>,
  onTableInstance: (table: TableType<T>) => void,
  onVisibilityChange: (visibility: Record<string, boolean>) => void,
}) {
  useEffect(() => {
    onTableInstance(tableInstance);
  }, [tableInstance, onTableInstance]);

  const currentVisibility = tableInstance.getState().columnVisibility;
  const visibilityKey = JSON.stringify(currentVisibility);
  useEffect(() => {
    onVisibilityChange(currentVisibility as Record<string, boolean>);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- serialized visibility key intentionally controls updates
  }, [visibilityKey, onVisibilityChange]);

  return null;
}

export default function PageClient() {
  const [environment, setEnvironment] = useState("production");
  const [timeWindow, setTimeWindow] = useState("7d");
  const [activeTab, setActiveTab] = useState<ActiveTab>("operations");
  const [compactMode, setCompactMode] = useState(false);
  const [includeBackfill, setIncludeBackfill] = useState(true);
  const [notificationFrequency, setNotificationFrequency] = useState("every_update");
  const [incidentTable, setIncidentTable] = useState<TableType<IncidentRow> | null>(null);
  const [incidentTableVisibility, setIncidentTableVisibility] = useState({});

  const categories = useMemo(() => [
    { id: "operations", label: "Operations", count: INCIDENTS.length },
    { id: "milestones", label: "Milestones", count: MILESTONES.length },
    { id: "settings", label: "Settings", count: 2 },
  ], []);

  const simulateSave = useCallback(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 150);
    });
  }, []);

  const settingsGridItems = useMemo<EditableGridItem[]>(() => [
    {
      type: "text",
      icon: <Package className="h-3.5 w-3.5" />,
      name: "Release Name",
      value: "Auth Platform 2026.02",
      onUpdate: simulateSave,
    },
    {
      type: "dropdown",
      icon: <FunnelSimple className="h-3.5 w-3.5" />,
      name: "Rollout Bucket",
      value: "25_percent",
      options: [
        { value: "10_percent", label: "10%" },
        { value: "25_percent", label: "25%" },
        { value: "50_percent", label: "50%" },
        { value: "100_percent", label: "100%" },
      ],
      onUpdate: simulateSave,
    },
    {
      type: "boolean",
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
      name: "Require Approval",
      value: true,
      trueLabel: "Enabled",
      falseLabel: "Disabled",
      onUpdate: simulateSave,
    },
    {
      type: "custom",
      icon: <ClockCounterClockwise className="h-3.5 w-3.5" />,
      name: "Cooldown",
      children: <span className="text-sm text-muted-foreground">30 min between phases</span>,
    },
  ], [simulateSave]);

  const incidentColumns = useMemo<ColumnDef<IncidentRow>[]>(() => [
    {
      accessorKey: "service",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Service" />,
      cell: ({ row }) => (
        <div className="min-w-[220px]">
          <Typography className="text-sm font-medium">{row.original.service}</Typography>
          <Typography variant="secondary" className="text-xs">{row.original.id}</Typography>
        </div>
      ),
    },
    {
      accessorKey: "severity",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Severity" />,
      cell: ({ row }) => {
        const severity = SEVERITY_META.get(row.original.severity);
        if (!severity) throw new Error(`Unknown severity: ${row.original.severity}`);
        return <StatusBadge label={severity.label} color={severity.color} size="sm" />;
      },
    },
    {
      accessorKey: "owner",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Owner" />,
      cell: ({ row }) => <Typography className="text-sm">{row.original.owner}</Typography>,
    },
    {
      accessorKey: "startedAt",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Started" />,
      cell: ({ row }) => <Typography variant="secondary" className="text-xs">{row.original.startedAt}</Typography>,
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Status" />,
      cell: ({ row }) => {
        const status = INCIDENT_STATUS_META.get(row.original.status);
        if (!status) throw new Error(`Unknown status: ${row.original.status}`);
        return <StatusBadge label={status.label} color={status.color} size="sm" />;
      },
    },
  ], []);

  return (
    <PageLayout
      title="Release Control Center"
      description="A realistic operations surface using the same design-language component styling."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 px-3 rounded-lg transition-all duration-150 hover:transition-none" asChild>
            <Link href="../design-language">Component catalog</Link>
          </Button>
          <Button size="sm" className="h-8 px-3 rounded-lg transition-all duration-150 hover:transition-none">Start rollout</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 pb-10">
        <Alert className="bg-orange-500/5 border-orange-500/20">
          <WarningCircle className="h-4 w-4 text-orange-500" />
          <AlertTitle className="text-orange-600 dark:text-orange-400">Warning</AlertTitle>
          <AlertDescription>
            Validate readability in both modes on this page: badges, tables, muted copy, compact controls, and highlighted states should remain legible.
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <ChartCard gradientColor="cyan">
            <div className="p-5 pb-4">
              <div className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {DEPLOYMENT_ACTIVITY_CONFIG.name}
                </span>
                <div className="text-xs text-muted-foreground">
                  {DEPLOYMENT_ACTIVITY_CONFIG.description}
                </div>
              </div>
            </div>
            <div className="px-5 pb-5">
              <ChartContainer
                config={DEPLOYMENT_ACTIVITY_CONFIG.chart}
                className="w-full"
                maxHeight={220}
              >
                <BarChart
                  data={DEPLOYMENT_ACTIVITY_DATA}
                  margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                >
                  <CartesianGrid
                    horizontal
                    vertical={false}
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    opacity={0.3}
                  />
                  <ChartTooltip
                    content={<DemoChartTooltip />}
                    cursor={{ fill: "var(--color-activity)", opacity: 0.35, radius: 4 }}
                    offset={20}
                    allowEscapeViewBox={{ x: true, y: true }}
                    wrapperStyle={{ zIndex: 9999, pointerEvents: "none" }}
                  />
                  <Bar dataKey="activity" fill="var(--color-activity)" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {DEPLOYMENT_ACTIVITY_DATA.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill="var(--color-activity)"
                        opacity={isWeekend(new Date(entry.date)) ? 0.5 : 1}
                      />
                    ))}
                  </Bar>
                  <YAxis tickLine={false} axisLine={false} width={50} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    tickMargin={8}
                    axisLine={false}
                    interval="equidistantPreserveStart"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      if (!isNaN(date.getTime())) {
                        return `${date.toLocaleDateString("en-US", { month: "short" })} ${date.getDate()}`;
                      }
                      return value;
                    }}
                  />
                </BarChart>
              </ChartContainer>
            </div>
          </ChartCard>

          <GlassCard gradientColor="default" className="p-4 sm:p-5">
            <div className="space-y-3">
              <SectionHeader icon={ClockCounterClockwise} title="Recent Timeline" />
              <Typography variant="secondary" className="text-xs">Latest rollout events from the command log</Typography>
              <div className="space-y-2">
                {RECENT_ACTIVITY.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <Typography className="text-sm font-medium">{entry.title}</Typography>
                      <Typography variant="secondary" className="text-xs whitespace-nowrap">{entry.at}</Typography>
                    </div>
                    <Typography variant="secondary" className="mt-1 text-xs">{entry.description}</Typography>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        </div>

        <div className="space-y-4">
          <CategoryTabs
            categories={categories}
            selectedCategory={activeTab}
            onSelect={(id) => setActiveTab(id as ActiveTab)}
          />

          {activeTab === "operations" && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <GlassCard gradientColor="default" className="overflow-hidden">
                <div className="p-5">
                  <div className="flex w-full items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <SectionHeader icon={SquaresFourIcon} title="Open Incidents" />
                      <Typography variant="secondary" className="text-sm mt-1">Operational incident queue with owners and current mitigation state</Typography>
                    </div>
                    {incidentTable && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <DataTableViewOptions
                          key={JSON.stringify(incidentTableVisibility)}
                          table={incidentTable}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-black/[0.12] dark:border-white/[0.06] px-5 pb-5 [&_div.rounded-md.border]:border-0 [&_div.rounded-md.border]:shadow-none">
                  <DataTable
                    columns={incidentColumns}
                    data={INCIDENTS}
                    defaultColumnFilters={[]}
                    defaultSorting={[{ id: "severity", desc: false }]}
                    showDefaultToolbar={false}
                    showResetFilters={false}
                    toolbarRender={(table) => (
                      <TableInstanceBridge
                        tableInstance={table}
                        onTableInstance={setIncidentTable}
                        onVisibilityChange={setIncidentTableVisibility}
                      />
                    )}
                  />
                </div>
              </GlassCard>

              <div className="space-y-4 sm:space-y-6">
                <GlassCard gradientColor="default" className="p-5">
                  <SectionHeader icon={ShieldCheck} title="Rollout Controls" />
                  <Typography variant="secondary" className="mt-1 text-xs">Launch configuration used by the release coordinator</Typography>
                  <div className="mt-4">
                    <div className="relative rounded-2xl overflow-hidden bg-white/90 dark:bg-[hsl(240,10%,5.5%)] border border-black/[0.12] dark:border-foreground/[0.12] shadow-sm">
                      <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.03] to-transparent pointer-events-none" />
                      <div className="relative p-5">
                        <EditableGrid items={settingsGridItems} columns={1} className="gap-x-6 gap-y-3" />
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 space-y-4">
                    <div className="flex items-center justify-between rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-background/60 px-3 py-3">
                      <div>
                        <Typography className="text-sm font-medium">Compact mode</Typography>
                        <Typography variant="secondary" className="text-xs">Use denser spacing on operator displays</Typography>
                      </div>
                      <Switch checked={compactMode} onCheckedChange={setCompactMode} />
                    </div>
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="include-backfill"
                        checked={includeBackfill}
                        onCheckedChange={(checked) => setIncludeBackfill(checked === true)}
                      />
                      <label htmlFor="include-backfill" className="text-sm leading-5 text-muted-foreground">Include historical events in rollout checks</label>
                    </div>
                  </div>
                </GlassCard>

              </div>
            </div>
          )}

          {activeTab === "milestones" && (
            <GlassCard gradientColor="default" className="p-4 sm:p-5">
              <div className="grid gap-2.5">
                {MILESTONES.map((milestone) => {
                  const style = MILESTONE_META.get(milestone.status);
                  if (!style) throw new Error(`Unknown milestone status: ${milestone.status}`);

                  return (
                    <div key={milestone.id} className="flex items-center justify-between gap-3 rounded-xl border border-black/[0.08] dark:border-white/[0.08] px-3 py-2.5">
                      <div className="min-w-0">
                        <Typography className="truncate text-sm font-medium">{milestone.title}</Typography>
                        <Typography variant="secondary" className="text-xs">Owner: {milestone.owner} · Due: {milestone.dueDate}</Typography>
                      </div>
                      <StatusBadge label={style.label} color={style.color} size="sm" />
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          )}

          {activeTab === "settings" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <GlassCard gradientColor="default" className="p-4 sm:p-5">
                <SectionHeader icon={Bell} title="Notification Channel" />
                <Typography variant="secondary" className="mt-1 text-xs">Where rollout updates are broadcast</Typography>
                <div className="mt-4 space-y-3">
                  <Input value="#ops-release-watch" readOnly />
                  <Select value={notificationFrequency} onValueChange={setNotificationFrequency}>
                    <SelectTrigger className="h-8 px-3 text-xs rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="every_update">Send every update</SelectItem>
                      <SelectItem value="critical_only">Only critical updates</SelectItem>
                      <SelectItem value="hourly_digest">Hourly digest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </GlassCard>

              <GlassCard gradientColor="default" className="p-4 sm:p-5">
                <SectionHeader icon={UserCircle} title="Recent Responders" />
                <Typography variant="secondary" className="mt-1 text-xs">On-call team members and recent SLA status</Typography>
                <div className="mt-4 space-y-2">
                  {["NR", "DP", "AS", "MJ"].map((initials) => (
                    <div key={initials} className="flex items-center gap-3 rounded-xl border border-black/[0.08] dark:border-white/[0.08] px-3 py-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs font-semibold">{initials}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <Typography className="text-sm font-medium">{initials} · On call</Typography>
                        <Typography variant="secondary" className="text-xs">Responded within SLA</Typography>
                      </div>
                      <StatusBadge label="Online" color="green" size="sm" />
                    </div>
                  ))}
                </div>
              </GlassCard>
            </div>
          )}
        </div>

      </div>
    </PageLayout>
  );
}
