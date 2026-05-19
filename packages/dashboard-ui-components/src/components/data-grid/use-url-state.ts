"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_COL_WIDTH, clampColumnWidth } from "./data-grid-sizing";
import { createDefaultDataGridState } from "./state";
import type {
  DataGridColumnDef,
  DataGridSortItem,
  DataGridSortModel,
  DataGridState,
} from "./types";

// ─── URL <-> state encoding ──────────────────────────────────────────
// Compact, human-readable formats so URLs stay short. Each piece of
// state gets its own param so unrelated changes don't churn shared keys:
//
//   ?{prefix}_w=name:200,email:300       column widths (only non-defaults)
//   ?{prefix}_h=createdAt,role           hidden column ids
//   ?{prefix}_s=signedUpAt:desc,name:asc multi-column sort
//   ?{prefix}_q=alice                    quick-search text
//
// Column ids are URL-encoded so ids containing `,` `:` or other reserved
// characters round-trip safely. Without encoding, an id like "user:name"
// would silently break the parser.

// ── widths ─────────────────────────────────────────────────────────
function serializeWidths(
  widths: Record<string, number>,
  columns: readonly DataGridColumnDef<any>[],
): string {
  const parts: string[] = [];
  for (const col of columns) {
    const w = widths[col.id];
    if (typeof w !== "number" || !Number.isFinite(w)) continue;
    const defaultW = clampColumnWidth(col, col.width ?? DEFAULT_COL_WIDTH);
    if (Math.round(w) === Math.round(defaultW)) continue;
    parts.push(`${encodeURIComponent(col.id)}:${Math.round(w)}`);
  }
  return parts.join(",");
}

function parseWidths(
  raw: string | null,
  fallback: Record<string, number>,
  columns: readonly DataGridColumnDef<any>[],
): Record<string, number> {
  if (!raw) return fallback;
  const colMap = new Map(columns.map((c) => [c.id, c]));
  const out: Record<string, number> = { ...fallback };
  for (const part of raw.split(",")) {
    // Only split on the FIRST colon — id-side is always pre-encoded so it
    // can't contain a literal `:`, but width-side is always numeric.
    const colonIdx = part.indexOf(":");
    if (colonIdx <= 0) continue;
    const encodedId = part.slice(0, colonIdx);
    const num = part.slice(colonIdx + 1);
    let id: string;
    try {
      id = decodeURIComponent(encodedId);
    } catch {
      continue;
    }
    if (!id || !num) continue;
    const col = colMap.get(id);
    if (!col) continue;
    const n = Number(num);
    if (!Number.isFinite(n)) continue;
    out[id] = clampColumnWidth(col, n);
  }
  return out;
}

// ── hidden columns ─────────────────────────────────────────────────
function serializeHidden(visibility: Record<string, boolean>): string {
  return Object.entries(visibility)
    .filter(([, v]) => v === false)
    .map(([id]) => encodeURIComponent(id))
    .join(",");
}

function parseHidden(
  raw: string | null,
  columns: readonly DataGridColumnDef<any>[],
): Record<string, boolean> {
  if (!raw) return {};
  const known = new Set(columns.map((c) => c.id));
  const out: Record<string, boolean> = {};
  for (const encodedId of raw.split(",")) {
    let id: string;
    try {
      id = decodeURIComponent(encodedId);
    } catch {
      continue;
    }
    if (id && known.has(id)) out[id] = false;
  }
  return out;
}

// ── sort model ─────────────────────────────────────────────────────
function serializeSort(sort: DataGridSortModel): string {
  return sort
    .map((s) => `${encodeURIComponent(s.columnId)}:${s.direction === "desc" ? "desc" : "asc"}`)
    .join(",");
}

function sortEqual(a: DataGridSortModel, b: DataGridSortModel): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].columnId !== b[i].columnId || a[i].direction !== b[i].direction) return false;
  }
  return true;
}

function parseSort(
  raw: string | null,
  fallback: DataGridSortModel,
  columns: readonly DataGridColumnDef<any>[],
): DataGridSortModel {
  if (raw == null) return fallback;
  if (raw === "") return [];
  const known = new Set(columns.map((c) => c.id));
  const out: DataGridSortItem[] = [];
  for (const part of raw.split(",")) {
    const colonIdx = part.indexOf(":");
    if (colonIdx <= 0) continue;
    const encodedId = part.slice(0, colonIdx);
    const dir = part.slice(colonIdx + 1);
    if (dir !== "asc" && dir !== "desc") continue;
    let id: string;
    try {
      id = decodeURIComponent(encodedId);
    } catch {
      continue;
    }
    if (!id || !known.has(id)) continue;
    out.push({ columnId: id, direction: dir });
  }
  return out;
}

// ── quick search ───────────────────────────────────────────────────
function parseQuickSearch(raw: string | null, fallback: string): string {
  if (raw == null) return fallback;
  return raw;
}

// ─── Hook ────────────────────────────────────────────────────────────

type UrlStateOptions = {
  /** Disambiguates URL params when multiple grids share a page. Defaults
   * to `"grid"`. Use unique prefixes per-grid (e.g. `"users"`, `"teams"`). */
  paramPrefix?: string,
  /** Overrides for default state used when the URL has no value for a
   * given key. Useful for things like a sensible initial sort (e.g.
   * "newest signups first") that should appear on first load but be
   * overridden when the user navigates to a bookmarked URL. */
  initial?: Partial<Pick<DataGridState, "sorting" | "quickSearch" | "columnVisibility">>,
};

