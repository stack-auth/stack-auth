"use client";

import { Button, Skeleton, Typography } from "@/components/ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleTooltip } from "@/components/ui/simple-tooltip";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useFromNow } from "@/hooks/use-from-now";
import { useUpdateConfig } from "@/lib/config-update";
import { cn } from "@/lib/utils";
import {
  ArrowClockwiseIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClockIcon,
  FilePlusIcon,
  FloppyDiskIcon,
  FolderIcon,
  FolderOpenIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  PlusIcon,
  SpinnerGapIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { QueryBuilder, type QueryTable, TABLE_CONFIGS, parseSql } from "../query-builder";
import {
  ErrorDisplay,
  FolderWithId,
  isDateValue,
  isJsonValue,
  JsonValue,
  parseClickHouseDate,
  RowData,
  RowDetailDialog,
  VirtualizedFlatTable,
} from "../shared";

// ============================================================================
// Constants & Types
// ============================================================================

const DateDisplayContext = createContext<{ relative: boolean }>({ relative: true });

type TableId = "events" | "spans";

const AVAILABLE_TABLES = new Map<TableId, { displayName: string; baseQuery: string; defaultOrderBy: string; defaultOrderDir: "ASC" | "DESC" }>([
  ["events", {
    displayName: "Events",
    baseQuery: "SELECT * FROM default.events",
    defaultOrderBy: "event_at",
    defaultOrderDir: "DESC",
  }],
  ["spans", {
    displayName: "Spans",
    baseQuery: "SELECT * FROM default.spans",
    defaultOrderBy: "started_at",
    defaultOrderDir: "DESC",
  }],
]);
type SortDir = "ASC" | "DESC";
const PAGE_SIZE = 50;

type ViewState =
  | { type: "table"; tableId: TableId }
  | { type: "newQuery" }
  | { type: "savedQuery"; folderId: string; queryId: string; sqlQuery: string };

// ============================================================================
// Query Helpers
// ============================================================================

function parseLimitFromQuery(query: string): number | null {
  const match = query.match(/\bLIMIT\s+(\d+)\b/i);
  return match ? parseInt(match[1], 10) : null;
}

function addOffsetToQuery(query: string, offset: number): string {
  if (/\bOFFSET\s+\d+\b/i.test(query)) {
    return query.replace(/\bOFFSET\s+\d+\b/i, `OFFSET ${offset}`);
  }
  return query.replace(/\bLIMIT\s+(\d+)\b/i, `LIMIT $1 OFFSET ${offset}`);
}

// ============================================================================
// Shared Query Execution Hook
// ============================================================================

const LIVE_POLL_MS = 3_000;

function useQueryRunner(adminApp: ReturnType<typeof useAdminApp>) {
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<RowData[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [hasQueried, setHasQueried] = useState(false);
  const [lastQueryRan, setLastQueryRan] = useState("");
  const [liveMode, setLiveMode] = useState(false);
  const runQueryRef = useRef<(query: string, append?: boolean) => Promise<void>>();

  const runQuery = useCallback(
    async (query: string, append = false) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setHasQueried(true);
      }
      setError(null);

      try {
        const response = await adminApp.queryAnalytics({
          query: trimmed,
          include_all_branches: false,
          timeout_ms: 30000,
        });

        const newRows = response.result as RowData[];
        const newColumns = newRows.length > 0 ? Object.keys(newRows[0]) : [];

        if (append) {
          setRows((prev) => [...prev, ...newRows]);
        } else {
          setColumns(newColumns);
          setRows(newRows);
          setLastQueryRan(trimmed);
        }

        const limit = parseLimitFromQuery(trimmed);
        setHasMore(limit !== null && newRows.length >= limit);
      } catch (e: unknown) {
        setError(e);
        if (!append) {
          setColumns([]);
          setRows([]);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [adminApp]
  );

  runQueryRef.current = runQuery;

  const handleLoadMore = useCallback(() => {
    if (loadingMore || !hasMore || !lastQueryRan || liveMode) return;
    const query = addOffsetToQuery(lastQueryRan, rows.length);
    runAsynchronouslyWithAlert(() => runQuery(query, true));
  }, [loadingMore, hasMore, lastQueryRan, liveMode, rows.length, runQuery]);

  // Live mode polling
  useEffect(() => {
    if (!liveMode || !lastQueryRan) return;
    const interval = setInterval(() => {
      runAsynchronouslyWithAlert(() => runQueryRef.current?.(lastQueryRan) ?? Promise.resolve());
    }, LIVE_POLL_MS);
    return () => clearInterval(interval);
  }, [liveMode, lastQueryRan]);

  const toggleLiveMode = useCallback(() => {
    setLiveMode((prev) => !prev);
  }, []);

  return {
    columns,
    rows,
    error,
    loading,
    loadingMore,
    hasMore,
    hasQueried,
    lastQueryRan,
    liveMode,
    toggleLiveMode,
    runQuery,
    runQueryRef,
    handleLoadMore,
  };
}

function LiveToggle({
  liveMode,
  onToggle,
  lastQueryRan,
  onRunQuery,
}: {
  liveMode: boolean;
  onToggle: () => void;
  lastQueryRan: string;
  onRunQuery?: () => void;
}) {
  return (
    <button
      onClick={() => {
        if (!liveMode && !lastQueryRan && onRunQuery) {
          onRunQuery();
        }
        onToggle();
      }}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors duration-150 hover:transition-none",
        liveMode
          ? "bg-green-500/15 text-green-600 dark:text-green-400 ring-1 ring-green-500/30"
          : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08]"
      )}
    >
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          liveMode ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"
        )}
      />
      Live
    </button>
  );
}

