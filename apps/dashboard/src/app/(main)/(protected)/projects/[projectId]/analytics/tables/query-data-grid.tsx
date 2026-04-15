"use client";

import { Alert, Button, Typography } from "@/components/ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SimpleTooltip } from "@/components/ui/simple-tooltip";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import {
  createDefaultDataGridState,
  DataGrid,
  DataGridToolbar,
  useDataSource,
  type DataGridColumnDef,
  type DataGridDataSource,
  type DataGridState,
  type DataGridToolbarContext,
} from "@stackframe/dashboard-ui-components";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAdminApp } from "../../use-admin-app";
import {
  isJsonValue,
  JsonValue,
  parseClickHouseDate,
  type RowData,
} from "../shared";

// ─── Types ──────────────────────────────────────────────────────────

export type QueryDataGridMode = "paginated" | "one-shot";

/**
 * Extended toolbar context exposed by QueryDataGrid on top of the
 * underlying DataGrid toolbar context. Adds the async data source's
 * reload / loading / pagination hints so a custom toolbar (e.g. an AI
 * search bar + refresh button) can wire these up without duplicating
 * state management.
 */
export type QueryDataGridToolbarContext<TRow = RowData> =
  DataGridToolbarContext<TRow> & {
    reload: () => void,
    rowCount: number,
    hasMore: boolean,
    isLoading: boolean,
    isRefetching: boolean,
  };

export type QueryDataGridProps = {
  /**
   * The SQL query to execute.
   *
   * - In `paginated` mode this is treated as a **base** query. The grid
   *   wraps it with `WHERE` (from quick-search), `ORDER BY` (from sort),
   *   `LIMIT` and `OFFSET` for infinite scroll, so it must be a simple
   *   expression like `SELECT * FROM default.events` without its own
   *   pagination / sort clauses.
   * - In `one-shot` mode the query is executed as-is, wrapped only in a
   *   subquery for sort/filter by the grid. Supply a full, self-contained
   *   query (aggregates, joins, GROUP BYs, etc.) — the grid will not
   *   touch its LIMIT.
   */
  query: string,
  /** Execution mode. Defaults to `paginated`. */
  mode?: QueryDataGridMode,
  /** Page size for paginated mode. Defaults to 50. */
  pageSize?: number,
  /** Initial sort column. When omitted, no default sort is injected. */
  defaultOrderBy?: string,
  /** Initial sort direction. Defaults to `"desc"`. */
  defaultOrderDir?: "asc" | "desc",
  /**
   * Whether the built-in quick-search input should be wired up as a
   * client/server-side ILIKE filter. Defaults to `true` — when the
   * caller provides no custom toolbar, typing in the search box filters
   * rows across discovered columns. Set `false` (or hook up a custom
   * toolbar that doesn't write to `state.quickSearch`) to opt out.
   */
  enableQuickSearchFilter?: boolean,
  /**
   * Custom toolbar renderer. Replaces the default toolbar entirely.
   * Receives an extended context with `reload` / `rowCount` etc. on
   * top of the built-in DataGrid toolbar context. Use this only when
   * you need full control — in most cases prefer `searchBar` +
   * `toolbarExtra`, which keep the built-in columns / export actions.
   */
  toolbar?: (ctx: QueryDataGridToolbarContext<RowData>) => ReactNode,
  /**
   * Replaces the toolbar's built-in quick-search input with a custom
   * node (e.g. an AI-powered search bar). The rest of the default
   * toolbar — Columns, Export, density — stays intact. Can be a node
   * or a function receiving the extended context.
   */
  searchBar?:
    | ReactNode
    | ((ctx: QueryDataGridToolbarContext<RowData>) => ReactNode),
  /**
   * Extra content slotted into the default toolbar, to the LEFT of
   * the built-in columns / export actions. Can be a node or a function
   * receiving the extended context.
   */
  toolbarExtra?:
    | ReactNode
    | ((ctx: QueryDataGridToolbarContext<RowData>) => ReactNode),
  /** Whether the default row-click-to-inspect dialog is enabled. Defaults to `true`. */
  enableRowDetailDialog?: boolean,
  /** Custom row click handler. Overrides the default row detail dialog. */
  onRowClick?: (row: RowData) => void,
  /** Called whenever the error state changes (null when cleared). */
  onError?: (error: string | null) => void,
  /** Called when the discovered schema changes. */
  onSchemaChange?: (columns: string[]) => void,
  /** Filename stem for CSV export (without extension). */
  exportFilename?: string,
  /** Custom empty state. */
  emptyState?: ReactNode,
  /** Show the default footer. Defaults to `false`. */
  footer?: boolean,
};

