import type { CSSProperties } from "react";
import type { DataGridColumnDef } from "./types";

// CSS variable names for column widths set on the grid container.
// Cells read these via var(...) so a single setProperty during drag
// resizes every cell in a column with zero React re-renders.

function colVar(id: string): `--col-${string}` {
  return `--col-${id}`;
}

export function getColumnSizingStyle<TRow>(col: DataGridColumnDef<TRow>): CSSProperties {
  const w = `var(${colVar(col.id)})`;
  return { flex: `0 0 ${w}`, width: w, minWidth: col.minWidth ?? 50, maxWidth: col.maxWidth ?? 800 };
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
  return Math.max(col.minWidth ?? 50, Math.min(col.maxWidth ?? 800, width));
}
