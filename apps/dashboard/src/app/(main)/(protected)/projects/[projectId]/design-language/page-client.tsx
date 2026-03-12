"use client";

import {
  DesignAlert,
  DesignBadge,
  type DesignBadgeColor,
  DesignButton,
  DesignCard,
  DesignCardTint,
  DesignCategoryTabs,
  DesignDataTable,
  DesignEditableGrid,
  type DesignEditableGridItem,
  DesignInput,
  DesignListItemRow,
  DesignMenu,
  DesignPillToggle,
  DesignSelectorDropdown,
  DesignUserList
} from "@/components/design-components";
import { Link } from "@/components/link";
import {
  Button,
  DataTableColumnHeader,
  Typography,
  cn,
} from "@/components/ui";
import {
  CheckCircle,
  Cube,
  DotsThree,
  Envelope,
  FileText,
  HardDrive,
  MagnifyingGlassIcon,
  Palette,
  PencilSimple,
  Sliders,
  SquaresFourIcon,
  StackSimple,
  Tag,
  Trash,
  WarningCircle,
  XCircle
} from "@phosphor-icons/react";
import { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
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
type ColumnKey = "recipient" | "subject" | "sentAt" | "status";
type DemoEmailRow = {
  id: string,
  recipient: string,
  subject: string,
  sentAt: number,
  status: "sent" | "failed" | "scheduled",
};

const DEMO_STATUS_MAP: Record<DemoEmailRow["status"], { label: string, color: DesignBadgeColor }> = {
  sent: { label: "Sent", color: "green" },
  failed: { label: "Failed", color: "red" },
  scheduled: { label: "Scheduled", color: "orange" },
};

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

export default function PageClient() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedViewport, setSelectedViewport] = useState("phone");
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [listAction, setListAction] = useState<"edit" | "delete" | null>(null);
  const [selectedMenuFilter, setSelectedMenuFilter] = useState("all");
  const [selectedSelectorValue, setSelectedSelectorValue] = useState("no");
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
        return <DesignBadge label={config.label} color={config.color} size="sm" />;
      },
    },
  ], [demoDateFormatter]);

  const editableGridItems = useMemo<DesignEditableGridItem[]>(() => [
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
            <DesignAlert
              variant="success"
              title="Success"
              description="Your changes have been saved successfully."
            />
          </ComponentDemo>

          <ComponentDemo
            title="Error Alert"
            description="Use for errors and failures"
          >
            <DesignAlert
              variant="error"
              title="Error"
              description="An error occurred while processing your request."
            />
          </ComponentDemo>

          <ComponentDemo
            title="Warning Alert"
            description="Use for warnings that need attention"
          >
            <DesignAlert
              variant="warning"
              title="Warning"
              description="You are using a shared email server. Configure a custom SMTP server to customize email templates."
            />
          </ComponentDemo>

          <ComponentDemo
            title="Info Alert"
            description="Use for informational messages without a title"
          >
            <DesignAlert
              variant="info"
              title="Info"
              description="Configure a custom SMTP server to send manual emails. You can still create and edit drafts."
            />
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "variant", type: "'success' | 'error' | 'warning' | 'info'", description: "Visual style. Use className for color overrides." },
              { name: "title", type: "ReactNode", description: "Optional. Use AlertTitle when needed." },
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
              <DesignBadge label="Success" color="green" icon={CheckCircle} />
              <DesignBadge label="Warning" color="orange" />
              <DesignBadge label="Error" color="red" icon={XCircle} />
              <DesignBadge label="Info" color="blue" />
              <DesignBadge label="New" color="purple" size="sm" />
              <DesignBadge label="Syncing" color="cyan" icon={DotsThree} size="sm" />
            </div>
          </ComponentDemo>

          <ComponentDemo
            title="Content modes"
            description="Text only, icon only, or both. At least one must be shown."
          >
            <div className="flex flex-wrap gap-2 items-center">
              <DesignBadge label="Text only" color="blue" contentMode="text" />
              <DesignBadge label="Icon only" color="green" icon={CheckCircle} contentMode="icon" />
              <DesignBadge label="Both" color="cyan" icon={DotsThree} contentMode="both" size="sm" />
            </div>
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "label", type: "string", description: "Text for the badge (used as aria-label when contentMode is 'icon')" },
              { name: "color", type: "'blue' | 'cyan' | 'purple' | 'green' | 'orange' | 'red'", description: "Gradient color theme" },
              { name: "icon", type: "ReactElement", description: "Optional icon. Required when contentMode is 'icon'." },
              { name: "contentMode", type: "'both' | 'text' | 'icon'", default: "'both'", description: "What to display. At least one of text or icon must be shown." },
              { name: "size", type: "'sm' | 'md'", default: "'md'", description: "Badge size" },
              { name: "glassmorphic", type: "boolean", default: "false", description: "Enable only when badges sit on glass." },
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
              <DesignButton variant="default" className="rounded-lg transition-all duration-150 hover:transition-none">
                Primary
              </DesignButton>
              <DesignButton variant="ghost" className="rounded-lg transition-all duration-150 hover:transition-none">
                Ghost
              </DesignButton>
              <DesignButton variant="secondary" className="rounded-lg transition-all duration-150 hover:transition-none">
                Secondary
              </DesignButton>
              <DesignButton variant="outline" className="rounded-lg transition-all duration-150 hover:transition-none">
                Outline
              </DesignButton>
              <DesignButton variant="destructive" className="rounded-lg transition-all duration-150 hover:transition-none">
                Delete
              </DesignButton>
              <DesignButton variant="link" className="rounded-lg transition-colors duration-150 hover:transition-none">
                Learn more
              </DesignButton>
              <DesignButton
                variant="plain"
                className="rounded-lg bg-foreground/10 text-foreground shadow-sm ring-1 ring-foreground/5 transition-all duration-150 hover:transition-none"
              >
                Active
              </DesignButton>
            </div>
          </ComponentDemo>

          <ComponentDemo
            title="Sizes"
            description="Use size for density, not prominence."
          >
            <div className="flex flex-wrap items-center gap-2">
              <DesignButton size="sm" className="rounded-lg transition-all duration-150 hover:transition-none">
                Small
              </DesignButton>
              <DesignButton className="rounded-lg transition-all duration-150 hover:transition-none">
                Default
              </DesignButton>
              <DesignButton size="lg" className="rounded-lg transition-all duration-150 hover:transition-none">
                Large
              </DesignButton>
              <DesignButton
                size="icon"
                variant="plain"
                className="rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/60 transition-all duration-150 hover:transition-none"
                aria-label="Send email"
              >
                <Envelope className="h-4 w-4" />
              </DesignButton>
            </div>
          </ComponentDemo>

          <ComponentDemo
            title="Loading States"
            description="Buttons show a spinner while async actions run."
          >
            <div className="flex flex-wrap items-center gap-2">
              <DesignButton loading className="rounded-lg transition-all duration-150 hover:transition-none">
                Saving
              </DesignButton>
              <DesignButton
                variant="secondary"
                className="rounded-lg transition-all duration-150 hover:transition-none"
                onClick={() => new Promise<void>((resolve) => {
                  setTimeout(() => resolve(), 1500);
                })}
              >
                Async Action
              </DesignButton>
            </div>
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "variant", type: "'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link' | 'plain'", default: "'default'", description: "Visual style for the button." },
              { name: "size", type: "'default' | 'sm' | 'lg' | 'icon'", default: "'default'", description: "Controls padding and button height." },
              { name: "loading", type: "boolean", default: "false", description: "Shows a spinner and disables the button." },
              { name: "loadingStyle", type: "'spinner' | 'disabled'", default: "'spinner'", description: "Spinner overlay or disabled-only state." },
              { name: "asChild", type: "boolean", default: "false", description: "Renders a child component instead of a native button." },
              { name: "onClick", type: "(event) => void | Promise<void>", description: "Async handlers show loading automatically." },
            ]} />
          </div>
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
            <DesignCard
              icon={Envelope}
              title="Email Drafts"
              subtitle="Create, edit, and send email drafts"
              gradient="default"
              glassmorphic
            >
              <Typography variant="secondary" className="text-sm">
                Placeholder content for the card body.
              </Typography>
            </DesignCard>
          </ComponentDemo>

          <ComponentDemo
            title="Compact Header"
            description="Small header row with an optional icon"
          >
            <DesignCard
              icon={HardDrive}
              title="Preview"
              gradient="default"
              glassmorphic
            >
              <Typography variant="secondary" className="text-sm">
                Placeholder content for the card body.
              </Typography>
            </DesignCard>
          </ComponentDemo>

          <ComponentDemo
            title="Body Only"
            description="Use for simple content blocks without a header"
          >
            <DesignCard gradient="default" glassmorphic>
              <Typography variant="secondary" className="text-sm">
                Placeholder content for the card body.
              </Typography>
            </DesignCard>
          </ComponentDemo>

          <ComponentDemo
            title="Glassmorphic Tint Variants"
            description="Use when the card needs a tinted glass surface."
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {(["blue", "cyan", "purple", "green", "orange", "default"] as const).map((color) => (
                <DesignCardTint key={color} gradient={color}>
                  <div className="p-4">
                    <SectionHeader icon={Cube} title={color} />
                    <Typography variant="secondary" className="text-xs mt-2">
                      Hover to see {color} tint
                    </Typography>
                  </div>
                </DesignCardTint>
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
                <DesignEditableGrid items={editableGridItems} columns={2} className="gap-x-6 gap-y-3" />
              </div>
            </div>
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "items", type: "DesignEditableGridItem[]", description: "Defines editable rows and their input types." },
              { name: "columns", type: "1 | 2", default: "2", description: "Number of columns in the grid." },
              { name: "type", type: "'text' | 'boolean' | 'dropdown' | 'custom-dropdown' | 'custom-button' | 'custom'", description: "Row type that controls the editor." },
              { name: "readOnly", type: "boolean", default: "false", description: "Disables editing for the row." },
              { name: "onUpdate", type: "(value) => Promise<void>", description: "Async handler for updates." },
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
              <DesignInput placeholder="Enter a value" />
            </div>
          </ComponentDemo>

          <ComponentDemo
            title="Search Input (Small)"
            description="Use size sm with a leading icon for compact search."
          >
            <div className="max-w-xs">
              <DesignInput
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
              { name: "value", type: "string", description: "Controlled input value." },
              { name: "placeholder", type: "string", description: "Placeholder text for empty states." },
              { name: "disabled", type: "boolean", default: "false", description: "Disables input interactions." },
              { name: "onChange", type: "(event) => void", description: "Change handler for input updates." },
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
              <DesignListItemRow
                icon={FileText}
                title="Transactional Templates"
                subtitle="3 templates configured"
                buttons={[
                  { id: "edit", label: "Edit", onClick: () => setListAction("edit") },
                  { id: "more", label: "Options", display: "icon", onClick: [
                    { id: "delete", label: "Delete", icon: <Trash className="h-4 w-4" />, itemVariant: "destructive", onClick: () => setListAction("delete") },
                  ] },
                ]}
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
            <DesignUserList users={[
              { name: "John Doe", email: "john@example.com", time: "Active 2h ago", color: "cyan" },
              { name: "Jane Smith", email: "jane@example.com", time: "Active 5h ago", color: "blue" },
            ]} />
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
            <DesignMenu
              variant="actions"
              triggerLabel="Open Menu"
              withIcons
              items={[
                {
                  id: "edit",
                  label: "Edit",
                  icon: <PencilSimple className="h-4 w-4" />,
                },
                {
                  id: "send-email",
                  label: "Send email",
                  icon: <Envelope className="h-4 w-4" />,
                },
                {
                  id: "delete",
                  label: "Delete",
                  icon: <Trash className="h-4 w-4" />,
                  itemVariant: "destructive",
                  onClick: () => new Promise<void>((resolve) => {
                    setTimeout(() => resolve(), 5000);
                  }),
                },
              ]}
            />
          </ComponentDemo>

          <ComponentDemo
            title="Selector Menu"
            description="Use radio items to switch between a small set of options."
          >
            <DesignMenu
              variant="selector"
              triggerLabel={menuFilterOptions.find((option) => option.id === selectedMenuFilter)?.label ?? "Select"}
              label="Filter"
              options={menuFilterOptions}
              value={selectedMenuFilter}
              onValueChange={setSelectedMenuFilter}
            />
          </ComponentDemo>

          <ComponentDemo
            title="Column Toggles"
            description="Use checkbox items for on/off configuration."
          >
            <DesignMenu
              variant="toggles"
              triggerLabel="Toggle columns"
              label="Toggle columns"
              align="end"
              options={columnOptions.map((column) => ({
                id: column.id,
                label: column.label,
                checked: visibleColumns[column.id],
              }))}
              onToggleChange={(id, checked) => {
                if (id !== "recipient" && id !== "subject" && id !== "sentAt" && id !== "status") {
                  throw new Error(`Unknown column id "${id}" in column toggle menu`);
                }
                setVisibleColumns((prev) => ({
                  ...prev,
                  [id]: checked,
                }));
              }}
            />
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "variant", type: "'actions' | 'selector' | 'toggles'", default: "'actions'", description: "Selects action list, radio selector menu, or checkbox settings menu." },
              { name: "trigger", type: "'button' | 'icon'", default: "'button'", description: "Trigger presentation for the menu." },
              { name: "triggerLabel", type: "string", default: "'Open Menu'", description: "Label for button trigger or aria-label for icon trigger." },
              { name: "label", type: "string", description: "Optional section label for grouped items." },
              { name: "items", type: "Array<{ id: string, label: string, icon?: ReactNode, itemVariant?: 'default' | 'destructive', onClick?: () => void | Promise<void> }>", description: "Action menu items for variant='actions'." },
              { name: "options", type: "Array<{ id: string, label: string }> | Array<{ id: string, label: string, checked: boolean }>", description: "Selector options or toggle options depending on variant." },
              { name: "value", type: "string", description: "Selected option id when variant='selector'." },
              { name: "onValueChange", type: "(value: string) => void", description: "Selection handler when variant='selector'." },
              { name: "onToggleChange", type: "(id: string, checked: boolean) => void", description: "Checkbox toggle handler when variant='toggles'." },
              { name: "withIcons", type: "boolean", default: "false", description: "Adds leading icons for action menus." },
              { name: "item.onClick", type: "() => void | Promise<void>", description: "Return a Promise to keep the menu open with a spinner until complete." },
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
            <DesignPillToggle
              options={viewportOptions}
              selected={selectedViewport}
              onSelect={setSelectedViewport}
              size="md"
              glassmorphic={false}
              gradient="default"
            />
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
              <DesignSelectorDropdown
                value={selectedSelectorValue}
                onValueChange={setSelectedSelectorValue}
                options={selectorOptions}
                size="sm"
              />
            </div>
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "value", type: "string", description: "Currently selected value." },
              { name: "onValueChange", type: "(value: string) => void", description: "Selection handler for the dropdown." },
              { name: "options", type: "Array<{ value: string, label: string, disabled?: boolean }>", description: "Selectable options rendered in the dropdown." },
              { name: "placeholder", type: "string", default: "'Select'", description: "Placeholder label when no option is selected." },
              { name: "size", type: "'sm' | 'md' | 'lg'", default: "'sm'", description: "Controls trigger height and text size." },
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
            <DesignCard
              icon={Envelope}
              title="Email Log"
              subtitle="Recent delivery activity with quick filters"
            >
              <DesignDataTable
                data={demoEmailRows}
                columns={demoTableColumns}
                defaultColumnFilters={[]}
                defaultSorting={[{ id: "sentAt", desc: true }]}
              />
            </DesignCard>
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "title", type: "string", description: "Optional table card header title." },
              { name: "subtitle", type: "string", description: "Optional supporting text below the header title." },
              { name: "icon", type: "ReactElement", description: "Optional header icon shown before the title." },
              { name: "columns", type: "ColumnDef[]", description: "Column definitions for headers and cells." },
              { name: "data", type: "Array<Record<string, unknown>>", description: "Row data to render in the table." },
              { name: "defaultColumnFilters", type: "ColumnFiltersState", default: "[]", description: "Initial filter state for table columns." },
              { name: "defaultSorting", type: "SortingState", description: "Initial sort order for the table." },
              { name: "showDefaultToolbar", type: "boolean", default: "false", description: "Toggle the built-in toolbar controls." },
              { name: "viewOptions", type: "boolean", default: "false", description: "Use DataTableViewOptions for column toggles." },
              { name: "onRowClick", type: "(row) => void", description: "Optional row click handler for navigation." },
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
            <DesignCategoryTabs
              categories={categories}
              selectedCategory={selectedCategory}
              onSelect={setSelectedCategory}
              glassmorphic={false}
              gradient="blue"
            />
          </ComponentDemo>

          <div className="pt-4 border-t border-black/[0.12] dark:border-white/[0.06]">
            <Typography type="label" className="font-semibold mb-3">Props</Typography>
            <PropsTable props={[
              { name: "categories", type: "Array<{ id: string, label: string, count?: number, badgeCount?: number }>", description: "Tab items. Set count/badgeCount to provide badge values." },
              { name: "selectedCategory", type: "string", description: "Currently selected category id." },
              { name: "onSelect", type: "(id: string) => void", description: "Selection handler for category tabs." },
              { name: "showBadge", type: "boolean", default: "true", description: "Enable/disable the number badge next to each tab label." },
              { name: "size", type: "'sm' | 'md'", default: "'sm'", description: "Controls padding and density." },
              { name: "glassmorphic", type: "boolean", default: "false", description: "Enable when tabs are on glass surfaces." },
              { name: "gradient", type: "'blue' | 'cyan' | 'purple' | 'green' | 'orange' | 'default'", description: "Optional accent when glassmorphic is true." },
            ]} />
          </div>
        </DesignSection>

      </div>
    </PageLayout>
  );
}
