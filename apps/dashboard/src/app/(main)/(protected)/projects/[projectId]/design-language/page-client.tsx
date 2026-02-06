"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  DataTable,
  DataTableColumnHeader,
  DataTableViewOptions,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  Typography,
  cn,
} from "@/components/ui";
import { EditableGrid, type EditableGridItem } from "@/components/editable-grid";
import { Link } from "@/components/link";
import {
  CheckCircle,
  Cube,
  DotsThree,
  Envelope,
  FileText,
  HardDrive,
  Info,
  MagnifyingGlassIcon,
  Palette,
  PencilSimple,
  StackSimple,
  Sliders,
  SquaresFourIcon,
  Tag,
  Trash,
  WarningCircle,
  XCircle
} from "@phosphor-icons/react";
import { ColumnDef, Table as TableType } from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";

// Bridge component to capture table instance without violating React rules
// (setState during render is not allowed, so we use useEffect instead)
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
  // Serialize visibility to avoid unnecessary re-renders from object reference changes
  const visibilityKey = JSON.stringify(currentVisibility);
  useEffect(() => {
    onVisibilityChange(currentVisibility as Record<string, boolean>);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally using serialized key for comparison
  }, [visibilityKey, onVisibilityChange]);

  return null;
}
import {
  TimeRange,
  TimeRangeToggle
} from "../(overview)/line-chart";
import { PageLayout } from "../page-layout";

// =============================================================================
// COMPONENT DISPLAY WRAPPER
// Wraps each component demo with title, description, and code preview
// =============================================================================
function ComponentDemo({
  title,
  description,
  children,
}: {
  title: string,
  description?: string,
  children: React.ReactNode,
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

      <div className="space-y-4">
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
function GlassCard({
  children,
  className,
  gradientColor = "blue",
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
  gradientColor = "default",
}: {
  children: React.ReactNode,
  className?: string,
  gradientColor: "blue" | "purple" | "green" | "orange" | "default" | "cyan",
}) {
  const hoverTints: Record<string, string> = {
    blue: "group-hover/tint:bg-blue-500/[0.02]",
    purple: "group-hover/tint:bg-purple-500/[0.02]",
    green: "group-hover/tint:bg-emerald-500/[0.02]",
    orange: "group-hover/tint:bg-orange-500/[0.02]",
    default: "group-hover/tint:bg-slate-500/[0.015]",
    cyan: "group-hover/tint:bg-cyan-500/[0.02]",
  };

  return (
    <div className={cn(
      "group/tint relative rounded-2xl bg-white/90 dark:bg-background/60 backdrop-blur-xl transition-all duration-150 hover:transition-none",
      "ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
      "shadow-sm hover:shadow-md",
      className
    )}>
      <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.04] dark:from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
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
      <div className="p-1.5 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.04]">
        <Icon className="h-3.5 w-3.5 text-foreground/70 dark:text-muted-foreground" />
      </div>
      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
        {title}
      </span>
    </div>
  );
}

function DesignSection({
  id,
  icon: Icon,
  title,
  description,
  children,
}: {
  id: string,
  icon: React.ElementType,
  title: string,
  description?: string,
  children: React.ReactNode,
}) {
  return (
    <section
      id={id}
      className="space-y-6 border-b border-foreground/[0.1] dark:border-foreground/[0.06] pb-12 last:border-b-0 last:pb-0 scroll-mt-24"
    >
      <div className="space-y-2">
        <SectionHeader icon={Icon} title={title} />
        {description && (
          <Typography variant="secondary" className="text-sm">
            {description}
          </Typography>
        )}
      </div>
      <div className="space-y-8">
        {children}
      </div>
    </section>
  );
}

// =============================================================================
// STATUS BADGE COMPONENT
// Gradient-based status pills with optional icons and size variants
// =============================================================================
type StatusBadgeColor = "blue" | "cyan" | "purple" | "green" | "orange" | "red";
type StatusBadgeSize = "sm" | "md";
type ColumnKey = "recipient" | "subject" | "sentAt" | "status";
type DemoEmailRow = {
  id: string,
  recipient: string,
  subject: string,
  sentAt: number,
  status: "sent" | "failed" | "scheduled",
};

const STATUS_BADGE_STYLES: Record<StatusBadgeColor, string> = {
  blue: "text-blue-700 dark:text-blue-400 bg-blue-500/20 dark:bg-blue-500/10 ring-1 ring-blue-500/30 dark:ring-blue-500/20",
  cyan: "text-cyan-700 dark:text-cyan-400 bg-cyan-500/20 dark:bg-cyan-500/10 ring-1 ring-cyan-500/30 dark:ring-cyan-500/20",
  purple: "text-purple-700 dark:text-purple-400 bg-purple-500/20 dark:bg-purple-500/10 ring-1 ring-purple-500/30 dark:ring-purple-500/20",
  green: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/20 dark:bg-emerald-500/10 ring-1 ring-emerald-500/30 dark:ring-emerald-500/20",
  orange: "text-amber-700 dark:text-amber-300 bg-amber-500/20 dark:bg-amber-500/10 ring-1 ring-amber-500/30 dark:ring-amber-500/20",
  red: "text-red-700 dark:text-red-400 bg-red-500/20 dark:bg-red-500/10 ring-1 ring-red-500/30 dark:ring-red-500/20",
};

const DEMO_STATUS_MAP: Record<DemoEmailRow["status"], { label: string, color: StatusBadgeColor }> = {
  sent: { label: "Sent", color: "green" },
  failed: { label: "Failed", color: "red" },
  scheduled: { label: "Scheduled", color: "orange" },
};

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
  const sizeClasses = size === "sm"
    ? "px-2 py-0.5 text-[10px]"
    : "px-2.5 py-1 text-[11px]";

  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 rounded-full font-medium",
      STATUS_BADGE_STYLES[color],
      sizeClasses
    )}>
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </div>
  );
}

