import type { DataGridStrings } from "./types";

export const DATA_GRID_DEFAULT_STRINGS: DataGridStrings = {
  // toolbar
  searchPlaceholder: "Search\u2026",
  columns: "Columns",
  export: "Export",
  density: "Density",
  // column manager
  showAll: "Show all",
  hideAll: "Hide all",
  resetColumns: "Reset",
  // date display
  dateFormat: "Date format",
  dateFormatRelative: "Relative",
  dateFormatAbsolute: "Absolute",
  // selection
  rowsSelected: (count) => `${count} row${count === 1 ? "" : "s"} selected`,
  // pagination
  rowsPerPage: "Rows per page",
  pageOf: (page, total) => `${page} of ${total}`,
  // empty / loading
  noData: "No data",
  loading: "Loading\u2026",
  loadingMore: "Loading more\u2026",
  // export
  exportCsv: "Export CSV",
  exportCopied: "Copied!",
  // sort
  sortAsc: "Sort ascending",
  sortDesc: "Sort descending",
  unsort: "Remove sort",
  // misc
  pinLeft: "Pin left",
  pinRight: "Pin right",
  unpin: "Unpin",
  hideColumn: "Hide column",
};

export function resolveDataGridStrings(
  override: Partial<DataGridStrings> | undefined,
): DataGridStrings {
  if (!override) return DATA_GRID_DEFAULT_STRINGS;
  return { ...DATA_GRID_DEFAULT_STRINGS, ...override };
}
