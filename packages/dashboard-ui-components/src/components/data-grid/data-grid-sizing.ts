import type { CSSProperties } from "react";
import type { DataGridColumnDef } from "./types";

// CSS variable names for column widths set on the grid container.
// Cells read these via var(...) so a single setProperty during drag
// resizes every cell in a column with zero React re-renders.

function colVar(id: string): `--col-${string}` {
  return `--col-${id}`;
}

// When col.minWidth is not set, the effective minimum is derived from
// the header label text width so the label is never clipped on resize.
// Uses an offscreen canvas for zero-layout measurement; results are
// cached per unique label string.

const MIN_COL_WIDTH = 20;
// px-3 both sides + gap-1.5 + sort icon (h-3 w-3) + 2px rounding buffer
const HEADER_CHROME_PX = 12 + 12 + 6 + 12 + 2;

let measureContext: CanvasRenderingContext2D | null = null;
const headerWidthCache = new Map<string, number>();

function measureHeaderLabelWidth(label: string): number {
  const cached = headerWidthCache.get(label);
  if (cached != null) {
    return cached;
  }

  if (typeof document === "undefined") {
    return 0;
  }
  if (measureContext == null) {
    measureContext = document.createElement("canvas").getContext("2d");
  }
  if (measureContext == null) {
    return 0;
  }

  // Match header cell: text-xs (12px) font-semibold (600) uppercase tracking-wider (0.05em)
  measureContext.font = "600 12px system-ui, -apple-system, sans-serif";
  const text = label.toUpperCase();
  const letterSpacingPx = 0.05 * 12;
  const width = Math.ceil(
    measureContext.measureText(text).width + letterSpacingPx * text.length,
  );

  headerWidthCache.set(label, width);
  return width;
}

export function getEffectiveMinWidth<TRow>(col: DataGridColumnDef<TRow>): number {
  if (col.minWidth != null) {
    return col.minWidth;
  }
  const label = typeof col.header === "string" ? col.header : null;
  if (label == null) {
    return MIN_COL_WIDTH;
  }
  return Math.max(MIN_COL_WIDTH, measureHeaderLabelWidth(label) + HEADER_CHROME_PX);
}

export function getColumnSizingStyle<TRow>(col: DataGridColumnDef<TRow>): CSSProperties {
  const w = `var(${colVar(col.id)})`;
  const grow = col.flex ?? 0;
  return {
    flex: `${grow} 0 ${w}`,
    width: w,
    minWidth: getEffectiveMinWidth(col),
    maxWidth: grow > 0 ? undefined : (col.maxWidth ?? 800),
  };
}

export function createGridSizingStyle(
  widths: ReadonlyMap<string, number>,
  totalWidth: number,
): Record<string, string> {
  const style: Record<string, string> = { "--grid-total-w": `${totalWidth}px` };
  for (const [id, w] of widths) {
    style[colVar(id)] = `${w}px`;
  }
  return style;
}

export function applyDraggedColumnWidth(
  el: HTMLElement,
  columnId: string,
  width: number,
  totalWidth: number,
) {
  el.style.setProperty(colVar(columnId), `${width}px`);
  el.style.setProperty("--grid-total-w", `${totalWidth}px`);
}

export function clampColumnWidth<TRow>(col: DataGridColumnDef<TRow>, width: number): number {
  const minWidth = getEffectiveMinWidth(col);
  const maxWidth = col.maxWidth ?? 800;
  return Math.max(minWidth, Math.min(maxWidth, width));
}
