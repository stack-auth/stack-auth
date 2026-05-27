import type { DataGridColumnDef } from "./types";

const MIN_COL_WIDTH = 20;
const MIN_CUSTOM_HEADER_WIDTH = 50;
export const DEFAULT_MAX_COL_WIDTH = 800;
export const DEFAULT_COL_WIDTH = 150;

// px-3 both sides + gap-1.5 + sort icon (h-3 w-3) + 2px rounding buffer
const HEADER_CHROME_PX = 12 + 12 + 6 + 12 + 2;

let measureContext: CanvasRenderingContext2D | null = null;
const headerWidthCache = new Map<string, number>();

function measureHeaderLabelWidth(label: string): number {
  const cached = headerWidthCache.get(label);
  if (cached != null) return cached;
  if (typeof document === "undefined") return 0;
  if (measureContext == null) {
    measureContext = document.createElement("canvas").getContext("2d");
  }
  if (measureContext == null) return 0;

  // Match header cell: text-xs (12px) font-semibold uppercase tracking-wider (0.05em)
  measureContext.font = "600 12px system-ui, -apple-system, sans-serif";
  const text = label.toUpperCase();
  const letterSpacingPx = 0.05 * 12;
  const width = Math.ceil(
    measureContext.measureText(text).width + letterSpacingPx * text.length,
  );
  headerWidthCache.set(label, width);
  return width;
}

/** Effective minimum column width. When `col.minWidth` is unset, derive
 * one from the header label so it never gets clipped during resize. */
export function getEffectiveMinWidth<TRow>(col: DataGridColumnDef<TRow>): number {
  if (col.minWidth != null) return col.minWidth;
  const label = typeof col.header === "string" ? col.header : null;
  if (label == null) {
    return typeof col.header === "function" ? MIN_CUSTOM_HEADER_WIDTH : MIN_COL_WIDTH;
  }
  return Math.max(MIN_COL_WIDTH, measureHeaderLabelWidth(label) + HEADER_CHROME_PX);
}

export function getEffectiveMaxWidth<TRow>(col: DataGridColumnDef<TRow>): number {
  return col.maxWidth ?? DEFAULT_MAX_COL_WIDTH;
}

export function clampColumnWidth<TRow>(col: DataGridColumnDef<TRow>, width: number): number {
  return Math.max(getEffectiveMinWidth(col), Math.min(getEffectiveMaxWidth(col), width));
}

function distributeFlexWidths<TRow>(
  sizes: Record<string, number>,
  visibleColumns: readonly DataGridColumnDef<TRow>[],
  available: number,
): void {
  const flexCols = visibleColumns.filter((c) => c.flex != null && c.flex > 0);
  if (flexCols.length === 0 || available <= 0) return;
  const totalFlex = flexCols.reduce((acc, c) => acc + (c.flex ?? 0), 0);
  let remaining = available;
  flexCols.forEach((col, i) => {
    const isLast = i === flexCols.length - 1;
    const share = isLast
      ? remaining
      : Math.floor(available * ((col.flex ?? 0) / totalFlex));
    const max = getEffectiveMaxWidth(col);
    const add = Math.max(0, Math.min(share, max - sizes[col.id]));
    sizes[col.id] += add;
    remaining -= add;
  });
}

/** Grow flex columns when there is extra space; shrink flex (then fixed) columns when overflowing. */
export function fitColumnsToContainer<TRow>(
  sizes: Record<string, number>,
  visibleColumns: readonly DataGridColumnDef<TRow>[],
  containerWidth: number,
  chromeWidth: number,
): void {
  const getTotal = () =>
    chromeWidth + visibleColumns.reduce((sum, col) => sum + sizes[col.id], 0);

  if (containerWidth <= 0) return;

  const total = getTotal();
  if (total <= containerWidth) {
    distributeFlexWidths(sizes, visibleColumns, containerWidth - total);
    return;
  }

  let overflow = total - containerWidth;
  const flexCols = visibleColumns.filter((c) => (c.flex ?? 0) > 0);

  for (const col of flexCols) {
    if (overflow <= 0) break;
    const min = getEffectiveMinWidth(col);
    const reducible = sizes[col.id] - min;
    if (reducible <= 0) continue;
    const delta = Math.min(overflow, reducible);
    sizes[col.id] -= delta;
    overflow -= delta;
  }

  if (overflow <= 0) return;

  const shrinkable = visibleColumns
    .map((col) => ({
      col,
      reducible: sizes[col.id] - getEffectiveMinWidth(col),
    }))
    .filter((entry) => entry.reducible > 0);

  const totalReducible = shrinkable.reduce((sum, entry) => sum + entry.reducible, 0);
  if (totalReducible <= 0) return;

  let remaining = overflow;
  shrinkable.forEach((entry, index) => {
    const isLast = index === shrinkable.length - 1;
    const share = isLast
      ? remaining
      : Math.floor(overflow * (entry.reducible / totalReducible));
    const delta = Math.min(remaining, share, entry.reducible);
    sizes[entry.col.id] -= delta;
    remaining -= delta;
  });
}
