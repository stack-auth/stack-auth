"use client";

import { useEffect, useRef, useState } from "react";
import { clampColumnWidth } from "./data-grid-sizing";
import { createDefaultDataGridState } from "./state";
import type { DataGridColumnDef, DataGridState } from "./types";

// ─── URL <-> state encoding ──────────────────────────────────────────
// Compact, human-readable formats so URLs stay short:
//   ?{prefix}_w=name:200,email:300       column widths (only non-defaults)
//   ?{prefix}_h=createdAt,role           hidden column ids

function serializeWidths(
  widths: Record<string, number>,
  columns: readonly DataGridColumnDef<any>[],
): string {
  const parts: string[] = [];
  for (const col of columns) {
    const w = widths[col.id];
    if (typeof w !== "number" || !Number.isFinite(w)) continue;
    const defaultW = clampColumnWidth(col, col.width ?? 150);
    if (Math.round(w) === Math.round(defaultW)) continue;
    parts.push(`${col.id}:${Math.round(w)}`);
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
    const [id, num] = part.split(":");
    if (!id || !num) continue;
    const col = colMap.get(id);
    if (!col) continue;
    const n = Number(num);
    if (!Number.isFinite(n)) continue;
    out[id] = clampColumnWidth(col, n);
  }
  return out;
}

function serializeHidden(visibility: Record<string, boolean>): string {
  return Object.entries(visibility)
    .filter(([, v]) => v === false)
    .map(([id]) => id)
    .join(",");
}

function parseHidden(
  raw: string | null,
  columns: readonly DataGridColumnDef<any>[],
): Record<string, boolean> {
  if (!raw) return {};
  const known = new Set(columns.map((c) => c.id));
  const out: Record<string, boolean> = {};
  for (const id of raw.split(",")) {
    if (id && known.has(id)) out[id] = false;
  }
  return out;
}

// ─── Hook ────────────────────────────────────────────────────────────

/**
 * Drop-in replacement for `useState(() => createDefaultDataGridState(columns))`
 * that persists column widths and visibility to URL search params. Other
 * state (sort, search, pagination, selection) is intentionally left in
 * memory — those tend to reset between visits.
 *
 * ```tsx
 * const [gridState, setGridState] = useDataGridUrlState(columns);
 * // or with a custom prefix to allow multiple grids on one page:
 * const [gridState, setGridState] = useDataGridUrlState(columns, { paramPrefix: "users" });
 * ```
 *
 * Encodes as `?{prefix}_w=col1:200,col2:150&{prefix}_h=col3`. Default values
 * are omitted so URLs stay clean. Updates use `history.replaceState` so
 * back/forward navigation isn't polluted, and `popstate` is observed so
 * external URL changes flow back into state.
 */
export function useDataGridUrlState<TRow>(
  columns: readonly DataGridColumnDef<TRow>[],
  opts?: { paramPrefix?: string },
): [DataGridState, React.Dispatch<React.SetStateAction<DataGridState>>] {
  const prefix = opts?.paramPrefix ?? "grid";
  const widthsKey = `${prefix}_w`;
  const hiddenKey = `${prefix}_h`;

  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const [state, setState] = useState<DataGridState>(() => {
    const base = createDefaultDataGridState(columns);
    if (typeof window === "undefined") return base;
    const params = new URLSearchParams(window.location.search);
    return {
      ...base,
      columnWidths: parseWidths(params.get(widthsKey), base.columnWidths, columns),
      columnVisibility: parseHidden(params.get(hiddenKey), columns),
    };
  });

  // Sync state -> URL. Debounced so that high-frequency state changes
  // (e.g. dragging a column resize handle) don't fire a URL write per pixel.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const before = params.toString();

      const widthsStr = serializeWidths(state.columnWidths, columnsRef.current);
      if (widthsStr) {
        params.set(widthsKey, widthsStr);
      } else {
        params.delete(widthsKey);
      }

      const hiddenStr = serializeHidden(state.columnVisibility);
      if (hiddenStr) {
        params.set(hiddenKey, hiddenStr);
      } else {
        params.delete(hiddenKey);
      }

      const after = params.toString();
      if (before === after) return;
      const url = `${window.location.pathname}${after ? `?${after}` : ""}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", url);
    }, 100);
    return () => clearTimeout(timer);
  }, [state.columnWidths, state.columnVisibility, widthsKey, hiddenKey]);

  // React to back/forward navigation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      const cols = columnsRef.current;
      // When the URL no longer has a value for a key, reset to defaults
      // rather than preserving the previous in-memory state — otherwise
      // navigating back to a clean URL leaves stale column widths.
      const defaults = createDefaultDataGridState(cols);
      setState((prev) => ({
        ...prev,
        columnWidths: parseWidths(params.get(widthsKey), defaults.columnWidths, cols),
        columnVisibility: parseHidden(params.get(hiddenKey), cols),
      }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [widthsKey, hiddenKey]);

  return [state, setState];
}
