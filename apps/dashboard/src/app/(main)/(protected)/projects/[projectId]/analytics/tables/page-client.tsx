"use client";

import { Link } from "@/components/link";
import { Alert, Button, Skeleton, Typography } from "@/components/ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleTooltip } from "@/components/ui/simple-tooltip";
import { Switch } from "@/components/ui/switch";
import { useFromNow } from "@/hooks/use-from-now";
import { cn } from "@/lib/utils";
import {
  ArrowClockwiseIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

// Context for date display preference
const DateDisplayContext = createContext<{ relative: boolean }>({ relative: true });

// Available tables in the analytics database
const AVAILABLE_TABLES = new Map([
  ["events", {
    displayName: "Events",
    baseQuery: "SELECT * FROM default.events",
    defaultOrderBy: "event_at",
    defaultOrderDir: "DESC" as const,
  }],
]);

type TableId = "events";
type RowData = Record<string, unknown>;
type SortDir = "ASC" | "DESC";

const PAGE_SIZE = 50;

// Detect if a value is a date string
function isDateValue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2})?/.test(value);
}

// Detect if a value is JSON
function isJsonValue(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

// Parse ClickHouse date string as UTC
function parseClickHouseDate(value: string): Date {
  // ClickHouse dates are in UTC but formatted without timezone indicator
  // e.g., "2026-01-29 02:08:20.970" - need to treat as UTC
  // Replace space with T and append Z to parse as UTC
  const normalized = value.replace(" ", "T") + (value.includes("Z") || value.includes("+") ? "" : "Z");
  return new Date(normalized);
}

// Component for displaying dates with toggle support
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

// Component for displaying JSON values
function JsonValue({ value, truncate = true }: { value: unknown, truncate?: boolean }) {
  const formatted = JSON.stringify(value, null, 2);
  const preview = JSON.stringify(value);

  if (truncate && preview.length > 60) {
    return (
      <SimpleTooltip tooltip={<pre className="text-xs max-w-md overflow-auto max-h-64">{formatted}</pre>}>
        <span className="cursor-help text-muted-foreground">
          {preview.slice(0, 57)}...
        </span>
      </SimpleTooltip>
    );
  }

  return <span className="text-muted-foreground">{preview}</span>;
}

// Format a cell value for display
function CellValue({ value, truncate = true }: { value: unknown, truncate?: boolean }) {
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

// Column header with sort
function ColumnHeader({
  column,
  sortColumn,
  sortDir,
  onSort,
}: {
  column: string,
  sortColumn: string | null,
  sortDir: SortDir,
  onSort: (column: string) => void,
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
      {isSorted && (
        sortDir === "ASC"
          ? <ArrowUpIcon className="h-3 w-3" />
          : <ArrowDownIcon className="h-3 w-3" />
      )}
    </button>
  );
}

// Virtualized flat table component
function VirtualizedFlatTable({
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
  columns: string[],
  rows: RowData[],
  onRowClick: (row: RowData) => void,
  onLoadMore: () => void,
  hasMore: boolean,
  loadingMore: boolean,
  sortColumn: string | null,
  sortDir: SortDir,
  onSort: (column: string) => void,
  refreshing?: boolean,
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length + (hasMore ? 1 : 0), // +1 for loading indicator
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  // Trigger load more when scrolling near the end
  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastItemIndex = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1]?.index ?? -1 : -1;

  useEffect(() => {
    if (lastItemIndex >= rows.length - 10 && hasMore && !loadingMore) {
      onLoadMore();
    }
  }, [lastItemIndex, rows.length, hasMore, loadingMore, onLoadMore]);

  // Column widths - distribute based on content type
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

  // Calculate minimum content width based on columns
  const minContentWidth = columns.length * 150;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden relative">
      {/* Refresh loading overlay */}
      {refreshing && (
        <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] z-20 flex items-center justify-center">
          <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-background/90 border border-border/50 shadow-lg">
            <div className="h-4 w-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Refreshing...</span>
          </div>
        </div>
      )}
      {/* Single scroll container for both header and body - handles horizontal scroll */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto"
      >
        {/* Inner container with min-width for horizontal scrolling */}
        <div style={{ minWidth: `${minContentWidth}px` }}>
          {/* Sticky header */}
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

          {/* Virtualized rows container */}
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const isLoaderRow = virtualRow.index >= rows.length;
              const row = rows[virtualRow.index];

              if (isLoaderRow) {
                return (
                  <div
                    key="loader"
                    className="absolute left-0 right-0 flex items-center justify-center py-4"
                    style={{
                      top: `${virtualRow.start}px`,
                      height: `${virtualRow.size}px`,
                    }}
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
                      <CellValue value={row[column]} />
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

function TableContent({ tableId }: { tableId: TableId }) {
  const adminApp = useAdminApp();
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<RowData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [relativeDate, setRelativeDate] = useState(true);
  const [selectedRow, setSelectedRow] = useState<RowData | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("DESC");

  const tableConfig = AVAILABLE_TABLES.get(tableId);

  const loadData = useCallback(async (offset: number = 0, append: boolean = false, isRefresh: boolean = false) => {
    if (!tableConfig) return;

    if (append) {
      setLoadingMore(true);
    } else if (isRefresh) {
      // For refresh, keep existing data visible and just show loading overlay
      setLoading(true);
    } else {
      // Initial load - clear everything
      setLoading(true);
      setRows([]);
    }
    setError(null);

    try {
      const orderBy = sortColumn ?? tableConfig.defaultOrderBy;
      const orderDir = sortColumn ? sortDir : tableConfig.defaultOrderDir;
      const query = `${tableConfig.baseQuery} ORDER BY ${orderBy} ${orderDir} LIMIT ${PAGE_SIZE} OFFSET ${offset}`;

      const response = await adminApp.queryAnalytics({
        query,
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
      }

      setHasMore(newRows.length === PAGE_SIZE);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load table data";
      setError(message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [adminApp, tableConfig, sortColumn, sortDir]);

  // Auto-load data when the component mounts or sort changes
  // If we already have rows, treat it as a refresh (keep data visible)
  useEffect(() => {
    const isRefresh = rows.length > 0;
    runAsynchronouslyWithAlert(() => loadData(0, false, isRefresh));
  }, [loadData]); // eslint-disable-line react-hooks/exhaustive-deps -- rows.length is intentionally not a dependency to avoid infinite loop

  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      runAsynchronouslyWithAlert(() => loadData(rows.length, true));
    }
  }, [loadData, loadingMore, hasMore, rows.length]);

  const handleSort = useCallback((column: string) => {
    if (sortColumn === column) {
      setSortDir((prev) => (prev === "ASC" ? "DESC" : "ASC"));
    } else {
      setSortColumn(column);
      setSortDir("DESC");
    }
  }, [sortColumn]);

  const handleRowClick = (row: RowData) => {
    setSelectedRow(row);
    setDetailDialogOpen(true);
  };

  const handleRefresh = useCallback(() => {
    runAsynchronouslyWithAlert(() => loadData(0, false, true));
  }, [loadData]);

  // Filter rows based on search query
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

  if (loading && rows.length === 0) {
    // If we have columns from a previous load, show them with skeleton rows
    if (columns.length > 0) {
      const gridTemplateColumns = columns.map(() => "1fr").join(" ");
      return (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Toolbar skeleton */}
          <div className="flex items-center gap-4 pl-4 pr-16 py-3 border-b border-border/50">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-9 w-24" />
          </div>
          {/* Header */}
          <div
            className="grid gap-4 pl-4 pr-16 py-2 border-b border-border/50 bg-muted/40"
            style={{ gridTemplateColumns }}
          >
            {columns.map((column) => (
              <span key={column} className="font-mono text-xs font-medium text-muted-foreground">
                {column}
              </span>
            ))}
          </div>
          {/* Skeleton rows */}
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
    // No columns yet - show simple skeleton
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
      <div className="flex-1 p-4 space-y-4">
        <Alert variant="destructive">{error}</Alert>
        <Button variant="outline" onClick={handleRefresh}>
          Retry
        </Button>
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
        {/* Toolbar */}
        <div className="flex items-center gap-4 pl-4 pr-16 py-3 border-b border-border/50 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 bg-transparent border-border/50"
            />
          </div>

          {/* Date toggle */}
          <div className="flex items-center gap-2">
            <SimpleTooltip tooltip={relativeDate ? "Relative dates" : "Absolute dates"}>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarIcon className={cn("h-4 w-4", !relativeDate && "text-foreground")} />
                <Switch
                  checked={relativeDate}
                  onCheckedChange={setRelativeDate}
                />
                <ClockIcon className={cn("h-4 w-4", relativeDate && "text-foreground")} />
              </div>
            </SimpleTooltip>
          </div>

          {/* Refresh */}
          <Button variant="ghost" size="sm" onClick={handleRefresh} className="h-8">
            <ArrowClockwiseIcon className="mr-2 h-4 w-4" />
            Refresh
          </Button>

          {/* Row count */}
          <span className="text-xs text-muted-foreground">
            {filteredRows.length.toLocaleString()} rows
            {hasMore && "+"}
          </span>
        </div>

        {/* Table */}
        <VirtualizedFlatTable
          columns={columns}
          rows={filteredRows}
          onRowClick={handleRowClick}
          onLoadMore={handleLoadMore}
          hasMore={hasMore && !searchQuery.trim()}
          loadingMore={loadingMore}
          sortColumn={sortColumn}
          sortDir={sortDir}
          onSort={handleSort}
          refreshing={loading && rows.length > 0}
        />

        <RowDetailDialog
          row={selectedRow}
          columns={columns}
          open={detailDialogOpen}
          onOpenChange={setDetailDialogOpen}
        />
      </div>
    </DateDisplayContext.Provider>
  );
}

export default function PageClient() {
  const [selectedTable, setSelectedTable] = useState<TableId | null>("events");

  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout fillWidth noPadding>
        <div className="flex flex-1 min-h-0 overflow-hidden -mx-2">
          {/* Left sidebar - table list (doesn't scroll, border extends full height) */}
          <div className="w-48 flex-shrink-0 border-r border-border/50 flex flex-col pl-2">
            <div className="flex-1 py-4 px-4">
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
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
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
