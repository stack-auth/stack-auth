"use client";

import { createDefaultDataGridState, DataGrid, type DataGridColumnDef } from "@stackframe/dashboard-ui-components";
import { useState, type ReactNode } from "react";

type UserPageTableSectionProps<TRow> = {
  title: string,
  actions?: ReactNode,
  columns: readonly DataGridColumnDef<TRow>[],
  rows: readonly TRow[],
  getRowId: (row: TRow) => string,
  emptyLabel: string,
};

export function UserPageTableSection<TRow,>({
  title,
  actions,
  columns,
  rows,
  getRowId,
  emptyLabel,
}: UserPageTableSectionProps<TRow>) {
  const [gridState, setGridState] = useState(() => createDefaultDataGridState(columns));

  const visibleColumns = columns.filter((column) => gridState.columnVisibility[column.id] !== false);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {actions}
      </div>
      {rows.length === 0 ? (
        <div
          className="w-full min-w-0 overflow-hidden rounded-[calc(var(--radius)*2)] bg-transparent"
          role="grid"
          aria-rowcount={0}
          aria-colcount={visibleColumns.length}
        >
          <div className="flex border-b border-foreground/[0.06]" role="row">
            {visibleColumns.map((column) => (
              <div
                key={column.id}
                className="flex h-11 items-center border-r border-foreground/[0.04] px-3 last:border-r-0"
                style={{
                  width: column.width,
                  minWidth: column.minWidth,
                  maxWidth: column.maxWidth,
                  flex: column.flex,
                  justifyContent: column.align === "right" ? "flex-end" : column.align === "center" ? "center" : "flex-start",
                }}
                role="columnheader"
              >
                <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {typeof column.header === "string" ? column.header : column.id}
                </span>
              </div>
            ))}
          </div>
          <div className="flex min-h-16 items-center justify-center py-4 text-sm font-medium text-muted-foreground">
            {emptyLabel}
          </div>
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={rows}
          getRowId={getRowId}
          state={gridState}
          onChange={setGridState}
          toolbar={false}
          footer={false}
          fillHeight={false}
          rowHeight="auto"
          estimatedRowHeight={44}
          emptyState={
            <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-8">
              <div className="text-sm font-medium text-muted-foreground">{emptyLabel}</div>
            </div>
          }
        />
      )}
    </section>
  );
}
