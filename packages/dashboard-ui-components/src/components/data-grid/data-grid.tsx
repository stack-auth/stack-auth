"use client";

import {
  ArrowDown,
  ArrowUp,
  CaretDown,
  CaretUp,
  CheckSquare,
  MinusSquare,
  Square,
} from "@phosphor-icons/react";
import { cn } from "@stackframe/stack-ui";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import { DesignSkeleton } from "../skeleton";
import {
  applyDraggedColumnWidth,
  clampColumnWidth,
  createGridSizingStyle,
  getColumnSizingStyle,
} from "./data-grid-sizing";
import { DataGridToolbar } from "./data-grid-toolbar";
import {
  clearSelection,
  exportToCsv,
  formatGridDate,
  getSortDirection,
  getSortIndex,
  isColumnVisible,
  resolveColumnValue,
  resolveColumnWidth,
  selectAll,
  toggleRowSelection,
  toggleSort,
} from "./state";
import { resolveDataGridStrings } from "./strings";
import type {
  DataGridCellContext,
  DataGridColumnDef,
  DataGridDateDisplay,
  DataGridFooterContext,
  DataGridHeaderContext,
  DataGridPaginationMode,
  DataGridProps,
  DataGridState,
  DataGridStrings,
  DataGridToolbarContext,
  RowId
} from "./types";
// ─── Resize handle ───────────────────────────────────────────────────

function ResizeHandle({
  onResize,
  onResizeEnd,
}: {
  onResize: (delta: number) => void;
  onResizeEnd: () => void;
}) {
  const startXRef = useRef(0);
  const rafRef = useRef(0);
  const latestDeltaRef = useRef(0);
  const callbacksRef = useRef({ onResize, onResizeEnd });

  callbacksRef.current = { onResize, onResizeEnd };

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startXRef.current = e.clientX;
      latestDeltaRef.current = 0;
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      let finished = false;

      const onMove = (ev: PointerEvent) => {
        latestDeltaRef.current = ev.clientX - startXRef.current;
        if (rafRef.current !== 0) {
          return;
        }

        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          callbacksRef.current.onResize(latestDeltaRef.current);
        });
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        if (rafRef.current !== 0) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
          callbacksRef.current.onResize(latestDeltaRef.current);
        }
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", finish);
        el.removeEventListener("pointercancel", finish);
        el.removeEventListener("lostpointercapture", finish);
        if (el.hasPointerCapture(e.pointerId)) {
          el.releasePointerCapture(e.pointerId);
        }
        callbacksRef.current.onResizeEnd();
      };

      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", finish);
      el.addEventListener("pointercancel", finish);
      el.addEventListener("lostpointercapture", finish);
    },
    [],
  );

  return (
    <div
      className={cn(
        "absolute right-0 top-0 bottom-0 z-10 w-[5px] cursor-col-resize touch-none",
        "group-hover/header:bg-foreground/[0.06] hover:!bg-blue-500/30",
        "transition-colors duration-100",
      )}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={onPointerDown}
    />
  );
}

function getNearestVerticalScrollElement(element: HTMLElement | null): HTMLElement | Window {
  let current = element?.parentElement ?? null;

  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY === "visible" ? style.overflow : style.overflowY;
    const canScrollVertically =
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      current.scrollHeight > current.clientHeight + 1;

    if (canScrollVertically) {
      return current;
    }

    current = current.parentElement;
  }

  return window;
}

// ─── Header cell ─────────────────────────────────────────────────────

function HeaderCell<TRow>({
  col,
  isSorted,
  sortIndex,
  resizable,
  onSort,
  onResize,
  onResizeEnd,
}: {
  col: DataGridColumnDef<TRow>;
  isSorted: false | "asc" | "desc";
  sortIndex: number | null;
  resizable: boolean;
  onSort: (columnId: string, multi: boolean) => void;
  onResize: (columnId: string, delta: number) => void;
  onResizeEnd: () => void;
}) {
  const ctx: DataGridHeaderContext<TRow> = {
    columnId: col.id,
    columnDef: col,
    isSorted,
    sortIndex,
  };
  const label =
    typeof col.header === "function" ? col.header(ctx) : col.header;

  const sortable = col.sortable !== false;

  return (
    <div
      className={cn(
        "group/header relative flex items-center gap-1.5 px-3 select-none bg-transparent overflow-hidden",
        "border-r border-black/[0.04] dark:border-white/[0.04] last:border-r-0",
        sortable && "cursor-pointer",
      )}
      style={getColumnSizingStyle(col)}
      data-col-id={col.id}
      onClick={(e) => sortable && onSort(col.id, e.metaKey || e.ctrlKey)}
      role="columnheader"
      aria-sort={isSorted === "asc" ? "ascending" : isSorted === "desc" ? "descending" : "none"}
    >
      <span
        className={cn(
          "flex-1 min-w-0 truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground",
          col.align === "center" && "text-center",
          col.align === "right" && "text-right",
        )}
      >
        {label}
      </span>

      {/* Sort indicator */}
      {isSorted && (
        <span className="flex items-center gap-0.5 text-foreground/60">
          {isSorted === "asc" ? (
            <ArrowUp className="h-3 w-3" weight="bold" />
          ) : (
            <ArrowDown className="h-3 w-3" weight="bold" />
          )}
          {sortIndex != null && (
            <span className="text-[10px] font-medium tabular-nums">{sortIndex}</span>
          )}
        </span>
      )}

      {/* Unsorted hint on hover */}
      {!isSorted && sortable && (
        <span className="hidden group-hover/header:flex items-center text-foreground/20">
          <CaretUp className="h-2.5 w-2.5 -mb-[1px]" weight="bold" />
          <CaretDown className="h-2.5 w-2.5 -mt-[1px]" weight="bold" />
        </span>
      )}

      {/* Resize handle */}
      {resizable && col.resizable !== false && (
        <ResizeHandle
          onResize={(delta) => onResize(col.id, delta)}
          onResizeEnd={onResizeEnd}
        />
      )}
    </div>
  );
}

// ─── Data cell ───────────────────────────────────────────────────────

