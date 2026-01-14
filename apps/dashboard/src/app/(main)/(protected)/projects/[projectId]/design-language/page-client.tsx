"use client";

import { AppIcon } from "@/components/app-square";
import { CodeBlock } from "@/components/code-block";
import { Link } from "@/components/link";
import { useRouter } from "@/components/router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Typography,
  cn,
} from "@/components/ui";
import {
  ArrowSquareOut,
  BookOpenText,
  CaretUpIcon,
  CheckCircle,
  Code,
  CompassIcon,
  Cube,
  DotsThree,
  DotsThreeIcon,
  Envelope,
  FileText,
  GlobeIcon,
  HardDrive,
  MagnifyingGlassIcon,
  Palette,
  PencilSimple,
  PlusIcon,
  Sliders,
  SquaresFourIcon,
  Trash,
  WarningCircle,
  WarningCircleIcon,
  XCircle
} from "@phosphor-icons/react";
import { useState } from "react";
import {
  AuthMethodDatapoint,
  DataPoint,
  DonutChartDisplay,
  TabbedMetricsCard,
  TimeRange,
  TimeRangeToggle
} from "../(overview)/line-chart";
import { MetricsLoadingFallback } from "../(overview)/metrics-loading";
import { PageLayout } from "../page-layout";

import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";

// =============================================================================
// COMPONENT DISPLAY WRAPPER
// Wraps each component demo with title, description, and code preview
// =============================================================================
function ComponentDemo({
  title,
  description,
  children,
  code,
}: {
  title: string,
  description?: string,
  children: React.ReactNode,
  code?: string,
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Typography type="h3" className="text-lg font-semibold">{title}</Typography>
          {description && (
            <Typography variant="secondary" className="text-sm mt-1">{description}</Typography>
          )}
        </div>
      </div>

      {/* Preview */}
      <div className="p-6 rounded-xl bg-muted/30 border border-border/50">
        {children}
      </div>
    </div>
  );
}

