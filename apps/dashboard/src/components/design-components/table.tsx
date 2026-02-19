"use client";

import { DataTable } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ColumnDef, ColumnFiltersState, SortingState, Table as TableType } from "@tanstack/react-table";
import React from "react";
import { DesignCard, useGlassmorphicDefault, useInsideDesignCard } from "./card";

const borderReset = "[&_div.rounded-md.border]:border-0 [&_div.rounded-md.border]:shadow-none";

export type DesignDataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[],
  data: TData[],
  defaultColumnFilters?: ColumnFiltersState,
  defaultSorting?: SortingState,
  toolbarRender?: (table: TableType<TData>) => React.ReactNode,
  showDefaultToolbar?: boolean,
  showResetFilters?: boolean,
  onRowClick?: (row: TData) => void,
  glassmorphic?: boolean,
  className?: string,
};

export function DesignDataTable<TData, TValue>({
  columns,
  data,
  defaultColumnFilters = [],
  defaultSorting = [],
  toolbarRender,
  showDefaultToolbar = false,
  showResetFilters = false,
  onRowClick,
  glassmorphic: glassmorphicProp,
  className,
}: DesignDataTableProps<TData, TValue>) {
  const glassmorphic = useGlassmorphicDefault(glassmorphicProp);
  const insideDesignCard = useInsideDesignCard();
  const [table, setTable] = React.useState<TableType<TData> | null>(null);
  const handleTableReady = React.useCallback((t: TableType<TData>) => {
    setTable(prev => prev === t ? prev : t);
  }, []);

  const needsOwnCard = glassmorphic && !insideDesignCard;
  const hasToolbarOutside = needsOwnCard && !!toolbarRender;

  const dataTable = (
    <DataTable
      data={data}
      columns={columns}
      defaultColumnFilters={defaultColumnFilters}
      defaultSorting={defaultSorting}
      toolbarRender={hasToolbarOutside ? undefined : toolbarRender}
      showDefaultToolbar={showDefaultToolbar}
      showResetFilters={showResetFilters}
      onTableReady={hasToolbarOutside ? handleTableReady : undefined}
      onRowClick={onRowClick}
    />
  );

  if (!needsOwnCard) {
    return (
      <div className={cn(borderReset, className)}>
        {dataTable}
      </div>
    );
  }

  return (
    <div className={cn(hasToolbarOutside && "space-y-4", className)}>
      {hasToolbarOutside && table && toolbarRender(table)}
      <DesignCard glassmorphic contentClassName={cn("pt-2", borderReset)}>
        {dataTable}
      </DesignCard>
    </div>
  );
}
