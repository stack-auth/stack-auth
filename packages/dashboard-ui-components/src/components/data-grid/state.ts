import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { clampColumnWidth } from "./data-grid-sizing";
import type {
  DataGridColumnDef,
  DataGridDateDisplay,
  DataGridDateFormat,
  DataGridPaginationModel,
  DataGridSelectionModel,
  DataGridSortModel,
  DataGridState,
} from "./types";

// ─── Default state ───────────────────────────────────────────────────

export const EMPTY_SORT_MODEL: DataGridSortModel = [];
export const EMPTY_SELECTION: DataGridSelectionModel = {
  selectedIds: new Set(),
  anchorId: null,
};
export const DEFAULT_PAGINATION: DataGridPaginationModel = {
  pageIndex: 0,
  pageSize: 50,
};

/**
 * Build the initial `DataGridState` for a set of columns. Pass this as the
 * lazy initializer to `useState` — NEVER hand-assemble the state object.
 *
 * ```tsx
 * const [gridState, setGridState] = React.useState(() =>
 *   createDefaultDataGridState(columns)
 * );
 * ```
 *
 * `columns` must be defined BEFORE this call (obvious, but a common TDZ
 * mistake: if you declare columns after the `useState`, you'll crash on
 * the first render). Keep the columns reference stable across renders
 * (define them outside the component or wrap in `React.useMemo`).
 */
export function createDefaultDataGridState(
  columns: readonly DataGridColumnDef<any>[],
): DataGridState {
  const columnWidths: Record<string, number> = {};
  const columnOrder: string[] = [];

  for (const col of columns) {
    const raw = col.width ?? 150;
    columnWidths[col.id] = clampColumnWidth(col, raw);
    columnOrder.push(col.id);
  }

  return {
    sorting: EMPTY_SORT_MODEL,
    columnVisibility: {},
    columnWidths,
    columnPinning: { left: [], right: [] },
    columnOrder,
    pagination: DEFAULT_PAGINATION,
    selection: EMPTY_SELECTION,
    dateDisplay: "relative",
    quickSearch: "",
  };
}

// ─── Column helpers ──────────────────────────────────────────────────

export function resolveColumnValue<TRow>(
  col: DataGridColumnDef<TRow>,
  row: TRow,
): unknown {
  if (typeof col.accessor === "function") return col.accessor(row);
  const key = (col.accessor ?? col.id) as keyof TRow;
  return row[key];
}

export function resolveColumnWidth(
  col: DataGridColumnDef<any>,
  storedWidth: number | undefined,
): number {
  const raw = storedWidth ?? col.width ?? 150;
  return clampColumnWidth(col, raw);
}

export function isColumnVisible(
  columnId: string,
  visibility: Record<string, boolean>,
): boolean {
  return visibility[columnId] !== false;
}

// ─── Sort helpers ────────────────────────────────────────────────────

export function toggleSort(
  model: DataGridSortModel,
  columnId: string,
  multiSort: boolean,
): DataGridSortModel {
  const existing = model.find((s) => s.columnId === columnId);

  if (!existing) {
    const item = { columnId, direction: "asc" as const };
    return multiSort ? [...model, item] : [item];
  }

  if (existing.direction === "asc") {
    const updated = { columnId, direction: "desc" as const };
    return model.map((s) => (s.columnId === columnId ? updated : s));
  }

  // desc → remove
  return model.filter((s) => s.columnId !== columnId);
}

export function getSortDirection(
  model: DataGridSortModel,
  columnId: string,
): false | "asc" | "desc" {
  const item = model.find((s) => s.columnId === columnId);
  return item ? item.direction : false;
}

export function getSortIndex(
  model: DataGridSortModel,
  columnId: string,
): number | null {
  if (model.length <= 1) return null;
  const idx = model.findIndex((s) => s.columnId === columnId);
  return idx >= 0 ? idx + 1 : null;
}

// ─── Default sort comparator ─────────────────────────────────────────

function defaultComparator(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return stringCompare(String(a), String(b));
}

export function buildRowComparator<TRow>(
  sortModel: DataGridSortModel,
  columns: readonly DataGridColumnDef<TRow>[],
): ((a: TRow, b: TRow) => number) | null {
  if (sortModel.length === 0) return null;

  const colMap = new Map(columns.map((c) => [c.id, c]));

  return (a, b) => {
    for (const { columnId, direction } of sortModel) {
      const col = colMap.get(columnId);
      if (!col) continue;

      const va = resolveColumnValue(col, a);
      const vb = resolveColumnValue(col, b);
      const cmp = col.sortComparator
        ? col.sortComparator(va, vb)
        : defaultComparator(va, vb);
      if (cmp !== 0) return direction === "asc" ? cmp : -cmp;
    }
    return 0;
  };
}

