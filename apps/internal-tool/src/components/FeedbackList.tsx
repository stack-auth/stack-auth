import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { clsx } from "clsx";
import type { FeedbackLogRow } from "../types";
import { toDate } from "../utils";
import { Alert, Badge, type BadgeColor, EmptyState, Input, Select } from "./design";

const CATEGORY_COLORS = new Map<string, BadgeColor>([
  ["bug", "red"],
  ["docs-gap", "orange"],
  ["suggestion", "blue"],
  ["praise", "green"],
  ["other", "neutral"],
]);

function categoryColor(category: string): BadgeColor {
  return CATEGORY_COLORS.get(category) ?? "neutral";
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "..." : str;
}

const ALL_CATEGORIES = "all";

export function FeedbackList({
  rows,
  connectionState,
  connectionErrorMessage,
  onSelect,
  selectedId,
}: {
  rows: FeedbackLogRow[],
  connectionState: string,
  connectionErrorMessage: string | null,
  onSelect: (row: FeedbackLogRow) => void,
  selectedId?: bigint,
}) {
  const [textFilter, setTextFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES);

  // Derived from the rows rather than a hardcoded list, the same way
  // CallLogList builds its tool-name filter. The vocabulary lives in the MCP
  // tool; this way the filter can never be missing a category that exists in
  // the data, and never offers one that has never been used.
  const categories = useMemo(() => {
    return Array.from(new Set(rows.map(row => row.category))).sort();
  }, [rows]);

  const visibleRows = useMemo(() => {
    const needle = textFilter.trim().toLowerCase();
    return rows
      .filter(row => categoryFilter === ALL_CATEGORIES || row.category === categoryFilter)
      .filter(row => needle === "" || row.message.toLowerCase().includes(needle))
      // Newest first. Sorting by id rather than createdAt because id is a
      // monotonic autoInc — two rows written in the same microsecond still get
      // a stable, insertion-ordered position.
      .slice()
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }, [rows, textFilter, categoryFilter]);

  if (connectionState === "connecting") {
    return <div className="p-4 text-sm text-muted-foreground">Connecting to SpacetimeDB...</div>;
  }

  if (connectionState === "error") {
    return (
      <Alert>
        <p>
          Failed to connect to SpacetimeDB. Check the browser session response below, then verify the{" "}
          <code>hexclave-ai-analytics</code> module is published and the local SpacetimeDB container is reachable.
        </p>
        {connectionErrorMessage != null && connectionErrorMessage !== "" && (
          <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-destructive/10 p-3 font-mono text-xs">
            {connectionErrorMessage}
          </pre>
        )}
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
          placeholder="Filter feedback..."
          className="flex-1"
        />
        <Select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="w-auto"
        >
          <option value={ALL_CATEGORIES}>All categories</option>
          {categories.map(category => (
            <option key={category} value={category}>{category}</option>
          ))}
        </Select>
        <span className="text-xs tabular-nums text-muted-foreground">
          {visibleRows.length}/{rows.length}
        </span>
      </div>

      {visibleRows.length === 0 ? (
        <EmptyState className="rounded-2xl bg-panel p-4 text-xs">
          {rows.length === 0 ? "No feedback yet." : "No feedback matches this filter."}
        </EmptyState>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl bg-panel">
          {visibleRows.map(row => (
            <button
              key={String(row.id)}
              onClick={() => onSelect(row)}
              className={clsx(
                "flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:transition-none",
                row.id === selectedId ? "bg-foreground/[0.06]" : "hover:bg-panel-raised",
              )}
            >
              <Badge color={categoryColor(row.category)} size="xs" className="mt-0.5 shrink-0">
                {row.category}
              </Badge>
              <span className="min-w-0 flex-1 text-xs text-foreground">
                {truncate(row.message, 160)}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {formatDistanceToNow(toDate(row.createdAt), { addSuffix: true })}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
