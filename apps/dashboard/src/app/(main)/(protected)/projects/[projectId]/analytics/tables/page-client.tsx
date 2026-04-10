"use client";

import { Link } from "@/components/link";
import { Alert, Button, Typography } from "@/components/ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SimpleTooltip } from "@/components/ui/simple-tooltip";
import { cn } from "@/lib/utils";
import {
  ArrowClockwiseIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridColumnDef,
  type DataGridDataSource,
  type DataGridState,
} from "@stackframe/dashboard-ui-components";
import { useCallback, useMemo, useRef, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import {
  isJsonValue,
  JsonValue,
  parseClickHouseDate,
  RowData,
} from "../shared";

type TableId = "events";

type TableConfig = {
  displayName: string,
  baseQuery: string,
  defaultOrderBy: string,
  defaultOrderDir: "ASC" | "DESC",
};

// Available tables in the analytics database
const AVAILABLE_TABLES = new Map<TableId, TableConfig>([
  ["events", {
    displayName: "Events",
    baseQuery: "SELECT * FROM default.events",
    defaultOrderBy: "event_at",
    defaultOrderDir: "DESC",
  }],
]);

const PAGE_SIZE = 50;

// Date detection for dynamic columns — the grid now handles actual
// rendering for `type: "dateTime"` columns, but we still need a runtime
// check to decide which columns should be marked as dates.
function isDateColumnName(name: string): boolean {
  return name.endsWith("_at") || name === "date" || /(^|_)date($|_)/.test(name);
}

// Format a non-date cell value for display. Date values never reach this
// component because date columns get `type: "dateTime"` and the grid's
// built-in date renderer kicks in.
function CellValue({ value, truncate = true }: { value: unknown, truncate?: boolean }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/50">—</span>;
  }

  if (isJsonValue(value)) {
    return <JsonValue value={value} truncate={truncate} />;
  }

  const str = String(value);
  if (truncate && str.length > 100) {
    return (
      <SimpleTooltip tooltip={str}>
        <span className="cursor-help">{str.slice(0, 97)}...</span>
      </SimpleTooltip>
    );
  }

  return <span>{str}</span>;
}

// `parseValue` adapter — ClickHouse emits "YYYY-MM-DD HH:MM:SS.mmm"
// strings. Grid's default `new Date()` would interpret those as local
// time; `parseClickHouseDate` treats them correctly as UTC and returns
// `null` for invalid values so the grid falls back to "—".
function parseClickHouseDateOrNull(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = parseClickHouseDate(value);
  return isNaN(d.getTime()) ? null : d;
}

