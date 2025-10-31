"use client";

import type { ReactNode } from "react";
import {
  DEFAULT_ROW_HEIGHT_PX,
  combineClassNames,
  getColumnStyles,
  getRowHeightStyle,
  type ColumnLayout,
} from "./manual-table";

type ManualTableSkeletonProps<TColumnKey extends string> = {
  columnOrder: readonly TColumnKey[],
  columnLayout: Partial<ColumnLayout<TColumnKey>>,
  headerLabels: Partial<Record<TColumnKey, ReactNode | null>>,
  rowCount: number,
  renderCellSkeleton: (columnKey: TColumnKey, rowIndex: number) => ReactNode,
  rowHeightPx?: number,
};

export function ManualTableSkeleton<TColumnKey extends string>(props: ManualTableSkeletonProps<TColumnKey>) {
  const { columnOrder, columnLayout, headerLabels, rowCount, renderCellSkeleton, rowHeightPx } = props;
  const rows = Array.from({ length: rowCount });
  const rowStyle = getRowHeightStyle(rowHeightPx ?? DEFAULT_ROW_HEIGHT_PX);

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/80 text-xs font-semibold tracking-wide text-muted-foreground backdrop-blur">
            <tr className="border-b border-border/70">
              {columnOrder.map((columnKey) => {
                const layout = columnLayout[columnKey];
                return (
                  <th
                    key={columnKey}
                    className={combineClassNames("px-4 py-3", layout?.headerClassName)}
                    style={getColumnStyles(layout)}
                  >
                    {headerLabels[columnKey] ?? null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((_, rowIndex) => (
              <tr key={rowIndex} className="border-b border-border/60" style={rowStyle}>
                {columnOrder.map((columnKey) => {
                  const layout = columnLayout[columnKey];
                  return (
                    <td
                      key={columnKey}
                      className={combineClassNames("px-4 py-2", layout?.cellClassName)}
                      style={getColumnStyles(layout)}
                    >
                      {renderCellSkeleton(columnKey, rowIndex)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

