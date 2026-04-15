export type AnalyticsChartStrings = {
  /** Reset-zoom badge in the top-right corner when `state.zoomRange` is set. */
  resetZoom: string,
  /** Header label above the timestamps in the live range-brush popup. */
  rangeLabel: string,
  /** Formatted day-count suffix used by the brush + action-bar. */
  daysShort: (days: number) => string,
  /** "Zoom in" button inside the committed-range action bar. */
  zoomIn: string,
  /** "Annotate" button inside the committed-range action bar. */
  annotate: string,
  /** Placeholder for the annotation label input. */
  annotationPlaceholder: string,
  /** `aria-label` for the annotation label input. */
  annotationLabelAria: string,
  /** Save button in the annotation form. */
  save: string,
  /** Cancel button in the annotation form. */
  cancel: string,
  /** `aria-label` for the X button that clears the committed range. */
  clearSelection: string,
  /** Pinned badge shown in the tooltip header when the tooltip is pinned. */
  pinnedBadge: string,
  /** "Δ vs prev" row label in the tooltip (both segmented and flat modes). */
  deltaVsPrev: string,
  /** Suffix appended to a layer's label in the per-layer totals section
   * (e.g. "Sign-ups" → "Sign-ups total"). */
  layerTotalSuffix: string,
  /** Hint row shown in the tooltip while it is floating (not pinned). */
  hintClickToPin: string,
  /** Hint row shown in the tooltip while it is pinned. */
  hintClickAnywhereUnpin: string,
  /** Center-stat heading shown in the pie when no segment is hovered. */
  pieTotalCenter: string,
  /** Label on the TrendPill in the pie center. */
  pieVsPrev: string,
  /** `aria-label` for the PieChart SVG. */
  pieAriaLabel: (ctx: { segmentCount: number, windowDays: number }) => string,
  /** Percentage-of-total caption shown under an active pie slice. */
  piePercentOfTotal: (pct: number) => string,
};

export const ANALYTICS_CHART_DEFAULT_STRINGS: AnalyticsChartStrings = {
  resetZoom: "Reset zoom",
  rangeLabel: "Range",
  daysShort: (days) => `${days}d`,
  zoomIn: "Zoom in",
  annotate: "Annotate",
  annotationPlaceholder: "Label this range…",
  annotationLabelAria: "Annotation label",
  save: "Save",
  cancel: "Cancel",
  clearSelection: "Clear selection",
  pinnedBadge: "Pinned",
  deltaVsPrev: "Δ vs prev",
  layerTotalSuffix: " total",
  hintClickToPin: "Click to pin this point",
  hintClickAnywhereUnpin: "Click anywhere · Esc\u00A0to unpin",
  pieTotalCenter: "Total",
  pieVsPrev: "vs prev",
  pieAriaLabel: ({ segmentCount, windowDays }) =>
    `${segmentCount} segment share-of-total over the visible ${windowDays}-day range`,
  piePercentOfTotal: (pct) => `${(pct * 100).toFixed(1)}% of total`,
};

/** Shallow merge — every field is a primitive or a flat function. */
export function resolveAnalyticsChartStrings(
  override: Partial<AnalyticsChartStrings> | undefined,
): AnalyticsChartStrings {
  if (!override) return ANALYTICS_CHART_DEFAULT_STRINGS;
  return { ...ANALYTICS_CHART_DEFAULT_STRINGS, ...override };
}