// =============================================================================
// CATEGORY TABS (UNDERLINE STYLE)
// From: apps/page-client.tsx - Category tabs with counts and underline indicator
// Used for: Filtering lists, category navigation
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
            {isActive && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-700 dark:bg-blue-400" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// =============================================================================
// UNDERLINE TABS
// Used for: Small view switchers (charts, lists)
// =============================================================================
function UnderlineTabsDemo() {
  const [activeTab, setActiveTab] = useState<"chart" | "list">("chart");
  return (
    <div className="flex items-center gap-1 border-b border-black/[0.12] dark:border-white/[0.06]">
      {[
        { id: "chart", label: "Daily Active Users" },
        { id: "list", label: "Recently Active" },
      ].map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id as "chart" | "list")}
          className={cn(
            "relative px-3 py-3.5 text-xs font-medium transition-all duration-150 hover:transition-none rounded-t-lg",
            activeTab === tab.id ? "text-foreground" : "text-foreground/70 dark:text-muted-foreground hover:text-foreground"
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
    <div className="inline-flex items-center gap-1 rounded-xl bg-black/[0.08] dark:bg-white/[0.04] p-1 backdrop-blur-sm">
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
                ? "bg-background text-foreground shadow-sm ring-1 ring-black/[0.12] dark:ring-white/[0.06]"
                : "text-muted-foreground hover:text-foreground hover:bg-black/[0.06] dark:hover:bg-white/[0.04]"
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
      "bg-white/90 dark:bg-background/60 backdrop-blur-xl ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
      "shadow-sm hover:shadow-md"
    )}>
      <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
      <div className="relative flex items-center gap-4">
        <div className="p-2.5 rounded-xl bg-black/[0.08] dark:bg-white/[0.04] ring-1 ring-black/[0.1] dark:ring-white/[0.06] transition-colors duration-150 group-hover:bg-black/[0.12] dark:group-hover:bg-white/[0.08] group-hover:transition-none">
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
            user.color === "cyan" ? "hover:bg-cyan-500/[0.1]" : "hover:bg-blue-500/[0.1]"
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

export default function PageClient() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedViewport, setSelectedViewport] = useState("phone");
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [listAction, setListAction] = useState<"edit" | "delete" | null>(null);
  const [selectedMenuFilter, setSelectedMenuFilter] = useState("all");
  const [selectedSelectorValue, setSelectedSelectorValue] = useState("no");
  const [tableDemo, setTableDemo] = useState<TableType<DemoEmailRow> | null>(null);
  const [tableDemoVisibility, setTableDemoVisibility] = useState({});
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>({
    recipient: true,
    subject: true,
    sentAt: true,
    status: true,
  });

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

  const columnOptions: Array<{ id: ColumnKey, label: string }> = [
    { id: "recipient", label: "Recipient" },
    { id: "subject", label: "Subject" },
    { id: "sentAt", label: "Sent At" },
    { id: "status", label: "Status" },
  ];

  const menuFilterOptions = [
    { id: "all", label: "All messages" },
    { id: "active", label: "Active" },
    { id: "drafts", label: "Drafts" },
  ];

  const selectorOptions = [
    { value: "no", label: "No" },
    { value: "yes", label: "Yes" },
  ];

  const demoDateFormatter = useMemo(() => new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }), []);

  const demoEmailRows: DemoEmailRow[] = [
    { id: "em_01", recipient: "jordan@stack.dev", subject: "Reset your password", sentAt: 1726516800000, status: "sent" },
    { id: "em_02", recipient: "ops@stack.dev", subject: "Weekly usage summary", sentAt: 1726257600000, status: "scheduled" },
    { id: "em_03", recipient: "pat@stack.dev", subject: "Verify your email", sentAt: 1725998400000, status: "failed" },
    { id: "em_04", recipient: "team@stack.dev", subject: "Invite to Stack Auth", sentAt: 1725739200000, status: "sent" },
  ];

  const demoTableColumns = useMemo<ColumnDef<DemoEmailRow>[]>(() => [
    {
      accessorKey: "recipient",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Recipient" />,
      cell: ({ row }) => (
        <span className="text-sm font-medium text-foreground">
          {row.getValue("recipient")}
        </span>
      ),
    },
    {
      accessorKey: "subject",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Subject" />,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.getValue("subject")}
        </span>
      ),
    },
    {
      accessorKey: "sentAt",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Sent At" />,
      cell: ({ row }) => {
        const value = row.getValue("sentAt") as number;
        return (
          <span className="text-xs text-muted-foreground">
            {demoDateFormatter.format(new Date(value))}
          </span>
        );
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Status" />,
      cell: ({ row }) => {
        const status = row.getValue("status") as DemoEmailRow["status"];
        const config = DEMO_STATUS_MAP[status];
        return <StatusBadge label={config.label} color={config.color} size="sm" />;
      },
    },
  ], [demoDateFormatter]);

  const editableGridItems = useMemo<EditableGridItem[]>(() => [
    {
      type: "text",
      icon: <FileText className="h-4 w-4" />,
      name: "Display Name",
      value: "Catalog Workspace Plans",
      readOnly: false,
      onUpdate: async (val) => {
        console.log("Updated to:", val);
        await new Promise((resolve) => setTimeout(resolve, 500));
      },
    },
    {
      type: "boolean",
      icon: <StackSimple className="h-4 w-4" />,
      name: "Stackable",
      value: false,
      readOnly: false,
      trueLabel: "Yes",
      falseLabel: "No",
      onUpdate: async (val) => {
        console.log("Stackable updated to:", val);
        await new Promise((resolve) => setTimeout(resolve, 500));
      },
    },
    {
      type: "boolean",
      icon: <Tag className="h-4 w-4" />,
      name: "Add-on",
      value: false,
      readOnly: false,
      trueLabel: "Yes",
      falseLabel: "No",
      onUpdate: async (val) => {
        console.log("Add-on updated to:", val);
        await new Promise((resolve) => setTimeout(resolve, 500));
      },
    },
    {
      type: "dropdown",
      icon: <Sliders className="h-4 w-4" />,
      name: "Free Trial",
      value: "2 weeks",
      options: [
        { value: "none", label: "No trial" },
        { value: "2 weeks", label: "2 weeks" },
        { value: "1 month", label: "1 month" },
      ],
      readOnly: false,
      onUpdate: async (val) => {
        console.log("Free Trial updated to:", val);
        await new Promise((resolve) => setTimeout(resolve, 500));
      },
    },
    {
      type: "boolean",
      icon: <HardDrive className="h-4 w-4" />,
      name: "Server Only",
      value: false,
      readOnly: false,
      trueLabel: "Yes",
      falseLabel: "No",
      onUpdate: async (val) => {
        console.log("Server Only updated to:", val);
        await new Promise((resolve) => setTimeout(resolve, 500));
      },
    },
    {
      type: "custom",
      icon: <Envelope className="h-4 w-4" />,
      name: "Prices",
      children: (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-foreground">$39 monthly</span>
          <span className="text-muted-foreground">2 week trial</span>
        </div>
      ),
    },
    {
      type: "custom",
      icon: <Cube className="h-4 w-4" />,
      name: "Included Items",
      children: (
        <div className="flex flex-col text-sm text-muted-foreground">
          <span>5× Studio Seats /mo</span>
          <span>50× Review Credits /mo</span>
        </div>
      ),
    },
  ], []);

  return (
    <PageLayout>
      <div className="flex flex-col gap-12">
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/[0.06] p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Typography type="h3" className="text-base font-semibold">Realistic Theme Preview</Typography>
            <Typography variant="secondary" className="text-sm">Use the new demo page to validate theme changes across a realistic layout.</Typography>
          </div>
          <Button asChild size="sm" className="w-fit">
            <Link href="./design-language/realistic-demo">Open demo page</Link>
          </Button>
        </div>

        {/* ============================================================ */}
        {/* CARDS */}
        {/* ============================================================ */}
        <DesignSection
          id="cards"
          icon={SquaresFourIcon}
          title="Cards"
          description="Use to group related settings or actions in a focused container."
        >
          <ComponentDemo
            title="Icon + Title + Subtitle"
            description="Header with supporting copy and a simple content area"
          >
            <GlassCard gradientColor="default">
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <SectionHeader icon={Envelope} title="Email Drafts" />
                    <Typography variant="secondary" className="text-sm mt-1">
                      Create, edit, and send email drafts
                    </Typography>
                  </div>
                </div>
              </div>
              <div className="border-t border-black/[0.12] dark:border-white/[0.06] px-5 py-4">
                <Typography variant="secondary" className="text-sm">
                  Placeholder content for the card body.
                </Typography>
              </div>
            </GlassCard>
          </ComponentDemo>

          <ComponentDemo
            title="Compact Header"
            description="Small header row with an optional icon"
          >
            <GlassCard gradientColor="default">
              <div className="p-5 flex items-center gap-2 border-b border-black/[0.12] dark:border-white/[0.06]">
                <div className="p-1.5 rounded-lg bg-foreground/[0.04]">
                  <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Preview
                </span>
              </div>
              <div className="px-5 py-4">
                <Typography variant="secondary" className="text-sm">
                  Placeholder content for the card body.
                </Typography>
              </div>
            </GlassCard>
          </ComponentDemo>

          <ComponentDemo
            title="Body Only"
            description="Use for simple content blocks without a header"
          >
            <GlassCard gradientColor="default">
              <div className="p-5">
                <Typography variant="secondary" className="text-sm">
                  Placeholder content for the card body.
                </Typography>
              </div>
            </GlassCard>
          </ComponentDemo>

          <ComponentDemo
            title="Glassmorphic Tint Variants"
            description="Use when the card needs a tinted glass surface."
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {(["blue", "cyan", "purple", "green", "orange", "default"] as const).map((color) => (
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

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "variant", type: "'header' | 'compact' | 'bodyOnly' | 'glassmorphic'", default: "'header'", description: "Layout style for the card header." },
              { name: "title", type: "string", description: "Primary title when a header is present." },
              { name: "subtitle", type: "string", description: "Optional supporting text under the title." },
              { name: "icon", type: "ReactElement", description: "Optional leading icon in the header." },
              { name: "glassmorphic", type: "boolean", default: "true", description: "Use glass styling when outside another card." },
              { name: "size", type: "'sm' | 'md' | 'lg' | ...", default: "'md'", description: "Controls padding and density." },
              { name: "gradient", type: "'blue' | 'cyan' | 'purple' | 'green' | 'orange' | 'default'", description: "Tint for glassmorphic cards." },
            ]} />
          </div>
        </DesignSection>

        {/* ============================================================ */}
        {/* TABS COMPONENT */}
        {/* ============================================================ */}
        <DesignSection
          id="tabs"
          icon={Sliders}
          title="Tabs"
          description="Use to switch between related sections without leaving the page."
        >
          <ComponentDemo
            title="Category Tabs"
            description="Use for segmented lists with counts."
          >
            <CategoryTabs
              categories={categories}
              selectedCategory={selectedCategory}
              onSelect={setSelectedCategory}
            />
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "categories", type: "Array<{ id: string, label: string, count: number }>", description: "Tab items with counts for category tabs." },
              { name: "selectedCategory", type: "string", description: "Currently selected category id." },
              { name: "onSelect", type: "(id: string) => void", description: "Selection handler for category tabs." },
              { name: "size", type: "'sm' | 'md' | 'lg' | ...", default: "'md'", description: "Controls padding and density." },
              { name: "glassmorphic", type: "boolean", default: "true", description: "Enable when tabs are outside a card." },
              { name: "gradient", type: "'blue' | 'cyan' | 'purple' | 'green' | 'orange' | 'default'", description: "Optional accent when glassmorphic is true." },
            ]} />
          </div>
        </DesignSection>

        {/* ============================================================ */}
        {/* DROPDOWNS */}
        {/* ============================================================ */}
        <DesignSection
          id="dropdowns"
          icon={DotsThree}
          title="Menus"
        >
          <ComponentDemo
            title="Action Menu"
            description="Standard action list with icons and a destructive row."
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 px-3 rounded-lg">
                  Open Menu
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[200px]">
                <DropdownMenuItem icon={<PencilSimple className="h-4 w-4" />}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem icon={<Envelope className="h-4 w-4" />}>
                  Send email
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600 dark:text-red-400 focus:bg-red-500/10"
                  icon={<Trash className="h-4 w-4" />}
                  onClick={() => new Promise<void>((resolve) => {
                    setTimeout(() => resolve(), 5000);
                  })}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ComponentDemo>

          <ComponentDemo
            title="Selector Menu"
            description="Use radio items to switch between a small set of options."
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 px-3 rounded-lg">
                  {menuFilterOptions.find((option) => option.id === selectedMenuFilter)?.label ?? "Select"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[200px]">
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Filter
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup
                  value={selectedMenuFilter}
                  onValueChange={setSelectedMenuFilter}
                >
                  {menuFilterOptions.map((option) => (
                    <DropdownMenuRadioItem key={option.id} value={option.id}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </ComponentDemo>

          <ComponentDemo
            title="Column Toggles"
            description="Use checkbox items for on/off configuration."
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 px-3 rounded-lg">
                  Toggle columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[200px]">
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Toggle columns
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {columnOptions.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={visibleColumns[column.id]}
                    onCheckedChange={(checked) => {
                      setVisibleColumns((prev) => ({
                        ...prev,
                        [column.id]: !!checked,
                      }));
                    }}
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "variant", type: "'actions' | 'selector' | 'toggles'", default: "'actions'", description: "Selects action list, radio selector menu, or checkbox settings menu." },
              { name: "trigger", type: "'button' | 'icon'", default: "'button'", description: "Trigger presentation for the menu." },
              { name: "label", type: "string", description: "Optional section label for grouped items." },
              { name: "itemVariant", type: "'default' | 'destructive' | 'checkbox'", default: "'default'", description: "Item style for actions or toggles." },
              { name: "withIcons", type: "boolean", default: "false", description: "Adds leading icons for action menus." },
              { name: "onClick", type: "(event) => void | Promise<void>", description: "Return a Promise to keep the menu open with a spinner until complete." },
            ]} />
          </div>
        </DesignSection>

        {/* ============================================================ */}
        {/* SELECTS */}
        {/* ============================================================ */}
        <DesignSection
          id="selects"
          icon={Tag}
          title="Selects"
          description="Use for compact, single-choice selection."
        >
          <ComponentDemo
            title="Selector Dropdown"
            description="Use select triggers for compact yes/no or single-choice menus."
          >
            <div className="max-w-xs">
              <Select value={selectedSelectorValue} onValueChange={setSelectedSelectorValue}>
                <SelectTrigger className="h-8 px-3 text-xs rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectorOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "value", type: "string", description: "Currently selected value." },
              { name: "onValueChange", type: "(value: string) => void", description: "Selection handler for the dropdown." },
              { name: "trigger", type: "ReactElement", description: "Select trigger element (e.g., SelectTrigger)." },
              { name: "options", type: "Array<{ value: string, label: string }>", description: "Selectable options rendered inside SelectContent." },
              { name: "disabled", type: "boolean", default: "false", description: "Disables the select and its trigger." },
            ]} />
          </div>
        </DesignSection>

        {/* ============================================================ */}
        {/* TABLES */}
        {/* ============================================================ */}
        <DesignSection
          id="tables"
          icon={FileText}
          title="Tables"
          description="Use for dense datasets with sorting and column visibility controls."
        >
          <ComponentDemo
            title="Data Table"
            description="Matches the email log table styling and layout."
          >
            <GlassCard gradientColor="default" className="overflow-hidden">
              <div className="p-5">
                <div className="flex w-full items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <SectionHeader icon={Envelope} title="Email Log" />
                    <Typography variant="secondary" className="text-sm mt-1">
                      Recent delivery activity with quick filters
                    </Typography>
                  </div>
                  {tableDemo && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <DataTableViewOptions
                        key={JSON.stringify(tableDemoVisibility)}
                        table={tableDemo}
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="border-t border-black/[0.12] dark:border-white/[0.06] px-5 pb-5 [&_div.rounded-md.border]:border-0 [&_div.rounded-md.border]:shadow-none">
                <DataTable
                  data={demoEmailRows}
                  columns={demoTableColumns}
                  defaultColumnFilters={[]}
                  defaultSorting={[{ id: "sentAt", desc: true }]}
                  showDefaultToolbar={false}
                  showResetFilters={false}
                  toolbarRender={(tableInstance) => (
                    <TableInstanceBridge
                      tableInstance={tableInstance}
                      onTableInstance={setTableDemo}
                      onVisibilityChange={setTableDemoVisibility}
                    />
                  )}
                />
              </div>
            </GlassCard>
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "columns", type: "ColumnDef[]", description: "Column definitions for headers and cells." },
              { name: "data", type: "Array<Record<string, unknown>>", description: "Row data to render in the table." },
              { name: "defaultSorting", type: "SortingState", description: "Initial sort order for the table." },
              { name: "showDefaultToolbar", type: "boolean", default: "true", description: "Toggle the built-in toolbar." },
              { name: "viewOptions", type: "boolean", default: "false", description: "Use DataTableViewOptions for column toggles." },
              { name: "onRowClick", type: "(row) => void", description: "Optional row click handler for navigation." },
            ]} />
          </div>
        </DesignSection>

        {/* ============================================================ */}
        {/* INPUTS */}
        {/* ============================================================ */}
        <DesignSection
          id="inputs"
          icon={FileText}
          title="Inputs"
          description="Use a single input component for text and search states."
        >
          <ComponentDemo
            title="Standard Input"
            description="Default input for forms and settings."
          >
            <div className="max-w-sm">
              <Input placeholder="Enter a value" />
            </div>
          </ComponentDemo>

          <ComponentDemo
            title="Search Input (Small)"
            description="Use size sm with a leading icon for compact search."
          >
            <div className="max-w-xs">
              <Input
                size="sm"
                leadingIcon={<MagnifyingGlassIcon className="h-3 w-3" />}
                placeholder="Search products..."
              />
            </div>
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.08] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "size", type: "'sm' | 'md' | 'lg'", default: "'md'", description: "Controls input height and text size." },
              { name: "leadingIcon", type: "ReactElement", description: "Optional icon rendered inside the input." },
              { name: "prefixItem", type: "ReactElement", description: "Optional leading segment for grouped inputs." },
              { name: "placeholder", type: "string", description: "Placeholder text for empty states." },
              { name: "onChange", type: "(event) => void", description: "Change handler for input updates." },
            ]} />
          </div>
        </DesignSection>

        {/* ============================================================ */}
        {/* EDITABLE GRID */}
        {/* ============================================================ */}
        <DesignSection
          id="editable-grid"
          icon={Sliders}
          title="Editable Grid"
          description="Use for compact, editable settings in two-column layouts."
        >
          <ComponentDemo
            title="Product Attribute Grid"
            description="Editable rows with inline select and dropdown fields."
          >
            <div className="relative rounded-2xl overflow-hidden bg-white/90 dark:bg-[hsl(240,10%,5.5%)] border border-black/[0.12] dark:border-foreground/[0.12] shadow-sm">
              <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.03] to-transparent pointer-events-none" />
              <div className="relative p-5">
                <EditableGrid items={editableGridItems} columns={2} className="gap-x-6 gap-y-3" />
              </div>
            </div>
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "items", type: "EditableGridItem[]", description: "Defines editable rows and their input types." },
              { name: "columns", type: "1 | 2", default: "2", description: "Number of columns in the grid." },
              { name: "type", type: "'text' | 'boolean' | 'dropdown' | 'custom'", description: "Row type that controls the editor." },
              { name: "readOnly", type: "boolean", default: "false", description: "Disables editing for the row." },
              { name: "onUpdate", type: "(value) => Promise<void>", description: "Async handler for updates." },
            ]} />
          </div>
        </DesignSection>

        {/* ============================================================ */}
        {/* BUTTONS */}
        {/* ============================================================ */}
        <DesignSection
          id="buttons"
          icon={CheckCircle}
          title="Buttons"
          description="Use for primary actions, secondary controls, and lightweight links."
        >
          <ComponentDemo
            title="Variants"
            description="Pair variants with action importance and context."
          >
            <div className="flex flex-wrap gap-2">
              <Button variant="default" className="rounded-lg transition-all duration-150 hover:transition-none">
                Primary
              </Button>
              <Button variant="ghost" className="rounded-lg transition-all duration-150 hover:transition-none">
                Ghost
              </Button>
              <Button variant="secondary" className="rounded-lg transition-all duration-150 hover:transition-none">
                Secondary
              </Button>
              <Button variant="outline" className="rounded-lg transition-all duration-150 hover:transition-none">
                Outline
              </Button>
              <Button variant="destructive" className="rounded-lg transition-all duration-150 hover:transition-none">
                Delete
              </Button>
              <Button variant="link" className="rounded-lg transition-colors duration-150 hover:transition-none">
                Learn more
              </Button>
              <Button
                variant="plain"
                className="rounded-lg bg-foreground/10 text-foreground shadow-sm ring-1 ring-foreground/5 transition-all duration-150 hover:transition-none"
              >
                Active
              </Button>
            </div>
          </ComponentDemo>

          <ComponentDemo
            title="Sizes"
            description="Use size for density, not prominence."
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" className="rounded-lg transition-all duration-150 hover:transition-none">
                Small
              </Button>
              <Button className="rounded-lg transition-all duration-150 hover:transition-none">
                Default
              </Button>
              <Button size="lg" className="rounded-lg transition-all duration-150 hover:transition-none">
                Large
              </Button>
              <Button
                size="plain"
                variant="plain"
                className="h-9 w-9 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/60 transition-all duration-150 hover:transition-none"
                aria-label="Send email"
              >
                <Envelope className="h-4 w-4" />
              </Button>
            </div>
          </ComponentDemo>

          <ComponentDemo
            title="Loading States"
            description="Buttons show a spinner while async actions run."
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button loading className="rounded-lg transition-all duration-150 hover:transition-none">
                Saving
              </Button>
              <Button
                variant="secondary"
                className="rounded-lg transition-all duration-150 hover:transition-none"
                onClick={() => new Promise<void>((resolve) => {
                  setTimeout(() => resolve(), 1500);
                })}
              >
                Async Action
              </Button>
            </div>
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "variant", type: "'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link' | 'plain'", default: "'default'", description: "Visual style for the button." },
              { name: "size", type: "'default' | 'sm' | 'lg' | 'icon' | 'plain'", default: "'default'", description: "Controls padding and button height." },
              { name: "loading", type: "boolean", default: "false", description: "Shows a spinner and disables the button." },
              { name: "loadingStyle", type: "'spinner' | 'disabled'", default: "'spinner'", description: "Spinner overlay or disabled-only state." },
              { name: "asChild", type: "boolean", default: "false", description: "Renders a child component instead of a native button." },
              { name: "onClick", type: "(event) => void | Promise<void>", description: "Async handlers show loading automatically." },
            ]} />
          </div>
        </DesignSection>

        {/* ============================================================ */}
        {/* PILL TOGGLE */}
        {/* ============================================================ */}
        <DesignSection
          id="pill-toggle"
          icon={Sliders}
          title="Pill Toggle"
          description="Use for quick mode switches with a small set of options."
        >
          <ComponentDemo
            title="Standard Pill Toggle"
            description="Default segmented control"
          >
            <ViewportSelector options={viewportOptions} selected={selectedViewport} onSelect={setSelectedViewport} />
          </ComponentDemo>

          <ComponentDemo
            title="Glassmorphic Variant"
            description="Time range pill toggle with glassmorphic enabled"
          >
            <TimeRangeToggle timeRange={timeRange} onTimeRangeChange={setTimeRange} />
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "options", type: "Array<{ id: string, label: string, icon?: ReactElement }>", description: "Available toggle options." },
              { name: "selected", type: "string", description: "Currently selected option id." },
              { name: "onSelect", type: "(id: string) => void", description: "Selection handler." },
              { name: "size", type: "'sm' | 'md' | 'lg' | ...", default: "'md'", description: "Controls pill sizing." },
              { name: "glassmorphic", type: "boolean", default: "false", description: "Enable for glass surfaces (e.g., time range toggle)." },
              { name: "gradient", type: "'blue' | 'cyan' | 'purple' | 'green' | 'orange' | 'default'", description: "Optional accent when glassmorphic is true." },
            ]} />
          </div>
        </DesignSection>

        {/* ============================================================ */}
        {/* ALERT COMPONENT */}
        {/* ============================================================ */}
        <DesignSection
          id="alert"
          icon={WarningCircle}
          title="Alert"
          description="Use for high-signal feedback that needs attention."
        >
          <ComponentDemo
            title="Success Alert"
            description="Use for successful operations"
          >
            <Alert className="bg-green-500/[0.06] border-green-500/30">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <AlertTitle className="text-green-600 dark:text-green-400">Success</AlertTitle>
              <AlertDescription>Your changes have been saved successfully.</AlertDescription>
            </Alert>
          </ComponentDemo>

          <ComponentDemo
            title="Error Alert"
            description="Use for errors and failures"
          >
            <Alert className="bg-red-500/[0.06] border-red-500/30">
              <XCircle className="h-4 w-4 text-red-500" />
              <AlertTitle className="text-red-600 dark:text-red-400">Error</AlertTitle>
              <AlertDescription>An error occurred while processing your request.</AlertDescription>
            </Alert>
          </ComponentDemo>

          <ComponentDemo
            title="Warning Alert"
            description="Use for warnings that need attention"
          >
            <Alert className="bg-amber-500/[0.08] border-amber-500/40">
              <WarningCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertTitle className="text-amber-700 dark:text-amber-300">Warning</AlertTitle>
              <AlertDescription>You are using a shared email server. Configure a custom SMTP server to customize email templates.</AlertDescription>
            </Alert>
          </ComponentDemo>

          <ComponentDemo
            title="Info Alert"
            description="Use for informational messages without a title"
          >
            <Alert className="bg-blue-500/[0.06] border-blue-500/30">
              <Info className="h-4 w-4 text-blue-500" />
              <AlertTitle className="text-blue-600 dark:text-blue-400">Info</AlertTitle>
              <AlertDescription>
                Configure a custom SMTP server to send manual emails. You can still create and edit drafts.
              </AlertDescription>
            </Alert>
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "variant", type: "'success' | 'error' | 'warning' | 'info'", description: "Visual style. Use className for color overrides." },
              { name: "title", type: "ReactNode", description: "Optional. Use AlertTitle when needed." },
              { name: "icon", type: "ReactElement", description: "Optional icon displayed before content." },
              { name: "glassmorphic", type: "boolean", default: "false", description: "Only enable if used on glass surfaces." },
            ]} />
          </div>
        </DesignSection>

        {/* ============================================================ */}
        {/* BADGE COMPONENT */}
        {/* ============================================================ */}
        <DesignSection
          id="badge"
          icon={CheckCircle}
          title="Badge"
          description="Use for statuses, tags, and lightweight labels."
        >
          <ComponentDemo
            title="Status Badges"
            description="Gradient status colors with optional icons"
          >
            <div className="flex flex-wrap gap-2">
              <StatusBadge label="Success" color="green" icon={CheckCircle} />
              <StatusBadge label="Warning" color="orange" />
              <StatusBadge label="Error" color="red" icon={XCircle} />
              <StatusBadge label="Info" color="blue" />
              <StatusBadge label="New" color="purple" size="sm" />
              <StatusBadge label="Syncing" color="cyan" icon={DotsThree} size="sm" />
            </div>
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "label", type: "string", description: "Text for the badge" },
              { name: "color", type: "'blue' | 'cyan' | 'purple' | 'green' | 'orange' | 'red'", description: "Gradient color theme" },
              { name: "icon", type: "ReactElement", description: "Optional icon displayed before text" },
              { name: "size", type: "'sm' | 'md'", default: "'md'", description: "Badge size" },
              { name: "glassmorphic", type: "boolean", default: "false", description: "Enable only when badges sit on glass." },
            ]} />
          </div>
        </DesignSection>

        {/* ============================================================ */}
        {/* LIST COMPONENTS */}
        {/* ============================================================ */}
        <DesignSection
          id="list-components"
          icon={HardDrive}
          title="List Components"
          description="Use for repeated rows. Variants differ by icon, avatar, and density."
        >
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

          <div className="pt-4 border-t border-black/[0.08] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "icon", type: "ReactElement", description: "Optional leading icon for list rows." },
              { name: "title", type: "string", description: "Primary row label." },
              { name: "subtitle", type: "string", description: "Optional supporting text." },
              { name: "onClick", type: "() => void", description: "Row click handler." },
              { name: "onEdit", type: "() => void", description: "Optional edit action for row variants." },
              { name: "onDelete", type: "() => void", description: "Optional delete action for row variants." },
              { name: "size", type: "'sm' | 'md' | 'lg' | ...", default: "'md'", description: "Controls row padding and density." },
              { name: "glassmorphic", type: "boolean", default: "true", description: "Use when list is outside a parent card." },
              { name: "gradient", type: "'blue' | 'cyan' | 'purple' | 'green' | 'orange' | 'default'", description: "Optional accent on hover." },
            ]} />
          </div>
        </DesignSection>

      </div>
    </PageLayout>
  );
}