// ============================================================================
// Table-specific Components (date toggle, sortable columns)
// ============================================================================

function DateValue({ value }: { value: string }) {
  const { relative } = useContext(DateDisplayContext);
  const date = parseClickHouseDate(value);
  const fromNow = useFromNow(date);

  if (relative) {
    return (
      <SimpleTooltip tooltip={date.toLocaleString()}>
        <span className="cursor-help">{fromNow}</span>
      </SimpleTooltip>
    );
  }

  return <span>{date.toLocaleString()}</span>;
}

function TableCellValue({ value, truncate = true }: { value: unknown; truncate?: boolean }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  if (isDateValue(value)) {
    return <DateValue value={value} />;
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

function TableRowDetailDialog({
  row,
  columns,
  open,
  onOpenChange,
}: {
  row: RowData | null;
  columns: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
                    <TableCellValue value={row[column]} truncate={false} />
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

function ColumnHeader({
  column,
  sortColumn,
  sortDir,
  onSort,
}: {
  column: string;
  sortColumn: string | null;
  sortDir: SortDir;
  onSort: (column: string) => void;
}) {
  const isSorted = sortColumn === column;
  return (
    <button
      onClick={() => onSort(column)}
      className={cn(
        "flex items-center gap-1 text-left font-mono text-xs font-medium",
        "text-muted-foreground hover:text-foreground transition-colors hover:transition-none",
        isSorted && "text-foreground"
      )}
    >
      <span>{column}</span>
      {isSorted &&
        (sortDir === "ASC" ? (
          <ArrowUpIcon className="h-3 w-3" />
        ) : (
          <ArrowDownIcon className="h-3 w-3" />
        ))}
    </button>
  );
}

function SortableDataTable({
  columns,
  rows,
  onRowClick,
  onLoadMore,
  hasMore,
  loadingMore,
  sortColumn,
  sortDir,
  onSort,
  refreshing = false,
}: {
  columns: string[];
  rows: RowData[];
  onRowClick: (row: RowData) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  sortColumn: string | null;
  sortDir: SortDir;
  onSort: (column: string) => void;
  refreshing?: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length + (hasMore ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastItemIndex =
    virtualItems.length > 0 ? virtualItems[virtualItems.length - 1]?.index ?? -1 : -1;

  useEffect(() => {
    if (lastItemIndex >= rows.length - 10 && hasMore && !loadingMore) {
      onLoadMore();
    }
  }, [lastItemIndex, rows.length, hasMore, loadingMore, onLoadMore]);

  const columnWidths = useMemo(() => {
    const widths = new Map<string, string>();
    columns.forEach((col) => {
      if (col.includes("id") && col !== "project_id") {
        widths.set(col, "minmax(280px, 1fr)");
      } else if (col.includes("_at") || col.includes("date")) {
        widths.set(col, "minmax(120px, 150px)");
      } else if (col === "data" || col.includes("json")) {
        widths.set(col, "minmax(200px, 2fr)");
      } else if (col === "event_type" || col === "type") {
        widths.set(col, "minmax(120px, 180px)");
      } else {
        widths.set(col, "minmax(100px, 1fr)");
      }
    });
    return widths;
  }, [columns]);

  const gridTemplateColumns = columns.map((col) => columnWidths.get(col) ?? "1fr").join(" ");
  const minContentWidth = columns.length * 150;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden relative">
      {refreshing && (
        <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] z-20 flex items-center justify-center">
          <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-background/90 border border-border/50 shadow-lg">
            <div className="h-4 w-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Refreshing...</span>
          </div>
        </div>
      )}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div style={{ minWidth: `${minContentWidth}px` }}>
          <div
            className="grid gap-4 pl-4 pr-16 py-2 border-b border-border/50 bg-muted/40 backdrop-blur-sm sticky top-0 z-10"
            style={{ gridTemplateColumns }}
          >
            {columns.map((column) => (
              <ColumnHeader
                key={column}
                column={column}
                sortColumn={sortColumn}
                sortDir={sortDir}
                onSort={onSort}
              />
            ))}
          </div>
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              if (virtualRow.index >= rows.length) {
                return (
                  <div
                    key="loader"
                    className="absolute left-0 right-0 flex items-center justify-center py-4"
                    style={{ top: `${virtualRow.start}px`, height: `${virtualRow.size}px` }}
                  >
                    {loadingMore ? (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <div className="h-4 w-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                        Loading more...
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">Scroll to load more</span>
                    )}
                  </div>
                );
              }

              const row = rows[virtualRow.index];
              return (
                <div
                  key={virtualRow.index}
                  className={cn(
                    "absolute left-0 right-0 grid gap-4 pl-4 pr-16 items-center cursor-pointer",
                    "border-b border-border/30 hover:bg-muted/30 transition-colors hover:transition-none",
                    virtualRow.index % 2 === 0 ? "bg-transparent" : "bg-muted/10"
                  )}
                  style={{
                    top: `${virtualRow.start}px`,
                    height: `${virtualRow.size}px`,
                    gridTemplateColumns,
                  }}
                  onClick={() => onRowClick(row)}
                >
                  {columns.map((column) => (
                    <div key={column} className="font-mono text-xs truncate">
                      <TableCellValue value={row[column]} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TableContent — preset table view (no query builder, read-only)
// ============================================================================

function TableContent({ tableId }: { tableId: TableId }) {
  const adminApp = useAdminApp();
  const tableConfig = AVAILABLE_TABLES.get(tableId);

  const {
    columns, rows, error, loading, loadingMore, hasMore, hasQueried,
    liveMode, toggleLiveMode, lastQueryRan,
    runQuery, handleLoadMore,
  } = useQueryRunner(adminApp);

  const [relativeDate, setRelativeDate] = useState(true);
  const [selectedRow, setSelectedRow] = useState<RowData | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("DESC");

  const currentQuery = useMemo(() => {
    if (!tableConfig) return "";
    const orderBy = sortColumn ?? tableConfig.defaultOrderBy;
    const orderDir = sortColumn ? sortDir : tableConfig.defaultOrderDir;
    return `${tableConfig.baseQuery} ORDER BY ${orderBy} ${orderDir} LIMIT ${PAGE_SIZE}`;
  }, [tableConfig, sortColumn, sortDir]);

  useEffect(() => {
    if (currentQuery) {
      runAsynchronouslyWithAlert(() => runQuery(currentQuery));
    }
  }, [currentQuery, runQuery]);

  const handleSort = useCallback(
    (column: string) => {
      if (sortColumn === column) {
        setSortDir((prev) => (prev === "ASC" ? "DESC" : "ASC"));
      } else {
        setSortColumn(column);
        setSortDir("DESC");
      }
    },
    [sortColumn]
  );

  const handleRowClick = (row: RowData) => {
    setSelectedRow(row);
    setDetailDialogOpen(true);
  };

  const handleRefresh = useCallback(() => {
    runAsynchronouslyWithAlert(() => runQuery(currentQuery));
  }, [runQuery, currentQuery]);

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const query = searchQuery.toLowerCase();
    return rows.filter((row) =>
      columns.some((col) => {
        const value = row[col];
        if (value === null || value === undefined) return false;
        const str = typeof value === "object" ? JSON.stringify(value) : String(value);
        return str.toLowerCase().includes(query);
      })
    );
  }, [rows, columns, searchQuery]);

  if ((loading || !hasQueried) && rows.length === 0) {
    if (columns.length > 0) {
      const gridCols = columns.map(() => "1fr").join(" ");
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-4 pl-4 pr-16 py-3 border-b border-border/50">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-9 w-24" />
          </div>
          <div
            className="grid gap-4 pl-4 pr-16 py-2 border-b border-border/50 bg-muted/40"
            style={{ gridTemplateColumns: gridCols }}
          >
            {columns.map((column) => (
              <span key={column} className="font-mono text-xs font-medium text-muted-foreground">
                {column}
              </span>
            ))}
          </div>
          <div className="flex-1 p-4">
            <div className="space-y-1">
              {Array.from({ length: 15 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex-1 p-4">
        <div className="space-y-1">
          {Array.from({ length: 15 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 p-4">
        <ErrorDisplay error={error} onRetry={() => runQuery(currentQuery)} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <Typography variant="secondary">No data available</Typography>
        <Button variant="outline" onClick={handleRefresh}>
          <ArrowClockwiseIcon className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <DateDisplayContext.Provider value={{ relative: relativeDate }}>
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-4 pl-4 pr-16 py-3 border-b border-border/50 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 bg-transparent border-border/50"
            />
          </div>
          <div className="flex items-center gap-2">
            <SimpleTooltip tooltip={relativeDate ? "Relative dates" : "Absolute dates"}>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarIcon className={cn("h-4 w-4", !relativeDate && "text-foreground")} />
                <Switch checked={relativeDate} onCheckedChange={setRelativeDate} />
                <ClockIcon className={cn("h-4 w-4", relativeDate && "text-foreground")} />
              </div>
            </SimpleTooltip>
          </div>
          <Button variant="ghost" size="sm" onClick={handleRefresh} className="h-8">
            <ArrowClockwiseIcon className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <LiveToggle
            liveMode={liveMode}
            onToggle={toggleLiveMode}
            lastQueryRan={lastQueryRan}
            onRunQuery={handleRefresh}
          />
          <span className="text-xs text-muted-foreground">
            {filteredRows.length.toLocaleString()} rows
            {hasMore && "+"}
          </span>
        </div>
        <SortableDataTable
          columns={columns}
          rows={filteredRows}
          onRowClick={handleRowClick}
          onLoadMore={handleLoadMore}
          hasMore={!liveMode && hasMore && !searchQuery.trim()}
          loadingMore={loadingMore}
          sortColumn={sortColumn}
          sortDir={sortDir}
          onSort={handleSort}
          refreshing={loading && rows.length > 0}
        />
        <TableRowDetailDialog
          row={selectedRow}
          columns={columns}
          open={detailDialogOpen}
          onOpenChange={setDetailDialogOpen}
        />
      </div>
    </DateDisplayContext.Provider>
  );
}

// ============================================================================
// Query-specific Components
// ============================================================================

function EmptyQueryState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-6 text-center h-full">
      <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center">
        <PlayIcon className="h-7 w-7 text-amber-500" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Run Query</h3>
        <p className="text-xs text-muted-foreground max-w-xs">
          Enter a ClickHouse SQL query above and click Run to see results.
        </p>
      </div>
      <div className="mt-2 p-3 rounded-lg bg-muted/30 border border-border/50 max-w-sm">
        <p className="text-[10px] text-muted-foreground/70 font-mono">
          SELECT * FROM default.events
          <br />
          ORDER BY event_at DESC
          <br />
          LIMIT 100
        </p>
      </div>
    </div>
  );
}

function NoResultsState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center h-full">
      <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center">
        <CheckCircleIcon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <h3 className="text-sm font-medium text-foreground mb-0.5">No Results</h3>
        <p className="text-xs text-muted-foreground">
          Query executed successfully but returned no rows.
        </p>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 h-full">
      <SpinnerGapIcon className="h-6 w-6 text-amber-500 animate-spin" />
      <p className="text-xs text-muted-foreground">Running query...</p>
    </div>
  );
}

// ============================================================================
// QueryEditorContent — query builder + SQL editor + results
// ============================================================================

function QueryEditorContent({
  initialSql,
  autoRun,
  isEditingSaved,
  onSqlChange,
  onSave,
  onUpdate,
}: {
  initialSql: string;
  autoRun: boolean;
  isEditingSaved: boolean;
  onSqlChange: (sql: string) => void;
  onSave: () => void;
  onUpdate: () => void;
}) {
  const adminApp = useAdminApp();
  const [sqlQuery, setSqlQuery] = useState(initialSql);
  const [selectedRow, setSelectedRow] = useState<RowData | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  // Table selection with auto-detection from SQL
  const [selectedTable, setSelectedTable] = useState<QueryTable>(() => {
    if (initialSql) {
      const parsed = parseSql(initialSql);
      if (parsed) return parsed.table;
    }
    return "events";
  });

  const handleTableChange = useCallback((newTable: QueryTable) => {
    setSelectedTable(newTable);
    const config = TABLE_CONFIGS[newTable];
    setSqlQuery(`SELECT *\nFROM ${config.sqlTable}\nORDER BY ${config.defaultOrderBy} DESC\nLIMIT 100`);
  }, []);

  // Auto-detect table when SQL is manually edited
  useEffect(() => {
    const parsed = parseSql(sqlQuery);
    if (parsed && parsed.table !== selectedTable) {
      setSelectedTable(parsed.table);
    }
  }, [sqlQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    columns, rows, error, loading, loadingMore, hasMore, hasQueried,
    liveMode, toggleLiveMode, lastQueryRan,
    runQuery, runQueryRef, handleLoadMore,
  } = useQueryRunner(adminApp);

  // Keep parent in sync with current SQL
  useEffect(() => {
    onSqlChange(sqlQuery);
  }, [sqlQuery, onSqlChange]);

  // Auto-run on mount for saved queries
  useEffect(() => {
    if (autoRun && initialSql) {
      runAsynchronouslyWithAlert(() => runQueryRef.current?.(initialSql) ?? Promise.resolve());
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      {/* Query input area */}
      <div className="p-4 border-b border-border/30">
        {/* Table selector */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Table
          </span>
          <div className="flex gap-1">
            {(Object.keys(TABLE_CONFIGS) as QueryTable[]).map((t) => (
              <button
                key={t}
                onClick={() => handleTableChange(t)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors duration-150 hover:transition-none",
                  selectedTable === t
                    ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 ring-1 ring-cyan-500/25"
                    : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08]"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <details className="mb-3 group">
          <summary className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors duration-150 hover:transition-none mb-2">
            <CaretRightIcon className="h-3 w-3 transition-transform duration-150 group-open:rotate-90" />
            Query Builder
          </summary>
          <div className="mb-3">
            <QueryBuilder key={selectedTable} sql={sqlQuery} onSqlChange={setSqlQuery} table={selectedTable} />
          </div>
        </details>

        <Textarea
          value={sqlQuery}
          onChange={(e) => setSqlQuery(e.target.value)}
          placeholder={`SELECT * FROM ${TABLE_CONFIGS[selectedTable].sqlTable} ORDER BY ${TABLE_CONFIGS[selectedTable].defaultOrderBy} DESC LIMIT 100`}
          className="font-mono text-sm min-h-[80px] resize-y bg-background/60"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !loading) {
              e.preventDefault();
              runAsynchronouslyWithAlert(() => runQuery(sqlQuery));
            }
          }}
        />
        <div className="flex items-center justify-between mt-2">
          <p className="text-[10px] text-muted-foreground">Cmd+Enter to run</p>
          <div className="flex items-center gap-2">
            {isEditingSaved ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={onUpdate}
                disabled={!sqlQuery.trim()}
                className="gap-1.5"
              >
                <FloppyDiskIcon className="h-4 w-4" />
                Save
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={onSave}
                disabled={!sqlQuery.trim()}
                className="gap-1.5"
              >
                <FloppyDiskIcon className="h-4 w-4" />
                Save
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={onSave}
              disabled={!sqlQuery.trim()}
              className="gap-1.5 text-xs"
            >
              Save As...
            </Button>
            <Button
              size="sm"
              onClick={() => runAsynchronouslyWithAlert(() => runQuery(sqlQuery))}
              disabled={!sqlQuery.trim() || loading}
              className="gap-1.5"
            >
              {loading ? (
                <SpinnerGapIcon className="h-4 w-4 animate-spin" />
              ) : (
                <PlayIcon className="h-4 w-4" />
              )}
              Run
            </Button>
          </div>
        </div>
      </div>

      {/* Results area */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {loading && rows.length === 0 ? (
          <LoadingState />
        ) : error ? (
          <ErrorDisplay error={error} onRetry={() => runQuery(sqlQuery)} />
        ) : !hasQueried ? (
          <EmptyQueryState />
        ) : rows.length === 0 ? (
          <NoResultsState />
        ) : (
          <>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 shrink-0">
              <span className="text-xs text-muted-foreground">
                {rows.length.toLocaleString()} row{rows.length !== 1 ? "s" : ""}
                {hasMore && "+"}
                {loading && " · refreshing..."}
              </span>
              <LiveToggle
                liveMode={liveMode}
                onToggle={toggleLiveMode}
                lastQueryRan={lastQueryRan}
                onRunQuery={() => runAsynchronouslyWithAlert(() => runQuery(sqlQuery))}
              />
            </div>
            <VirtualizedFlatTable
              columns={columns}
              rows={rows}
              onRowClick={(row) => {
                setSelectedRow(row);
                setDetailDialogOpen(true);
              }}
              onLoadMore={liveMode ? undefined : handleLoadMore}
              hasMore={!liveMode && hasMore}
              loadingMore={loadingMore}
            />
          </>
        )}
      </div>

      <RowDetailDialog
        row={selectedRow}
        columns={columns}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
      />
    </div>
  );
}

// ============================================================================
// Dialogs
// ============================================================================

function CreateFolderDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (displayName: string) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!displayName.trim()) return;
    setLoading(true);
    try {
      await onCreate(displayName.trim());
      setDisplayName("");
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Folder</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">Folder Name</Label>
              <Input
                id="folder-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My Queries"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    runAsynchronouslyWithAlert(handleCreate);
                  }
                }}
              />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => runAsynchronouslyWithAlert(handleCreate)}
            disabled={!displayName.trim() || loading}
          >
            {loading ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SaveQueryDialog({
  open,
  onOpenChange,
  folders,
  sqlQuery,
  onSave,
  onCreateFolder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: FolderWithId[];
  sqlQuery: string;
  onSave: (displayName: string, folderId: string, description: string | null) => Promise<void>;
  onCreateFolder: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!displayName.trim() || !sqlQuery.trim() || !selectedFolderId) return;
    setLoading(true);
    try {
      await onSave(displayName.trim(), selectedFolderId, description.trim() || null);
      setDisplayName("");
      setDescription("");
      setSelectedFolderId("");
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const canSave = displayName.trim() && selectedFolderId && sqlQuery.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save Query</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="query-name">Query Name</Label>
              <Input
                id="query-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My Query"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="query-folder">Folder</Label>
              <select
                id="query-folder"
                className="w-full h-10 px-3 border rounded-md text-sm bg-background"
                value={selectedFolderId}
                onChange={(e) => {
                  if (e.target.value === "__create_new__") {
                    onCreateFolder();
                  } else {
                    setSelectedFolderId(e.target.value);
                  }
                }}
              >
                <option value="">Select a folder...</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.displayName}
                  </option>
                ))}
                <option value="__create_new__">Create new...</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="query-description">Description (optional)</Label>
              <Textarea
                id="query-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this query does..."
                rows={2}
              />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => runAsynchronouslyWithAlert(handleSave)}
            disabled={!canSave || loading}
          >
            {loading ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground">{description}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => runAsynchronouslyWithAlert(handleConfirm)}
            disabled={loading}
          >
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// FolderItem — sidebar folder tree item
// ============================================================================

function FolderItem({
  folder,
  selectedFolderId,
  selectedQueryId,
  onSelectQuery,
  onDeleteFolder,
  onDeleteQuery,
}: {
  folder: FolderWithId;
  selectedFolderId: string | null;
  selectedQueryId: string | null;
  onSelectQuery: (query: {
    id: string;
    displayName: string;
    sqlQuery: string;
    description?: string;
  }) => void;
  onDeleteFolder: () => void;
  onDeleteQuery: (queryId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selectedFolderId === folder.id;

  return (
    <div>
      <div className="group flex items-center">
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "flex items-center gap-1.5 flex-1 px-2 py-1.5 rounded-md text-sm",
            "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground",
            "transition-colors hover:transition-none"
          )}
        >
          {expanded ? (
            <CaretDownIcon className="h-3 w-3 shrink-0" />
          ) : (
            <CaretRightIcon className="h-3 w-3 shrink-0" />
          )}
          {expanded ? (
            <FolderOpenIcon className="h-4 w-4 text-amber-500 shrink-0" />
          ) : (
            <FolderIcon className="h-4 w-4 text-amber-500 shrink-0" />
          )}
          <span className="truncate flex-1 text-left">{folder.displayName}</span>
          <span className="text-xs text-muted-foreground/60 shrink-0">
            {folder.queries.length}
          </span>
        </button>
        <SimpleTooltip tooltip="Delete folder">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteFolder();
            }}
            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors hover:transition-none"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </SimpleTooltip>
      </div>
      {expanded && (
        <div className="ml-5 mt-0.5 space-y-0.5">
          {folder.queries.length === 0 ? (
            <div className="px-2 py-1 text-xs text-muted-foreground/60 italic">Empty</div>
          ) : (
            folder.queries.map((query) => (
              <div key={query.id} className="group flex items-center">
                <button
                  onClick={() => onSelectQuery(query)}
                  className={cn(
                    "flex-1 text-left px-2 py-1 rounded-md text-sm truncate",
                    "transition-colors hover:transition-none",
                    isSelected && selectedQueryId === query.id
                      ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                      : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground"
                  )}
                >
                  {query.displayName}
                </button>
                <SimpleTooltip tooltip="Delete query">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteQuery(query.id);
                    }}
                    className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors hover:transition-none"
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </SimpleTooltip>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Unified PageClient
// ============================================================================

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();

  // View routing
  const [viewState, setViewState] = useState<ViewState>({ type: "table", tableId: "events" });
  const [queryMountKey, setQueryMountKey] = useState(0);
  const currentSqlRef = useRef("");

  // Dialog state
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [saveQueryDialogOpen, setSaveQueryDialogOpen] = useState(false);
  const [saveDialogSql, setSaveDialogSql] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "folder" | "query";
    folderId: string;
    queryId?: string;
  } | null>(null);

  // Folders from config
  const folders = useMemo((): FolderWithId[] => {
    const queryFolders = config.analytics.queryFolders;
    return Object.entries(queryFolders)
      .map(([id, folder]) => ({
        id,
        displayName: folder.displayName,
        sortOrder: folder.sortOrder,
        queries: Object.entries(folder.queries).map(([queryId, query]) => ({
          id: queryId,
          displayName: query.displayName,
          sqlQuery: query.sqlQuery,
          description: query.description,
        })),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [config]);

  // Config operations
  const handleCreateFolder = async (displayName: string) => {
    const folderId = generateSecureRandomString();
    await updateConfig({
      adminApp,
      configUpdate: {
        [`analytics.queryFolders.${folderId}`]: {
          displayName,
          sortOrder: folders.length,
          queries: {},
        },
      },
      pushable: false,
    });
  };

  const handleSaveQuery = async (
    displayName: string,
    folderId: string,
    description: string | null
  ) => {
    const queryId = generateSecureRandomString();
    await updateConfig({
      adminApp,
      configUpdate: {
        [`analytics.queryFolders.${folderId}.queries.${queryId}`]: {
          displayName,
          sqlQuery: saveDialogSql,
          ...(description ? { description } : {}),
        },
      },
      pushable: false,
    });
  };

  const handleUpdateCurrentQuery = useCallback(async () => {
    if (viewState.type !== "savedQuery") return;
    const folder = folders.find((f) => f.id === viewState.folderId);
    const currentQuery = folder?.queries.find((q) => q.id === viewState.queryId);
    if (!currentQuery) return;
    await updateConfig({
      adminApp,
      configUpdate: {
        [`analytics.queryFolders.${viewState.folderId}.queries.${viewState.queryId}`]: {
          displayName: currentQuery.displayName,
          sqlQuery: currentSqlRef.current,
          ...(currentQuery.description ? { description: currentQuery.description } : {}),
        },
      },
      pushable: false,
    });
  }, [adminApp, folders, updateConfig, viewState]);

  const handleDeleteFolder = async (folderId: string) => {
    await updateConfig({
      adminApp,
      configUpdate: { [`analytics.queryFolders.${folderId}`]: null },
      pushable: false,
    });
    if (viewState.type === "savedQuery" && viewState.folderId === folderId) {
      setViewState({ type: "table", tableId: "events" });
    }
  };

  const handleDeleteQuery = async (folderId: string, queryId: string) => {
    await updateConfig({
      adminApp,
      configUpdate: { [`analytics.queryFolders.${folderId}.queries.${queryId}`]: null },
      pushable: false,
    });
    if (
      viewState.type === "savedQuery" &&
      viewState.folderId === folderId &&
      viewState.queryId === queryId
    ) {
      setViewState({ type: "table", tableId: "events" });
    }
  };

  // View switching
  const selectTable = useCallback((tableId: TableId) => {
    setViewState({ type: "table", tableId });
  }, []);

  const selectNewQuery = useCallback(() => {
    setQueryMountKey((k) => k + 1);
    setViewState({ type: "newQuery" });
  }, []);

  const selectSavedQuery = useCallback(
    (folderId: string, query: { id: string; sqlQuery: string }) => {
      setQueryMountKey((k) => k + 1);
      setViewState({
        type: "savedQuery",
        folderId,
        queryId: query.id,
        sqlQuery: query.sqlQuery,
      });
    },
    []
  );

  const handleSqlChange = useCallback((sql: string) => {
    currentSqlRef.current = sql;
  }, []);

  const openSaveDialog = useCallback(() => {
    setSaveDialogSql(currentSqlRef.current);
    setSaveQueryDialogOpen(true);
  }, []);

  const openDeleteDialog = (
    type: "folder" | "query",
    folderId: string,
    queryId?: string
  ) => {
    setDeleteTarget({ type, folderId, queryId });
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "folder") {
      await handleDeleteFolder(deleteTarget.folderId);
    } else if (deleteTarget.queryId) {
      await handleDeleteQuery(deleteTarget.folderId, deleteTarget.queryId);
    }
    setDeleteTarget(null);
  };

  const getDeleteDialogInfo = () => {
    if (!deleteTarget) return { title: "", description: "" };
    if (deleteTarget.type === "folder") {
      const folder = folders.find((f) => f.id === deleteTarget.folderId);
      return {
        title: "Delete Folder",
        description: `Are you sure you want to delete "${folder?.displayName ?? "this folder"}" and all its queries? This action cannot be undone.`,
      };
    }
    const folder = folders.find((f) => f.id === deleteTarget.folderId);
    const query = folder?.queries.find((q) => q.id === deleteTarget.queryId);
    return {
      title: "Delete Query",
      description: `Are you sure you want to delete "${query?.displayName ?? "this query"}"? This action cannot be undone.`,
    };
  };

  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout fillWidth noPadding>
        <div className="flex flex-1 min-h-0 overflow-hidden -mx-2">
          {/* Sidebar */}
          <div className="w-56 flex-shrink-0 border-r border-border/50 flex flex-col pl-2">
            <div className="flex-1 overflow-auto py-4 px-3">
              {/* Preset tables */}
              <Typography className="px-3 mb-3 text-xs font-semibold uppercase tracking-wide text-foreground/70">
                Tables
              </Typography>
              <div className="space-y-1 mb-4">
                {[...AVAILABLE_TABLES.entries()].map(([id, tableConfig]) => (
                  <button
                    key={id}
                    onClick={() => selectTable(id as TableId)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover:transition-none",
                      viewState.type === "table" && viewState.tableId === id
                        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {tableConfig.displayName}
                  </button>
                ))}
              </div>

              {/* Separator */}
              <div className="border-t border-border/40 mb-4" />

              {/* New Query */}
              <button
                onClick={selectNewQuery}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm mb-3",
                  "transition-colors hover:transition-none",
                  viewState.type === "newQuery"
                    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                    : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground"
                )}
              >
                <FilePlusIcon className="h-4 w-4" />
                New Query
              </button>

              {/* Folders */}
              <div className="flex items-center justify-between px-3 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
                  Folders
                </span>
                <SimpleTooltip tooltip="New folder">
                  <button
                    onClick={() => setCreateFolderDialogOpen(true)}
                    className="p-1 rounded hover:bg-foreground/[0.06] text-muted-foreground hover:text-foreground transition-colors hover:transition-none"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                  </button>
                </SimpleTooltip>
              </div>

              {folders.length === 0 ? (
                <div className="px-3 py-4 text-center">
                  <p className="text-xs text-muted-foreground mb-2">No folders yet</p>
                  <button
                    onClick={() => setCreateFolderDialogOpen(true)}
                    className="text-xs text-blue-500 hover:text-blue-400 transition-colors hover:transition-none"
                  >
                    Create folder
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  {folders.map((folder) => (
                    <FolderItem
                      key={folder.id}
                      folder={folder}
                      selectedFolderId={
                        viewState.type === "savedQuery" ? viewState.folderId : null
                      }
                      selectedQueryId={
                        viewState.type === "savedQuery" ? viewState.queryId : null
                      }
                      onSelectQuery={(query) => selectSavedQuery(folder.id, query)}
                      onDeleteFolder={() => openDeleteDialog("folder", folder.id)}
                      onDeleteQuery={(queryId) =>
                        openDeleteDialog("query", folder.id, queryId)
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Content area */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {viewState.type === "table" ? (
              <TableContent key={viewState.tableId} tableId={viewState.tableId} />
            ) : (
              <QueryEditorContent
                key={queryMountKey}
                initialSql={viewState.type === "savedQuery" ? viewState.sqlQuery : ""}
                autoRun={viewState.type === "savedQuery"}
                isEditingSaved={viewState.type === "savedQuery"}
                onSqlChange={handleSqlChange}
                onSave={openSaveDialog}
                onUpdate={() => runAsynchronouslyWithAlert(handleUpdateCurrentQuery)}
              />
            )}
          </div>
        </div>

        {/* Dialogs */}
        <CreateFolderDialog
          open={createFolderDialogOpen}
          onOpenChange={setCreateFolderDialogOpen}
          onCreate={handleCreateFolder}
        />
        <SaveQueryDialog
          open={saveQueryDialogOpen}
          onOpenChange={setSaveQueryDialogOpen}
          folders={folders}
          sqlQuery={saveDialogSql}
          onSave={handleSaveQuery}
          onCreateFolder={() => setCreateFolderDialogOpen(true)}
        />
        <DeleteConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          {...getDeleteDialogInfo()}
          onConfirm={handleConfirmDelete}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}
