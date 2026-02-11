"use client";

import { DataTable } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ColumnDef, ColumnFiltersState, SortingState } from "@tanstack/react-table";

export type DesignDataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[],
  data: TData[],
  defaultColumnFilters?: ColumnFiltersState,
  defaultSorting?: SortingState,
  showDefaultToolbar?: boolean,
  showResetFilters?: boolean,
  onRowClick?: (row: TData) => void,
  className?: string,
};

export function DesignDataTable<TData, TValue>({
  columns,
  data,
  defaultColumnFilters = [],
  defaultSorting = [],
  showDefaultToolbar = false,
  showResetFilters = false,
  onRowClick,
  className,
}: DesignDataTableProps<TData, TValue>) {
  return (
    <div
      className={cn(
        "[&_div.rounded-md.border]:border-0 [&_div.rounded-md.border]:shadow-none",
        className
      )}
    >
      <DataTable
        data={data}
        columns={columns}
        defaultColumnFilters={defaultColumnFilters}
        defaultSorting={defaultSorting}
        showDefaultToolbar={showDefaultToolbar}
        showResetFilters={showResetFilters}
        onRowClick={onRowClick}
      />
    </div>
  );
}
