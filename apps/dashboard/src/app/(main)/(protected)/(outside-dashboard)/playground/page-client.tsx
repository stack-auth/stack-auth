"use client";

import {
  DesignAlert,
  DesignBadge,
  type DesignBadgeColor,
  DesignButton,
  DesignCard,
  DesignCategoryTabs,
  CursorBlastEffect,
  DesignDataTable,
  DesignEditableGrid,
  type DesignEditableGridItem,
  DesignInput,
  DesignListItemRow,
  DesignMenu,
  DesignPillToggle,
  DesignSelectorDropdown,
  DesignUserList,
} from "@/components/design-language";
import { DataTableColumnHeader, Typography } from "@/components/ui";
import {
  CheckCircle,
  Cube,
  Envelope,
  FileText,
  HardDrive,
  Info,
  MagnifyingGlassIcon,
  Package,
  PencilSimple,
  Sliders,
  Sparkle,
  StackSimple,
  Tag,
  Trash,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { ColumnDef } from "@tanstack/react-table";
import { useMemo, useRef, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type ComponentId =
  | "alert"
  | "badge"
  | "button"
  | "card"
  | "category-tabs"
  | "cursor-blast"
  | "data-table"
  | "editable-grid"
  | "input"
  | "list-item-row"
  | "menu"
  | "pill-toggle"
  | "selector-dropdown"
  | "user-list";

const COMPONENT_LIST: Array<{ value: ComponentId, label: string }> = [
  { value: "alert", label: "Alert" },
  { value: "badge", label: "Badge" },
  { value: "button", label: "Button" },
  { value: "card", label: "Card" },
  { value: "category-tabs", label: "Category Tabs" },
  { value: "cursor-blast", label: "Cursor Blast Effect" },
  { value: "data-table", label: "Data Table" },
  { value: "editable-grid", label: "Editable Grid" },
  { value: "input", label: "Input" },
  { value: "list-item-row", label: "List Item Row" },
  { value: "menu", label: "Menu" },
  { value: "pill-toggle", label: "Pill Toggle" },
  { value: "selector-dropdown", label: "Selector Dropdown" },
  { value: "user-list", label: "User List" },
];

function isComponentId(value: string): value is ComponentId {
  return COMPONENT_LIST.some((c) => c.value === value);
}

// ─── Shared enums ────────────────────────────────────────────────────────────

type Gradient = "blue" | "cyan" | "purple" | "green" | "orange" | "default";
type Size3 = "sm" | "md" | "lg";

const GRADIENT_OPTIONS: Array<{ value: Gradient, label: string }> = [
  { value: "default", label: "Default" },
  { value: "blue", label: "Blue" },
  { value: "cyan", label: "Cyan" },
  { value: "purple", label: "Purple" },
  { value: "green", label: "Green" },
  { value: "orange", label: "Orange" },
];

const SIZE3_OPTIONS: Array<{ value: Size3, label: string }> = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
];

function isGradient(v: string): v is Gradient {
  return GRADIENT_OPTIONS.some((o) => o.value === v);
}
function isSize3(v: string): v is Size3 {
  return SIZE3_OPTIONS.some((o) => o.value === v);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function PropField({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
        {label}
      </span>
      {children}
    </div>
  );
}

function BoolToggle({
  value,
  onChange,
  on = "On",
  off = "Off",
}: {
  value: boolean,
  onChange: (v: boolean) => void,
  on?: string,
  off?: string,
}) {
  return (
    <div className="max-w-[132px]">
      <DesignSelectorDropdown
        value={value ? "true" : "false"}
        onValueChange={(nextValue) => onChange(nextValue === "true")}
        options={[
          { value: "true", label: on },
          { value: "false", label: off },
        ]}
        size="sm"
      />
    </div>
  );
}

// ─── Demo data ───────────────────────────────────────────────────────────────

type DemoProduct = {
  id: string,
  name: string,
  category: string,
  price: number,
  status: "active" | "draft" | "archived",
};

const DEMO_PRODUCTS: DemoProduct[] = [
  { id: "1", name: "Widget Pro", category: "Hardware", price: 29.99, status: "active" },
  { id: "2", name: "Gadget Lite", category: "Accessories", price: 14.99, status: "draft" },
  { id: "3", name: "Tool Max", category: "Software", price: 49.99, status: "archived" },
  { id: "4", name: "Sensor Hub", category: "Hardware", price: 79.99, status: "active" },
];

const STATUS_BADGE: Record<DemoProduct["status"], { label: string, color: DesignBadgeColor }> = {
  active: { label: "Active", color: "green" },
  draft: { label: "Draft", color: "orange" },
  archived: { label: "Archived", color: "red" },
};

const DEMO_USERS = [
  { name: "Ada Lovelace", email: "ada@example.com", time: "Active 1h ago", color: "cyan" as const },
  { name: "Grace Hopper", email: "grace@example.com", time: "Active 3h ago", color: "blue" as const },
  { name: "Alan Turing", email: "alan@example.com", time: "Active 5h ago", color: "cyan" as const },
];

// ─── Main ────────────────────────────────────────────────────────────────────

export default function PageClient() {
  const [selected, setSelected] = useState<ComponentId>("button");

  // Alert
  const [alertVariant, setAlertVariant] = useState<"default" | "success" | "error" | "warning" | "info">("success");
  const [alertTitle, setAlertTitle] = useState("Order placed");
  const [alertDesc, setAlertDesc] = useState("Your order has been confirmed.");
  const [alertIcon, setAlertIcon] = useState(true);

  // Badge
  const [badgeLabel, setBadgeLabel] = useState("In stock");
  const [badgeColor, setBadgeColor] = useState<DesignBadgeColor>("green");
  const [badgeSize, setBadgeSize] = useState<"sm" | "md">("md");
  const [badgeIcon, setBadgeIcon] = useState(true);

  // Button
  const [btnLabel, setBtnLabel] = useState("Buy now");
  const [btnVariant, setBtnVariant] = useState<"default" | "secondary" | "outline" | "destructive" | "ghost" | "link" | "plain">("default");
  const [btnSize, setBtnSize] = useState<"default" | "sm" | "lg" | "icon" | "plain">("default");
  const [btnLoading, setBtnLoading] = useState(false);

  // Card
  const [cardVariant, setCardVariant] = useState<"header" | "compact" | "bodyOnly">("header");
  const [cardTitle, setCardTitle] = useState("Featured Bundle");
  const [cardSubtitle, setCardSubtitle] = useState("Save 20% this week.");
  const [cardSize, setCardSize] = useState<Size3>("md");
  const [cardGradient, setCardGradient] = useState<Gradient>("default");
  const [cardGlass, setCardGlass] = useState(true);
  const [cardShowIcon, setCardShowIcon] = useState(true);

  // Category Tabs
  const [tabSize, setTabSize] = useState<Size3>("md");
  const [tabGlass, setTabGlass] = useState(false);
  const [tabGradient, setTabGradient] = useState<Gradient>("blue");
  const [tabSelected, setTabSelected] = useState("all");
  const [tabShowBadge, setTabShowBadge] = useState(true);

  // Cursor Blast
  const blastPreviewRef = useRef<HTMLDivElement>(null);
  const [blastEnabled, setBlastEnabled] = useState(true);
  const [blastLifetime, setBlastLifetime] = useState(720);
  const [blastMaxActive, setBlastMaxActive] = useState(18);
  const [blastRageThreshold, setBlastRageThreshold] = useState(3);
  const [blastRageWindow, setBlastRageWindow] = useState(600);
  const [blastRageRadius, setBlastRageRadius] = useState(60);

  // Data Table
  const [tableTitle, setTableTitle] = useState("Products");
  const [tableSubtitle, setTableSubtitle] = useState("All items in catalog");
  const [tableShowHeader, setTableShowHeader] = useState(true);
  const [tableShowIcon, setTableShowIcon] = useState(true);
  const [tableClickableRows, setTableClickableRows] = useState(false);
  const [tableLastRowClick, setTableLastRowClick] = useState("");

  // Editable Grid
  const [gridCols, setGridCols] = useState<1 | 2>(2);
  const [gridMode, setGridMode] = useState<"basic" | "full">("basic");
  const [gridDeferredSave, setGridDeferredSave] = useState(false);
  const [gridHasChanges, setGridHasChanges] = useState(false);
  const [gridShowModified, setGridShowModified] = useState(false);
  const [gridActionLog, setGridActionLog] = useState("");

  // Input
  const [inputPlaceholder, setInputPlaceholder] = useState("Search products...");
  const [inputSize, setInputSize] = useState<Size3>("md");
  const [inputIcon, setInputIcon] = useState(false);
  const [inputPrefix, setInputPrefix] = useState(false);
  const [inputType, setInputType] = useState<"text" | "password">("text");
  const [inputDisabled, setInputDisabled] = useState(false);

  // List Item Row
  const [listTitle, setListTitle] = useState("Premium Support Plan");
  const [listShowIcon, setListShowIcon] = useState(true);
  const [listEdit, setListEdit] = useState(true);
  const [listDelete, setListDelete] = useState(true);
  const [listLastAction, setListLastAction] = useState("");

  // Menu
  const [menuVariant, setMenuVariant] = useState<"actions" | "selector" | "toggles">("actions");
  const [menuSelectorValue, setMenuSelectorValue] = useState("all");
  const [menuToggles, setMenuToggles] = useState<Record<string, boolean>>({ opt1: true, opt2: false, opt3: true });
  const [menuTrigger, setMenuTrigger] = useState<"button" | "icon">("button");
  const [menuTriggerLabel, setMenuTriggerLabel] = useState("Open Menu");
  const [menuLabel, setMenuLabel] = useState("Actions");
  const [menuAlign, setMenuAlign] = useState<"start" | "center" | "end">("start");
  const [menuWithIcons, setMenuWithIcons] = useState(true);
  const [menuActionStyle, setMenuActionStyle] = useState<"default" | "destructive">("destructive");
  const [menuLastAction, setMenuLastAction] = useState("");

  // Pill Toggle
  const [pillSize, setPillSize] = useState<Size3>("md");
  const [pillGlass, setPillGlass] = useState(false);
  const [pillShowIcons, setPillShowIcons] = useState(true);
  const [pillShowLabels, setPillShowLabels] = useState(true);
  const [pillSelected, setPillSelected] = useState("a");

  // Selector Dropdown
  const [selSize, setSelSize] = useState<Size3>("sm");
  const [selDisabled, setSelDisabled] = useState(false);
  const [selValue, setSelValue] = useState("option-a");
  const [selPlaceholder, setSelPlaceholder] = useState("Select");
  const [selDisableOptionB, setSelDisableOptionB] = useState(false);

  // User List
  const [userClickable, setUserClickable] = useState(true);
  const [userShowAvatar, setUserShowAvatar] = useState(true);
  const [userGradient, setUserGradient] = useState<"blue-purple" | "cyan-blue" | "none">("blue-purple");
  const [userLastClick, setUserLastClick] = useState("");

  // ─── Demo table columns ──────────────────────────────────────────────────

  const tableColumns = useMemo<ColumnDef<DemoProduct>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Name" />,
        cell: ({ row }) => <span className="text-sm font-medium text-foreground">{row.getValue("name")}</span>,
      },
      {
        accessorKey: "category",
        header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Category" />,
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.getValue("category")}</span>,
      },
      {
        accessorKey: "price",
        header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Price" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            ${(row.getValue("price") as number).toFixed(2)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Status" />,
        cell: ({ row }) => {
          const s = row.getValue("status") as DemoProduct["status"];
          return <DesignBadge label={STATUS_BADGE[s].label} color={STATUS_BADGE[s].color} size="sm" />;
        },
      },
    ],
    []
  );

  // ─── Demo editable grid items ────────────────────────────────────────────

  const editableItems = useMemo<DesignEditableGridItem[]>(() => {
    const baseItems: DesignEditableGridItem[] = [
      {
        itemKey: "display-name",
        type: "text",
        icon: <FileText className="h-4 w-4" />,
        name: "Display Name",
        value: "Widget Pro",
        readOnly: false,
        onUpdate: async () => {
          await new Promise((r) => setTimeout(r, 400));
          setGridActionLog("Updated text value");
        },
      },
      {
        itemKey: "active",
        type: "boolean",
        icon: <StackSimple className="h-4 w-4" />,
        name: "Active",
        value: true,
        readOnly: false,
        trueLabel: "Yes",
        falseLabel: "No",
        onUpdate: async () => {
          await new Promise((r) => setTimeout(r, 400));
          setGridActionLog("Updated boolean value");
        },
      },
      {
        itemKey: "category",
        type: "dropdown",
        icon: <Sliders className="h-4 w-4" />,
        name: "Category",
        value: "hardware",
        options: [
          { value: "hardware", label: "Hardware" },
          { value: "software", label: "Software" },
          { value: "accessories", label: "Accessories" },
        ],
        readOnly: false,
        onUpdate: async () => {
          await new Promise((r) => setTimeout(r, 400));
          setGridActionLog("Updated dropdown value");
        },
      },
      {
        itemKey: "price",
        type: "custom",
        icon: <Tag className="h-4 w-4" />,
        name: "Price",
        children: <span className="text-sm text-foreground">$29.99</span>,
      },
    ];

    if (gridMode === "full") {
      return [
        ...baseItems,
        {
          itemKey: "custom-dropdown",
          type: "custom-dropdown",
          icon: <Sparkle className="h-4 w-4" />,
          name: "Custom Dropdown",
          triggerContent: <span>Open custom panel</span>,
          popoverContent: <div>Custom content</div>,
          disabled: false,
        },
        {
          itemKey: "custom-button",
          type: "custom-button",
          icon: <Cube className="h-4 w-4" />,
          name: "Custom Button",
          onClick: () => setGridActionLog("Clicked custom button"),
          children: <span>Run action</span>,
          disabled: false,
        },
      ];
    }

    return baseItems;
  }, [gridMode]);

  // ─── Preview renderer ────────────────────────────────────────────────────

  const alertIconMap: Record<string, React.ElementType> = {
    success: CheckCircle,
    error: XCircle,
    warning: WarningCircle,
    info: Info,
    default: Info,
  };

  function renderPreview() {
    if (selected === "alert") {
      return (
        <div className="w-full max-w-lg">
          <DesignAlert
            variant={alertVariant}
            icon={alertIcon ? alertIconMap[alertVariant] : undefined}
            title={alertTitle}
            description={alertDesc}
          />
        </div>
      );
    }
    if (selected === "badge") {
      return (
        <DesignBadge
          label={badgeLabel || "Badge"}
          color={badgeColor}
          size={badgeSize}
          icon={badgeIcon ? CheckCircle : undefined}
        />
      );
    }
    if (selected === "button") {
      return (
        <DesignButton
          variant={btnVariant}
          size={btnSize}
          loading={btnLoading}
        >
          {btnSize === "icon"
            ? <Sparkle className="h-4 w-4" />
            : btnLabel || "Button"}
        </DesignButton>
      );
    }
    if (selected === "card") {
      return (
        <div className="w-full max-w-md">
          <DesignCard
            variant={cardVariant}
            title={cardTitle}
            subtitle={cardSubtitle}
            icon={cardShowIcon ? Package : undefined}
            size={cardSize}
            gradient={cardGradient}
            glassmorphic={cardGlass}
          >
            <Typography variant="secondary" className="text-sm">
              Highlight pricing, benefits, or key product details here.
            </Typography>
          </DesignCard>
        </div>
      );
    }
    if (selected === "category-tabs") {
      return (
        <DesignCategoryTabs
          categories={[
            { id: "all", label: "All Items", count: 24 },
            { id: "active", label: "Active", count: 12 },
            { id: "draft", label: "Drafts", count: 8 },
            { id: "archived", label: "Archived", count: 4 },
          ]}
          selectedCategory={tabSelected}
          onSelect={setTabSelected}
          showBadge={tabShowBadge}
          size={tabSize}
          glassmorphic={tabGlass}
          gradient={tabGradient}
        />
      );
    }
    if (selected === "cursor-blast") {
      return (
        <div className="flex flex-col items-center gap-3">
          {blastEnabled && (
            <CursorBlastEffect
              containerRef={blastPreviewRef}
              blastLifetimeMs={blastLifetime}
              maxActiveBlasts={blastMaxActive}
              rageClickThreshold={blastRageThreshold}
              rageClickWindowMs={blastRageWindow}
              rageClickRadiusPx={blastRageRadius}
            />
          )}
          <Typography variant="secondary" className="text-sm text-center max-w-xs">
            {blastEnabled
              ? "Rage-click inside the preview area to trigger the blast effect."
              : "Enable the effect to see cursor blasts."}
          </Typography>
        </div>
      );
    }
    if (selected === "data-table") {
      return (
        <div className="w-full max-w-2xl">
          <DesignDataTable
            title={tableTitle}
            subtitle={tableSubtitle}
            icon={tableShowIcon ? Package : undefined}
            showHeader={tableShowHeader}
            data={DEMO_PRODUCTS}
            columns={tableColumns}
            defaultSorting={[{ id: "name", desc: false }]}
            onRowClick={tableClickableRows ? (row) => setTableLastRowClick(row.name) : undefined}
          />
          {tableLastRowClick && (
            <Typography variant="secondary" className="text-xs mt-2">
              Last row click: {tableLastRowClick}
            </Typography>
          )}
        </div>
      );
    }
    if (selected === "editable-grid") {
      return (
        <div className="w-full max-w-xl">
          <div className="rounded-2xl overflow-hidden bg-white/90 dark:bg-[hsl(240,10%,5.5%)] border border-black/[0.12] dark:border-foreground/[0.12] shadow-sm">
            <div className="p-5">
              <DesignEditableGrid
                items={editableItems}
                columns={gridCols}
                className="gap-x-6 gap-y-3"
                deferredSave={gridDeferredSave}
                hasChanges={gridHasChanges}
                onSave={gridDeferredSave ? async () => {
                  await new Promise((r) => setTimeout(r, 400));
                  setGridActionLog("Saved deferred changes");
                  setGridHasChanges(false);
                } : undefined}
                onDiscard={gridDeferredSave ? () => {
                  setGridActionLog("Discarded deferred changes");
                  setGridHasChanges(false);
                } : undefined}
                externalModifiedKeys={gridShowModified ? new Set(["display-name", "category"]) : undefined}
              />
              {gridActionLog && (
                <Typography variant="secondary" className="text-xs mt-2">
                  Last action: {gridActionLog}
                </Typography>
              )}
            </div>
          </div>
        </div>
      );
    }
    if (selected === "input") {
      return (
        <div className="w-full max-w-xs">
          <DesignInput
            type={inputType}
            size={inputSize}
            disabled={inputDisabled}
            placeholder={inputPlaceholder}
            leadingIcon={inputPrefix ? undefined : (inputIcon ? <MagnifyingGlassIcon className="h-3 w-3" /> : undefined)}
            prefixItem={inputPrefix ? "$" : undefined}
          />
        </div>
      );
    }
    if (selected === "list-item-row") {
      return (
        <div className="w-full max-w-lg space-y-2">
          <DesignListItemRow
            icon={Cube}
            title={listTitle}
            showIcon={listShowIcon}
            onEdit={listEdit ? () => setListLastAction("edit") : undefined}
            onDelete={listDelete ? () => setListLastAction("delete") : undefined}
          />
          {listLastAction && (
            <Typography variant="secondary" className="text-xs pl-1">
              Last action: {listLastAction}
            </Typography>
          )}
        </div>
      );
    }
    if (selected === "menu") {
      if (menuVariant === "selector") {
        return (
          <DesignMenu
            variant="selector"
            trigger={menuTrigger}
            align={menuAlign}
            triggerLabel={
              menuTriggerLabel || (
                [
                  { id: "all", label: "All" },
                  { id: "active", label: "Active" },
                  { id: "drafts", label: "Drafts" },
                ].find((o) => o.id === menuSelectorValue)?.label ?? "Select"
              )
            }
            label={menuLabel}
            options={[
              { id: "all", label: "All" },
              { id: "active", label: "Active" },
              { id: "drafts", label: "Drafts" },
            ]}
            value={menuSelectorValue}
            onValueChange={setMenuSelectorValue}
          />
        );
      }
      if (menuVariant === "toggles") {
        return (
          <DesignMenu
            variant="toggles"
            trigger={menuTrigger}
            triggerLabel={menuTriggerLabel}
            align={menuAlign}
            label={menuLabel}
            options={[
              { id: "opt1", label: "Name", checked: !!menuToggles.opt1 },
              { id: "opt2", label: "Status", checked: !!menuToggles.opt2 },
              { id: "opt3", label: "Price", checked: !!menuToggles.opt3 },
            ]}
            onToggleChange={(id, checked) => setMenuToggles((prev) => ({ ...prev, [id]: checked }))}
          />
        );
      }
      return (
        <DesignMenu
          variant="actions"
          trigger={menuTrigger}
          triggerLabel={menuTriggerLabel}
          align={menuAlign}
          label={menuLabel}
          withIcons={menuWithIcons}
          items={[
            { id: "edit", label: "Edit", icon: <PencilSimple className="h-4 w-4" />, onClick: () => setMenuLastAction("edit") },
            { id: "email", label: "Send email", icon: <Envelope className="h-4 w-4" />, onClick: () => setMenuLastAction("send-email") },
            { id: "delete", label: "Delete", icon: <Trash className="h-4 w-4" />, itemVariant: menuActionStyle, onClick: () => setMenuLastAction("delete") },
          ]}
        />
      );
    }
    if (selected === "pill-toggle") {
      return (
        <DesignPillToggle
          options={[
            { id: "a", label: "Phone", icon: Envelope },
            { id: "b", label: "Tablet", icon: HardDrive },
            { id: "c", label: "Desktop", icon: Sparkle },
          ]}
          selected={pillSelected}
          onSelect={setPillSelected}
          size={pillSize}
          glassmorphic={pillGlass}
          showIcons={pillShowIcons}
          showLabels={pillShowLabels}
        />
      );
    }
    if (selected === "selector-dropdown") {
      return (
        <div className="w-48">
          <DesignSelectorDropdown
            value={selValue}
            onValueChange={setSelValue}
            options={[
              { value: "option-a", label: "Option A" },
              { value: "option-b", label: "Option B", disabled: selDisableOptionB },
              { value: "option-c", label: "Option C" },
            ]}
            placeholder={selPlaceholder}
            size={selSize}
            disabled={selDisabled}
          />
        </div>
      );
    }
    // user-list
    return (
      <div className="w-full max-w-sm">
        <DesignUserList
          users={DEMO_USERS}
          showAvatar={userShowAvatar}
          gradient={userGradient}
          onUserClick={userClickable ? (user) => setUserLastClick(user.name) : undefined}
        />
        {userLastClick && (
          <Typography variant="secondary" className="text-xs mt-2">
            Last clicked user: {userLastClick}
          </Typography>
        )}
      </div>
    );
  }

  // ─── Controls renderer ───────────────────────────────────────────────────

  function renderControls() {
    if (selected === "alert") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 items-end">
          <PropField label="Variant">
            <DesignSelectorDropdown
              value={alertVariant}
              onValueChange={(v) => {
                if (v === "default" || v === "success" || v === "error" || v === "warning" || v === "info") {
                  setAlertVariant(v);
                  return;
                }
                throw new Error(`Unknown alert variant "${v}"`);
              }}
              options={[
                { value: "default", label: "Default" },
                { value: "success", label: "Success" },
                { value: "error", label: "Error" },
                { value: "warning", label: "Warning" },
                { value: "info", label: "Info" },
              ]}
              size="sm"
            />
          </PropField>
          <PropField label="Title">
            <DesignInput size="sm" value={alertTitle} onChange={(e) => setAlertTitle(e.target.value)} />
          </PropField>
          <PropField label="Description">
            <DesignInput size="sm" value={alertDesc} onChange={(e) => setAlertDesc(e.target.value)} />
          </PropField>
          <PropField label="Icon">
            <BoolToggle value={alertIcon} onChange={setAlertIcon} on="Show" off="Hide" />
          </PropField>
        </div>
      );
    }
    if (selected === "badge") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 items-end">
          <PropField label="Label">
            <DesignInput size="sm" value={badgeLabel} onChange={(e) => setBadgeLabel(e.target.value)} />
          </PropField>
          <PropField label="Color">
            <DesignSelectorDropdown
              value={badgeColor}
              onValueChange={(v) => {
                if (v === "blue" || v === "cyan" || v === "purple" || v === "green" || v === "orange" || v === "red") {
                  setBadgeColor(v);
                  return;
                }
                throw new Error(`Unknown badge color "${v}"`);
              }}
              options={[
                { value: "blue", label: "Blue" },
                { value: "cyan", label: "Cyan" },
                { value: "purple", label: "Purple" },
                { value: "green", label: "Green" },
                { value: "orange", label: "Orange" },
                { value: "red", label: "Red" },
              ]}
              size="sm"
            />
          </PropField>
          <PropField label="Size">
            <DesignSelectorDropdown
              value={badgeSize}
              onValueChange={(v) => {
                if (v === "sm" || v === "md") {
                  setBadgeSize(v);
                  return;
                }
                throw new Error(`Unknown badge size "${v}"`);
              }}
              options={[
                { value: "sm", label: "Small" },
                { value: "md", label: "Medium" },
              ]}
              size="sm"
            />
          </PropField>
          <PropField label="Icon">
            <BoolToggle value={badgeIcon} onChange={setBadgeIcon} on="Show" off="Hide" />
          </PropField>
        </div>
      );
    }
    if (selected === "button") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 items-end">
          <PropField label="Label">
            <DesignInput size="sm" value={btnLabel} onChange={(e) => setBtnLabel(e.target.value)} />
          </PropField>
          <PropField label="Variant">
            <DesignSelectorDropdown
              value={btnVariant}
              onValueChange={(v) => {
                if (v === "default" || v === "secondary" || v === "outline" || v === "destructive" || v === "ghost" || v === "link" || v === "plain") {
                  setBtnVariant(v);
                  return;
                }
                throw new Error(`Unknown button variant "${v}"`);
              }}
              options={[
                { value: "default", label: "Default" },
                { value: "secondary", label: "Secondary" },
                { value: "outline", label: "Outline" },
                { value: "destructive", label: "Destructive" },
                { value: "ghost", label: "Ghost" },
                { value: "link", label: "Link" },
                { value: "plain", label: "Plain" },
              ]}
              size="sm"
            />
          </PropField>
          <PropField label="Size">
            <DesignSelectorDropdown
              value={btnSize}
              onValueChange={(v) => {
                if (v === "default" || v === "sm" || v === "lg" || v === "icon" || v === "plain") {
                  setBtnSize(v);
                  return;
                }
                throw new Error(`Unknown button size "${v}"`);
              }}
              options={[
                { value: "default", label: "Default" },
                { value: "sm", label: "Small" },
                { value: "lg", label: "Large" },
                { value: "icon", label: "Icon" },
                { value: "plain", label: "Plain" },
              ]}
              size="sm"
            />
          </PropField>
          <PropField label="Loading">
            <BoolToggle value={btnLoading} onChange={setBtnLoading} />
          </PropField>
        </div>
      );
    }
    if (selected === "card") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 items-end">
          <PropField label="Variant">
            <DesignSelectorDropdown
              value={cardVariant}
              onValueChange={(v) => {
                if (v === "header" || v === "compact" || v === "bodyOnly") {
                  setCardVariant(v);
                  return;
                }
                throw new Error(`Unknown card variant "${v}"`);
              }}
              options={[
                { value: "header", label: "Header" },
                { value: "compact", label: "Compact" },
                { value: "bodyOnly", label: "Body Only" },
              ]}
              size="sm"
            />
          </PropField>
          <PropField label="Title">
            <DesignInput size="sm" value={cardTitle} onChange={(e) => setCardTitle(e.target.value)} />
          </PropField>
          <PropField label="Subtitle">
            <DesignInput size="sm" value={cardSubtitle} onChange={(e) => setCardSubtitle(e.target.value)} />
          </PropField>
          <PropField label="Size">
            <DesignSelectorDropdown
              value={cardSize}
              onValueChange={(v) => {
                if (!isSize3(v)) throw new Error(`Unknown card size "${v}"`);
                setCardSize(v);
              }}
              options={SIZE3_OPTIONS}
              size="sm"
            />
          </PropField>
          <PropField label="Gradient">
            <DesignSelectorDropdown
              value={cardGradient}
              onValueChange={(v) => {
                if (!isGradient(v)) throw new Error(`Unknown gradient "${v}"`);
                setCardGradient(v);
              }}
              options={GRADIENT_OPTIONS}
              size="sm"
            />
          </PropField>
          <PropField label="Glassmorphic">
            <BoolToggle value={cardGlass} onChange={setCardGlass} />
          </PropField>
          <PropField label="Header Icon">
            <BoolToggle value={cardShowIcon} onChange={setCardShowIcon} on="Show" off="Hide" />
          </PropField>
        </div>
      );
    }
    if (selected === "category-tabs") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 items-end">
          <PropField label="Size">
            <DesignSelectorDropdown
              value={tabSize}
              onValueChange={(v) => {
                if (!isSize3(v)) throw new Error(`Unknown size "${v}"`);
                setTabSize(v);
              }}
              options={SIZE3_OPTIONS}
              size="sm"
            />
          </PropField>
          <PropField label="Gradient">
            <DesignSelectorDropdown
              value={tabGradient}
              onValueChange={(v) => {
                if (!isGradient(v)) throw new Error(`Unknown gradient "${v}"`);
                setTabGradient(v);
              }}
              options={GRADIENT_OPTIONS}
              size="sm"
            />
          </PropField>
          <PropField label="Glassmorphic">
            <BoolToggle value={tabGlass} onChange={setTabGlass} />
          </PropField>
          <PropField label="Show Badge">
            <BoolToggle value={tabShowBadge} onChange={setTabShowBadge} on="Yes" off="No" />
          </PropField>
        </div>
      );
    }
    if (selected === "cursor-blast") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 items-end">
          <PropField label="Enabled">
            <BoolToggle value={blastEnabled} onChange={setBlastEnabled} />
          </PropField>
          <PropField label="Lifetime (ms)">
            <DesignInput
              size="sm"
              type="text"
              value={String(blastLifetime)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isNaN(n) && n > 0) setBlastLifetime(n);
              }}
            />
          </PropField>
          <PropField label="Max Active">
            <DesignInput
              size="sm"
              type="text"
              value={String(blastMaxActive)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isNaN(n) && n > 0) setBlastMaxActive(n);
              }}
            />
          </PropField>
          <PropField label="Rage Threshold">
            <DesignInput
              size="sm"
              type="text"
              value={String(blastRageThreshold)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isNaN(n) && n > 0) setBlastRageThreshold(n);
              }}
            />
          </PropField>
          <PropField label="Rage Window (ms)">
            <DesignInput
              size="sm"
              type="text"
              value={String(blastRageWindow)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isNaN(n) && n > 0) setBlastRageWindow(n);
              }}
            />
          </PropField>
          <PropField label="Rage Radius (px)">
            <DesignInput
              size="sm"
              type="text"
              value={String(blastRageRadius)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isNaN(n) && n > 0) setBlastRageRadius(n);
              }}
            />
          </PropField>
        </div>
      );
    }
    if (selected === "data-table") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 items-end">
          <PropField label="Title">
            <DesignInput size="sm" value={tableTitle} onChange={(e) => setTableTitle(e.target.value)} />
          </PropField>
          <PropField label="Subtitle">
            <DesignInput size="sm" value={tableSubtitle} onChange={(e) => setTableSubtitle(e.target.value)} />
          </PropField>
          <PropField label="Show Header">
            <BoolToggle value={tableShowHeader} onChange={setTableShowHeader} on="Show" off="Hide" />
          </PropField>
          <PropField label="Show Icon">
            <BoolToggle value={tableShowIcon} onChange={setTableShowIcon} />
          </PropField>
          <PropField label="Row Click">
            <BoolToggle value={tableClickableRows} onChange={setTableClickableRows} on="Enabled" off="Disabled" />
          </PropField>
        </div>
      );
    }
    if (selected === "editable-grid") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 items-end">
          <PropField label="Columns">
            <DesignSelectorDropdown
              value={String(gridCols)}
              onValueChange={(v) => {
                if (v === "1" || v === "2") {
                  setGridCols(Number(v) as 1 | 2);
                  return;
                }
                throw new Error(`Unknown column count "${v}"`);
              }}
              options={[
                { value: "1", label: "1 Column" },
                { value: "2", label: "2 Columns" },
              ]}
              size="sm"
            />
          </PropField>
          <PropField label="Mode">
            <DesignSelectorDropdown
              value={gridMode}
              onValueChange={(v) => {
                if (v === "basic" || v === "full") {
                  setGridMode(v);
                  return;
                }
                throw new Error(`Unknown grid mode "${v}"`);
              }}
              options={[
                { value: "basic", label: "Basic items" },
                { value: "full", label: "All item types" },
              ]}
              size="sm"
            />
          </PropField>
          <PropField label="Deferred Save">
            <BoolToggle value={gridDeferredSave} onChange={setGridDeferredSave} />
          </PropField>
          <PropField label="Has Changes">
            <BoolToggle value={gridHasChanges} onChange={setGridHasChanges} on="True" off="False" />
          </PropField>
          <PropField label="Modified Dots">
            <BoolToggle value={gridShowModified} onChange={setGridShowModified} on="Show" off="Hide" />
          </PropField>
        </div>
      );
    }
    if (selected === "input") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 items-end">
          <PropField label="Placeholder">
            <DesignInput size="sm" value={inputPlaceholder} onChange={(e) => setInputPlaceholder(e.target.value)} />
          </PropField>
          <PropField label="Size">
            <DesignSelectorDropdown
              value={inputSize}
              onValueChange={(v) => {
                if (!isSize3(v)) throw new Error(`Unknown size "${v}"`);
                setInputSize(v);
              }}
              options={SIZE3_OPTIONS}
              size="sm"
            />
          </PropField>
          <PropField label="Leading Icon">
            <BoolToggle value={inputIcon} onChange={setInputIcon} />
          </PropField>
          <PropField label="Prefix Item">
            <BoolToggle
              value={inputPrefix}
              onChange={(v) => {
                setInputPrefix(v);
                if (v) {
                  setInputIcon(false);
                }
              }}
            />
          </PropField>
          <PropField label="Type">
            <DesignSelectorDropdown
              value={inputType}
              onValueChange={(v) => {
                if (v === "text" || v === "password") {
                  setInputType(v);
                  return;
                }
                throw new Error(`Unknown input type "${v}"`);
              }}
              options={[
                { value: "text", label: "Text" },
                { value: "password", label: "Password" },
              ]}
              size="sm"
            />
          </PropField>
          <PropField label="Disabled">
            <BoolToggle value={inputDisabled} onChange={setInputDisabled} on="Yes" off="No" />
          </PropField>
        </div>
      );
    }
    if (selected === "list-item-row") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 items-end">
          <PropField label="Title">
            <DesignInput size="sm" value={listTitle} onChange={(e) => setListTitle(e.target.value)} />
          </PropField>
          <PropField label="Show Icon">
            <BoolToggle value={listShowIcon} onChange={setListShowIcon} on="Show" off="Hide" />
          </PropField>
          <PropField label="Edit Action">
            <BoolToggle value={listEdit} onChange={setListEdit} on="Show" off="Hide" />
          </PropField>
          <PropField label="Delete Action">
            <BoolToggle value={listDelete} onChange={setListDelete} on="Show" off="Hide" />
          </PropField>
        </div>
      );
    }
    if (selected === "menu") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 items-end">
          <PropField label="Variant">
            <DesignSelectorDropdown
              value={menuVariant}
              onValueChange={(v) => {
                if (v === "actions" || v === "selector" || v === "toggles") {
                  setMenuVariant(v);
                  return;
                }
                throw new Error(`Unknown menu variant "${v}"`);
              }}
              options={[
                { value: "actions", label: "Actions" },
                { value: "selector", label: "Selector" },
                { value: "toggles", label: "Toggles" },
              ]}
              size="sm"
            />
          </PropField>
          <PropField label="Trigger">
            <DesignSelectorDropdown
              value={menuTrigger}
              onValueChange={(v) => {
                if (v === "button" || v === "icon") {
                  setMenuTrigger(v);
                  return;
                }
                throw new Error(`Unknown menu trigger "${v}"`);
              }}
              options={[
                { value: "button", label: "Button" },
                { value: "icon", label: "Icon" },
              ]}
              size="sm"
            />
          </PropField>
          <PropField label="Align">
            <DesignSelectorDropdown
              value={menuAlign}
              onValueChange={(v) => {
                if (v === "start" || v === "center" || v === "end") {
                  setMenuAlign(v);
                  return;
                }
                throw new Error(`Unknown menu align "${v}"`);
              }}
              options={[
                { value: "start", label: "Start" },
                { value: "center", label: "Center" },
                { value: "end", label: "End" },
              ]}
              size="sm"
            />
          </PropField>
          <PropField label="Trigger Label">
            <DesignInput size="sm" value={menuTriggerLabel} onChange={(e) => setMenuTriggerLabel(e.target.value)} />
          </PropField>
          <PropField label="Group Label">
            <DesignInput size="sm" value={menuLabel} onChange={(e) => setMenuLabel(e.target.value)} />
          </PropField>
          <PropField label="With Icons">
            <BoolToggle value={menuWithIcons} onChange={setMenuWithIcons} />
          </PropField>
          <PropField label="Delete Style">
            <DesignSelectorDropdown
              value={menuActionStyle}
              onValueChange={(v) => {
                if (v === "default" || v === "destructive") {
                  setMenuActionStyle(v);
                  return;
                }
                throw new Error(`Unknown menu item style "${v}"`);
              }}
              options={[
                { value: "default", label: "Default" },
                { value: "destructive", label: "Destructive" },
              ]}
              size="sm"
            />
          </PropField>
          {menuLastAction && (
            <PropField label="Last Action">
              <Typography variant="secondary" className="text-xs h-8 inline-flex items-center">
                {menuLastAction}
              </Typography>
            </PropField>
          )}
        </div>
      );
    }
    if (selected === "pill-toggle") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 items-end">
          <PropField label="Size">
            <DesignSelectorDropdown
              value={pillSize}
              onValueChange={(v) => {
                if (!isSize3(v)) throw new Error(`Unknown size "${v}"`);
                setPillSize(v);
              }}
              options={SIZE3_OPTIONS}
              size="sm"
            />
          </PropField>
          <PropField label="Glassmorphic">
            <BoolToggle value={pillGlass} onChange={setPillGlass} />
          </PropField>
          <PropField label="Show Icons">
            <BoolToggle value={pillShowIcons} onChange={setPillShowIcons} on="Show" off="Hide" />
          </PropField>
          <PropField label="Show Labels">
            <BoolToggle value={pillShowLabels} onChange={setPillShowLabels} on="Show" off="Hide" />
          </PropField>
        </div>
      );
    }
    if (selected === "selector-dropdown") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 items-end">
          <PropField label="Size">
            <DesignSelectorDropdown
              value={selSize}
              onValueChange={(v) => {
                if (!isSize3(v)) throw new Error(`Unknown size "${v}"`);
                setSelSize(v);
              }}
              options={SIZE3_OPTIONS}
              size="sm"
            />
          </PropField>
          <PropField label="Disabled">
            <BoolToggle value={selDisabled} onChange={setSelDisabled} on="Yes" off="No" />
          </PropField>
          <PropField label="Placeholder">
            <DesignInput size="sm" value={selPlaceholder} onChange={(e) => setSelPlaceholder(e.target.value)} />
          </PropField>
          <PropField label="Disable Option B">
            <BoolToggle value={selDisableOptionB} onChange={setSelDisableOptionB} on="Yes" off="No" />
          </PropField>
        </div>
      );
    }
    // user-list
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 items-end">
        <PropField label="User Clickable">
          <BoolToggle value={userClickable} onChange={setUserClickable} on="Yes" off="No" />
        </PropField>
        <PropField label="Show Avatar">
          <BoolToggle value={userShowAvatar} onChange={setUserShowAvatar} on="Show" off="Hide" />
        </PropField>
        <PropField label="Avatar Gradient">
          <DesignSelectorDropdown
            value={userGradient}
            onValueChange={(v) => {
              if (v === "blue-purple" || v === "cyan-blue" || v === "none") {
                setUserGradient(v);
                return;
              }
              throw new Error(`Unknown gradient "${v}"`);
            }}
            options={[
              { value: "blue-purple", label: "Blue → Purple" },
              { value: "cyan-blue", label: "Cyan → Blue" },
              { value: "none", label: "None" },
            ]}
            size="sm"
          />
        </PropField>
      </div>
    );
  }

  // ─── Layout ──────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 w-full">
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-8 sm:py-10 space-y-7 sm:space-y-8">

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <Typography type="h2" className="text-xl font-semibold tracking-tight">
              Playground
            </Typography>
            <Typography variant="secondary" className="text-[13px]">
              Explore and configure every design-language component.
            </Typography>
          </div>
          <div className="w-full sm:w-64 shrink-0">
            <DesignSelectorDropdown
              value={selected}
              onValueChange={(v) => {
                if (!isComponentId(v)) throw new Error(`Unknown component "${v}"`);
                setSelected(v);
              }}
              options={COMPONENT_LIST}
              size="md"
            />
          </div>
        </div>

        {/* Preview */}
        <div
          className="relative rounded-2xl border border-black/[0.08] dark:border-white/[0.09] bg-gradient-to-b from-black/[0.03] to-black/[0.05] dark:from-white/[0.02] dark:to-white/[0.04] min-h-[340px] p-4 sm:p-6 overflow-hidden"
          style={{
            backgroundImage:
              "radial-gradient(circle, hsl(var(--foreground) / 0.05) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
        >
          <div
            ref={blastPreviewRef}
            className="relative w-full min-h-[292px] rounded-xl border border-black/[0.08] dark:border-white/[0.1] bg-white/85 dark:bg-[hsl(240,12%,9%)] shadow-sm flex items-center justify-center p-6 sm:p-10"
          >
            {renderPreview()}
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-2">
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70">
            Props
          </span>
          <div className="rounded-xl border border-black/[0.08] dark:border-white/[0.09] bg-background/85 backdrop-blur-sm p-4 sm:p-5">
            {renderControls()}
          </div>
        </div>
      </div>
    </div>
  );
}