// Row detail dialog
function RowDetailDialog({
  row,
  columns,
  open,
  onOpenChange,
}: {
  row: RowData | null,
  columns: string[],
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  if (!row) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Row Details</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            {columns.map((column) => (
              <div key={column} className="space-y-1">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {column}
                </Label>
                <div className="font-mono text-sm bg-muted/30 rounded px-3 py-2 overflow-auto max-h-48">
                  {isJsonValue(row[column]) ? (
                    <pre className="whitespace-pre-wrap break-all">
                      {JSON.stringify(row[column], null, 2)}
                    </pre>
                  ) : (
                    <CellValue value={row[column]} truncate={false} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

// ─── Column width heuristic ──────────────────────────────────────────

/** Pick a sensible initial width for a column based on its name. */
function guessColumnWidth(colName: string): number {
  if (colName.includes("id") && colName !== "project_id") return 280;
  if (colName.includes("_at") || colName.includes("date")) return 170;
  if (colName === "data" || colName.includes("json")) return 320;
  if (colName === "event_type" || colName === "type") return 160;
  return 150;
}

function TableContent({ tableId }: { tableId: TableId }) {
  const adminApp = useAdminApp();
  const tableConfig = AVAILABLE_TABLES.get(tableId)!;

  const [discoveredColumns, setDiscoveredColumns] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<RowData | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  // Ref mirror of discoveredColumns so the async generator (memoised
  // against adminApp + tableConfig) can read the latest column list
  // without being re-created every time the schema updates. The
  // generator builds its WHERE clause from this ref.
  const discoveredColumnsRef = useRef<string[]>([]);

  // Grid state — initialize with the table's default sort so the very
  // first fetch already uses the right ORDER BY.
  const [gridState, setGridState] = useState<DataGridState>(() => {
    const base = createDefaultDataGridState([]);
    return {
      ...base,
      sorting: [{
        columnId: tableConfig.defaultOrderBy,
        direction: tableConfig.defaultOrderDir === "DESC" ? "desc" : "asc",
      }],
      pagination: { pageIndex: 0, pageSize: PAGE_SIZE },
    };
  });

  // DataGrid column defs built from the discovered column names.
  // Empty on first render — the grid renders blank until the first page
  // comes back, then re-renders with populated columns. This is fine
  // because the initial sort is by columnId string, not by column ref.
  // Columns are sortable server-side via the ORDER BY in the generator.
  //
  // Date columns are detected by name (`*_at`, `date`). They get
  // `type: "dateTime"` which enables the grid's built-in date cell
  // renderer, and a `parseValue` override so ClickHouse's space-
  // separated UTC strings parse correctly. The date format toggle
  // (relative / absolute) lives in the grid's Columns popover and is
  // wired up automatically once any date column exists.
  const columns = useMemo<DataGridColumnDef<RowData>[]>(
    () =>
      discoveredColumns.map((col): DataGridColumnDef<RowData> => {
        const isDate = isDateColumnName(col);
        if (isDate) {
          return {
            id: col,
            header: col,
            accessor: (row) => row[col],
            width: guessColumnWidth(col),
            minWidth: 80,
            sortable: true,
            type: "dateTime",
            parseValue: parseClickHouseDateOrNull,
          };
        }
        return {
          id: col,
          header: col,
          accessor: (row) => row[col],
          width: guessColumnWidth(col),
          minWidth: 80,
          sortable: true,
          type: "string",
          renderCell: ({ value }) => <CellValue value={value} />,
        };
      }),
    [discoveredColumns],
  );

  // Async data source — server-side sort + search + paginated fetch
  // via SQL. The generator also discovers the schema from the first
  // row of the first page (on every refetch, in case the schema
  // changes).
  const dataSource = useMemo<DataGridDataSource<RowData>>(() => {
    return async function* (params) {
      setError(null);
      try {
        // `sorting` is a tuple of zero or one item in practice — multi-sort
        // isn't wired up server-side. Handle the empty case explicitly so
        // we don't rely on `params.sorting[0]` being defined.
        let orderBy: string;
        let orderDir: "ASC" | "DESC";
        if (params.sorting.length > 0) {
          const first = params.sorting[0]!;
          orderBy = first.columnId;
          orderDir = first.direction === "asc" ? "ASC" : "DESC";
        } else {
          orderBy = tableConfig.defaultOrderBy;
          orderDir = tableConfig.defaultOrderDir;
        }
        const pageSize = params.pagination.pageSize;
        const offset = params.pagination.pageIndex * pageSize;

        // Build a WHERE clause from the quick-search text. We can only
        // do this once the schema has been discovered (i.e. after the
        // first unfiltered fetch), otherwise there are no columns to
        // search against. Cast every column to String and OR ILIKE
        // across all of them — generic enough for any events-style
        // table. Single quotes in the query are escaped to prevent
        // trivial injection via the search box; backslashes are
        // doubled first so the escape itself doesn't re-introduce
        // unescaped quotes.
        const search = params.quickSearch.trim();
        const searchableCols = discoveredColumnsRef.current;
        let whereClause = "";
        if (search && searchableCols.length > 0) {
          const escaped = search.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
          const clauses = searchableCols
            .map((c) => `toString(\`${c}\`) ILIKE '%${escaped}%'`)
            .join(" OR ");
          whereClause = ` WHERE ${clauses}`;
        }

        const query = `${tableConfig.baseQuery}${whereClause} ORDER BY ${orderBy} ${orderDir} LIMIT ${pageSize} OFFSET ${offset}`;

        const response = await adminApp.queryAnalytics({
          query,
          include_all_branches: false,
          timeout_ms: 30000,
        });

        const newRows = response.result as RowData[];

        // Refresh the column list only when the schema actually differs,
        // otherwise every page load would cause a spurious re-render.
        // Mirror to the ref so subsequent generator runs (including
        // the one fired by a search-box keystroke) can build a WHERE
        // clause without waiting for another re-render.
        if (newRows.length > 0) {
          const cols = Object.keys(newRows[0]!);
          discoveredColumnsRef.current = cols;
          setDiscoveredColumns((prev) => {
            if (prev.length === cols.length && prev.every((c, i) => c === cols[i])) {
              return prev;
            }
            return cols;
          });
        }

        yield {
          rows: newRows,
          hasMore: newRows.length === pageSize,
        };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to load table data";
        setError(message);
        yield { rows: [], hasMore: false };
      }
    };
  }, [adminApp, tableConfig]);

  // Stable row ID — prefer explicit ID fields, fall back to a JSON
  // fingerprint so infinite-scroll dedup in useDataSource still works
  // for tables without a dedicated ID column.
  const getRowId = useCallback((row: RowData): string => {
    if (row.id != null) return String(row.id);
    if (row.event_id != null) return String(row.event_id);
    return JSON.stringify(row);
  }, []);

  // The async data source handles server-side sort + search + infinite
  // scroll. `quickSearch` flows straight from grid state into the
  // generator via `params.quickSearch`, and the hook re-fires the
  // generator on change (same mechanism as sorting).
  const gridData = useDataSource<RowData>({
    dataSource,
    columns,
    getRowId,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  const handleRowClick = useCallback((row: RowData) => {
    setSelectedRow(row);
    setDetailDialogOpen(true);
  }, []);

  const showEmptyError =
    error != null && !gridData.isLoading && gridData.rows.length === 0;

  // Rendered inside the DataGrid's default toolbar, to the left of the
  // built-in columns / export actions. The date-format toggle now lives
  // inside the grid's Columns popover (auto-wired because the grid sees
  // `type: "dateTime"` columns), so this extras slot only has refresh +
  // row count now.
  const toolbarExtra = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={gridData.reload}
        className="h-7 px-2 text-xs"
      >
        <ArrowClockwiseIcon className="mr-1.5 h-3.5 w-3.5" />
        Refresh
      </Button>

      <span className="px-1 text-[11px] tabular-nums text-muted-foreground">
        {gridData.rows.length.toLocaleString()} rows
        {gridData.hasMore && "+"}
      </span>
    </div>
  );

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Non-fatal error banner — shown while data is still visible. */}
      {error != null && !showEmptyError && (
        <div className="shrink-0 px-4 pt-3">
          <Alert variant="destructive">{error}</Alert>
        </div>
      )}

      {/* Fatal error panel — no data to fall back to. */}
      {showEmptyError && (
        <div className="flex flex-1 flex-col items-start gap-4 p-4">
          <Alert variant="destructive">{error}</Alert>
          <Button variant="outline" onClick={gridData.reload}>
            <ArrowClockwiseIcon className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      )}

      {/* Data grid — fills remaining space via `flex-1 min-h-0`.
          Uses the DataGrid's default toolbar (column visibility, CSV
          export) and slots refresh + row count in via `toolbarExtra`.
          The date format toggle shows up automatically inside the
          Columns popover because at least one column is `dateTime`. */}
      {!showEmptyError && (
        <div className="flex-1 min-h-0 pr-8">
          <DataGrid<RowData>
            columns={columns}
            rows={gridData.rows}
            getRowId={getRowId}
            totalRowCount={gridData.totalRowCount}
            isLoading={gridData.isLoading}
            isRefetching={gridData.isRefetching}
            isLoadingMore={gridData.isLoadingMore}
            hasMore={gridData.hasMore}
            onLoadMore={gridData.loadMore}
            state={gridState}
            onChange={setGridState}
            paginationMode="infinite"
            selectionMode="none"
            toolbarExtra={toolbarExtra}
            footer={false}
            exportFilename={`${tableId}-export`}
            onRowClick={handleRowClick}
            emptyState={
              <div className="flex flex-col items-center justify-center gap-4 py-16">
                <Typography variant="secondary">No data available</Typography>
              </div>
            }
          />
        </div>
      )}

      <RowDetailDialog
        row={selectedRow}
        columns={discoveredColumns}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
      />
    </div>
  );
}

export default function PageClient() {
  const [selectedTable, setSelectedTable] = useState<TableId | null>("events");

  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout fillWidth noPadding>
        <div className="flex h-[calc(100vh-4.5rem)] max-h-[calc(100vh-4.5rem)] flex-1 min-h-0 overflow-hidden -mx-2 dark:h-full dark:max-h-full">
          {/* Left sidebar - table list (doesn't scroll, border extends full height) */}
          <div className="flex h-full w-48 flex-shrink-0 flex-col overflow-hidden border-r border-border/50 pl-2">
            <div className="flex-1 overflow-auto px-4 py-4">
              <Typography className="px-3 mb-3 text-xs font-semibold uppercase tracking-wide text-foreground/70">Tables</Typography>
              <div className="space-y-1">
                {[...AVAILABLE_TABLES.entries()].map(([id, config]) => (
                  <button
                    key={id}
                    onClick={() => setSelectedTable(id as TableId)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover:transition-none",
                      selectedTable === id
                        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {config.displayName}
                  </button>
                ))}
              </div>
            </div>
            <div className="py-4 px-4">
              <Link
                href="./queries"
                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors hover:transition-none w-full"
              >
                <SparkleIcon className="h-4 w-4" />
                Queries
              </Link>
            </div>
          </div>

          {/* Right content - table data (scrolls independently, extends to edge) */}
          <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
            {selectedTable ? (
              <TableContent key={selectedTable} tableId={selectedTable} />
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <Typography variant="secondary">Select a table to view its contents</Typography>
              </div>
            )}
          </div>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