// ─── Pagination helpers ──────────────────────────────────────────────

export function paginateRows<TRow>(
  rows: readonly TRow[],
  pagination: DataGridPaginationModel,
): TRow[] {
  const start = pagination.pageIndex * pagination.pageSize;
  return rows.slice(start, start + pagination.pageSize) as TRow[];
}

export function getTotalPages(
  totalRows: number,
  pageSize: number,
): number {
  return Math.max(1, Math.ceil(totalRows / pageSize));
}

// ─── Selection helpers ───────────────────────────────────────────────

export function toggleRowSelection(
  selection: DataGridSelectionModel,
  rowId: string,
  mode: "single" | "multiple",
  shiftKey: boolean,
  ctrlKey: boolean,
  allRowIds: readonly string[],
): DataGridSelectionModel {
  if (mode === "single") {
    const isSelected = selection.selectedIds.has(rowId);
    return {
      selectedIds: isSelected ? new Set() : new Set([rowId]),
      anchorId: isSelected ? null : rowId,
    };
  }

  // Multiple mode
  if (shiftKey && selection.anchorId != null) {
    const anchorIdx = allRowIds.indexOf(selection.anchorId);
    const currentIdx = allRowIds.indexOf(rowId);
    if (anchorIdx >= 0 && currentIdx >= 0) {
      const start = Math.min(anchorIdx, currentIdx);
      const end = Math.max(anchorIdx, currentIdx);
      const rangeIds = allRowIds.slice(start, end + 1);

      const next = ctrlKey ? new Set(selection.selectedIds) : new Set<string>();
      for (const id of rangeIds) next.add(id);

      return { selectedIds: next, anchorId: selection.anchorId };
    }
  }

  if (ctrlKey) {
    // Toggle single in multi mode
    const next = new Set(selection.selectedIds);
    if (next.has(rowId)) {
      next.delete(rowId);
    } else {
      next.add(rowId);
    }
    return { selectedIds: next, anchorId: rowId };
  }

  // Plain click in multi mode — select only this row
  return {
    selectedIds: new Set([rowId]),
    anchorId: rowId,
  };
}

export function selectAll(
  allRowIds: readonly string[],
): DataGridSelectionModel {
  return {
    selectedIds: new Set(allRowIds),
    anchorId: null,
  };
}

export function clearSelection(): DataGridSelectionModel {
  return EMPTY_SELECTION;
}

// ─── Quick search ────────────────────────────────────────────────────

/** Default row matcher used by `applyQuickSearch`. Case-insensitive
 * substring match across every column's resolved cell value. Columns
 * with `null` / `undefined` values are skipped. The query is expected
 * to be pre-trimmed and lowercased by `applyQuickSearch` — this helper
 * does NOT trim or lowercase it again, so if you wire it up yourself,
 * do that first. */
export function defaultMatchRow<TRow>(
  row: TRow,
  query: string,
  columns: readonly DataGridColumnDef<TRow>[],
): boolean {
  for (const col of columns) {
    const v = resolveColumnValue(col, row);
    if (v == null) continue;
    if (String(v).toLowerCase().includes(query)) return true;
  }
  return false;
}

/** Client-side quick-search filter. Returns the original array
 * reference when `query` is empty, so calling this in a hot `useMemo`
 * is cheap in the common "no search" case.
 *
 * Used by `useDataSource` in client mode. Exported so consumers driving
 * the grid manually (or doing their own pre-filtering before feeding
 * rows to an async data source) can stay consistent with the built-in
 * search behaviour.
 *
 * Override `matchRow` for custom matching logic — e.g. fuzzy matching,
 * field-specific weighting, or skipping some columns. */
export function applyQuickSearch<TRow>(
  rows: readonly TRow[],
  query: string,
  columns: readonly DataGridColumnDef<TRow>[],
  matchRow: (
    row: TRow,
    query: string,
    columns: readonly DataGridColumnDef<TRow>[],
  ) => boolean = defaultMatchRow,
): readonly TRow[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return rows;
  return rows.filter((r) => matchRow(r, trimmed, columns));
}

// ─── Date helpers ────────────────────────────────────────────────────