// =============================================================================
// COMPONENT PROPS TABLE
// Displays component props in a table format
// =============================================================================
function PropsTable({
  props,
}: {
  props: Array<{ name: string, type: string, default?: string, description: string }>,
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50">
            <th className="text-left py-2 px-3 font-semibold text-foreground">Prop</th>
            <th className="text-left py-2 px-3 font-semibold text-foreground">Type</th>
            <th className="text-left py-2 px-3 font-semibold text-foreground">Default</th>
            <th className="text-left py-2 px-3 font-semibold text-foreground">Description</th>
          </tr>
        </thead>
        <tbody>
          {props.map((prop) => (
            <tr key={prop.name} className="border-b border-border/30">
              <td className="py-2 px-3 font-mono text-xs text-blue-600 dark:text-blue-400">{prop.name}</td>
              <td className="py-2 px-3 font-mono text-xs text-muted-foreground">{prop.type}</td>
              <td className="py-2 px-3 font-mono text-xs text-muted-foreground">{prop.default || "—"}</td>
              <td className="py-2 px-3 text-muted-foreground">{prop.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// GLASSMORPHIC CARD COMPONENT
// From: DESIGN-GUIDE.md - "Glassmorphism & Surfaces" section
// Used in: emails/page-client.tsx, email-themes/page-client.tsx, email-drafts/page-client.tsx
// Key CSS: bg-background/60 backdrop-blur-xl ring-1 ring-foreground/[0.06]
// CRITICAL: Always use "transition-all duration-150 hover:transition-none"
// =============================================================================
// Main section card - NO hover tints (to avoid affecting nested components)
function GlassCard({
  children,
  className,
}: {
  children: React.ReactNode,
  className?: string,
  gradientColor?: "blue" | "purple" | "green" | "orange" | "slate" | "cyan", // kept for API compatibility
}) {
  return (
    <div className={cn(
      "relative rounded-2xl bg-background/60 backdrop-blur-xl",
      "ring-1 ring-foreground/[0.06]",
      "shadow-sm",
      className
    )}>
      <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
      <div className="relative">
        {children}
      </div>
    </div>
  );
}

// Demo card WITH hover tints - used only for demonstrating the hover effect
function GlassCardWithTint({
  children,
  className,
  gradientColor = "slate",
}: {
  children: React.ReactNode,
  className?: string,
  gradientColor: "blue" | "purple" | "green" | "orange" | "slate" | "cyan",
}) {
  const hoverTints: Record<string, string> = {
    blue: "group-hover/tint:bg-blue-500/[0.02]",
    purple: "group-hover/tint:bg-purple-500/[0.02]",
    green: "group-hover/tint:bg-emerald-500/[0.02]",
    orange: "group-hover/tint:bg-orange-500/[0.02]",
    slate: "group-hover/tint:bg-slate-500/[0.015]",
    cyan: "group-hover/tint:bg-cyan-500/[0.02]",
  };

  return (
    <div className={cn(
      "group/tint relative rounded-2xl bg-background/60 backdrop-blur-xl transition-all duration-150 hover:transition-none",
      "ring-1 ring-foreground/[0.06] hover:ring-foreground/[0.1]",
      "shadow-sm hover:shadow-md",
      className
    )}>
      <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
      <div className={cn(
        "absolute inset-0 transition-colors duration-150 group-hover/tint:transition-none pointer-events-none rounded-2xl overflow-hidden",
        hoverTints[gradientColor]
      )} />
      <div className="relative">
        {children}
      </div>
    </div>
  );
}

// =============================================================================
// SECTION HEADER WITH ICON
// From: DESIGN-GUIDE.md - "Component Patterns" > "Section Header with Icon"
// Used in: All email pages, metrics-page.tsx
// Pattern: Icon in bg-foreground/[0.04] container + uppercase tracking label
// =============================================================================
function SectionHeader({ icon: Icon, title }: { icon: React.ElementType, title: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="p-1.5 rounded-lg bg-foreground/[0.04]">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
        {title}
      </span>
    </div>
  );
}

// =============================================================================
// STATUS BADGE COMPONENT
// From: emails/page-client.tsx - StatusBadge component
// Used for: Email status, operation results, health indicators
// Colors: emerald (sent), amber (pending), red (failed) with /10 bg and /20 ring
// =============================================================================
function StatusBadge({ status }: { status: 'sent' | 'failed' | 'pending' }) {
  if (status === 'sent') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-500/20">
        <CheckCircle className="h-3 w-3" />
        Sent
      </div>
    );
  }
  if (status === 'pending') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 ring-1 ring-amber-500/20">
        <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
        Pending
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium text-red-600 dark:text-red-400 bg-red-500/10 ring-1 ring-red-500/20">
      <XCircle className="h-3 w-3" />
      Failed
    </div>
  );
}

// =============================================================================
// CATEGORY TABS (UNDERLINE STYLE)
// From: apps/page-client.tsx - Category tabs with counts and underline indicator
// Used for: Filtering lists, category navigation
// Features: Count badges, underline indicator for active, horizontal scroll
// =============================================================================
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
    <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 overflow-x-auto flex-nowrap [&::-webkit-scrollbar]:hidden">
      {categories.map((category) => {
        const isActive = selectedCategory === category.id;
        return (
          <button
            key={category.id}
            onClick={() => onSelect(category.id)}
            className={cn(
              "px-4 py-3 text-sm font-medium transition-all relative flex-shrink-0 whitespace-nowrap",
              "hover:text-gray-900 dark:hover:text-gray-100",
              isActive ? "text-blue-600 dark:text-blue-400" : "text-gray-600 dark:text-gray-400"
            )}
          >
            <span className="flex items-center gap-2">
              {category.label}
              <span className={cn(
                "text-xs px-1.5 py-0.5 rounded-full",
                isActive
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
              )}>
                {category.count}
              </span>
            </span>
            {isActive && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// =============================================================================
// PILL TOGGLE / VIEWPORT SELECTOR
// From: DESIGN-GUIDE.md - "Time Range Toggle (Pill Buttons)"
// Used in: metrics-page.tsx, email-themes/page-client.tsx (ViewportSelector)
// Container: rounded-xl bg-foreground/[0.04] p-1 backdrop-blur-sm
// Active: bg-background shadow-sm ring-1 ring-foreground/[0.06]
// =============================================================================
function ViewportSelector({
  options,
  selected,
  onSelect,
}: {
  options: Array<{ id: string, label: string, icon: React.ElementType }>,
  selected: string,
  onSelect: (id: string) => void,
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-foreground/[0.04] p-1 backdrop-blur-sm">
      {options.map((option) => {
        const isActive = selected === option.id;
        const Icon = option.icon;
        return (
          <button
            key={option.id}
            onClick={() => onSelect(option.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-150 hover:transition-none",
              isActive
                ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.06]"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// =============================================================================
// LIST ITEM ROW (EMAIL TEMPLATES STYLE)
// From: email-templates/page-client.tsx - Template list item pattern
// Used for: Lists of templates, themes, configurations
// Features: Icon container with hover, edit button, dropdown menu
// =============================================================================
function ListItemRow({
  icon: Icon,
  title,
  onEdit,
  onDelete,
}: {
  icon: React.ElementType,
  title: string,
  onEdit?: () => void,
  onDelete?: () => void,
}) {
  return (
    <div className={cn(
      "group relative flex items-center justify-between p-4 rounded-2xl transition-all duration-150 hover:transition-none",
      "bg-background/60 backdrop-blur-xl ring-1 ring-foreground/[0.06] hover:ring-foreground/[0.1]",
      "shadow-sm hover:shadow-md"
    )}>
      <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
      <div className="relative flex items-center gap-4">
        <div className="p-2.5 rounded-xl bg-foreground/[0.04] ring-1 ring-foreground/[0.06] transition-colors duration-150 group-hover:bg-foreground/[0.08] group-hover:transition-none">
          <Icon className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors duration-150 group-hover:transition-none" />
        </div>
        <Typography className="font-semibold text-foreground">{title}</Typography>
      </div>
      <div className="relative flex items-center gap-2">
        {onEdit && (
          <Button variant="ghost" size="sm" className="h-8 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] rounded-lg" onClick={onEdit}>
            Edit
          </Button>
        )}
        {onDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] rounded-lg">
                <DotsThree size={20} weight="bold" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuItem onClick={onDelete} className="py-2.5 text-red-600 dark:text-red-400 focus:bg-red-500/10 cursor-pointer justify-center">
                <span className="font-medium">Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// DEMO COMPONENTS (for showcasing overview page patterns)
// =============================================================================

function UnderlineTabsDemo() {
  const [activeTab, setActiveTab] = useState<'chart' | 'list'>('chart');
  return (
    <div className="flex items-center gap-1 border-b border-foreground/[0.05]">
      {[
        { id: 'chart', label: 'Daily Active Users' },
        { id: 'list', label: 'Recently Active' },
      ].map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id as 'chart' | 'list')}
          className={cn(
            "relative px-3 py-3.5 text-xs font-medium transition-all duration-150 hover:transition-none rounded-t-lg",
            activeTab === tab.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
          {activeTab === tab.id && (
            <div className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-cyan-500 dark:bg-[hsl(200,91%,70%)]" />
          )}
        </button>
      ))}
    </div>
  );
}

function UserListItemDemo() {
  const users = [
    { name: "John Doe", email: "john@example.com", time: "Active 2h ago", color: "cyan" },
    { name: "Jane Smith", email: "jane@example.com", time: "Active 5h ago", color: "blue" },
  ];
  return (
    <div className="space-y-0.5 max-w-md">
      {users.map((user) => (
        <button
          key={user.email}
          className={cn(
            "w-full flex items-center gap-3 p-2.5 rounded-xl transition-all duration-150 hover:transition-none text-left group",
            user.color === "cyan" ? "hover:bg-cyan-500/[0.06]" : "hover:bg-blue-500/[0.06]"
          )}
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-medium shrink-0">
            {user.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate text-foreground">{user.name}</div>
            <div className="text-[11px] text-muted-foreground truncate">{user.time}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function ChartTooltipDemo() {
  return (
    <div className="rounded-xl bg-background/95 px-3.5 py-2.5 shadow-lg backdrop-blur-xl ring-1 ring-foreground/[0.08] w-fit">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-medium text-muted-foreground tracking-wide">
          Jan 15, 2024
        </span>
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full ring-2 ring-white/20 bg-cyan-500" />
          <span className="text-[11px] text-muted-foreground">Activity</span>
          <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">1,234</span>
        </div>
      </div>
    </div>
  );
}

function LegendPillsDemo() {
  const items = [
    { label: "Google", color: "#DB4437", percentage: 45 },
    { label: "GitHub", color: "#181717", percentage: 30 },
    { label: "Email", color: "#F59E0B", percentage: 25 },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-1.5 rounded-full bg-foreground/[0.03] ring-1 ring-foreground/[0.06] transition-colors duration-150 hover:transition-none hover:bg-foreground/[0.05] px-3 py-1.5 text-xs cursor-pointer"
        >
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
          <span className="font-medium text-foreground">{item.label}</span>
          <span className="text-muted-foreground">{item.percentage}%</span>
        </div>
      ))}
    </div>
  );
}

function LoadingStateDemo() {
  return (
    <div className="flex flex-col items-center justify-center py-8 space-y-4">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <div className="text-center space-y-1">
        <p className="text-sm font-medium">Recalculating metrics...</p>
        <p className="text-xs text-muted-foreground">Please check back later</p>
      </div>
    </div>
  );
}

function FrameworkSelectorDemo() {
  const [selected, setSelected] = useState<string>('nextjs');
  const frameworks = [
    { id: 'nextjs', name: 'Next.js', icon: '▲' },
    { id: 'react', name: 'React', icon: '⚛' },
    { id: 'js', name: 'JavaScript', icon: 'JS' },
    { id: 'python', name: 'Python', icon: '🐍' },
  ];
  return (
    <div className="flex gap-4 flex-wrap">
      {frameworks.map((fw) => (
        <Button
          key={fw.id}
          variant={selected === fw.id ? 'secondary' : 'ghost'}
          className="h-24 w-24 flex flex-col items-center justify-center gap-2"
          onClick={() => setSelected(fw.id)}
        >
          <span className="text-2xl">{fw.icon}</span>
          <Typography type="label">{fw.name}</Typography>
        </Button>
      ))}
    </div>
  );
}

function StepIndicatorDemo() {
  const steps = [
    { step: 1, title: "Select framework", done: true },
    { step: 2, title: "Install dependencies", done: true },
    { step: 3, title: "Configure keys", done: false },
  ];
  return (
    <ol className="relative text-gray-500 border-s border-gray-200 dark:border-gray-700 ml-4">
      {steps.map((item) => (
        <li key={item.step} className="ms-6 mb-8 last:mb-0">
          <span className={cn(
            "absolute flex items-center justify-center w-8 h-8 rounded-full -start-4 ring-4 ring-white dark:ring-gray-900",
            item.done ? "bg-green-500 text-white" : "bg-gray-100 dark:bg-gray-700"
          )}>
            {item.done ? (
              <CheckCircle className="w-4 h-4" weight="bold" />
            ) : (
              <span className="text-gray-500 dark:text-gray-400 font-medium text-sm">{item.step}</span>
            )}
          </span>
          <h3 className={cn("font-medium leading-tight", item.done ? "text-foreground" : "text-muted-foreground")}>
            {item.title}
          </h3>
        </li>
      ))}
    </ol>
  );
}


function QuickAccessGridDemo() {
  const [expanded, setExpanded] = useState(false);
  const apps = expanded ? DEMO_APP_IDS : DEMO_APP_IDS.slice(0, 4);

  return (
    <div className="shrink-0">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2">
        {apps.map((appId) => (
          <Link
            key={appId}
            href="#"
            className="group flex flex-col items-center gap-2.5 pt-3 pb-2 rounded-xl hover:bg-foreground/[0.03] transition-all duration-750 hover:transition-none"
            title={ALL_APPS[appId].displayName}
          >
            <div className="relative transition-transform duration-750 group-hover:transition-none group-hover:scale-105">
              <AppIcon
                appId={appId}
                variant="installed"
                className="shadow-sm group-hover:shadow-[0_0_20px_rgba(59,130,246,0.45)] group-hover:brightness-110 group-hover:saturate-110 transition-all duration-750 group-hover:transition-none"
              />
            </div>
            <span
              className="text-[11px] font-medium text-center group-hover:text-foreground transition-colors duration-750 group-hover:transition-none leading-tight w-full"
              title={ALL_APPS[appId].displayName}
            >
              {ALL_APPS[appId].displayName}
            </span>
          </Link>
        ))}
        <Link
          href="#"
          className="group flex flex-col items-center gap-2.5 pt-3 pb-2 rounded-xl hover:bg-foreground/[0.03] transition-all duration-750 hover:transition-none"
          title="Explore all apps"
        >
          <div className="relative transition-transform duration-750 group-hover:transition-none group-hover:scale-105">
            <div className="flex items-center justify-center w-[72px] h-[72px]">
              <CompassIcon className="w-[30px] h-[30px] text-muted-foreground group-hover:text-foreground transition-colors duration-750 group-hover:transition-none" />
            </div>
          </div>
          <span className="text-[11px] font-medium text-center text-muted-foreground group-hover:text-foreground transition-colors duration-750 group-hover:transition-none leading-tight w-full">
            Explore
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="group flex flex-col items-center gap-2.5 pt-3 pb-2 rounded-xl hover:bg-foreground/[0.03] transition-all duration-750 hover:transition-none"
          title={expanded ? "Show less" : "See all"}
        >
          <div className="relative transition-transform duration-750 group-hover:transition-none group-hover:scale-105">
            <div className="flex items-center justify-center w-[72px] h-[72px]">
              {expanded ? (
                <CaretUpIcon className="w-[30px] h-[30px] text-muted-foreground group-hover:text-foreground transition-colors duration-750 group-hover:transition-none" />
              ) : (
                <DotsThreeIcon className="w-[30px] h-[30px] text-muted-foreground group-hover:text-foreground transition-colors duration-750 group-hover:transition-none" />
              )}
            </div>
          </div>
          <span className="text-[11px] font-medium text-center text-muted-foreground group-hover:text-foreground transition-colors duration-750 group-hover:transition-none leading-tight w-full">
            {expanded ? "Less" : "See all"}
          </span>
        </button>
      </div>
    </div>
  );
}

function MetricStatCalloutDemo() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 rounded-lg bg-foreground/[0.04]">
          <GlobeIcon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Total Users
        </span>
      </div>
      <div className="text-4xl font-bold tracking-tight text-foreground pl-0.5">
        128,456
      </div>
    </div>
  );
}


// Static chart data for demos (avoids hydration issues)
const DEMO_CHART_DATA: DataPoint[] = [
  { date: "2024-01-01", activity: 120 },
  { date: "2024-01-02", activity: 150 },
  { date: "2024-01-03", activity: 90 },
  { date: "2024-01-04", activity: 180 },
  { date: "2024-01-05", activity: 60 },
  { date: "2024-01-06", activity: 45 },
  { date: "2024-01-07", activity: 200 },
  { date: "2024-01-08", activity: 170 },
  { date: "2024-01-09", activity: 130 },
  { date: "2024-01-10", activity: 160 },
  { date: "2024-01-11", activity: 140 },
  { date: "2024-01-12", activity: 110 },
  { date: "2024-01-13", activity: 55 },
  { date: "2024-01-14", activity: 190 },
];

const DEMO_AUTH_DATA: AuthMethodDatapoint[] = [
  { method: "google", count: 450 },
  { method: "github", count: 300 },
  { method: "email", count: 250 },
  { method: "microsoft", count: 120 },
];

const DEMO_APP_IDS = (Object.keys(ALL_APPS) as AppId[]).slice(0, 6);

export default function PageClient() {
  const router = useRouter();

  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedViewport, setSelectedViewport] = useState("phone");
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [switchChecked, setSwitchChecked] = useState(false);
  const [checkboxChecked, setCheckboxChecked] = useState(false);
  const [listAction, setListAction] = useState<"edit" | "delete" | null>(null);

  const categories = [
    { id: "all", label: "All Items", count: 24 },
    { id: "active", label: "Active", count: 12 },
    { id: "draft", label: "Drafts", count: 8 },
    { id: "archived", label: "Archived", count: 4 },
  ];

  const viewportOptions = [
    { id: "phone", label: "Phone", icon: Envelope },
    { id: "tablet", label: "Tablet", icon: Palette },
    { id: "desktop", label: "Desktop", icon: HardDrive },
  ];

  return (
    <PageLayout
      title="Design System"
      description="Component library documentation with variants, props, and usage examples"
    >
      <div className="flex flex-col gap-12">

        {/* ============================================================ */}
        {/* TYPOGRAPHY */}
        {/* ============================================================ */}
        <GlassCard gradientColor="slate">
          <div className="p-6 border-b border-foreground/[0.05]">
            <SectionHeader icon={BookOpenText} title="Typography" />
            <Typography variant="secondary" className="text-sm mt-2">
              Text styles and hierarchy using Geist Sans
            </Typography>
          </div>
          <div className="p-6 space-y-8">

            <ComponentDemo
              title="Heading Levels"
              description="Different heading sizes"
            >
              <div className="space-y-3">
                <Typography type="h1">Heading 1 - Largest</Typography>
                <Typography type="h2">Heading 2 - Large</Typography>
                <Typography type="h3">Heading 3 - Medium</Typography>
                <Typography type="h4">Heading 4 - Small</Typography>
              </div>
            </ComponentDemo>

            <ComponentDemo
              title="Body Text"
              description="Paragraph, label, and footnote styles"
            >
              <div className="space-y-3">
                <Typography type="p">Paragraph text for body content.</Typography>
                <Typography type="label">Label text for form fields</Typography>
                <Typography type="footnote">Footnote text for small print</Typography>
              </div>
            </ComponentDemo>

            <ComponentDemo
              title="Color Variants"
              description="Text color variations"
              code={`<Typography variant="primary">Primary text</Typography>
<Typography variant="secondary">Secondary text</Typography>
<Typography variant="destructive">Error text</Typography>
<Typography variant="success">Success text</Typography>`}
            >
              <div className="flex flex-wrap gap-4">
                <Typography variant="primary">Primary</Typography>
                <Typography variant="secondary">Secondary</Typography>
                <Typography variant="destructive">Destructive</Typography>
                <Typography variant="success">Success</Typography>
              </div>
            </ComponentDemo>

            <div className="pt-4 border-t border-foreground/[0.05]">
              <Typography type="label" className="font-semibold mb-3">Props</Typography>
              <PropsTable props={[
                { name: "type", type: "'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'label' | 'footnote'", default: "'p'", description: "Text style and size" },
                { name: "variant", type: "'primary' | 'secondary' | 'destructive' | 'success'", default: "'primary'", description: "Text color" },
              ]} />
            </div>
          </div>
        </GlassCard>

        {/* ============================================================ */}
        {/* DESIGN TOKENS */}
        {/* ============================================================ */}
        <GlassCard>
          <div className="p-6 border-b border-foreground/[0.05]">
            <SectionHeader icon={Palette} title="Design Tokens" />
            <Typography variant="secondary" className="text-sm mt-2">
              Core design values: colors, spacing, and transitions
            </Typography>
          </div>
          <div className="p-6 space-y-8">

            <div className="space-y-4">
              <Typography type="label" className="font-semibold">Opacity Layers</Typography>
              <Typography variant="secondary" className="text-sm">
                Foreground-based opacity values for consistent light/dark mode
              </Typography>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { opacity: "0.02", label: "Gradient overlay", usage: "Card gradients" },
                  { opacity: "0.03", label: "Subtle hover", usage: "Hover backgrounds" },
                  { opacity: "0.04", label: "Icon backgrounds", usage: "Icon containers" },
                  { opacity: "0.05", label: "More visible", usage: "Borders, dividers" },
                  { opacity: "0.06", label: "Active/ring", usage: "Focus rings, active states" },
                  { opacity: "0.10", label: "Prominent", usage: "Strong backgrounds" },
                ].map(({ opacity, label, usage }) => (
                  <div key={opacity} className="flex items-center gap-3 p-3 rounded-lg bg-foreground/[0.04]">
                    <div className="w-10 h-10 rounded shrink-0" style={{ backgroundColor: `hsl(var(--foreground) / ${opacity})` }} />
                    <div className="min-w-0">
                      <div className="text-xs font-mono text-foreground font-semibold">{opacity}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{usage}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-foreground/[0.05] space-y-4">
              <Typography type="label" className="font-semibold">Accent Colors</Typography>
              <div className="flex flex-wrap gap-2">
                <div className="px-3 py-2 rounded-lg bg-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-medium">Blue (Primary)</div>
                <div className="px-3 py-2 rounded-lg bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 text-xs font-medium">Cyan (DAU)</div>
                <div className="px-3 py-2 rounded-lg bg-purple-500/20 text-purple-600 dark:text-purple-400 text-xs font-medium">Purple (Features)</div>
                <div className="px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium">Green (Success)</div>
                <div className="px-3 py-2 rounded-lg bg-orange-500/20 text-orange-600 dark:text-orange-400 text-xs font-medium">Orange (Warning)</div>
              </div>
            </div>

            <div className="pt-4 border-t border-foreground/[0.05] space-y-4">
              <Typography type="label" className="font-semibold">⚡ Transition Guidelines</Typography>
              <Alert className="bg-green-500/5 border-green-500/20">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <AlertTitle className="text-green-600 dark:text-green-400">✓ CORRECT Pattern</AlertTitle>
                <AlertDescription>
                  <code className="text-xs block mt-1">transition-all duration-150 hover:transition-none</code>
                  <Typography variant="secondary" className="text-xs mt-1">Instant on hover-in, smooth on hover-out</Typography>
                </AlertDescription>
              </Alert>
              <Alert className="bg-red-500/5 border-red-500/20">
                <XCircle className="h-4 w-4 text-red-500" />
                <AlertTitle className="text-red-600 dark:text-red-400">✗ WRONG Pattern</AlertTitle>
                <AlertDescription>
                  <code className="text-xs block mt-1">transition-all duration-300</code>
                  <Typography variant="secondary" className="text-xs mt-1">Causes sluggish UI with hover-in delays</Typography>
                </AlertDescription>
              </Alert>
              <div className="p-4 bg-muted/30 rounded-xl">
                <Typography type="label" className="font-semibold mb-2">Duration Values:</Typography>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div><code className="text-foreground">duration-150</code> — Standard interactions (buttons, cards)</div>
                  <div><code className="text-foreground">duration-200</code> — Layout changes (sidebar, drawers)</div>
                  <div><code className="text-foreground">duration-750</code> — Ambient effects (icon glows)</div>
                </div>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* ============================================================ */}
        {/* CODE BLOCK */}
        {/* ============================================================ */}
        <GlassCard gradientColor="slate">
          <div className="p-6 border-b border-foreground/[0.05]">
            <SectionHeader icon={Code} title="Code Block" />
            <Typography variant="secondary" className="text-sm mt-2">
              Syntax-highlighted code display with copy button
            </Typography>
          </div>
          <div className="p-6 space-y-8">

            <ComponentDemo
              title="Terminal Command"
              description="Bash/shell commands"
            >
              <CodeBlock
                language="bash"
                content="npx @stackframe/init-stack@latest"
                title="Terminal"
                icon="terminal"
              />
            </ComponentDemo>

            <ComponentDemo
              title="TypeScript Code"
              description="Code file with syntax highlighting"
            >
              <CodeBlock
                language="typescript"
                content={`import { StackClientApp } from "@stackframe/react";

export const stackClientApp = new StackClientApp({
  projectId: "your-project-id",
  publishableClientKey: "pk_test_...",
  tokenStore: "cookie",
});`}
                title="stack/client.ts"
                icon="code"
              />
            </ComponentDemo>
          </div>
        </GlassCard>

        {/* ============================================================ */}
        {/* GLASSCARD COMPONENT */}
        {/* ============================================================ */}
        <GlassCard gradientColor="purple">
          <div className="p-6 border-b border-foreground/[0.05]">
            <SectionHeader icon={Palette} title="GlassCard" />
            <Typography variant="secondary" className="text-sm mt-2">
              Glassmorphic card with backdrop blur and accent hover tints
            </Typography>
          </div>
          <div className="p-6 space-y-8">

            <ComponentDemo
              title="Gradient Colors"
              description="Different accent colors that appear on hover"
              code={`<GlassCard gradientColor="blue">
  <div className="p-4">
    <Typography>Blue accent</Typography>
  </div>
</GlassCard>`}
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {(["blue", "cyan", "purple", "green", "orange", "slate"] as const).map((color) => (
                  <GlassCardWithTint key={color} gradientColor={color}>
                    <div className="p-4">
                      <SectionHeader icon={Cube} title={color} />
                      <Typography variant="secondary" className="text-xs mt-2">
                        Hover to see {color} tint
                      </Typography>
                    </div>
                  </GlassCardWithTint>
                ))}
              </div>
            </ComponentDemo>

            <div className="pt-4 border-t border-foreground/[0.05]">
              <Typography type="label" className="font-semibold mb-3">Key Features</Typography>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• <code className="text-xs">bg-background/60 backdrop-blur-xl</code> for glass effect</li>
                <li>• <code className="text-xs">ring-1 ring-foreground/[0.06]</code> for soft border</li>
                <li>• Gradient overlay <code className="text-xs">from-foreground/[0.02]</code> for depth</li>
                <li>• Accent hover tints based on gradientColor prop</li>
                <li>• Hover-exit transitions only (<code className="text-xs">hover:transition-none</code>)</li>
              </ul>
            </div>

            <div className="pt-4 border-t border-foreground/[0.05]">
              <Typography type="label" className="font-semibold mb-3">Props</Typography>
              <PropsTable props={[
                { name: "gradientColor", type: "'blue' | 'cyan' | 'purple' | 'green' | 'orange' | 'slate'", default: "'slate'", description: "Accent color that appears on hover" },
                { name: "children", type: "ReactNode", description: "Content of the card" },
                { name: "className", type: "string", description: "Additional CSS classes" },
              ]} />
            </div>
          </div>
        </GlassCard>

        {/* ============================================================ */}
        {/* BUTTON COMPONENT */}
        {/* ============================================================ */}
        <GlassCard gradientColor="blue">
          <div className="p-6 border-b border-foreground/[0.05]">
            <SectionHeader icon={Sliders} title="Button" />
            <Typography variant="secondary" className="text-sm mt-2">
              Interactive button component with multiple variants and sizes
            </Typography>
          </div>
          <div className="p-6 space-y-8">

            <ComponentDemo
              title="Variants"
              description="Different visual styles for various contexts"
              code={`<Button variant="default">Default</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>
<Button variant="destructive">Destructive</Button>`}
            >
              <div className="flex flex-wrap gap-3">
                <Button variant="default">Default</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="link">Link</Button>
                <Button variant="destructive">Destructive</Button>
              </div>
            </ComponentDemo>

            <ComponentDemo
              title="Sizes"
              description="Different button sizes"
              code={`<Button size="lg">Large</Button>
<Button size="default">Default</Button>
<Button size="sm">Small</Button>
<Button size="icon"><PlusIcon /></Button>`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg">Large</Button>
                <Button size="default">Default</Button>
                <Button size="sm">Small</Button>
                <Button size="icon"><PlusIcon className="h-4 w-4" /></Button>
              </div>
            </ComponentDemo>

            <ComponentDemo
              title="With Icons"
              description="Buttons with leading or trailing icons"
              code={`<Button>
  <PlusIcon className="h-4 w-4 mr-2" />
  Add Item
</Button>`}
            >
              <div className="flex flex-wrap gap-3">
                <Button><PlusIcon className="h-4 w-4 mr-2" />Add Item</Button>
                <Button variant="secondary"><ArrowSquareOut className="h-4 w-4 mr-2" />Open</Button>
                <Button variant="outline"><Trash className="h-4 w-4 mr-2" />Delete</Button>
              </div>
            </ComponentDemo>

            <ComponentDemo
              title="Loading State"
              description="Show loading spinner"
              code={`<Button loading>Loading...</Button>`}
            >
              <div className="flex flex-wrap gap-3">
                <Button loading>Loading...</Button>
                <Button variant="secondary" loading>Loading...</Button>
              </div>
            </ComponentDemo>

            <div className="pt-4 border-t border-foreground/[0.05]">
              <Typography type="label" className="font-semibold mb-3">Props</Typography>
              <PropsTable props={[
                { name: "variant", type: "'default' | 'secondary' | 'outline' | 'ghost' | 'link' | 'destructive'", default: "'default'", description: "Visual style of the button" },
                { name: "size", type: "'default' | 'sm' | 'lg' | 'icon'", default: "'default'", description: "Size of the button" },
                { name: "loading", type: "boolean", default: "false", description: "Show loading spinner" },
                { name: "disabled", type: "boolean", default: "false", description: "Disable the button" },
              ]} />
            </div>
          </div>
        </GlassCard>

        {/* ============================================================ */}
        {/* INPUT COMPONENT */}
        {/* ============================================================ */}
        <GlassCard gradientColor="slate">
          <div className="p-6 border-b border-foreground/[0.05]">
            <SectionHeader icon={PencilSimple} title="Input" />
            <Typography variant="secondary" className="text-sm mt-2">
              Text input fields with various configurations
            </Typography>
          </div>
          <div className="p-6 space-y-8">

            <ComponentDemo
              title="Basic Input"
              description="Standard text input"
              code={`<Label>Email</Label>
<Input placeholder="Enter your email..." />`}
            >
              <div className="max-w-md space-y-2">
                <Label>Email</Label>
                <Input placeholder="Enter your email..." />
              </div>
            </ComponentDemo>

            <ComponentDemo
              title="Search Input"
              description="Input with search icon"
              code={`<div className="relative">
  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
  <input className="w-full pl-10 pr-4 py-2.5..." placeholder="Search..." />
</div>`}
            >
              <div className="max-w-md relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search..."
                  className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
              </div>
            </ComponentDemo>

            <div className="pt-4 border-t border-foreground/[0.05]">
              <Typography type="label" className="font-semibold mb-3">Props</Typography>
              <PropsTable props={[
                { name: "prefixItem", type: "string", description: "Text to display before the input" },
                { name: "placeholder", type: "string", description: "Placeholder text" },
                { name: "disabled", type: "boolean", default: "false", description: "Disable the input" },
              ]} />
            </div>
          </div>
        </GlassCard>

        {/* ============================================================ */}
        {/* TOGGLE CONTROLS */}
        {/* ============================================================ */}
        <GlassCard gradientColor="blue">
          <div className="p-6 border-b border-foreground/[0.05]">
            <SectionHeader icon={Sliders} title="Toggle Controls" />
            <Typography variant="secondary" className="text-sm mt-2">
              Switch and checkbox components
            </Typography>
          </div>
          <div className="p-6 space-y-8">

            <ComponentDemo
              title="Switch"
              description="Toggle switch for boolean values"
              code={`const [checked, setChecked] = useState(false);

<Switch checked={checked} onCheckedChange={setChecked} />
<Label>Enable notifications</Label>`}
            >
              <div className="flex items-center gap-3">
                <Switch checked={switchChecked} onCheckedChange={setSwitchChecked} />
                <Label>{switchChecked ? "Enabled" : "Disabled"}</Label>
              </div>
            </ComponentDemo>

            <ComponentDemo
              title="Checkbox"
              description="Checkbox for multiple selections"
              code={`const [checked, setChecked] = useState(false);

<Checkbox checked={checked} onCheckedChange={setChecked} />
<Label>I agree to the terms</Label>`}
            >
              <div className="flex items-center gap-3">
                <Checkbox checked={checkboxChecked} onCheckedChange={(c) => setCheckboxChecked(!!c)} />
                <Label>{checkboxChecked ? "Checked" : "Unchecked"}</Label>
              </div>
            </ComponentDemo>

            <ComponentDemo
              title="Time Range Toggle"
              description="Pill-style toggle for time range selection"
            >
              <TimeRangeToggle timeRange={timeRange} onTimeRangeChange={setTimeRange} />
            </ComponentDemo>
          </div>
        </GlassCard>

        {/* ============================================================ */}
        {/* TABS COMPONENT */}
        {/* ============================================================ */}
        <GlassCard gradientColor="cyan">
          <div className="p-6 border-b border-foreground/[0.05]">
            <SectionHeader icon={Sliders} title="Tabs" />
            <Typography variant="secondary" className="text-sm mt-2">
              Tabbed navigation components
            </Typography>
          </div>
          <div className="p-6 space-y-8">

            <ComponentDemo
              title="Standard Tabs"
              description="Default tab component"
              code={`<Tabs defaultValue="tab1">
  <TabsList>
    <TabsTrigger value="tab1">Tab 1</TabsTrigger>
    <TabsTrigger value="tab2">Tab 2</TabsTrigger>
  </TabsList>
  <TabsContent value="tab1">Content 1</TabsContent>
  <TabsContent value="tab2">Content 2</TabsContent>
</Tabs>`}
            >
              <Tabs defaultValue="tab1">
                <TabsList>
                  <TabsTrigger value="tab1">Overview</TabsTrigger>
                  <TabsTrigger value="tab2">Settings</TabsTrigger>
                  <TabsTrigger value="tab3">Advanced</TabsTrigger>
                </TabsList>
                <TabsContent value="tab1" className="p-4 bg-muted/50 rounded-lg mt-2">
                  <Typography variant="secondary">Overview content goes here</Typography>
                </TabsContent>
                <TabsContent value="tab2" className="p-4 bg-muted/50 rounded-lg mt-2">
                  <Typography variant="secondary">Settings content goes here</Typography>
                </TabsContent>
                <TabsContent value="tab3" className="p-4 bg-muted/50 rounded-lg mt-2">
                  <Typography variant="secondary">Advanced content goes here</Typography>
                </TabsContent>
              </Tabs>
            </ComponentDemo>

            <ComponentDemo
              title="Category Tabs"
              description="Tabs with count badges and underline indicator"
            >
              <CategoryTabs categories={categories} selectedCategory={selectedCategory} onSelect={setSelectedCategory} />
            </ComponentDemo>

            <ComponentDemo
              title="Underline Tabs (Metrics)"
              description="Chart view tabs with colored underline indicator"
            >
              <UnderlineTabsDemo />
            </ComponentDemo>

            <ComponentDemo
              title="Pill Toggle"
              description="Segmented control style toggle"
              code={`<ViewportSelector 
  options={[
    { id: "phone", label: "Phone", icon: Envelope },
    { id: "desktop", label: "Desktop", icon: HardDrive }
  ]}
  selected={selected}
  onSelect={setSelected}
/>`}
            >
              <ViewportSelector options={viewportOptions} selected={selectedViewport} onSelect={setSelectedViewport} />
            </ComponentDemo>
          </div>
        </GlassCard>

        {/* ============================================================ */}
        {/* DROPDOWN MENU */}
        {/* ============================================================ */}
        <GlassCard gradientColor="purple">
          <div className="p-6 border-b border-foreground/[0.05]">
            <SectionHeader icon={DotsThree} title="Dropdown Menu" />
            <Typography variant="secondary" className="text-sm mt-2">
              Context menus and action dropdowns
            </Typography>
          </div>
          <div className="p-6 space-y-8">

            <ComponentDemo
              title="Basic Dropdown"
              description="Menu with icons and separators"
              code={`<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline">Open Menu</Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem icon={<PencilSimple />}>Edit</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>`}
            >
              <div className="flex flex-wrap gap-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">Actions Menu</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[180px]">
                    <DropdownMenuItem icon={<PencilSimple className="h-4 w-4" />}>Edit</DropdownMenuItem>
                    <DropdownMenuItem icon={<Envelope className="h-4 w-4" />}>Send Email</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-red-600 dark:text-red-400 focus:bg-red-500/10" icon={<Trash className="h-4 w-4" />}>Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <DotsThree className="h-5 w-5" weight="bold" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>View</DropdownMenuItem>
                    <DropdownMenuItem>Edit</DropdownMenuItem>
                    <DropdownMenuItem>Duplicate</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </ComponentDemo>
          </div>
        </GlassCard>

        {/* ============================================================ */}
        {/* ALERT COMPONENT */}
        {/* ============================================================ */}
        <GlassCard gradientColor="orange">
          <div className="p-6 border-b border-foreground/[0.05]">
            <SectionHeader icon={WarningCircle} title="Alert" />
            <Typography variant="secondary" className="text-sm mt-2">
              Contextual feedback messages for typical user actions
            </Typography>
          </div>
          <div className="p-6 space-y-8">

            <ComponentDemo
              title="Variants"
              description="Different alert styles for various message types"
              code={`<Alert>
  <AlertTitle>Default Alert</AlertTitle>
  <AlertDescription>This is a default alert message.</AlertDescription>
</Alert>

<Alert variant="destructive">
  <WarningCircleIcon className="h-4 w-4" />
  <AlertTitle>Error</AlertTitle>
  <AlertDescription>Something went wrong.</AlertDescription>
</Alert>`}
            >
              <div className="space-y-3">
                <Alert>
                  <AlertTitle>Default Alert</AlertTitle>
                  <AlertDescription>This is a default informational message.</AlertDescription>
                </Alert>
                <Alert variant="destructive">
                  <WarningCircleIcon className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>An error occurred while processing your request.</AlertDescription>
                </Alert>
                <Alert variant="success">
                  <CheckCircle className="h-4 w-4" />
                  <AlertTitle>Success</AlertTitle>
                  <AlertDescription>Your changes have been saved successfully.</AlertDescription>
                </Alert>
              </div>
            </ComponentDemo>

            <ComponentDemo
              title="Custom Colors"
              description="Alerts with custom background and border colors"
              code={`<Alert className="bg-blue-500/5 border-blue-500/20">
  <AlertDescription>Custom blue alert</AlertDescription>
</Alert>`}
            >
              <div className="space-y-3">
                <Alert className="bg-blue-500/5 border-blue-500/20">
                  <AlertDescription><Typography variant="secondary" className="text-sm"><strong>Info:</strong> This is an informational message.</Typography></AlertDescription>
                </Alert>
                <Alert className="bg-amber-500/5 border-amber-500/20">
                  <WarningCircle className="h-4 w-4 text-amber-500" />
                  <AlertTitle className="text-amber-600 dark:text-amber-400">Warning</AlertTitle>
                  <AlertDescription className="text-muted-foreground">Please review before proceeding.</AlertDescription>
                </Alert>
              </div>
            </ComponentDemo>

            <div className="pt-4 border-t border-foreground/[0.05]">
              <Typography type="label" className="font-semibold mb-3">Props</Typography>
              <PropsTable props={[
                { name: "variant", type: "'default' | 'destructive' | 'success'", default: "'default'", description: "Visual style of the alert" },
                { name: "className", type: "string", description: "Additional CSS classes for custom styling" },
              ]} />
            </div>
          </div>
        </GlassCard>

        {/* ============================================================ */}
        {/* BADGE COMPONENT */}
        {/* ============================================================ */}
        <GlassCard gradientColor="green">
          <div className="p-6 border-b border-foreground/[0.05]">
            <SectionHeader icon={CheckCircle} title="Badge" />
            <Typography variant="secondary" className="text-sm mt-2">
              Small status indicators and labels
            </Typography>
          </div>
          <div className="p-6 space-y-8">

            <ComponentDemo
              title="Variants"
              description="Different badge styles"
              code={`<Badge variant="default">Default</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="outline">Outline</Badge>
<Badge variant="destructive">Destructive</Badge>`}
            >
              <div className="flex flex-wrap gap-2">
                <Badge variant="default">Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="destructive">Destructive</Badge>
              </div>
            </ComponentDemo>

            <ComponentDemo
              title="Status Badges"
              description="Custom status badges with icons"
              code={`<div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-500/20">
  <CheckCircle className="h-3 w-3" />
  Sent
</div>`}
            >
              <div className="flex flex-wrap gap-3">
                <StatusBadge status="sent" />
                <StatusBadge status="pending" />
                <StatusBadge status="failed" />
              </div>
            </ComponentDemo>

            <ComponentDemo
              title="Stage Badges"
              description="Development stage indicators"
            >
              <div className="flex flex-wrap gap-2">
                <div className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border bg-orange-500/10 text-orange-500 border-orange-500/50">Alpha</div>
                <div className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border bg-blue-500/10 text-blue-500 border-blue-500/50">Beta</div>
                <div className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border bg-green-500/10 text-green-500 border-green-500/50">Stable</div>
              </div>
            </ComponentDemo>

            <div className="pt-4 border-t border-foreground/[0.05]">
              <Typography type="label" className="font-semibold mb-3">Props</Typography>
              <PropsTable props={[
                { name: "variant", type: "'default' | 'secondary' | 'outline' | 'destructive'", default: "'default'", description: "Visual style of the badge" },
              ]} />
            </div>
          </div>
        </GlassCard>

        {/* ============================================================ */}
        {/* STATE INDICATORS */}
        {/* ============================================================ */}
        <GlassCard gradientColor="green">
          <div className="p-6 border-b border-foreground/[0.05]">
            <SectionHeader icon={CheckCircle} title="State Indicators" />
            <Typography variant="secondary" className="text-sm mt-2">
              Loading states, step indicators, and status displays
            </Typography>
          </div>
          <div className="p-6 space-y-8">

            <ComponentDemo
              title="Metrics Loading Card"
              description="Card-based loading state used for overview metrics"
            >
              <MetricsLoadingFallback />
            </ComponentDemo>

            <ComponentDemo
              title="Step Indicator"
              description="Timeline-style numbered steps with completion states"
            >
              <StepIndicatorDemo />
            </ComponentDemo>

          </div>
        </GlassCard>

        {/* ============================================================ */}
        {/* LIST COMPONENTS */}
        {/* ============================================================ */}
        <GlassCard gradientColor="orange">
          <div className="p-6 border-b border-foreground/[0.05]">
            <SectionHeader icon={HardDrive} title="List Components" />
            <Typography variant="secondary" className="text-sm mt-2">
              List items, rows, and data display components
            </Typography>
          </div>
          <div className="p-6 space-y-8">

            <ComponentDemo
              title="List Item Row"
              description="Icon row with inline actions and overflow menu"
            >
              <div className="space-y-3">
                <ListItemRow
                  icon={FileText}
                  title="Transactional Templates"
                  onEdit={() => setListAction("edit")}
                  onDelete={() => setListAction("delete")}
                />
                <Typography variant="secondary" className="text-xs">
                  {listAction ? `Last action: ${listAction}` : "Click edit or delete to preview actions."}
                </Typography>
              </div>
            </ComponentDemo>

            <ComponentDemo
              title="User List Item"
              description="Clickable user row with avatar and accent hover"
            >
              <UserListItemDemo />
            </ComponentDemo>

            <ComponentDemo
              title="Chart Tooltip"
              description="Glassmorphic tooltip for displaying chart data"
            >
              <ChartTooltipDemo />
            </ComponentDemo>

            <ComponentDemo
              title="Legend Pills"
              description="Interactive pill-shaped legend items with colors"
            >
              <LegendPillsDemo />
            </ComponentDemo>

          </div>
        </GlassCard>

        {/* ============================================================ */}
        {/* OVERVIEW WIDGETS */}
        {/* ============================================================ */}
        <GlassCard gradientColor="slate">
          <div className="p-6 border-b border-foreground/[0.05]">
            <SectionHeader icon={CompassIcon} title="Overview Widgets" />
            <Typography variant="secondary" className="text-sm mt-2">
              Dashboard widgets and quick access patterns from the overview page
            </Typography>
          </div>
          <div className="p-6 space-y-8">

            <ComponentDemo
              title="Quick Access Grid"
              description="App icon grid with expand/collapse affordance"
            >
              <QuickAccessGridDemo />
            </ComponentDemo>

            <ComponentDemo
              title="Metric Callout"
              description="Icon label with a primary stat value"
            >
              <MetricStatCalloutDemo />
            </ComponentDemo>

          </div>
        </GlassCard>

        {/* ============================================================ */}
        {/* CHARTS */}
        {/* ============================================================ */}
        <GlassCard gradientColor="cyan">
          <div className="p-6 border-b border-foreground/[0.05]">
            <SectionHeader icon={SquaresFourIcon} title="Charts" />
            <Typography variant="secondary" className="text-sm mt-2">
              Chart components for data visualization
            </Typography>
          </div>
          <div className="p-6 space-y-8">

            <ComponentDemo
              title="Donut Chart"
              description="Pie/donut chart for authentication method distribution"
            >
              <DonutChartDisplay
                className="h-[420px]"
                datapoints={DEMO_AUTH_DATA}
                gradientColor="purple"
                height={240}
              />
            </ComponentDemo>

            <ComponentDemo
              title="Tabbed Chart Card"
              description="Chart card with tab switching between chart and list views"
            >
              <div className="h-[350px]">
                <TabbedMetricsCard
                  config={{
                    name: "Sign Ups",
                    chart: {
                      activity: {
                        label: "Activity",
                        theme: {
                          light: "hsl(221, 83%, 53%)",
                          dark: "hsl(240, 71%, 70%)",
                        }
                      }
                    }
                  }}
                  chartData={DEMO_CHART_DATA}
                  listData={[
                    { id: "1", display_name: "Alice", primary_email: "alice@example.com", signed_up_at_millis: 1704067200000 },
                    { id: "2", display_name: "Bob", primary_email: "bob@example.com", signed_up_at_millis: 1704063600000 },
                    { id: "3", display_name: "Charlie", primary_email: "charlie@example.com", signed_up_at_millis: 1704060000000 },
                  ]}
                  listTitle="Recent Signups"
                  projectId="demo"
                  router={router}
                  timeRange="all"
                  gradientColor="cyan"
                  height={220}
                  compact
                />
              </div>
            </ComponentDemo>

          </div>
        </GlassCard>

      </div>
    </PageLayout>
  );
}
