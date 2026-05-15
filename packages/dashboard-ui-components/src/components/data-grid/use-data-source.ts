import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DataGridColumnDef,
  DataGridDataSource,
  DataGridFetchParams,
  DataGridDataPaginationMode,
  DataGridPaginationModel,
  DataGridSortModel,
  RowId,
} from "./types";
import {
  applyQuickSearch,
  buildRowComparator,
  defaultMatchRow,
  paginateRows,
} from "./state";

export type UseDataSourceResult<TRow> = {
  /** All rows currently loaded (for infinite mode, the accumulated set). */
  rows: readonly TRow[];
  /** Total row count if known. */
  totalRowCount: number | undefined;
  /** Whether the initial load is in progress (no data at all yet). */
  isLoading: boolean;
  /** Whether a background refetch is happening (data already shown). */
  isRefetching: boolean;
  /** Whether more rows are being fetched (infinite scroll). */
  isLoadingMore: boolean;
  /** Request the next page (infinite scroll). */
  loadMore: () => void;
  /** Whether there are more pages to load. */
  hasMore: boolean;
  /** Reload from scratch. */
  reload: () => void;
  /**
   * Error from the most recent async fetch, if any. Consumers should render
   * an error UI and offer a `reload()` button when this is non-null. Client
   * mode never sets this (no fetching). Cleared on next successful fetch.
   */
  error: Error | null;
};

// ─── Client-side hook ────────────────────────────────────────────────
// Memoised so resize / selection / other unrelated state changes
// don't recompute or create new array references.

function useClientDataSource<TRow>(opts: {
  data: readonly TRow[];
  columns: readonly DataGridColumnDef<TRow>[];
  sorting: DataGridSortModel;
  quickSearch: string;
  matchRow: (
    row: TRow,
    query: string,
    columns: readonly DataGridColumnDef<TRow>[],
  ) => boolean;
  pagination: DataGridPaginationModel;
  paginationMode: DataGridDataPaginationMode;
}): UseDataSourceResult<TRow> {
  const { data, columns, sorting, quickSearch, matchRow, pagination, paginationMode } = opts;

  // Stable serialised keys so useMemo only fires on real changes
  const sortingKey = JSON.stringify(sorting);

  const processed = useMemo(() => {
    // Quick search is applied FIRST, on the full input. If nothing is
    // typed this is a zero-cost no-op (applyQuickSearch returns the
    // original array reference). Sort and paginate operate on the
    // already-filtered set so the result counts are search-aware.
    const searched = applyQuickSearch(data, quickSearch, columns, matchRow);
    const comparator = buildRowComparator(sorting, columns);
    const sorted = comparator ? [...searched].sort(comparator) : searched;
    const totalRowCount = sorted.length;
    const paged =
      paginationMode === "client"
        ? paginateRows(sorted as readonly TRow[], pagination)
        : sorted;
    return { rows: paged, totalRowCount };
  }, [data, sortingKey, quickSearch, matchRow, pagination.pageIndex, pagination.pageSize, paginationMode, columns]);

  return useMemo(() => ({
    rows: processed.rows,
    totalRowCount: processed.totalRowCount,
    isLoading: false,
    isRefetching: false,
    isLoadingMore: false,
    loadMore: () => {},
    hasMore: false,
    reload: () => {},
    error: null,
  }), [processed]);
}

// ─── Async data source hook ──────────────────────────────────────────
// Key behaviour: when refetching (sort change), we keep showing the old
// rows and set `isRefetching` instead of `isLoading`. This avoids the
// jarring flash-to-skeleton on every sort toggle.