function DataCell<TRow>({
  col,
  row,
  rowId,
  rowIndex,
  isSelected,
  dateDisplay,
}: {
  col: DataGridColumnDef<TRow>;
  row: TRow;
  rowId: RowId;
  rowIndex: number;
  isSelected: boolean;
  dateDisplay: DataGridDateDisplay;
}) {
  const value = resolveColumnValue(col, row);
  const ctx: DataGridCellContext<TRow> = {
    row,
    rowId,
    rowIndex,
    value,
    columnId: col.id,
    isSelected,
    dateDisplay,
  };

  const isDateCol = col.type === "date" || col.type === "dateTime";
  let content: React.ReactNode;
  if (col.renderCell) {
    content = col.renderCell(ctx);
  } else if (isDateCol) {
    content = renderDateCell(value, dateDisplay, col);
  } else {
    content = formatCellValue(value);
  }
  const hasCellClick = col.onCellClick || col.onCellDoubleClick;

  const isWrap = col.cellOverflow === "wrap";

  return (
    <div
      className={cn(
        "flex px-3 bg-transparent overflow-hidden",
        "border-r border-black/[0.04] dark:border-white/[0.04] last:border-r-0",
        "text-sm text-foreground",
        isWrap ? "items-start py-2" : "items-center",
        col.align === "center" && "justify-center",
        col.align === "right" && "justify-end",
        hasCellClick && "cursor-pointer",
      )}
      style={getColumnSizingStyle(col)}
      data-col-id={col.id}
      role="gridcell"
      onClick={col.onCellClick ? (e) => {
        e.stopPropagation();
        col.onCellClick!(ctx, e);
      } : undefined}
      onDoubleClick={col.onCellDoubleClick ? (e) => {
        e.stopPropagation();
        col.onCellDoubleClick!(ctx, e);
      } : undefined}
    >
      <div className={cn("min-w-0", isWrap ? "flex-1" : "truncate")}>
        {content}
      </div>
    </div>
  );
}

function formatCellValue(value: unknown): React.ReactNode {
  if (value == null) return <span className="text-muted-foreground/40">-</span>;
  if (typeof value === "boolean") {
    return (
      <span
        className={cn(
          "inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-medium",
          value
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "bg-foreground/[0.04] text-muted-foreground",
        )}
      >
        {value ? "Yes" : "No"}
      </span>
    );
  }
  if (value instanceof Date) {
    return (
      <span className="tabular-nums text-muted-foreground">
        {value.toLocaleDateString()}
      </span>
    );
  }
  return <span className="truncate">{String(value)}</span>;
}

/** Built-in date cell — mirrors what `formatGridDate` returns but wraps
 * the display in a `<span>` with a `title` tooltip showing the absolute
 * datetime. Only used when the column has `type: "date" | "dateTime"`
 * and no custom `renderCell`. */
function renderDateCell<TRow>(
  value: unknown,
  dateDisplay: DataGridDateDisplay,
  col: DataGridColumnDef<TRow>,
): React.ReactNode {
  const { display, tooltip } = formatGridDate(value, dateDisplay, {
    parseValue: col.parseValue,
    dateFormat: col.dateFormat,
  });
  if (display == null) return <span className="text-muted-foreground/40">-</span>;
  return (
    <span
      className="tabular-nums text-muted-foreground truncate cursor-help"
      title={tooltip ?? undefined}
    >
      {display}
    </span>
  );
}

// ─── Skeleton row ────────────────────────────────────────────────────