export type QueryDataGridHandle = {
  reload: () => void,
  getDiscoveredColumns: () => string[],
};

const INTERNAL_ROW_ID_KEY = "__stack_row_id";

// ─── Utility helpers ────────────────────────────────────────────────

/** Detect whether a column name refers to a date/time value. */
function isDateColumnName(name: string): boolean {
  return name.endsWith("_at") || name === "date" || /(^|_)date($|_)/.test(name);
}

/** Pick a sensible initial width for a column based on its name. */
function guessColumnWidth(colName: string): number {
  if (colName.includes("id") && colName !== "project_id") return 280;
  if (colName.includes("_at") || colName.includes("date")) return 170;
  if (colName === "data" || colName.includes("json")) return 320;
  if (colName === "event_type" || colName === "type") return 160;
  return 150;
}

/**
 * ClickHouse emits `"YYYY-MM-DD HH:MM:SS.mmm"` strings. The grid's
 * default `new Date()` parser would interpret those as local time;
 * this wrapper returns `null` for anything invalid so the grid falls
 * back to `—`.
 */
function parseClickHouseDateOrNull(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = parseClickHouseDate(value);
  return isNaN(d.getTime()) ? null : d;
}

function CellValue({
  value,
  truncate = true,
}: {
  value: unknown,
  truncate?: boolean,
}) {
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

// ─── Query building ─────────────────────────────────────────────────

type BuildQueryArgs = {
  baseQuery: string,
  mode: QueryDataGridMode,
  orderBy: string | null,
  orderDir: "ASC" | "DESC",
  search: string,
  searchableColumns: readonly string[],
  pageSize: number,
  offset: number,
};

function escapeLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildWhereClause(search: string, columns: readonly string[]): string {
  if (!search || columns.length === 0) return "";
  const escaped = escapeLiteral(search);
  const clauses = columns
    .map((c) => `toString(\`${c}\`) ILIKE '%${escaped}%'`)
    .join(" OR ");
  return ` WHERE ${clauses}`;
}

function buildFinalQuery(args: BuildQueryArgs): string {
  const { baseQuery, mode, orderBy, orderDir, search, searchableColumns, pageSize, offset } = args;
  const where = buildWhereClause(search, searchableColumns);
  const orderClause = orderBy ? ` ORDER BY \`${orderBy}\` ${orderDir}` : "";
  if (mode === "paginated") {
    return `${baseQuery}${where}${orderClause} LIMIT ${pageSize} OFFSET ${offset}`;
  }
  // one-shot: wrap the (potentially complex) user query as a subquery
  // so we can still layer sort/filter on top without touching the
  // inner LIMIT. The outer LIMIT/OFFSET lets the grid paginate through
  // the AI query's result set via infinite scroll.
  return `SELECT * FROM (${baseQuery})${where}${orderClause} LIMIT ${pageSize} OFFSET ${offset}`;
}

// ─── Component ──────────────────────────────────────────────────────

/**
 * Reusable, modular DataGrid wrapper that runs a ClickHouse query and
 * streams results into a DataGrid. Handles schema discovery, paginated
 * vs one-shot execution, client/server-side sort/search, and row
 * inspection — callers only need to supply a query and (optionally)
 * override the toolbar or row click behaviour.
 *
 * @example
 * ```tsx
 * <QueryDataGrid
 *   query="SELECT * FROM default.events"
 *   mode="paginated"
 *   defaultOrderBy="event_at"
 * />
 * ```
 *
 * @example with a custom toolbar (e.g. an AI search bar)
 * ```tsx
 * <QueryDataGrid
 *   query={currentQuery}
 *   mode="one-shot"
 *   toolbar={(ctx) => <MyAiToolbar ctx={ctx} />}
 * />
 * ```
 */
export const QueryDataGrid = forwardRef<QueryDataGridHandle, QueryDataGridProps>(
  function QueryDataGrid(
    {
      query,
      mode = "paginated",
      pageSize = 50,
      defaultOrderBy,
      defaultOrderDir = "desc",
      enableQuickSearchFilter = true,
      toolbar,
      searchBar,
      toolbarExtra,
      enableRowDetailDialog = true,
      onRowClick,
      onError,
      onSchemaChange,
      exportFilename,
      emptyState,
      footer = false,
    },
    ref,
  ) {
    const adminApp = useAdminApp();

    const [discoveredColumns, setDiscoveredColumns] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [selectedRow, setSelectedRow] = useState<RowData | null>(null);
    const [detailDialogOpen, setDetailDialogOpen] = useState(false);

    // Ref mirror so the async generator (memoised against adminApp) can
    // read the latest column list without being re-created every time
    // the schema updates.
    const discoveredColumnsRef = useRef<string[]>([]);
    const queryRef = useRef(query);
    queryRef.current = query;
    const modeRef = useRef(mode);
    modeRef.current = mode;
    const enableSearchFilterRef = useRef(enableQuickSearchFilter);
    enableSearchFilterRef.current = enableQuickSearchFilter;
    const defaultOrderByRef = useRef(defaultOrderBy);
    defaultOrderByRef.current = defaultOrderBy;
    const defaultOrderDirRef = useRef(defaultOrderDir);
    defaultOrderDirRef.current = defaultOrderDir;

    const [gridState, setGridState] = useState<DataGridState>(() => {
      const base = createDefaultDataGridState([]);
      return {
        ...base,
        sorting: defaultOrderBy
          ? [
            {
              columnId: defaultOrderBy,
              direction: defaultOrderDir,
            },
          ]
          : [],
        pagination: { pageIndex: 0, pageSize },
      };
    });

    // Whenever the query changes we want fresh columns + a reset sort
    // so a leftover sort from a previous schema doesn't crash the
    // next query (nonexistent column in ORDER BY).
    useEffect(() => {
      setDiscoveredColumns([]);
      discoveredColumnsRef.current = [];
      setError(null);
      setGridState((prev) => ({
        ...prev,
        sorting: defaultOrderByRef.current
          ? [
            {
              columnId: defaultOrderByRef.current,
              direction: defaultOrderDirRef.current,
            },
          ]
          : [],
        pagination: { ...prev.pagination, pageIndex: 0 },
        quickSearch: "",
      }));
    }, [query]);

    useEffect(() => {
      onError?.(error);
    }, [error, onError]);

    useEffect(() => {
      onSchemaChange?.(discoveredColumns);
    }, [discoveredColumns, onSchemaChange]);

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

    const dataSource = useMemo<DataGridDataSource<RowData>>(() => {
      return async function* (params) {
        setError(null);
        try {
          let orderBy: string | null = null;
          let orderDir: "ASC" | "DESC" = "DESC";
          if (params.sorting.length > 0) {
            const first = params.sorting[0]!;
            orderBy = first.columnId;
            orderDir = first.direction === "asc" ? "ASC" : "DESC";
          } else if (defaultOrderByRef.current) {
            orderBy = defaultOrderByRef.current;
            orderDir = defaultOrderDirRef.current === "asc" ? "ASC" : "DESC";
          }

          const gridPageSize = params.pagination.pageSize;
          const offset = params.pagination.pageIndex * gridPageSize;

          const search = params.quickSearch.trim();
          const applyFilter = enableSearchFilterRef.current;

          const finalQuery = buildFinalQuery({
            baseQuery: queryRef.current,
            mode: modeRef.current,
            orderBy,
            orderDir,
            search: applyFilter ? search : "",
            searchableColumns: discoveredColumnsRef.current,
            pageSize: gridPageSize,
            offset,
          });

          const response = await adminApp.queryAnalytics({
            query: finalQuery,
            include_all_branches: false,
            timeout_ms: 30000,
          });

          const newRows = (response.result as RowData[]).map((row, index) => ({
            ...row,
            [INTERNAL_ROW_ID_KEY]: `${offset + index}`,
          }));

          if (newRows.length > 0) {
            const cols = Object.keys(newRows[0]!).filter((col) => col !== INTERNAL_ROW_ID_KEY);
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
            hasMore: newRows.length === gridPageSize,
          };
        } catch (e: unknown) {
          const message =
            e instanceof Error ? e.message : "Failed to load query results";
          setError(message);
          yield { rows: [], hasMore: false };
        }
      };
    }, [adminApp]);

    const getRowId = useCallback((row: RowData): string => {
      if (typeof row[INTERNAL_ROW_ID_KEY] === "string") return row[INTERNAL_ROW_ID_KEY];
      if (row.id != null) return String(row.id);
      if (row.event_id != null) return String(row.event_id);
      throw new Error("QueryDataGrid row is missing an internal row id");
    }, []);

    const gridData = useDataSource<RowData>({
      dataSource,
      columns,
      getRowId,
      sorting: gridState.sorting,
      quickSearch: gridState.quickSearch,
      pagination: gridState.pagination,
      paginationMode: "infinite",
    });

    useImperativeHandle(
      ref,
      () => ({
        reload: () => gridData.reload(),
        getDiscoveredColumns: () => discoveredColumnsRef.current,
      }),
      [gridData],
    );

    const handleRowClick = useCallback(
      (row: RowData) => {
        if (onRowClick) {
          onRowClick(row);
          return;
        }
        if (enableRowDetailDialog) {
          setSelectedRow(row);
          setDetailDialogOpen(true);
        }
      },
      [onRowClick, enableRowDetailDialog],
    );

    const showEmptyError =
      error != null && !gridData.isLoading && gridData.rows.length === 0;

    /**
     * Extend the built-in toolbar context with the async data source
     * state (reload, counts, loading flags) so callers can build rich
     * toolbars without re-deriving any of this.
     */
    const extendCtx = useCallback(
      (ctx: DataGridToolbarContext<RowData>): QueryDataGridToolbarContext<RowData> => ({
        ...ctx,
        reload: gridData.reload,
        rowCount: gridData.rows.length,
        hasMore: gridData.hasMore,
        isLoading: gridData.isLoading,
        isRefetching: gridData.isRefetching,
      }),
      [gridData.reload, gridData.rows.length, gridData.hasMore, gridData.isLoading, gridData.isRefetching],
    );

    /**
     * Resolves the toolbar prop passed to the underlying DataGrid.
     *
     * Priority:
     *  1. `toolbar` (full override)  — caller owns the whole row
     *  2. `searchBar` provided       — render our own DataGridToolbar
     *     wrapper that hides the built-in quick search and slots the
     *     caller's node where it used to live; keeps Columns/Export
     *     intact. `toolbarExtra` (if provided) is passed through as
     *     the built-in extras slot.
     *  3. neither                    — undefined, so the DataGrid
     *     falls back to its default toolbar behaviour (built-in
     *     quick search, extras, columns, export).
     */
    const renderCustomToolbar = useCallback(
      function renderCustomToolbar(ctx: DataGridToolbarContext<RowData>) {
        const extended = extendCtx(ctx);
        const leading =
          typeof searchBar === "function" ? searchBar(extended) : searchBar;
        const extras =
          toolbarExtra === undefined
            ? undefined
            : typeof toolbarExtra === "function"
              ? toolbarExtra(extended)
              : toolbarExtra;
        return (
          <DataGridToolbar
            ctx={ctx}
            extra={extras}
            extraLeading={leading}
            hideQuickSearch
          />
        );
      },
      [searchBar, toolbarExtra, extendCtx],
    );

    const renderForwardedToolbar = useCallback(
      function renderForwardedToolbar(ctx: DataGridToolbarContext<RowData>) {
        if (!toolbar) return null;
        return toolbar(extendCtx(ctx));
      },
      [toolbar, extendCtx],
    );

    const resolvedToolbar = toolbar
      ? renderForwardedToolbar
      : searchBar !== undefined
        ? renderCustomToolbar
        : undefined;

    const resolvedToolbarExtra = useMemo(() => {
      // When we've already built a custom toolbar above for the
      // `searchBar` case, the `toolbarExtra` prop is consumed inside
      // that custom toolbar — don't also pass it to DataGrid.
      if (toolbar || searchBar !== undefined) return undefined;
      if (toolbarExtra === undefined) return undefined;
      if (typeof toolbarExtra !== "function") return toolbarExtra;
      return (ctx: DataGridToolbarContext<RowData>) => toolbarExtra(extendCtx(ctx));
    }, [toolbar, searchBar, toolbarExtra, extendCtx]);

    return (
      <div className="flex flex-1 min-h-0 flex-col">
        {error != null && !showEmptyError && (
          <div className="shrink-0 px-4 pt-3">
            <Alert variant="destructive">{error}</Alert>
          </div>
        )}

        {showEmptyError && (
          <div className="flex flex-1 flex-col items-start gap-4 p-4">
            <Alert variant="destructive">{error}</Alert>
            <Button variant="outline" onClick={gridData.reload}>
              <ArrowClockwiseIcon className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        )}

        {!showEmptyError && (
          <div className="flex-1 min-h-0 pr-0 lg:pr-8">
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
              stickyTop={0}
              toolbar={resolvedToolbar}
              toolbarExtra={resolvedToolbarExtra}
              footer={footer ? undefined : false}
              exportFilename={exportFilename}
              onRowClick={handleRowClick}
              emptyState={
                emptyState ?? (
                  <div className="flex flex-col items-center justify-center gap-4 py-16">
                    <Typography variant="secondary">No data available</Typography>
                  </div>
                )
              }
            />
          </div>
        )}

        {enableRowDetailDialog && (
          <RowDetailDialog
            row={selectedRow}
            columns={discoveredColumns}
            open={detailDialogOpen}
            onOpenChange={setDetailDialogOpen}
          />
        )}
      </div>
    );
  },
);