function useAsyncDataSource<TRow>(opts: {
  dataSource: DataGridDataSource<TRow>;
  getRowId: (row: TRow) => RowId;
  sorting: DataGridSortModel;
  quickSearch: string;
  pagination: DataGridPaginationModel;
  paginationMode: DataGridDataPaginationMode;
}): UseDataSourceResult<TRow> {
  const {
    dataSource,
    getRowId,
    sorting,
    quickSearch,
    pagination,
    paginationMode,
  } = opts;

  const [rows, setRows] = useState<TRow[]>([]);
  const [totalRowCount, setTotalRowCount] = useState<number | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const cursorRef = useRef<unknown>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const pageIndexRef = useRef(0);
  const hasDataRef = useRef(false);
  const hasMountedServerPaginationRef = useRef(false);

  const latestArgsRef = useRef({
    dataSource,
    getRowId,
    sorting,
    quickSearch,
    pagination,
  });
  latestArgsRef.current = { dataSource, getRowId, sorting, quickSearch, pagination };

  const sortingKey = JSON.stringify(sorting);
  const quickSearchKey = quickSearch;

  const fetchPage = useCallback(
    async (append: boolean) => {
      const {
        dataSource: currentDataSource,
        getRowId: currentGetRowId,
        sorting: currentSorting,
        quickSearch: currentQuickSearch,
        pagination: currentPagination,
      } = latestArgsRef.current;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (append) {
        setIsLoadingMore(true);
      } else {
        // First load → skeleton. Subsequent → subtle refetch indicator.
        if (hasDataRef.current) {
          setIsRefetching(true);
        } else {
          setIsLoading(true);
        }
        cursorRef.current = undefined;
        pageIndexRef.current = 0;
      }
      // Clear previous error at the start of a new attempt; we'll set it
      // again if this attempt fails.
      setError(null);

      try {
        const params: DataGridFetchParams = {
          sorting: currentSorting,
          quickSearch: currentQuickSearch,
          pagination: append
            ? { pageIndex: pageIndexRef.current, pageSize: currentPagination.pageSize }
            : currentPagination,
          cursor: cursorRef.current,
        };

        const gen = currentDataSource(params);

        for await (const result of gen) {
          if (controller.signal.aborted) return;

          if (result.totalRowCount != null) {
            setTotalRowCount(result.totalRowCount);
          }
          if (result.nextCursor !== undefined) {
            cursorRef.current = result.nextCursor;
          }
          setHasMore(result.hasMore !== false);

          if (append) {
            setRows((prev) => {
              const existingIds = new Set(prev.map(currentGetRowId));
              const newRows = result.rows.filter(
                (r) => !existingIds.has(currentGetRowId(r)),
              );
              return [...prev, ...newRows];
            });
          } else {
            setRows(result.rows);
          }

          hasDataRef.current = true;
          pageIndexRef.current++;
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        // Surface the error on the result so consumers can render retry UI.
        // Still log to console so it's visible in dev without forcing every
        // consumer to wire up error rendering.
        // eslint-disable-next-line no-console
        console.error("[DataGrid] Data source error:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsRefetching(false);
          setIsLoadingMore(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    fetchPage(false).catch(() => {});
    return () => abortRef.current?.abort();
    // Also refetches when `dataSource` identity changes — consumers encode
    // external filter state into the generator's closure, so a new
    // generator reference is the signal that the query changed.
  }, [fetchPage, dataSource, sortingKey, quickSearchKey, pagination.pageSize]);

  useEffect(() => {
    if (paginationMode !== "server") {
      hasMountedServerPaginationRef.current = false;
      return;
    }
    if (!hasMountedServerPaginationRef.current) {
      hasMountedServerPaginationRef.current = true;
      return;
    }
    fetchPage(false).catch(() => {});
  }, [fetchPage, paginationMode, pagination.pageIndex]);

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore && paginationMode === "infinite") {
      fetchPage(true).catch(() => {});
    }
  }, [isLoadingMore, hasMore, paginationMode, fetchPage]);

  const reload = useCallback(() => {
    fetchPage(false).catch(() => {});
  }, [fetchPage]);

  return {
    rows,
    totalRowCount,
    isLoading,
    isRefetching,
    isLoadingMore,
    loadMore,
    hasMore,
    reload,
    error,
  };
}

// ─── Noop data source (stable reference) ─────────────────────────────
const NOOP_DATA_SOURCE: DataGridDataSource<any> = async function* () {};
const NOOP_GET_ROW_ID = () => "";

// ─── Public hook ─────────────────────────────────────────────────────
// Both inner hooks are always called (React rules-of-hooks) but only
// one provides the returned result.

/**
 * Hook that processes raw data through the grid's sort/pagination state
 * and returns the `rows` slice ready to pass to `DataGrid`. This is the
 * only correct way to feed client-side data into a grid.
 *
 * Two modes, picked by which prop you pass:
 * - `data: TRow[]` → client-side mode. In-memory sort + paginate.
 * - `dataSource: (params) => AsyncGenerator` → server / infinite mode.
 *   The generator yields pages as you scroll or change pages.
 *
 * ```tsx
 * // Client-side (most common):
 * const gridData = useDataSource({
 *   data: users,
 *   columns,
 *   getRowId: (row) => row.id,
 *   sorting: gridState.sorting,
 *   quickSearch: gridState.quickSearch,
 *   pagination: gridState.pagination,
 *   paginationMode: "client",
 * });
 *
 * <DataGrid
 *   columns={columns}
 *   rows={gridData.rows}
 *   totalRowCount={gridData.totalRowCount}
 *   isLoading={gridData.isLoading}
 *   state={gridState}
 *   onChange={setGridState}
 *   getRowId={(row) => row.id}
 * />
 * ```
 *
 * Rules:
 * - Call this hook unconditionally at the top level, before any early return.
 * - `rows` on `DataGrid` must ALWAYS be `gridData.rows`, never your raw array.
 * - For server or infinite pagination, use `dataSource` — see the
 *   `DataGridDataSource` type for the generator signature.
 *
 * Quick search:
 * - Client mode (`data` prop): the hook auto-filters rows via
 *   `applyQuickSearch` using a default case-insensitive substring match
 *   across every column. Override with `matchRow` for custom matching
 *   (fuzzy, weighted, field-specific, etc.).
 * - Async mode (`dataSource` prop): the hook passes `quickSearch` into
 *   `params.quickSearch` and re-runs the generator whenever the search
 *   string changes. The consumer owns the matching logic (typically by
 *   folding it into a backend query). The grid performs NO client-side
 *   filtering in async mode.
 */
export function useDataSource<TRow>(opts: {
  data?: readonly TRow[];
  dataSource?: DataGridDataSource<TRow>;
  columns: readonly DataGridColumnDef<TRow>[];
  getRowId: (row: TRow) => RowId;
  sorting: DataGridSortModel;
  /** Current quick-search text, typically `gridState.quickSearch`. */
  quickSearch: string;
  /** Override the default client-mode matcher. Ignored in async mode
   * (there the generator is the matcher). */
  matchRow?: (
    row: TRow,
    query: string,
    columns: readonly DataGridColumnDef<TRow>[],
  ) => boolean;
  pagination: DataGridPaginationModel;
  paginationMode: DataGridDataPaginationMode;
}): UseDataSourceResult<TRow> {
  const {
    data,
    dataSource,
    columns,
    getRowId,
    sorting,
    quickSearch,
    matchRow = defaultMatchRow,
    pagination,
    paginationMode,
  } = opts;

  const isClientMode = data != null && !dataSource;

  if (process.env.NODE_ENV !== "production" && data == null && dataSource == null) {
    // eslint-disable-next-line no-console
    console.warn(
      "[useDataSource] neither `data` nor `dataSource` was provided — "
      + "the grid will render empty indefinitely. Pass one or the other."
    );
  }

  // Common footgun: consumers pass `data` as a fully-materialized array and
  // set `paginationMode: "infinite"` expecting the grid to page through it.
  // In client mode "infinite" skips `paginateRows` and returns every row;
  // `hasMore` / `loadMore` on the result are always false/no-ops. If you
  // want real paging, switch to `paginationMode: "server"` with a
  // `dataSource` generator. If you want in-memory slicing, use `"client"`.
  // If you're manually accumulating rows into `data` and driving the grid's
  // sentinel via your own `hasMore`/`onLoadMore`, this warning is a hint —
  // but current behavior (full list + external sentinel) is intentional.
  if (
    process.env.NODE_ENV !== "production"
    && isClientMode
    && paginationMode === "infinite"
    && data.length > 0
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      "[useDataSource] `paginationMode: \"infinite\"` with a `data` array "
      + "skips pagination entirely. Prefer `\"client\"` for in-memory lists "
      + "or `\"server\"` + a `dataSource` generator for real paging."
    );
  }

  const clientResult = useClientDataSource({
    data: data ?? [],
    columns,
    sorting,
    quickSearch,
    matchRow,
    pagination,
    paginationMode,
  });

  const asyncResult = useAsyncDataSource({
    dataSource: dataSource ?? NOOP_DATA_SOURCE,
    getRowId: dataSource ? getRowId : NOOP_GET_ROW_ID,
    sorting,
    quickSearch,
    pagination,
    paginationMode,
  });

  return isClientMode ? clientResult : asyncResult;
}
