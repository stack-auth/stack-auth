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
