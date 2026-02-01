"use client";

import { useAdminAppIfExists } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SimpleTooltip } from "@/components/ui/simple-tooltip";
import { useDebouncedAction } from "@/hooks/use-debounced-action";
import { useFromNow } from "@/hooks/use-from-now";
import { cn } from "@/lib/utils";
import {
    ArrowClockwiseIcon,
    CheckCircleIcon,
    PlayIcon,
    SpinnerGapIcon,
    WarningCircleIcon,
} from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { CmdKPreviewProps } from "../cmdk-commands";

type RowData = Record<string, unknown>;

const DEBOUNCE_MS = 400;

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
  const normalized = value.replace(" ", "T") + (value.includes("Z") || value.includes("+") ? "" : "Z");
  return new Date(normalized);
}

// Component for displaying dates
function DateValue({ value }: { value: string }) {
  const date = parseClickHouseDate(value);
  const fromNow = useFromNow(date);

  return (
    <SimpleTooltip tooltip={date.toLocaleString()}>
      <span className="cursor-help">{fromNow}</span>
    </SimpleTooltip>
  );
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

// Virtualized flat table component
function VirtualizedFlatTable({
  columns,
  rows,
  onRowClick,
}: {
  columns: string[],
  rows: RowData[],
  onRowClick: (row: RowData) => void,
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  // Column widths - distribute based on content type
  const columnWidths = useMemo(() => {
    const widths = new Map<string, string>();
    columns.forEach((col) => {
      if (col.includes("id") && col !== "project_id") {
        widths.set(col, "minmax(200px, 1fr)");
      } else if (col.includes("_at") || col.includes("date")) {
        widths.set(col, "minmax(100px, 140px)");
      } else if (col === "data" || col.includes("json")) {
        widths.set(col, "minmax(180px, 2fr)");
      } else if (col === "event_type" || col === "type") {
        widths.set(col, "minmax(100px, 160px)");
      } else {
        widths.set(col, "minmax(80px, 1fr)");
      }
    });
    return widths;
  }, [columns]);

  const gridTemplateColumns = columns.map((col) => columnWidths.get(col) ?? "1fr").join(" ");
  const minContentWidth = columns.length * 120;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div
        ref={parentRef}
        className="flex-1 overflow-auto"
      >
        <div style={{ minWidth: `${minContentWidth}px` }}>
          {/* Sticky header */}
          <div
            className="grid gap-3 px-3 py-1.5 border-b border-border/50 bg-muted/40 backdrop-blur-sm sticky top-0 z-10"
            style={{ gridTemplateColumns }}
          >
            {columns.map((column) => (
              <span
                key={column}
                className="font-mono text-xs font-medium text-muted-foreground"
              >
                {column}
              </span>
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
              const row = rows[virtualRow.index];

              return (
                <div
                  key={virtualRow.index}
                  className={cn(
                    "absolute left-0 right-0 grid gap-3 px-3 items-center cursor-pointer",
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
                    <div key={column} className="font-mono text-[11px] truncate">
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

// Parse error message for human-readable display
function parseErrorMessage(error: unknown): { title: string, details: string | null } {
  const message = error instanceof Error ? error.message : String(error);
  return {
    title: "Query Error",
    details: message,
  };
}

// Error display component
function ErrorDisplay({ error, onRetry }: { error: unknown, onRetry: () => void }) {
  const { title, details } = parseErrorMessage(error);

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center">
        <WarningCircleIcon className="h-7 w-7 text-red-500" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
        {details && (
          <p className="text-xs text-muted-foreground max-w-md break-words font-mono whitespace-pre-wrap">
            {details}
          </p>
        )}
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground/[0.06] hover:bg-foreground/[0.1] transition-colors hover:transition-none"
      >
        <ArrowClockwiseIcon className="h-3 w-3" />
        Retry
      </button>
    </div>
  );
}

// Empty state component
function EmptyQueryState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-6 text-center h-full">
      <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center">
        <PlayIcon className="h-7 w-7 text-amber-500" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Run Query</h3>
        <p className="text-xs text-muted-foreground max-w-xs">
          Enter a ClickHouse SQL query above to see results here.
        </p>
      </div>
      <div className="mt-2 p-3 rounded-lg bg-muted/30 border border-border/50 max-w-sm">
        <p className="text-[10px] text-muted-foreground/70 font-mono">
          SELECT * FROM default.events<br />
          ORDER BY event_at DESC<br />
          LIMIT 100
        </p>
      </div>
    </div>
  );
}

// No results state
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

// Loading state component
function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 h-full">
      <SpinnerGapIcon className="h-6 w-6 text-amber-500 animate-spin" />
      <p className="text-xs text-muted-foreground">Running query...</p>
    </div>
  );
}

// Main Run Query Preview Component - wrapper that resets state on query change
export function RunQueryPreview({ query, ...rest }: CmdKPreviewProps) {
  return <RunQueryPreviewInner key={query} query={query} {...rest} />;
}

// Inner component that handles the actual query execution
const RunQueryPreviewInner = memo(function RunQueryPreviewInner({
  query,
}: CmdKPreviewProps) {
  const adminApp = useAdminAppIfExists();
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<RowData[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [hasQueried, setHasQueried] = useState(false);
  const [selectedRow, setSelectedRow] = useState<RowData | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  const trimmedQuery = query.trim();

  const runQuery = useCallback(async () => {
    if (!adminApp) {
      setError(new Error("Not connected to a project"));
      return;
    }

    if (!trimmedQuery) {
      return;
    }

    setLoading(true);
    setError(null);
    setHasQueried(true);

    try {
      const response = await adminApp.queryAnalytics({
        query: trimmedQuery,
        include_all_branches: false,
        timeout_ms: 30000,
      });

      const newRows = response.result as RowData[];
      const newColumns = newRows.length > 0 ? Object.keys(newRows[0]) : [];

      setColumns(newColumns);
      setRows(newRows);
    } catch (e: unknown) {
      setError(e);
      setColumns([]);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [adminApp, trimmedQuery]);

  // Run query on mount with debounce
  useDebouncedAction({
    action: runQuery,
    delayMs: DEBOUNCE_MS,
    skip: !trimmedQuery,
  });

  const handleRowClick = (row: RowData) => {
    setSelectedRow(row);
    setDetailDialogOpen(true);
  };

  const handleRetry = useCallback(() => {
    runQuery().catch(() => {
      // Error is already handled in runQuery
    });
  }, [runQuery]);

  // No admin app available
  if (!adminApp) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-6 text-center h-full">
        <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
          <WarningCircleIcon className="h-5 w-5 text-amber-500" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-foreground mb-0.5">No Project Selected</h3>
          <p className="text-xs text-muted-foreground">
            Select a project to run queries.
          </p>
        </div>
      </div>
    );
  }

  // Loading state - show during debounce (before query starts) or while query is running
  // If we have a query but haven't queried yet, we're in the debounce period
  const isWaitingToRun = trimmedQuery && !hasQueried;
  if (loading || isWaitingToRun) {
    return <LoadingState />;
  }

  // Error state
  if (error) {
    return <ErrorDisplay error={error} onRetry={handleRetry} />;
  }

  // Empty state - no query provided
  if (!trimmedQuery) {
    return <EmptyQueryState />;
  }

  // No results
  if (rows.length === 0) {
    return <NoResultsState />;
  }

  // Results table
  return (
    <div className="flex flex-col h-full w-full">
      {/* Header with row count */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 shrink-0">
        <span className="text-[10px] text-muted-foreground">
          {rows.length.toLocaleString()} row{rows.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <VirtualizedFlatTable
        columns={columns}
        rows={rows}
        onRowClick={handleRowClick}
      />

      <RowDetailDialog
        row={selectedRow}
        columns={columns}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
      />
    </div>
  );
});
