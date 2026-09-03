"use client";

import { cn } from "./cn";
import { Tooltip } from "./surfaces";

/** Shared class strings for the dense data tables (header row, body row, selected row). */
export const tableClasses = {
  headRow: "border-b border-border text-[10px] font-semibold uppercase tracking-[0.09em] text-faint",
  bodyRow: cn(
    "border-b border-border",
    "cursor-pointer transition-colors hover:transition-none hover:bg-panel",
  ),
  selectedRow: "bg-panel-raised",
  cell: "py-[7px] pr-3 text-[12px] text-foreground",
  mutedCell: "py-[7px] pr-3 text-[12px] text-muted-foreground",
} as const;

/** Sortable `<th>`: click to toggle direction, optional hover explainer for the metric. */
export function SortHeader({
  children,
  align = "left",
  active,
  dir,
  onClick,
  tooltip,
}: {
  children: React.ReactNode,
  align?: "left" | "right",
  active: boolean,
  dir: "asc" | "desc",
  onClick: () => void,
  tooltip?: string,
}) {
  return (
    <th className={cn("group relative py-2 pr-3", align === "left" ? "text-left" : "text-right")}>
      <button
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:transition-none hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span>{children}</span>
        <span className="text-[8px]">{active ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
      {tooltip != null && <Tooltip align={align === "right" ? "right" : "left"} className="w-64">{tooltip}</Tooltip>}
    </th>
  );
}
