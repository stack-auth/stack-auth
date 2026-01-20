"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Typography,
  cn,
} from "@/components/ui";
import {
  CheckCircle,
  CompassIcon,
  Cube,
  DotsThree,
  Envelope,
  FileText,
  HardDrive,
  Palette,
  Sliders,
  SquaresFourIcon,
  WarningCircle,
  XCircle
} from "@phosphor-icons/react";
import { useState } from "react";
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
      "group relative rounded-2xl bg-background/60 backdrop-blur-xl transition-all duration-150 hover:transition-none",
      "ring-1 ring-foreground/[0.06] hover:ring-foreground/[0.1]",
      "shadow-sm hover:shadow-md",
      className
    )}>
      <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
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
      className="space-y-6 border-b border-foreground/[0.06] pb-12 last:border-b-0 last:pb-0 scroll-mt-24"
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

const STATUS_BADGE_STYLES: Record<StatusBadgeColor, string> = {
  blue: "text-blue-600 dark:text-blue-400 bg-blue-500/10 ring-1 ring-blue-500/20",
  cyan: "text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 ring-1 ring-cyan-500/20",
  purple: "text-purple-600 dark:text-purple-400 bg-purple-500/10 ring-1 ring-purple-500/20",
  green: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-500/20",
  orange: "text-orange-600 dark:text-orange-400 bg-orange-500/10 ring-1 ring-orange-500/20",
  red: "text-red-600 dark:text-red-400 bg-red-500/10 ring-1 ring-red-500/20",
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
// UNDERLINE TABS
// Used for: Small view switchers (charts, lists)
// =============================================================================
function UnderlineTabsDemo() {
  const [activeTab, setActiveTab] = useState<"chart" | "list">("chart");
  return (
    <div className="flex items-center gap-1 border-b border-foreground/[0.05]">
      {[
        { id: "chart", label: "Daily Active Users" },
        { id: "list", label: "Recently Active" },
      ].map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id as "chart" | "list")}
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

export default function PageClient() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedViewport, setSelectedViewport] = useState("phone");
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
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

  const sectionItems = [
    { id: "global-props", label: "Global Props" },
    { id: "cards", label: "Cards" },
    { id: "tabs", label: "Tabs" },
    { id: "pill-toggle", label: "Pill Toggle" },
    { id: "alert", label: "Alert" },
    { id: "badge", label: "Badge" },
    { id: "list-components", label: "List Components" },
  ];

  const handleSectionJump = (id: string) => {
    const section = document.getElementById(id);
    if (!section) {
      return;
    }
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <PageLayout
      title="Design System"
      description="Component library documentation with variants, props, and usage examples"
    >
      <div className="flex flex-col gap-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <Typography type="label" className="text-xs uppercase tracking-wide text-muted-foreground">
              On this page
            </Typography>
            <Typography variant="secondary" className="text-sm">
              Jump to a specific section
            </Typography>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <CompassIcon className="h-4 w-4" />
                Jump to section
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px]">
              {sectionItems.map((section) => (
                <DropdownMenuItem
                  key={section.id}
                  onClick={() => handleSectionJump(section.id)}
                  className="cursor-pointer"
                >
                  {section.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* ============================================================ */}
        {/* GLOBAL PROPS */}
        {/* ============================================================ */}
        <DesignSection
          id="global-props"
          icon={Sliders}
          title="Global Props"
          description="Shared props most components should support"
        >
          <ComponentDemo
            title="Core Interface"
            description="Implement when needed; throw an error when provided but unsupported."
          >
            <div className="space-y-4">
              <Typography variant="secondary" className="text-sm">
                These props are shared across the component library. If a component does not
                yet implement one of them, throw an error to keep behavior explicit.
              </Typography>
              <PropsTable props={[
                {
                  name: "glassmorphic",
                  type: "boolean",
                  default: "true",
                  description: "Use glassmorphic styling. Typically true when outside a card.",
                },
                {
                  name: "size",
                  type: "'sm' | 'md' | 'lg' | ...",
                  default: "'md'",
                  description: "Default size is medium. Some components add extra sizes.",
                },
                {
                  name: "gradient",
                  type: "'blue' | 'purple' | 'green' | 'orange' | 'default' | 'cyan' | ...",
                  description: "Optional. Some components apply it only when glassmorphic is true.",
                },
              ]} />
            </div>
          </ComponentDemo>
        </DesignSection>

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
              <div className="border-t border-foreground/[0.05] px-5 py-4">
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
            <GlassCard gradientColor="cyan">
              <div className="p-5 flex items-center justify-between gap-4 border-b border-foreground/[0.05]">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-foreground/[0.04]">
                    <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    Preview
                  </span>
                </div>
                <Typography variant="secondary" className="text-xs">
                  390 × 844
                </Typography>
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
            <GlassCard gradientColor="purple">
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

          <div className="pt-4 border-t border-foreground/[0.05]">
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
              description="Use for segmented lists with counts."
            >
              <CategoryTabs
                categories={categories}
                selectedCategory={selectedCategory}
                onSelect={setSelectedCategory}
              />
            </ComponentDemo>

            <ComponentDemo
              title="Underline Tabs"
              description="Use for lightweight view switches."
            >
              <UnderlineTabsDemo />
            </ComponentDemo>

            <div className="pt-4 border-t border-foreground/[0.05]">
              <Typography type="label" className="font-semibold mb-3">Props</Typography>
              <PropsTable props={[
                { name: "variant", type: "'standard' | 'category' | 'underline'", default: "'standard'", description: "Visual style of the tabs." },
                { name: "defaultValue", type: "string", description: "Initial active tab when uncontrolled." },
                { name: "value", type: "string", description: "Controlled active tab value." },
                { name: "onValueChange", type: "(value: string) => void", description: "Change handler for controlled usage." },
                { name: "items", type: "Array<{ id: string, label: string, count?: number }>", description: "Tab items. Counts used by category variant." },
                { name: "size", type: "'sm' | 'md' | 'lg' | ...", default: "'md'", description: "Controls padding and density." },
                { name: "glassmorphic", type: "boolean", default: "true", description: "Enable when tabs are outside a card." },
                { name: "gradient", type: "'blue' | 'cyan' | 'purple' | 'green' | 'orange' | 'default'", description: "Optional accent when glassmorphic is true." },
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

            <ComponentDemo
              title="Glassmorphic Variant"
              description="Time range pill toggle with glassmorphic enabled"
            >
              <TimeRangeToggle timeRange={timeRange} onTimeRangeChange={setTimeRange} />
            </ComponentDemo>

            <div className="pt-4 border-t border-foreground/[0.05]">
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
              <Alert className="bg-green-500/5 border-green-500/20">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <AlertTitle className="text-green-600 dark:text-green-400">Success</AlertTitle>
                <AlertDescription>Your changes have been saved successfully.</AlertDescription>
              </Alert>
            </ComponentDemo>

            <ComponentDemo
              title="Error Alert"
              description="Use for errors and failures"
            >
              <Alert className="bg-red-500/5 border-red-500/20">
                <XCircle className="h-4 w-4 text-red-500" />
                <AlertTitle className="text-red-600 dark:text-red-400">Error</AlertTitle>
                <AlertDescription>An error occurred while processing your request.</AlertDescription>
              </Alert>
            </ComponentDemo>

            <ComponentDemo
              title="Warning Alert"
              description="Use for warnings that need attention"
            >
              <Alert className="bg-orange-500/5 border-orange-500/20">
                <WarningCircle className="h-4 w-4 text-orange-500" />
                <AlertTitle className="text-orange-600 dark:text-orange-400">Warning</AlertTitle>
                <AlertDescription>You are using a shared email server. Configure a custom SMTP server to customize email templates.</AlertDescription>
              </Alert>
            </ComponentDemo>

            <ComponentDemo
              title="Info Alert"
              description="Use for informational messages without a title"
            >
              <Alert className="bg-amber-500/5 border-amber-500/20">
                <AlertDescription>Configure a custom SMTP server to send manual emails. You can still create and edit drafts.</AlertDescription>
              </Alert>
            </ComponentDemo>

            <div className="pt-4 border-t border-foreground/[0.05]">
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
              code={`<StatusBadge label="Success" color="green" icon={CheckCircle} />
<StatusBadge label="Warning" color="orange" />
<StatusBadge label="Error" color="red" icon={XCircle} />`}
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

            <div className="pt-4 border-t border-foreground/[0.05]">
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

            <div className="pt-4 border-t border-foreground/[0.05]">
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
