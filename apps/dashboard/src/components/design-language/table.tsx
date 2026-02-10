"use client";

import { DataTable, DataTableViewOptions } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ColumnDef, ColumnFiltersState, SortingState, Table as TableType } from "@tanstack/react-table";
import { useState } from "react";
import { DesignCard } from "./card";

export type DesignDataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[],
  data: TData[],
  title?: string,
  subtitle?: string,
  icon?: React.ElementType,
  defaultColumnFilters?: ColumnFiltersState,
  defaultSorting?: SortingState,
  showDefaultToolbar?: boolean,
  showResetFilters?: boolean,
  viewOptions?: boolean,
  onRowClick?: (row: TData) => void,
  className?: string,
  contentClassName?: string,
};

export function DesignDataTable<TData, TValue>({
  columns,
  data,
  title,
  subtitle,
  icon: Icon,
  defaultColumnFilters = [],
  defaultSorting = [],
  showDefaultToolbar = false,
  showResetFilters = false,
  viewOptions = false,
  onRowClick,
  className,
  contentClassName,
}: DesignDataTableProps<TData, TValue>) {
  const [tableInstance, setTableInstance] = useState<TableType<TData> | null>(null);

  return (
    <DesignCard
      variant="bodyOnly"
      gradient="default"
      className={cn("overflow-hidden p-0", className)}
      contentClassName="p-0"
    >
      {(title || subtitle || Icon || viewOptions) && (
        <div className="p-5">
          <div className="flex w-full items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {(title || Icon) && (
                <div className="flex items-center gap-2">
                  {Icon && (
                    <div className="p-1.5 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.04]">
                      <Icon className="h-3.5 w-3.5 text-foreground/70 dark:text-muted-foreground" />
                    </div>
                  )}
                  {title && (
                    <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      {title}
                    </span>
                  )}
                </div>
              )}
              {subtitle && (
                <p className="text-sm text-muted-foreground mt-1">
                  {subtitle}
                </p>
              )}
            </div>
            {viewOptions && tableInstance && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <DataTableViewOptions table={tableInstance} />
              </div>
            )}
          </div>
        </div>
      )}
      <div
        className={cn(
          "border-t border-black/[0.12] dark:border-white/[0.06] px-5 pb-5 [&_div.rounded-md.border]:border-0 [&_div.rounded-md.border]:shadow-none",
          contentClassName
        )}
      >
        <DataTable
          data={data}
          columns={columns}
          onTableReady={setTableInstance}
          defaultColumnFilters={defaultColumnFilters}
          defaultSorting={defaultSorting}
          showDefaultToolbar={showDefaultToolbar}
          showResetFilters={showResetFilters}
          onRowClick={onRowClick}
        />
      </div>
    </DesignCard>
  );
}
