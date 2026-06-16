import {
  ColumnDef,
  ColumnFiltersState,
  GlobalFiltering,
  OnChangeFn,
  PaginationState,
  SortingState,
  Table as TableType,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import React from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../table";
import { DataTablePagination } from "./pagination";
import { DataTableToolbar } from "./toolbar";

export function TableView<TData, TValue>(props: {
  table: TableType<TData>,
  columns: ColumnDef<TData, TValue>[],
  toolbarRender?: (table: TableType<TData>) => React.ReactNode,
  showDefaultToolbar?: boolean,
  defaultColumnFilters: ColumnFiltersState,
  defaultSorting: SortingState,
  onRowClick?: (row: TData) => void,
}) {
  return (
    <div className="space-y-4">
      <DataTableToolbar
        table={props.table}
        toolbarRender={props.toolbarRender}
        showDefaultToolbar={props.showDefaultToolbar}
        defaultColumnFilters={props.defaultColumnFilters}
        defaultSorting={props.defaultSorting}
      />
      <div className="rounded-xl border border-black/[0.07] dark:border-white/[0.08] bg-white/40 dark:bg-zinc-950/25 shadow-none overflow-hidden">
        <Table>
          <TableHeader>
            {props.table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} >
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {props.table.getRowModel().rows.length ? (
              props.table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  onClick={(ev) => {
                    // only trigger onRowClick if the element is a direct descendant; don't trigger for portals
                    if (ev.target instanceof Node && ev.currentTarget.contains(ev.target)) {
                      props.onRowClick?.(row.original);
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={props.columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={props.table} />
    </div>
  );
}

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[],
  data: TData[],
  toolbarRender?: (table: TableType<TData>) => React.ReactNode,
  defaultVisibility?: VisibilityState,
  defaultColumnFilters: ColumnFiltersState,
  defaultSorting: SortingState,
  showDefaultToolbar?: boolean,
  onRowClick?: (row: TData) => void,
}

export function DataTable<TData, TValue>({
  columns,
  data,
  toolbarRender,
  defaultVisibility,
  defaultColumnFilters,
  defaultSorting,
  showDefaultToolbar = true,
  onRowClick,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>(defaultSorting);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(defaultColumnFilters);
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [globalFilter, setGlobalFilter] = React.useState<any>();

  return <DataTableBase
    columns={columns}
    data={data}
    toolbarRender={toolbarRender}
    defaultVisibility={defaultVisibility}
    sorting={sorting}
    setSorting={setSorting}
    defaultSorting={defaultSorting}
    columnFilters={columnFilters}
    setColumnFilters={setColumnFilters}
    defaultColumnFilters={defaultColumnFilters}
    manualPagination={false}
    manualFiltering={false}
    pagination={pagination}
    setPagination={setPagination}
    globalFilter={globalFilter}
    setGlobalFilter={setGlobalFilter}
    showDefaultToolbar={showDefaultToolbar}
    onRowClick={onRowClick}
  />;
}

type DataTableBaseProps<TData, TValue> = DataTableProps<TData, TValue> & {
  sorting?: SortingState,
  setSorting?: OnChangeFn<SortingState>,
  pagination?: PaginationState,
  setPagination?: OnChangeFn<PaginationState>,
  rowCount?: number,
  columnFilters?: ColumnFiltersState,
  setColumnFilters?: OnChangeFn<ColumnFiltersState>,
  manualPagination?: boolean,
  manualFiltering?: boolean,
  globalFilter?: any,
  setGlobalFilter?: OnChangeFn<any>,
}

function DataTableBase<TData, TValue>({
  columns,
  data,
  toolbarRender,
  defaultVisibility,
  sorting,
  setSorting,
  defaultColumnFilters,
  defaultSorting,
  pagination,
  setPagination,
  rowCount,
  columnFilters,
  setColumnFilters,
  globalFilter,
  setGlobalFilter,
  manualPagination = true,
  manualFiltering = true,
  showDefaultToolbar = true,
  onRowClick,
}: DataTableBaseProps<TData, TValue>) {
  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(defaultVisibility || {});

  const table: TableType<TData> = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
      globalFilter: globalFilter,
    },
    enableRowSelection: true,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getColumnCanGlobalFilter: (c) => c.columnDef.enableGlobalFilter ?? GlobalFiltering.getDefaultOptions!(table).getColumnCanGlobalFilter!(c),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    autoResetAll: false,
    manualPagination,
    manualFiltering,
    rowCount,
  });

  return <TableView
    table={table}
    columns={columns}
    toolbarRender={toolbarRender}
    showDefaultToolbar={showDefaultToolbar}
    defaultColumnFilters={defaultColumnFilters}
    defaultSorting={defaultSorting}
    onRowClick={onRowClick}
  />;
}