/** Parse a raw cell value into a `Date`. Returns `null` for nullish,
 * unparseable, or invalid dates. Accepts strings (including ISO and
 * "YYYY-MM-DD HH:MM:SS"-style ClickHouse output), numbers (ms since
 * epoch), and `Date` instances. For truly weird formats, override via
 * `col.parseValue`. */
export function defaultParseDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

// Memoized per-locale formatter. `Intl.RelativeTimeFormat` construction
// shows up as a real cost in flamegraphs for grids with many date cells,
// so cache one instance per locale ("undefined" = default).
const relativeTimeFormatterCache = new Map<string, Intl.RelativeTimeFormat>();
function getRelativeTimeFormatter(locale?: string): Intl.RelativeTimeFormat {
  const key = locale ?? "__default__";
  let cached = relativeTimeFormatterCache.get(key);
  if (cached == null) {
    cached = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeTimeFormatterCache.set(key, cached);
  }
  return cached;
}

/** Default relative formatter — "1 day ago" / "in 2 hours" via
 * `Intl.RelativeTimeFormat`. Pure function of the date; does NOT
 * re-render as real time passes. */
export function defaultFormatRelative(date: Date): string {
  const rtf = getRelativeTimeFormatter();
  let duration = (date.getTime() - Date.now()) / 1000;
  for (const div of DIVISIONS) {
    if (Math.abs(duration) < div.amount) {
      return rtf.format(Math.round(duration), div.unit);
    }
    duration /= div.amount;
  }
  return rtf.format(Math.round(duration), "year");
}

/** Default absolute formatter — full locale date + time. */
export function defaultFormatAbsolute(date: Date): string {
  return date.toLocaleString();
}

/** Format a raw cell value for display in a `date` / `dateTime` column.
 * Returns both the inline display string and the tooltip string (which
 * is always the absolute form so users can read the exact datetime).
 *
 * Used internally by the grid's default date cell renderer, and exported
 * so consumers writing a custom `renderCell` for a date column can stay
 * visually consistent with the built-in behaviour.
 *
 * ```tsx
 * renderCell: ({ value, dateDisplay }) => {
 *   const { display, tooltip } = formatGridDate(value, dateDisplay);
 *   if (!display) return <span className="text-muted-foreground/40">—</span>;
 *   return <span title={tooltip ?? undefined}>{display}</span>;
 * }
 * ``` */
export function formatGridDate(
  value: unknown,
  mode: DataGridDateDisplay,
  opts?: {
    parseValue?: (value: unknown) => Date | null;
    dateFormat?: DataGridDateFormat;
  },
): { display: string | null; tooltip: string | null } {
  const parse = opts?.parseValue ?? defaultParseDate;
  const date = parse(value);
  if (!date) return { display: null, tooltip: null };

  const relative = opts?.dateFormat?.relative ?? defaultFormatRelative;
  const absolute = opts?.dateFormat?.absolute ?? defaultFormatAbsolute;

  const tooltip = absolute(date);
  const display = mode === "relative" ? relative(date) : tooltip;
  return { display, tooltip };
}

// ─── CSV Export ──────────────────────────────────────────────────────

export function exportToCsv<TRow>(
  rows: readonly TRow[],
  columns: readonly DataGridColumnDef<TRow>[],
  filename: string,
): void {
  const header = columns.map((col) =>
    typeof col.header === "string" ? col.header : col.id,
  );

  const csvRows = rows.map((row) =>
    columns.map((col) => {
      const val = resolveColumnValue(col, row);
      // Coerce through `?? ""` so a `formatValue` that returns undefined/null
      // (easy to do from a ternary) doesn't crash `.includes` below.
      // The type says `formatValue` returns string, but a consumer can
      // easily return undefined/null from a ternary. Guard at runtime.
      const formatted = col.formatValue
        ? String((col.formatValue(val, row) as string | null | undefined) ?? "")
        : String(val ?? "");
      // Escape CSV special characters
      if (formatted.includes(",") || formatted.includes('"') || formatted.includes("\n")) {
        return `"${formatted.replace(/"/g, '""')}"`;
      }
      return formatted;
    }),
  );

  // Prepend a UTF-8 BOM so Excel (Windows) opens the CSV as UTF-8 instead of
  // falling back to latin-1 and mangling every display name with a non-ascii
  // character.
  const csvContent = "\ufeff" + [
    header.join(","),
    ...csvRows.map((row) => row.join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  // Safari / older Firefox need the link in the DOM to honour `.click()`.
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}