function hashStringToInt(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function SkeletonRow({
  columns,
  height,
  showCheckbox,
}: {
  columns: readonly DataGridColumnDef<any>[];
  height: number;
  showCheckbox?: boolean;
}) {
  return (
    <div className="flex" style={{ height }} role="row">
      {showCheckbox && (
        <div
          className="flex items-center justify-center border-r border-black/[0.04] dark:border-white/[0.04]"
          style={{ width: 44 }}
        >
          <DesignSkeleton className="h-4 w-4 rounded" />
        </div>
      )}
      {columns.map((col) => (
        <div
          key={col.id}
          className="flex items-center px-3 border-r border-black/[0.04] dark:border-white/[0.04] last:border-r-0"
          style={getColumnSizingStyle(col)}
        >
          <DesignSkeleton
            className="h-3.5 rounded-md"
            style={{ width: `${40 + (hashStringToInt(col.id) % 40)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Checkbox cell ───────────────────────────────────────────────────

function SelectionCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (event: React.MouseEvent<HTMLButtonElement>) => void;
  ariaLabel: string;
}) {
  const Icon = indeterminate ? MinusSquare : checked ? CheckSquare : Square;
  return (
    <button
      className={cn(
        "flex items-center justify-center w-full h-full",
        "hover:bg-foreground/[0.04] transition-colors duration-75",
        checked || indeterminate
          ? "text-blue-600 dark:text-blue-400"
          : "text-muted-foreground/40 hover:text-muted-foreground/60",
      )}
      onClick={(e) => {
        e.stopPropagation();
        onChange(e);
      }}
      aria-label={ariaLabel}
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
    >
      <Icon className="h-4 w-4" weight={checked || indeterminate ? "fill" : "regular"} />
    </button>
  );
}

// ─── Infinite scroll sentinel ────────────────────────────────────────

function InfiniteScrollSentinel({
  onIntersect,
  isLoading,
  strings,
}: {
  onIntersect: () => void;
  isLoading: boolean;
  strings: DataGridStrings;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onIntersect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onIntersect]);

  return (
    <div ref={ref} className="flex items-center justify-center py-4">
      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
          {strings.loadingMore}
        </div>
      )}
    </div>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────

function DefaultFooter<TRow>({
  ctx,
  pagination,
  onChange,
}: {
  ctx: DataGridFooterContext<TRow>;
  pagination: DataGridPaginationMode;
  onChange: React.Dispatch<React.SetStateAction<DataGridState>>;
}) {
  const { state, totalRowCount, visibleRowCount, selectedRowCount, strings } = ctx;
  const totalPages = totalRowCount != null
    ? Math.max(1, Math.ceil(totalRowCount / state.pagination.pageSize))
    : undefined;

  const setPage = (pageIndex: number) =>
    onChange((s) => ({
      ...s,
      pagination: { ...s.pagination, pageIndex },
    }));

  const setPageSize = (pageSize: number) =>
    onChange((s) => ({
      ...s,
      pagination: { ...s.pagination, pageSize, pageIndex: 0 },
    }));

  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-foreground/[0.06] text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        {selectedRowCount > 0 && (
          <span className="font-medium text-foreground">
            {strings.rowsSelected(selectedRowCount)}
          </span>
        )}
        {totalRowCount != null && (
          <span>
            {visibleRowCount} of {totalRowCount} rows
          </span>
        )}
      </div>

      {pagination !== "infinite" && totalPages != null && (
        <div className="flex items-center gap-3">
          {/* Page size selector */}
          <div className="flex items-center gap-1.5">
            <span>{strings.rowsPerPage}</span>
            <select
              className={cn(
                "h-7 rounded-lg border border-black/[0.08] dark:border-white/[0.08] bg-background px-1.5",
                "text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/[0.1]",
                "cursor-pointer",
              )}
              value={state.pagination.pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          {/* Page navigation */}
          <div className="flex items-center gap-1">
            <button
              className={cn(
                "h-7 w-7 flex items-center justify-center rounded-lg",
                "hover:bg-foreground/[0.04] disabled:opacity-30 disabled:cursor-not-allowed",
                "transition-colors duration-75",
              )}
              onClick={() => setPage(state.pagination.pageIndex - 1)}
              disabled={state.pagination.pageIndex === 0}
              aria-label="Previous page"
            >
              <CaretUp className="h-3.5 w-3.5 -rotate-90" weight="bold" />
            </button>
            <span className="px-2 tabular-nums font-medium">
              {strings.pageOf(state.pagination.pageIndex + 1, totalPages)}
            </span>
            <button
              className={cn(
                "h-7 w-7 flex items-center justify-center rounded-lg",
                "hover:bg-foreground/[0.04] disabled:opacity-30 disabled:cursor-not-allowed",
                "transition-colors duration-75",
              )}
              onClick={() => setPage(state.pagination.pageIndex + 1)}
              disabled={state.pagination.pageIndex >= totalPages - 1}
              aria-label="Next page"
            >
              <CaretDown className="h-3.5 w-3.5 -rotate-90" weight="bold" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main DataGrid ───────────────────────────────────────────────────

/**
 * Interactive table with sorting, quick search, pagination, selection,
 * and virtualization. Handles 10k+ rows smoothly. Pair with
 * `useDataSource` for client-side data; use an async `dataSource`
 * generator for server or infinite-scroll modes.
 *
 * ## Mental model (read this first — everything else depends on it)
 *
 * DataGrid is a **display** component. It does NOT sort, search, or
 * paginate your data directly — you own that, but `useDataSource` does
 * it for you. The `rows` prop is always the already-processed slice to
 * show. The grid tracks user intent in `state` (sort model, quick
 * search text, page index). You feed that state into `useDataSource`,
 * and its output goes back in as `rows`.
 *
 * `useDataSource` IS the processor. Given your full dataset and the
 * grid's state, it returns the searched + sorted + paginated rows
 * ready to pass to DataGrid. This is the ONLY correct pattern for
 * client-side data — do NOT pass a raw array to `rows`.
 *
 * ## Search (client vs async)
 *
 * - **Client mode** (`useDataSource` with `data`): a case-insensitive
 *   substring match across every column is applied automatically.
 *   Override the matcher with `matchRow` for fuzzy / weighted search,
 *   or disable by passing `matchRow: () => true`.
 * - **Async mode** (`useDataSource` with `dataSource`): `state.quickSearch`
 *   is forwarded to the generator as `params.quickSearch`. Same
 *   mechanism as `params.sorting` — a change triggers a refetch, and
 *   the generator is the "matching logic" (typically a WHERE / ILIKE
 *   clause in the backend query). The grid does NO client-side
 *   filtering in async mode.
 *
 * ## The canonical pattern
 *
 * ```tsx
 * // 1. Columns — define OUTSIDE the component or inside a useMemo. Must be stable.
 * const columns = React.useMemo(() => [
 *   { id: "name", header: "Name", accessor: "name", width: 180, type: "string" },
 *   { id: "email", header: "Email", accessor: "email", width: 240, type: "string" },
 *   { id: "role", header: "Role", accessor: "role", width: 120, type: "singleSelect",
 *     valueOptions: [{ value: "admin", label: "Admin" }, { value: "member", label: "Member" }] },
 *   { id: "signUps", header: "Sign-ups", accessor: "signUps", width: 120, type: "number", align: "right",
 *     renderCell: ({ value }) => <span className="tabular-nums">{Number(value).toLocaleString()}</span> },
 * ], []);
 *
 * // 2. Grid state — one hook, initialized from the columns. NEVER build the state object by hand.
 * const [gridState, setGridState] = React.useState(() => createDefaultDataGridState(columns));
 *
 * // 3. Data source — wires your raw array through the grid state. ALWAYS call this
 * //    hook unconditionally at the top level (no if/return before it).
 * const gridData = useDataSource({
 *   data: users,                   // your raw array (can be [] while loading)
 *   columns,
 *   getRowId: (row) => row.id,
 *   sorting: gridState.sorting,
 *   quickSearch: gridState.quickSearch,
 *   pagination: gridState.pagination,
 *   paginationMode: "client",       // "client" | "server" | "infinite"
 * });
 *
 * // 4. Render — `rows` comes from gridData.rows, NOT from your raw array.
 * <DataGrid
 *   columns={columns}
 *   rows={gridData.rows}
 *   getRowId={(row) => row.id}
 *   totalRowCount={gridData.totalRowCount}
 *   isLoading={gridData.isLoading}
 *   state={gridState}
 *   onChange={setGridState}
 *   selectionMode="none"            // "none" | "single" | "multiple"
 *   maxHeight={480}
 * />
 * ```
 *
 * ## Iron rules (violating any of these breaks the grid)
 *
 * 1. The prop is `rows`, NOT `data`. There is no `data` prop on DataGrid.
 *    `data` belongs on `useDataSource`.
 * 2. `rows` is ALWAYS `gridData.rows`. Never pass your raw array to
 *    `rows` — the grid won't search, sort, or paginate it.
 * 3. Columns must be stable across renders. Define them outside the
 *    component or wrap in `React.useMemo`. A fresh columns array every
 *    render will reset sorting state.
 * 4. Initialize grid state with `createDefaultDataGridState(columns)`.
 *    Do NOT spell out the state object manually — you will miss fields
 *    and crash.
 * 5. `onChange` takes a `SetStateAction` (the setter you got from
 *    `useState`). Pass `setGridState` directly. Do NOT wrap it unless
 *    you know exactly what you're doing.
 * 6. Call `useDataSource` ONCE per grid, at the top level, before any
 *    early return. It contains hooks.
 * 7. `renderCell` is a PURE function of its context. NEVER call React
 *    hooks inside it (no `useState`, `useMemo`, `useEffect`, nothing).
 *    If you need derived data per row, compute it BEFORE the render —
 *    e.g. build a `Map<rowId, sparklineData>` in a `useMemo` and look
 *    it up in `renderCell`.
 * 8. `toolbar` accepts `false` (hide it) or a render function
 *    `(ctx) => ReactNode`. Anything else — `true`, `undefined`, a state
 *    variable — will either show the default toolbar or crash. If you
 *    just want the default toolbar, omit the prop entirely.
 * 9. The toolbar's search input writes to `state.quickSearch`. That
 *    value is consumed by `useDataSource` — client mode filters
 *    client-side, async mode forwards to the generator. Do NOT wire
 *    a separate "controlled" search prop, everything flows through
 *    grid state.
 *
 * ## renderCell — what you can and cannot do inside it
 *
 * ```tsx
 * // OK — pure rendering from ctx:
 * renderCell: ({ value }) => <span className="tabular-nums">{Number(value).toLocaleString()}</span>
 * renderCell: ({ row }) => <Badge variant={row.active ? "default" : "outline"}>{row.status}</Badge>
 *
 * // OK — looking up pre-computed data by row id:
 * // BEFORE the return, in the component body:
 * const sparklinesById = React.useMemo(() => {
 *   const m = new Map();
 *   for (const u of users) {
 *     m.set(u.id, u.recentActivity.map((n, i) => ({ ts: i, values: { primary: n } })));
 *   }
 *   return m;
 * }, [users]);
 * // Then inside the column def:
 * renderCell: ({ rowId }) => <MiniSparkline data={sparklinesById.get(rowId) ?? []} />
 *
 * // NOT OK — hooks inside renderCell:
 * renderCell: ({ row }) => {
 *   const [hovered, setHovered] = React.useState(false);  // ← crashes the grid
 *   const data = React.useMemo(() => ..., []);             // ← crashes the grid
 *   return ...;
 * }
 *
 * // NOT OK — embedding AnalyticsChart (or any other controlled, stateful chart) per row:
 * // AnalyticsChart owns its own state, tooltips, zoom, and virtualized data
 * // pipeline. Instantiating one per row is expensive and fights the grid's
 * // virtualizer. Don't do it.
 * ```
 *
 * ## Sparklines and mini-charts in cells — use raw Recharts
 *
 * If you want a tiny chart (sparkline, micro bar chart, trend line) inside
 * a cell, drop down to raw `Recharts.*` components — they are lightweight
 * and stateless, so they render cleanly per row without owning any state.
 * Read pre-computed points off the row (or off a `Map<rowId, points>` you
 * built in a `useMemo` above) and pass them directly to the Recharts
 * primitive. Do NOT wrap them in `DesignChartContainer` or
 * `DesignChartCard` inside a cell — those add chrome meant for full-size
 * charts.
 *
 * ```tsx
 * // OK — raw Recharts sparkline per row:
 * renderCell: ({ rowId }) => {
 *   const points = sparklinesById.get(rowId) ?? [];
 *   return (
 *     <Recharts.ResponsiveContainer width="100%" height={28}>
 *       <Recharts.LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
 *         <Recharts.Line type="monotone" dataKey="v" stroke="currentColor" strokeWidth={1.5} dot={false} isAnimationActive={false} />
 *       </Recharts.LineChart>
 *     </Recharts.ResponsiveContainer>
 *   );
 * }
 * ```
 *
 * Keep in-cell Recharts configs minimal: no axes, no tooltips, no animation
 * (`isAnimationActive={false}`), tight margins, fixed height. The goal is a
 * visual summary, not an interactive chart.
 *
 * ## State shape (from `createDefaultDataGridState`)
 *
 * ```ts
 * {
 *   sorting: [],                                        // { columnId, direction: "asc" | "desc" }[]
 *   quickSearch: "",                                    // search input text
 *   dateDisplay: "relative",                            // "relative" | "absolute"
 *   columnVisibility: {}, columnWidths: {...},
 *   columnPinning: { left: [], right: [] }, columnOrder: [...],
 *   pagination: { pageIndex: 0, pageSize: 50 },
 *   selection: { selectedIds: new Set(), anchorId: null },
 * }
 * ```
 *
 * Everything is updated through `setGridState` — the toolbar, header,
 * and footer all call it for you. You do not need to wire any of this
 * manually.
 *
 * ## Cell overflow and dynamic row heights
 *
 * By default every cell truncates its content with an ellipsis
 * (`cellOverflow: "truncate"`). For columns whose content should wrap
 * — badge lists, multi-line text, permission chips — set
 * `cellOverflow: "wrap"` on the column definition.
 *
 * To let rows grow to fit their tallest cell, set `rowHeight="auto"`
 * on the grid. The virtualizer will measure each row after render and
 * adjust scroll positions accordingly. Pair with `estimatedRowHeight`
 * (default 44) for better scroll-position estimates before measurement.
 *
 * ```tsx
 * // Columns: UUIDs truncate, auth-method badges wrap
 * const columns = [
 *   { id: "userId", header: "User ID", width: 130 },                      // default truncate
 *   { id: "auth", header: "Auth methods", width: 150, cellOverflow: "wrap",
 *     renderCell: ({ row }) => (
 *       <div className="flex flex-wrap gap-1">
 *         {row.authTypes.map((t) => <Badge key={t}>{t}</Badge>)}
 *       </div>
 *     ),
 *   },
 * ];
 *
 * <DataGrid columns={columns} rowHeight="auto" estimatedRowHeight={48} ... />
 * ```
 *
 * With a fixed numeric `rowHeight` (the default), `cellOverflow: "wrap"`
 * still lets content wrap within the row, but anything exceeding the
 * fixed height is clipped. This is useful when you want controlled
 * wrapping without variable row heights.
 *
 * ## Height and scrolling
 *
 * DataGrid is NOT a card. It has no border, rounded corners, or shadow of
 * its own. Wrap it in whatever chrome you want — a `DesignCard`, a section,
 * or just raw layout. The grid itself fills its parent's height via
 * `h-full`.
 *
 * How the grid gets its height (pick ONE):
 * 1. Bounded parent — put the grid inside a flex/grid container with a
 *    definite height (e.g. `flex-1 min-h-0` inside a page-filling flex
 *    column). The grid stretches to that height and scrolls its body.
 * 2. `maxHeight` prop — pass a number (pixels) or CSS string
 *    (`"480px"`, `"60vh"`, `"100%"`). The grid caps at that size and
 *    scrolls its body.
 * 3. Unbounded — omit `maxHeight` and let the parent grow freely. The
 *    grid renders at its full content height and the page scrolls. Fine
 *    for small lists; bad UX for thousands of rows.
 *
 * The toolbar, header, and footer are always `shrink-0`; only the body
 * scrolls. You do NOT need to subtract toolbar/footer heights from
 * `maxHeight` — the grid's internal flex layout handles that.
 *
 * ## When to use what
 *
 * - Simple static list, < 20 rows, no interaction → use a plain table component instead.
 * - Interactive table, sortable + searchable, any size → `DataGrid` +
 *   `useDataSource` with `paginationMode: "client"`.
 * - Infinite scroll over a huge dataset you fetch in pages → `dataSource` async
 *   generator + `paginationMode: "infinite"`. Only reach for this if you actually
 *   need pagination over a remote source. For anything that fits in memory,
 *   `"client"` is simpler and faster.
 *
 * ## Features you get for free
 *
 * Quick search, sortable columns (shift-click for multi-sort), column
 * visibility toggle, column resize, CSV export, virtualized rendering
 * for 10k+ rows, keyboard navigation, and a relative/absolute date
 * toggle for `date` / `dateTime` columns.
 */
export function DataGrid<TRow>(props: DataGridProps<TRow>) {
  const {
    columns: allColumns,
    rows,
    getRowId,
    totalRowCount,
    isLoading = false,
    isRefetching = false,
    hasMore = false,
    isLoadingMore = false,
    onLoadMore,
    state,
    onChange,
    paginationMode = "paginated",
    selectionMode = "none",
    resizable = true,
    rowHeight: rowHeightProp = 44,
    estimatedRowHeight: estimatedRowHeightProp,
    headerHeight = 44,
    overscan = 5,
    maxHeight,
    fillHeight = true,
    stickyTop,
    toolbar,
    toolbarExtra,
    emptyState,
    loadingState,
    footer,
    footerExtra,
    exportFilename = "export",
    strings: stringsOverride,
    className,
    // Callbacks
    onRowClick,
    onRowDoubleClick,
    onSelectionChange,
    onSortChange,
  } = props;

  const isDynamicRowHeight = rowHeightProp === "auto";
  const fixedRowHeight = isDynamicRowHeight ? undefined : rowHeightProp;
  const estimatedRowHeight = estimatedRowHeightProp ?? (fixedRowHeight ?? 44);

  const strings = useMemo(
    () => resolveDataGridStrings(stringsOverride),
    [stringsOverride],
  );

  // ── Visible columns ──────────────────────────────────────────
  const visibleColumns = useMemo(
    () =>
      (state.columnOrder.length > 0
        ? state.columnOrder
          .map((id) => allColumns.find((c) => c.id === id))
          .filter(Boolean) as DataGridColumnDef<TRow>[]
        : allColumns
      ).filter((col) => isColumnVisible(col.id, state.columnVisibility)),
    [allColumns, state.columnOrder, state.columnVisibility],
  );

  // ── Row IDs (stable) ─────────────────────────────────────────
  const rowIds = useMemo(() => rows.map(getRowId), [rows, getRowId]);

  // ── Column widths ────────────────────────────────────────────
  const visibleColumnMetrics = useMemo(() => {
    const widths = new Map<string, number>();
    let totalWidth = selectionMode !== "none" ? 44 : 0;

    for (const col of visibleColumns) {
      const width = resolveColumnWidth(col, state.columnWidths[col.id]);
      widths.set(col.id, width);
      totalWidth += width;
    }

    return { widths, totalWidth };
  }, [selectionMode, state.columnWidths, visibleColumns]);

  const gridSizingStyle = useMemo(
    () => createGridSizingStyle(visibleColumnMetrics.widths, visibleColumnMetrics.totalWidth),
    [visibleColumnMetrics],
  );

  // Resize drag tracked via ref — zero React re-renders during drag.
  // CSS variables on gridRef are mutated directly; committed on pointer up.
  const resizeRef = useRef<{ columnId: string; baseWidth: number; baseTotalWidth: number; latestWidth: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // ── Handlers ─────────────────────────────────────────────────
  const handleSort = useCallback(
    (columnId: string, multi: boolean) => {
      onChange((s) => {
        const next = toggleSort(s.sorting, columnId, multi);
        onSortChange?.(next);
        return { ...s, sorting: next };
      });
    },
    [onChange, onSortChange],
  );

  const handleResize = useCallback(
    (columnId: string, delta: number) => {
      const col = allColumns.find((c) => c.id === columnId);
      if (!col) return;
      if (!resizeRef.current || resizeRef.current.columnId !== columnId) {
        const baseWidth = visibleColumnMetrics.widths.get(columnId) ?? resolveColumnWidth(col, state.columnWidths[columnId]);
        resizeRef.current = { columnId, baseWidth, baseTotalWidth: visibleColumnMetrics.totalWidth, latestWidth: baseWidth };
      }
      const newWidth = clampColumnWidth(col, resizeRef.current.baseWidth + delta);
      resizeRef.current.latestWidth = newWidth;
      if (gridRef.current) {
        applyDraggedColumnWidth(gridRef.current, columnId, newWidth, resizeRef.current.baseTotalWidth + (newWidth - resizeRef.current.baseWidth));
      }
    },
    [allColumns, state.columnWidths, visibleColumnMetrics],
  );

  // Re-apply CSS vars after React re-renders (e.g. sort during drag)
  useLayoutEffect(() => {
    const r = resizeRef.current;
    if (r && gridRef.current) {
      applyDraggedColumnWidth(gridRef.current, r.columnId, r.latestWidth, r.baseTotalWidth + (r.latestWidth - r.baseWidth));
    }
  }, [gridSizingStyle]);

  const handleResizeEnd = useCallback(() => {
    const r = resizeRef.current;
    resizeRef.current = null;
    if (!r || r.latestWidth === r.baseWidth) return;
    onChange((s) => ({ ...s, columnWidths: { ...s.columnWidths, [r.columnId]: r.latestWidth } }));
  }, [onChange]);

  const handleRowClick = useCallback(
    (row: TRow, rowId: RowId, event: React.MouseEvent) => {
      // Selection
      if (selectionMode !== "none") {
        onChange((s) => {
          const next = toggleRowSelection(
            s.selection,
            rowId,
            selectionMode,
            event.shiftKey,
            event.metaKey || event.ctrlKey,
            rowIds,
          );
          // Fire callback after state update
          if (onSelectionChange) {
            const selectedRows = rows.filter((r) =>
              next.selectedIds.has(getRowId(r)),
            );
            setTimeout(() => onSelectionChange(next.selectedIds, selectedRows), 0);
          }
          return { ...s, selection: next };
        });
      }

      onRowClick?.(row, rowId, event);
    },
    [selectionMode, onChange, onRowClick, onSelectionChange, rowIds, rows, getRowId],
  );

  const handleRowSelectionCheckboxClick = useCallback(
    (
      row: TRow,
      rowId: RowId,
      event: React.MouseEvent<HTMLButtonElement>,
    ) => {
      handleRowClick(row, rowId, event);
    },
    [handleRowClick],
  );

  const handleSelectAll = useCallback(() => {
    onChange((s) => {
      const allSelected = rowIds.every((id) => s.selection.selectedIds.has(id));
      const next = allSelected ? clearSelection() : selectAll(rowIds);
      if (onSelectionChange) {
        const selectedRows = allSelected
          ? []
          : rows;
        setTimeout(() => onSelectionChange(next.selectedIds, [...selectedRows]), 0);
      }
      return { ...s, selection: next };
    });
  }, [onChange, rowIds, rows, onSelectionChange]);

  const handleExportCsv = useCallback(() => {
    exportToCsv(rows, visibleColumns, exportFilename);
  }, [rows, visibleColumns, exportFilename]);

  // ── Virtualizer ──────────────────────────────────────────────
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const stickyChromeRef = useRef<HTMLDivElement>(null);
  const rowsClipRef = useRef<HTMLDivElement>(null);
  const measureElementFn = useCallback(
    (el: Element) => el.getBoundingClientRect().height,
    [],
  );
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan,
    ...(isDynamicRowHeight ? { measureElement: measureElementFn } : {}),
  });

  // Composite ancestor backgrounds into a single opaque color so the
  // sticky header fully covers rows scrolling underneath. Handles
  // semi-transparent layers like `bg-white/80` by alpha-blending the
  // full ancestor chain. Re-runs on theme changes (class on <html>).
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const stickyEl = stickyChromeRef.current;
    if (!grid || !stickyEl) return;

    const parseRgba = (raw: string): [number, number, number, number] | null => {
      const rgbaMatch = raw.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)/) as (RegExpMatchArray & { [4]?: string }) | null;
      if (!rgbaMatch) return null;
      const alphaRaw = rgbaMatch[4];
      return [
        Number(rgbaMatch[1]),
        Number(rgbaMatch[2]),
        Number(rgbaMatch[3]),
        alphaRaw === undefined ? 1 : Number(alphaRaw),
      ];
    };

    const blendOver = (
      base: [number, number, number, number],
      top: [number, number, number, number],
    ): [number, number, number, number] => {
      const [tr, tg, tb, ta] = top;
      const [br, bg, bb, ba] = base;
      const outA = ta + ba * (1 - ta);
      if (outA === 0) return [0, 0, 0, 0];
      return [
        (tr * ta + br * ba * (1 - ta)) / outA,
        (tg * ta + bg * ba * (1 - ta)) / outA,
        (tb * ta + bb * ba * (1 - ta)) / outA,
        outA,
      ];
    };

    const detect = () => {
      const layers: [number, number, number, number][] = [];
      let ancestor: HTMLElement | null = grid.parentElement;
      while (ancestor) {
        const parsed = parseRgba(getComputedStyle(ancestor).backgroundColor);
        if (parsed && parsed[3] > 0) {
          layers.push(parsed);
          if (parsed[3] >= 1) break;
        }
        ancestor = ancestor.parentElement;
      }

      if (layers.length === 0) {
        stickyEl.style.backgroundColor = "";
        return;
      }

      // Blend bottom-up (deepest ancestor is the base)
      let result: [number, number, number, number] = layers[layers.length - 1]!;
      for (let i = layers.length - 2; i >= 0; i--) {
        result = blendOver(result, layers[i]!);
      }

      const [r, g, b] = result;
      stickyEl.style.backgroundColor = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    };

    detect();

    const observer = new MutationObserver(detect);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Hide row content scrolling behind the sticky chrome by clipping the
  // rows wrapper. Computes overlap = max(0, stickyBottom - wrapperTop)
  // in viewport coords and writes `clip-path: inset(<overlap>px 0 0 0)`
  // directly to the wrapper on every scroll/resize. Direct DOM writes
  // (no React state, no rAF) keep clip in lockstep with scroll so no
  // row content flashes through the sticky band for a frame.
  useLayoutEffect(() => {
    const gridEl = gridRef.current;
    const stickyEl = stickyChromeRef.current;
    const bodyEl = scrollContainerRef.current;
    const clipEl = rowsClipRef.current;
    if (!gridEl || !stickyEl || !bodyEl || !clipEl) return;

    const verticalScrollEl = fillHeight
      ? bodyEl
      : getNearestVerticalScrollElement(gridEl);
    let extraObservedScrollEl: HTMLElement | null = null;
    if (verticalScrollEl instanceof HTMLElement && verticalScrollEl !== bodyEl) {
      extraObservedScrollEl = verticalScrollEl;
    }

    const updateClip = () => {
      const stickyRect = stickyEl.getBoundingClientRect();
      const clipRect = clipEl.getBoundingClientRect();
      const overlap = Math.max(0, stickyRect.bottom - clipRect.top);
      const clipValue = overlap > 0 ? `inset(${overlap}px 0 0 0)` : "";
      const maskValue = overlap > 0
        ? `linear-gradient(to bottom, transparent 0px, transparent ${overlap}px, black ${overlap}px, black 100%)`
        : "";
      clipEl.style.clipPath = clipValue;
      clipEl.style.setProperty("-webkit-clip-path", clipValue);
      clipEl.style.maskImage = maskValue;
      clipEl.style.setProperty("-webkit-mask-image", maskValue);
    };

    updateClip();

    bodyEl.addEventListener("scroll", updateClip);
    if (verticalScrollEl === window) {
      window.addEventListener("scroll", updateClip, true);
    } else if (extraObservedScrollEl) {
      extraObservedScrollEl.addEventListener("scroll", updateClip);
    }
    window.addEventListener("resize", updateClip);
    const ro = new ResizeObserver(updateClip);
    ro.observe(gridEl);
    ro.observe(stickyEl);
    ro.observe(bodyEl);
    ro.observe(clipEl);
    if (extraObservedScrollEl) {
      ro.observe(extraObservedScrollEl);
    }

    return () => {
      bodyEl.removeEventListener("scroll", updateClip);
      if (verticalScrollEl === window) {
        window.removeEventListener("scroll", updateClip, true);
      } else if (extraObservedScrollEl) {
        extraObservedScrollEl.removeEventListener("scroll", updateClip);
      }
      window.removeEventListener("resize", updateClip);
      ro.disconnect();
    };
  }, [fillHeight]);

  // Sync horizontal scroll from body to header
  const handleBodyScroll = useCallback(() => {
    const body = scrollContainerRef.current;
    const header = headerScrollRef.current;
    if (body && header) {
      header.scrollLeft = body.scrollLeft;
    }
  }, []);

  // ── Toolbar context ──────────────────────────────────────────
  const toolbarCtx: DataGridToolbarContext<TRow> = useMemo(
    () => ({
      state,
      onChange,
      columns: allColumns,
      visibleColumns,
      totalRowCount,
      selectedRowCount: state.selection.selectedIds.size,
      strings,
      exportCsv: handleExportCsv,
    }),
    [state, onChange, allColumns, visibleColumns, totalRowCount, strings, handleExportCsv],
  );

  // ── Footer context ───────────────────────────────────────────
  const footerCtx: DataGridFooterContext<TRow> = useMemo(
    () => ({
      state,
      totalRowCount,
      visibleRowCount: rows.length,
      selectedRowCount: state.selection.selectedIds.size,
      paginationMode,
      strings,
    }),
    [state, totalRowCount, rows.length, paginationMode, strings],
  );

  // ── Selection state for header checkbox ──────────────────────
  const allSelected = rowIds.length > 0 && rowIds.every((id) => state.selection.selectedIds.has(id));
  const someSelected = !allSelected && rowIds.some((id) => state.selection.selectedIds.has(id));

  // ── Render ───────────────────────────────────────────────────
  //
  // Height model:
  // - Root is `flex flex-col h-full min-h-0 bg-transparent`. `h-full`
  //   makes the grid fill a bounded parent; in an unbounded parent it
  //   resolves to `auto` and the grid takes the content's intrinsic size.
  // - Toolbar + header are wrapped in a single `sticky top-0` container
  //   so they pin to the top of the nearest scroll ancestor. Footer is
  //   `shrink-0`; the scroll body is `flex-1 min-h-0 overflow-auto`.
  // - `maxHeight` is applied directly to the root; the scroll body never
  //   subtracts chrome sizes manually (that math breaks when the toolbar
  //   wraps, the footer grows, etc.).
  // - `fillHeight={false}` uses `h-auto` and a non-growing scroll body so the grid
  //   only occupies the height of its rows (no flex gap above sibling sections).
  return (
    <div
      ref={gridRef}
      className={cn(
        "flex w-full min-w-0 max-w-full flex-col bg-transparent rounded-[calc(var(--radius)*2)]",
        fillHeight ? "min-h-0 h-full" : "min-h-0 h-auto",
        className,
      )}
      style={maxHeight != null ? { ...gridSizingStyle, maxHeight } : gridSizingStyle}
      role="grid"
      aria-rowcount={totalRowCount ?? rows.length}
      aria-colcount={visibleColumns.length}
    >
      {/* Sticky chrome: toolbar + header pin to the top of the nearest
          scroll ancestor so they remain visible while the body scrolls. */}
      <div
        ref={stickyChromeRef}
        className="sticky z-20 w-full min-w-0 shrink-0 rounded-t-[calc(var(--radius)*2)] bg-background"
        style={{ top: stickyTop ?? "var(--data-grid-sticky-top, 0px)" }}
      >
        {/* Toolbar */}
        {toolbar !== false && (
          <div className="relative bg-transparent">
            {toolbar ? (
              toolbar(toolbarCtx)
            ) : (
              <DataGridToolbar
                ctx={toolbarCtx}
                extra={
                  typeof toolbarExtra === "function"
                    ? toolbarExtra(toolbarCtx)
                    : toolbarExtra
                }
              />
            )}
          </div>
        )}

        {/* Header row — syncs horizontal scroll with the body */}
        <div className="relative">
          {isRefetching && (
            <div className="absolute top-0 left-0 right-0 h-0.5 z-30 bg-foreground/[0.04] overflow-hidden">
              <div className="h-full w-1/3 bg-blue-500/60 rounded-full animate-pulse" />
            </div>
          )}
          <div
            ref={headerScrollRef}
            className="w-full min-w-0 shrink-0 overflow-hidden border-b border-foreground/[0.06]"
          >
            <div
              className="flex"
              style={{ height: headerHeight, minWidth: visibleColumnMetrics.totalWidth }}
              role="row"
            >
              {selectionMode !== "none" && (
                <div
                  className="flex items-center justify-center border-r border-foreground/[0.04]"
                  style={{ width: 44 }}
                >
                  {selectionMode === "multiple" && (
                    <SelectionCheckbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={handleSelectAll}
                      ariaLabel="Select all rows"
                    />
                  )}
                </div>
              )}
              {visibleColumns.map((col) => (
                <HeaderCell
                  key={col.id}
                  col={col}
                  isSorted={getSortDirection(state.sorting, col.id)}
                  sortIndex={getSortIndex(state.sorting, col.id)}
                  resizable={resizable}
                  onSort={handleSort}
                  onResize={handleResize}
                  onResizeEnd={handleResizeEnd}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable body — flex-1 + min-h-0 when filling parent; flex-none when
          `fillHeight` is false so row stack height drives the grid (page scroll). */}
      <div
        ref={scrollContainerRef}
        className={cn(
          "w-full min-w-0 overflow-auto bg-transparent",
          fillHeight ? "min-h-0 flex-1" : "flex-none",
          "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5",
          "[&::-webkit-scrollbar-track]:bg-transparent",
          "[&::-webkit-scrollbar-thumb]:bg-foreground/[0.08] [&::-webkit-scrollbar-thumb]:rounded-full",
          "[&::-webkit-scrollbar-thumb]:hover:bg-foreground/[0.15]",
        )}
        onScroll={handleBodyScroll}
      >
        {/* Clip wrapper — `clip-path` updated on scroll/resize so row
            content scrolling behind the sticky chrome is physically cut
            out instead of bleeding through. */}
        <div ref={rowsClipRef}>
          {/* Loading initial */}
          {isLoading && (
            <div style={{ minWidth: visibleColumnMetrics.totalWidth }}>
              {loadingState ??
                Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonRow
                    key={i}
                    columns={visibleColumns}
                    height={estimatedRowHeight}
                    showCheckbox={selectionMode !== "none"}
                  />
                ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && rows.length === 0 && (
            <div
              className="flex items-center justify-center py-16 text-sm text-muted-foreground"
              style={{ minWidth: visibleColumnMetrics.totalWidth }}
            >
              {emptyState ?? strings.noData}
            </div>
          )}

          {/* Virtualized rows */}
          {!isLoading && rows.length > 0 && (
            <div
              style={{
                height: rowVirtualizer.getTotalSize(),
                width: "100%",
                minWidth: visibleColumnMetrics.totalWidth,
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow: VirtualItem) => {
                const row = rows[virtualRow.index]!;
                const rowId = getRowId(row);
                const isSelected = state.selection.selectedIds.has(rowId);

                const isOddRow = virtualRow.index % 2 === 1;
                return (
                  <div
                    key={rowId}
                    ref={isDynamicRowHeight ? rowVirtualizer.measureElement : undefined}
                    data-index={virtualRow.index}
                    className={cn(
                      "absolute left-0 w-full flex",
                      "border-b border-black/[0.03] dark:border-white/[0.03]",
                      "transition-colors duration-75",
                      isSelected
                        ? "bg-blue-500/[0.06] dark:bg-blue-400/[0.08] hover:bg-blue-500/[0.08] dark:hover:bg-blue-400/[0.1]"
                        : isOddRow
                          ? "bg-foreground/[0.02] dark:bg-foreground/[0.03] hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06]"
                          : "hover:bg-foreground/[0.025] dark:hover:bg-foreground/[0.04]",
                      (selectionMode !== "none" || onRowClick) && "cursor-pointer",
                    )}
                    style={{
                      ...(isDynamicRowHeight
                        ? { minHeight: estimatedRowHeight }
                        : { height: fixedRowHeight }),
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    onClick={(e) => handleRowClick(row, rowId, e)}
                    onDoubleClick={(e) => onRowDoubleClick?.(row, rowId, e)}
                    role="row"
                    aria-rowindex={virtualRow.index + 2}
                    aria-selected={isSelected}
                    data-row-id={rowId}
                    data-state={isSelected ? "selected" : undefined}
                  >
                    {/* Selection checkbox */}
                    {selectionMode !== "none" && (
                      <div
                        className="flex items-center justify-center border-r border-black/[0.04] dark:border-white/[0.04]"
                        style={{ width: 44 }}
                      >
                        <SelectionCheckbox
                          checked={isSelected}
                          onChange={(event) => handleRowSelectionCheckboxClick(row, rowId, event)}
                          ariaLabel={`Select row ${rowId}`}
                        />
                      </div>
                    )}

                    {/* Data cells */}
                    {visibleColumns.map((col) => (
                      <DataCell
                        key={col.id}
                        col={col}
                        row={row}
                        rowId={rowId}
                        rowIndex={virtualRow.index}
                        isSelected={isSelected}
                        dateDisplay={state.dateDisplay}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Infinite scroll sentinel */}
          {paginationMode === "infinite" && hasMore && !isLoading && (
            <InfiniteScrollSentinel
              onIntersect={onLoadMore ?? (() => {})}
              isLoading={isLoadingMore}
              strings={strings}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      {footer !== false && (
        <div className="relative z-10 shrink-0 bg-transparent">
          {footer ? (
            footer(footerCtx)
          ) : (
            <DefaultFooter
              ctx={footerCtx}
              pagination={paginationMode}
              onChange={onChange}
            />
          )}
          {footerExtra && (
            typeof footerExtra === "function" ? footerExtra(footerCtx) : footerExtra
          )}
        </div>
      )}
    </div>
  );
}
