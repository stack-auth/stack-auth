export type AnalyticsChartMode = "default" | "dau" | "visitors" | "revenue";
export type AnalyticsChartMetricMode = Exclude<AnalyticsChartMode, "default">;

export const ANALYTICS_CHART_METRIC_MODE_ORDER: readonly AnalyticsChartMetricMode[] = [
  "dau",
  "visitors",
  "revenue",
];

export function toggleAnalyticsChartMetricMode(currentMode: AnalyticsChartMode, metricMode: AnalyticsChartMetricMode): AnalyticsChartMode {
  return currentMode === metricMode ? "default" : metricMode;
}