/**
 * Drop-in replacement for `useState(() => createDefaultDataGridState(columns))`
 * that persists user view preferences to URL search params, so a view
 * can be bookmarked / shared / restored on reload.
 *
 * **Persisted:** column widths, hidden columns, sort model, quick-search.
 * **Not persisted** (deliberately): pagination scroll position, selection,
 * column pinning/order, date display mode — these are session-scoped.
 *
 * ```tsx
 * const [gridState, setGridState] = useDataGridUrlState(columns, {
 *   paramPrefix: "users",
 *   initial: { sorting: [{ columnId: "signedUpAt", direction: "desc" }] },
 * });
 * ```
 *
 * URL encoding: `?{prefix}_w=...&{prefix}_h=...&{prefix}_s=...&{prefix}_q=...`.
 * Default values are omitted so URLs stay clean. Updates use
 * `history.replaceState` (not pushState) so back/forward isn't polluted,
 * and `popstate` is observed so external URL changes flow back into state.
 */
export function useDataGridUrlState<TRow>(
  columns: readonly DataGridColumnDef<TRow>[],
  opts?: UrlStateOptions,
): [DataGridState, React.Dispatch<React.SetStateAction<DataGridState>>] {
  const prefix = opts?.paramPrefix ?? "grid";
  const widthsKey = `${prefix}_w`;
  const hiddenKey = `${prefix}_h`;
  const sortKey = `${prefix}_s`;
  const searchKey = `${prefix}_q`;

  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  // `initial` snapshots are captured once on first render. Re-running them
  // each render would clobber the user's interactions.
  const initialRef = useRef(opts?.initial);

  const [state, setState] = useState<DataGridState>(() => {
    const base = createDefaultDataGridState(columns);
    const initial = initialRef.current ?? {};
    const baseWithInitial: DataGridState = {
      ...base,
      sorting: initial.sorting ?? base.sorting,
      quickSearch: initial.quickSearch ?? base.quickSearch,
      columnVisibility: initial.columnVisibility ?? base.columnVisibility,
    };
    if (typeof window === "undefined") return baseWithInitial;
    const params = new URLSearchParams(window.location.search);
    return {
      ...baseWithInitial,
      columnWidths: parseWidths(params.get(widthsKey), base.columnWidths, columns),
      columnVisibility: params.get(hiddenKey) != null
        ? parseHidden(params.get(hiddenKey), columns)
        : baseWithInitial.columnVisibility,
      sorting: parseSort(params.get(sortKey), baseWithInitial.sorting, columns),
      quickSearch: parseQuickSearch(params.get(searchKey), baseWithInitial.quickSearch),
    };
  });

  // Sync state -> URL. Debounced so that high-frequency state changes
  // (e.g. dragging a column resize handle, typing in the search box)
  // don't fire a URL write per pixel / per keystroke.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const before = params.toString();
      const cols = columnsRef.current;
      const initial = initialRef.current ?? {};

      const widthsStr = serializeWidths(state.columnWidths, cols);
      if (widthsStr) params.set(widthsKey, widthsStr);
      else params.delete(widthsKey);

      const hiddenStr = serializeHidden(state.columnVisibility);
      // If the consumer supplied initial visibility, "no hidden cols" must
      // be encoded explicitly (empty string) so a bookmark with no `_h=`
      // doesn't silently re-hide a column the user just un-hid.
      const initialHidden = initial.columnVisibility
        ? serializeHidden(initial.columnVisibility)
        : "";
      if (hiddenStr) params.set(hiddenKey, hiddenStr);
      else if (initialHidden) params.set(hiddenKey, "");
      else params.delete(hiddenKey);

      const initialSort = initial.sorting ?? [];
      if (sortEqual(state.sorting, initialSort)) params.delete(sortKey);
      else params.set(sortKey, serializeSort(state.sorting));

      const initialSearch = initial.quickSearch ?? "";
      if (state.quickSearch === initialSearch) params.delete(searchKey);
      else params.set(searchKey, state.quickSearch);

      const after = params.toString();
      if (before === after) return;
      const url = `${window.location.pathname}${after ? `?${after}` : ""}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", url);
    }, 100);
    return () => clearTimeout(timer);
  }, [
    state.columnWidths,
    state.columnVisibility,
    state.sorting,
    state.quickSearch,
    widthsKey,
    hiddenKey,
    sortKey,
    searchKey,
  ]);

  // React to back/forward navigation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      const cols = columnsRef.current;
      const initial = initialRef.current ?? {};
      // When the URL no longer has a value for a key, reset to defaults
      // rather than preserving the previous in-memory state — otherwise
      // navigating back to a clean URL leaves stale state.
      const defaults = createDefaultDataGridState(cols);
      setState((prev) => ({
        ...prev,
        columnWidths: parseWidths(params.get(widthsKey), defaults.columnWidths, cols),
        columnVisibility: params.get(hiddenKey) != null
          ? parseHidden(params.get(hiddenKey), cols)
          : (initial.columnVisibility ?? defaults.columnVisibility),
        sorting: parseSort(params.get(sortKey), initial.sorting ?? defaults.sorting, cols),
        quickSearch: parseQuickSearch(params.get(searchKey), initial.quickSearch ?? defaults.quickSearch),
      }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [widthsKey, hiddenKey, sortKey, searchKey]);

  return [state, setState];
}
