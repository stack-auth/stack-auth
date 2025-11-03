"use client";

import { flexRender, type Table } from "@tanstack/react-table";
import type { CSSProperties } from "react";

export type ColumnLayoutEntry = {
  size: number,
  minWidth: number,
  maxWidth: number,
  width: string,
  headerClassName?: string,
  cellClassName?: string,
};

export type ColumnLayout<TColumnKey extends string> = Record<TColumnKey, ColumnLayoutEntry>;

export type ColumnMeta<TColumnKey extends string> = {
  columnKey: TColumnKey,
};

export const DEFAULT_ROW_HEIGHT_PX = 50;

export function getRowHeightStyle(heightPx: number = DEFAULT_ROW_HEIGHT_PX) {
  return { height: heightPx } satisfies CSSProperties;
}

export function combineClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

export function getColumnStyles(layout?: ColumnLayoutEntry) {
  if (!layout) {
    return undefined;
  }
  return {
    width: layout.width,
    minWidth: layout.minWidth,
    maxWidth: layout.maxWidth,
  } satisfies CSSProperties;
}

type TableContentProps<TData, TColumnKey extends string> = {
  table: Table<TData>,
  columnLayout: Partial<ColumnLayout<TColumnKey>>,
  renderEmptyState: () => React.ReactNode,
  rowHeightPx?: number,
};

export function TableContent<TData, TColumnKey extends string>(props: TableContentProps<TData, TColumnKey>) {
  const {
    table,
    columnLayout,
    renderEmptyState,
    rowHeightPx,
  } = props;

  const resolveColumnKey = ((meta: unknown) => (meta as ColumnMeta<TColumnKey> | undefined)?.columnKey);
  const rowHeightStyle = getRowHeightStyle(rowHeightPx ?? DEFAULT_ROW_HEIGHT_PX);

  return (
    <div className="overflow-x-auto">
      <table className={"w-full border-collapse text-left text-sm text-foreground"}>
        <thead className="sticky top-0 z-10 bg-muted/80 text-xs font-semibold tracking-wide text-muted-foreground backdrop-blur">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-border/70">
              {headerGroup.headers.map((header) => {
                const columnKey = resolveColumnKey(header.column.columnDef.meta);
                const layout = columnKey ? columnLayout[columnKey] : undefined;
                return (
                  <th
                    key={header.id}
                    className={combineClassNames("px-4 py-3 font-medium", layout?.headerClassName)}
                    style={getColumnStyles(layout)}
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length > 0 ? (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-border/60 transition hover:bg-muted/60"
                style={rowHeightStyle}
              >
                {row.getVisibleCells().map((cell) => {
                  const columnKey = resolveColumnKey(cell.column.columnDef.meta);
                  const layout = columnKey ? columnLayout[columnKey] : undefined;
                  return (
                    <td
                      key={cell.id}
                      className={combineClassNames("px-4 py-2 align-middle", layout?.cellClassName)}
                      style={getColumnStyles(layout)}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={table.getAllColumns().length}
                className="px-6 py-12 text-center text-sm text-muted-foreground"
              >
                {renderEmptyState()}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
