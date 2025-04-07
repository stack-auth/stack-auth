"use client";

import { Cross2Icon } from "@radix-ui/react-icons";
import { deepPlainEquals } from "@stackframe/stack-shared/dist/utils/objects";
import { Button } from "@stackframe/stack-ui";
import { Cell, ColumnFiltersState, SortingState, Table } from "@tanstack/react-table";
import { download, generateCsv, mkConfig } from 'export-to-csv';
import { DownloadIcon } from "lucide-react";
import { DataTableViewOptions } from "./view-options";

type DataTableToolbarProps<TData> = {
  table: Table<TData>,
  toolbarRender?: (table: Table<TData>) => React.ReactNode,
  showDefaultToolbar?: boolean,
  defaultColumnFilters: ColumnFiltersState,
  defaultSorting: SortingState,
}

export function DataTableToolbar<TData>({
  table,
  toolbarRender,
  showDefaultToolbar,
  defaultColumnFilters,
  defaultSorting,
}: DataTableToolbarProps<TData>) {
  const isFiltered = !deepPlainEquals(table.getState().columnFilters, defaultColumnFilters);
  const isSorted = !deepPlainEquals(table.getState().sorting, defaultSorting);

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 flex-wrap flex-1 stack-scope">
        {toolbarRender?.(table)}
        {(isFiltered || isSorted) && (
          <Button
            variant="ghost"
            onClick={() => {
              table.setColumnFilters(defaultColumnFilters);
              table.setSorting(defaultSorting);
            }}
            className="h-8 px-2 lg:px-3"
          >
            Reset filters
            <Cross2Icon className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
      {showDefaultToolbar && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <DataTableViewOptions table={table} />
            <Button
              variant="outline"
              size="sm"
              className="ml-auto hidden h-8 lg:flex"
              onClick={() => {
                const csvConfig = mkConfig({
                  fieldSeparator: ',',
                  filename: 'data',
                  decimalSeparator: '.',
                  useKeysAsHeaders: true,
                });

                const renderCellValue = (cell: Cell<TData, unknown>) => {
                  const rendered = cell.renderValue();
                  if (rendered === null) {
                    return undefined;
                  }
                  if (['string', 'number', 'boolean', 'undefined'].includes(typeof rendered)) {
                    return rendered;
                  }
                  if (rendered instanceof Date) {
                    return rendered.toISOString();
                  }
                  if (typeof rendered === 'object') {
                    return JSON.stringify(rendered);
                  }
                };


                const rowModel = table.getCoreRowModel();
                const rows = rowModel.rows.map(row => Object.fromEntries(row.getAllCells().map(c => [c.column.id, renderCellValue(c)]).filter(([_, v]) => v !== undefined)));
                if (rows.length === 0) {
                  alert("No data to export");
                  return;
                }
                const csv = generateCsv(csvConfig)(rows as any);
                download(csvConfig)(csv);
              }}
            >
              <DownloadIcon className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
