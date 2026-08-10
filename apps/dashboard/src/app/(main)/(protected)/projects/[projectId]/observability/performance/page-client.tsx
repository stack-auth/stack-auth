"use client";

import {
  DesignAlert,
  DesignAnalyticsCard,
  DesignAnalyticsCardHeader,
  DesignBadge,
  DesignButton,
  DesignPillToggle,
  DesignSelectorDropdown,
} from "@/components/design-components";
import { cn } from "@/lib/utils";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import {
  ArrowClockwiseIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  GraphIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { Link } from "@/components/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { StickyPageHeader } from "../../sticky-page-header";
import { useAdminApp } from "../../use-admin-app";
import { traceDetailHref } from "../issues/issue-links";
import {
  fetchPerformanceMetrics,
  fetchWebVitals,
  PERFORMANCE_TIME_RANGES,
  WEB_VITAL_METRICS,
  type PerformanceMetricCatalogEntry,
  type PerformanceMetricResponse,
  type PerformanceTimeRangeHours,
  type WebVitalMetricDefinition,
  type WebVitalMetricKey,
} from "./performance-data";

function formatMetricType(metricType: PerformanceMetricCatalogEntry["metric_type"]): string {
  if (metricType === "exponential_histogram") return "Exponential histogram";
  return metricType.charAt(0).toUpperCase() + metricType.slice(1);
}

function formatMetricValue(value: number | null, unit: string): string {
  if (value === null) return "Not numerically aggregated";
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  return unit === "" ? formatted : `${formatted} ${unit}`;
}

function formatUnixNano(value: string): string {
  if (!/^\d+$/.test(value)) throw new Error(`Cannot format invalid metric timestamp: ${value}`);
  const milliseconds = Number(BigInt(value) / BigInt(1_000_000));
  if (!Number.isSafeInteger(milliseconds)) throw new Error(`Metric timestamp is outside the supported display range: ${value}`);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(milliseconds));
}

function metricSelectorValue(entry: PerformanceMetricCatalogEntry): string {
  return `${entry.metric_name}::${entry.metric_type}`;
}

function metricSelectorOptions(catalog: readonly PerformanceMetricCatalogEntry[]) {
  return catalog.map((entry) => ({
    value: metricSelectorValue(entry),
    label: `${entry.metric_name} · ${formatMetricType(entry.metric_type)}`,
  }));
}

type WebVitalRating = {
  label: "Good" | "Needs work" | "Poor" | "No data",
  color: "green" | "orange" | "red" | "zinc",
};

function webVitalValue(response: PerformanceMetricResponse | undefined): number | null {
  if (response === undefined) return null;
  let weightedTotal = 0;
  let pointTotal = 0;
  for (const point of response.series) {
    if (point.numeric_value === null || point.point_count === 0) continue;
    weightedTotal += point.numeric_value * point.point_count;
    pointTotal += point.point_count;
  }
  return pointTotal === 0 ? null : weightedTotal / pointTotal;
}

function webVitalRating(metric: WebVitalMetricDefinition, value: number | null): WebVitalRating {
  if (value === null) return { label: "No data", color: "zinc" };
  if (metric.lowerIsBetter) {
    if (value <= metric.goodThreshold) return { label: "Good", color: "green" };
    if (value <= metric.needsImprovementThreshold) return { label: "Needs work", color: "orange" };
    return { label: "Poor", color: "red" };
  }
  if (value >= metric.goodThreshold) return { label: "Good", color: "green" };
  if (value >= metric.needsImprovementThreshold) return { label: "Needs work", color: "orange" };
  return { label: "Poor", color: "red" };
}

function formatWebVitalValue(metric: WebVitalMetricDefinition, value: number | null): string {
  if (value === null) return "No data";
  const maximumFractionDigits = metric.key === "cls" ? 3 : metric.key === "fps" ? 1 : 0;
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
  return metric.unit === "" ? formatted : `${formatted} ${metric.unit}`;
}

function WebVitalSparkline({ response, metric }: { response: PerformanceMetricResponse | undefined, metric: WebVitalMetricDefinition }) {
  const values = response?.series
    .map((point) => point.numeric_value)
    .filter((value): value is number => value !== null) ?? [];
  const minimum = metric.lowerIsBetter ? 0 : values.length === 0 ? 0 : Math.min(...values);
  const maximum = values.length === 0 ? 1 : Math.max(...values);
  const span = maximum - minimum || 1;

  return (
    <div className="flex h-8 items-end gap-0.5" aria-label={`${metric.label} trend`}>
      {values.length === 0 ? (
        <div className="h-px w-full bg-foreground/[0.12]" />
      ) : values.map((value, index) => {
        const normalized = metric.lowerIsBetter
          ? 1 - ((value - minimum) / span)
          : (value - minimum) / span;
        return (
          <span
            key={`${metric.key}-${index}`}
            className="min-w-0 flex-1 rounded-t-sm bg-cyan-500/70"
            style={{ height: `${Math.max(12, normalized * 80 + 20)}%` }}
            title={formatWebVitalValue(metric, value)}
          />
        );
      })}
    </div>
  );
}

function WebVitalsOverview({
  responses,
  rangeLabel,
}: {
  responses: ReadonlyMap<WebVitalMetricKey, PerformanceMetricResponse>,
  rangeLabel: string,
}) {
  const samples = WEB_VITAL_METRICS.reduce((count, metric) => {
    const response = responses.get(metric.key);
    return count + (response?.series.reduce((total, point) => total + point.point_count, 0) ?? 0);
  }, 0);

  return (
    <section aria-labelledby="browser-performance-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <h2 id="browser-performance-heading" className="text-sm font-semibold">Browser performance</h2>
          <p className="mt-1 text-xs text-muted-foreground">Real-user Web Vitals and frame-rate samples from native browser Metrics.</p>
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {samples === 0 ? `No browser samples in ${rangeLabel}` : `${samples.toLocaleString()} browser samples`}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {WEB_VITAL_METRICS.map((metric) => {
          const response = responses.get(metric.key);
          const value = webVitalValue(response);
          const rating = webVitalRating(metric, value);
          return (
            <DesignAnalyticsCard key={metric.key} gradient={rating.color === "red" ? "orange" : rating.color === "green" ? "green" : "cyan"} className="overflow-hidden">
              <div className="flex items-start justify-between gap-2 px-4 pt-4">
                <div>
                  <p className="text-xs font-semibold tracking-wide">{metric.label}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{metric.description}</p>
                </div>
                <DesignBadge label={rating.label} color={rating.color} size="sm" />
              </div>
              <div className="px-4 pb-3 pt-4">
                <p className={cn("text-xl font-semibold tabular-nums", value === null && "text-muted-foreground")}>{formatWebVitalValue(metric, value)}</p>
                <div className="mt-4">
                  <WebVitalSparkline response={response} metric={metric} />
                </div>
              </div>
            </DesignAnalyticsCard>
          );
        })}
      </div>
    </section>
  );
}

function selectedCatalogEntry(
  response: PerformanceMetricResponse,
): PerformanceMetricCatalogEntry | null {
  if (response.selected_metric_name === null || response.selected_metric_type === null) return null;
  return response.catalog.find((entry) => (
    entry.metric_name === response.selected_metric_name && entry.metric_type === response.selected_metric_type
  )) ?? null;
}

function MetricSeries({ response, metric }: { response: PerformanceMetricResponse, metric: PerformanceMetricCatalogEntry }) {
  const showsPointVolume = metric.supports_numeric_aggregation === false;
  const chartValues = response.series
    .map((point) => showsPointVolume ? point.point_count : point.numeric_value)
    .filter((value): value is number => value !== null);
  const minimum = showsPointVolume ? 0 : chartValues.length === 0 ? 0 : Math.min(...chartValues);
  const maximum = chartValues.length === 0 ? 1 : Math.max(...chartValues);
  const span = maximum - minimum || 1;

  return (
    <div className="space-y-3">
      <div className="flex h-28 items-end gap-1 rounded-xl bg-foreground/[0.025] px-3 py-4" aria-label={`${metric.metric_name} ${showsPointVolume ? "point volume" : "metric series"}`}>
        {response.series.length === 0 ? (
          <div className="flex h-28 w-full items-center justify-center text-xs text-muted-foreground">No points in this window.</div>
        ) : response.series.map((point) => {
          const value = point.numeric_value;
          const height = showsPointVolume
            ? Math.max(8, (point.point_count / Math.max(maximum, 1)) * 92 + 8)
            : value === null ? 6 : Math.max(8, ((value - minimum) / span) * 92 + 8);
          const title = showsPointVolume
            ? `${formatUnixNano(point.bucket_start_unix_nano)} · ${point.point_count.toLocaleString()} points in bucket`
            : `${formatUnixNano(point.bucket_start_unix_nano)} · ${formatMetricValue(value, metric.metric_unit)}`;
          return (
            <div
              key={point.bucket_start_unix_nano}
              className={cn("group relative min-w-0 flex-1 rounded-t-sm", showsPointVolume ? "bg-orange-400/60" : "bg-cyan-500/70")}
              style={{ height: `${height}%`, minHeight: "0.375rem" }}
              title={title}
            >
              {point.exemplar != null && (
                <span className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-purple-500 ring-2 ring-background" aria-label="Trace exemplar" />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {showsPointVolume ? "Point volume per bucket" : "Average value per bucket"}
      </p>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{response.series.length === 0 ? "No data" : formatUnixNano(response.series[0].bucket_start_unix_nano)}</span>
        <span>{response.series.length === 0 ? "" : formatUnixNano(response.series[response.series.length - 1].bucket_start_unix_nano)}</span>
      </div>
    </div>
  );
}

function MetricCatalog({
  catalog,
  selected,
  onSelect,
}: {
  catalog: readonly PerformanceMetricCatalogEntry[],
  selected: string,
  onSelect: (value: string) => void,
}) {
  return (
    <DesignAnalyticsCard gradient="slate" className="overflow-hidden">
      <DesignAnalyticsCardHeader label="Metric streams" />
      <div className="space-y-2 p-4">
        {catalog.length === 0 ? (
          <div className="rounded-xl border border-dashed border-foreground/[0.1] px-3 py-6 text-center text-xs text-muted-foreground">
            No native metric streams have arrived yet.
          </div>
        ) : (
          <>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="performance-metric-select">
              Stream
            </label>
            <DesignSelectorDropdown
              triggerId="performance-metric-select"
              value={selected}
              onValueChange={onSelect}
              options={metricSelectorOptions(catalog)}
              size="sm"
              className="w-full"
            />
            <div className="space-y-2 pt-2">
              {catalog.slice(0, 8).map((entry) => (
                <button
                  key={metricSelectorValue(entry)}
                  type="button"
                  onClick={() => onSelect(metricSelectorValue(entry))}
                  className={cn(
                    "w-full rounded-xl p-3 text-left ring-1 ring-foreground/[0.06] transition-colors duration-150 hover:bg-foreground/[0.04] hover:transition-none",
                    selected === metricSelectorValue(entry) && "bg-cyan-500/[0.06] ring-cyan-500/30",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">{entry.metric_name}</span>
                    <DesignBadge label={formatMetricType(entry.metric_type)} color={entry.supports_numeric_aggregation ? "blue" : "orange"} size="sm" />
                  </span>
                  <span className="mt-1 block text-[11px] tabular-nums text-muted-foreground">
                    {entry.point_count.toLocaleString()} points{entry.metric_unit === "" ? "" : ` · ${entry.metric_unit}`}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </DesignAnalyticsCard>
  );
}

function PerformancePageClient() {
  const adminApp = useAdminApp();
  const [hours, setHours] = useState<PerformanceTimeRangeHours>(24);
  const [metricSelector, setMetricSelector] = useState("");
  const [response, setResponse] = useState<PerformanceMetricResponse | null>(null);
  const [webVitalResponses, setWebVitalResponses] = useState<Map<WebVitalMetricKey, PerformanceMetricResponse>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestSequence = useRef(0);

  const selectedMetricName = useMemo(() => {
    const separator = metricSelector.lastIndexOf("::");
    return separator < 0 ? null : metricSelector.slice(0, separator);
  }, [metricSelector]);

  const load = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setError(null);
    try {
      const [next, nextWebVitalResponses] = await Promise.all([
        fetchPerformanceMetrics(adminApp, { hours, metricName: selectedMetricName }),
        fetchWebVitals(adminApp, hours),
      ]);
      if (sequence !== requestSequence.current) return;
      setResponse(next);
      setWebVitalResponses(nextWebVitalResponses);
      const selected = selectedCatalogEntry(next);
      if (selected != null) {
        setMetricSelector(metricSelectorValue(selected));
      } else if (next.catalog.length === 0) {
        setMetricSelector("");
      } else {
        setMetricSelector(metricSelectorValue(next.catalog[0]));
      }
    } catch (caught) {
      if (sequence === requestSequence.current) {
        setError(caught instanceof Error ? caught.message : "Native metrics could not be loaded");
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [adminApp, hours, selectedMetricName]);

  useEffect(() => {
    runAsynchronouslyWithAlert(load);
  }, [load]);

  const selected = response == null ? null : selectedCatalogEntry(response);
  const latestPoint = response?.series.at(-1);
  const selectedShowsPointVolume = selected?.supports_numeric_aggregation === false;
  const rangeLabel = PERFORMANCE_TIME_RANGES.find((range) => range.hours === hours)?.label ?? `${hours}h`;

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      <DesignPillToggle
        selected={String(hours)}
        onSelect={(id) => {
          const next = Number(id);
          const range = PERFORMANCE_TIME_RANGES.find((candidate) => candidate.hours === next);
          if (range == null) throw new Error(`Unknown performance time range: ${id}`);
          setHours(range.hours);
        }}
        options={PERFORMANCE_TIME_RANGES.map((range) => ({ label: range.label, id: String(range.hours) }))}
        size="sm"
        glassmorphic={false}
      />
      <DesignButton variant="secondary" size="sm" onClick={load} loading={loading}>
        <ArrowClockwiseIcon className="mr-1.5 h-3.5 w-3.5" />
        Refresh
      </DesignButton>
    </div>
  );

  return (
    <AppEnabledGuard appId="observability">
      <PageLayout fillWidth>
        <StickyPageHeader
          title="Performance"
          description={`Browser Web Vitals and native OpenTelemetry metric streams for the last ${rangeLabel}.`}
          actions={headerActions}
          sticky
          layoutGroupId="observability-performance-sticky-header"
        />

        {error != null && (
          <DesignAlert
            variant="error"
            title="Native metrics could not be loaded"
            description={error}
          />
        )}

        {loading && response == null ? (
          <DesignAnalyticsCard gradient="slate">
            <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-muted-foreground">
              <SpinnerGapIcon className="h-4 w-4 animate-spin" />
              Loading native metric streams…
            </div>
          </DesignAnalyticsCard>
        ) : (
          <div className="space-y-5">
            <WebVitalsOverview responses={webVitalResponses} rangeLabel={rangeLabel} />
            {response == null || response.catalog.length === 0 ? (
              <DesignAnalyticsCard gradient="blue">
                <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center">
                  <GraphIcon className="h-8 w-8 text-muted-foreground/60" />
                  <h2 className="mt-4 text-sm font-semibold">No additional native metric streams in this window</h2>
                  <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">
                    The cards above are backed by browser OTel Metrics. Server metrics, logs, traces, and custom streams appear here when they have data in the selected range.
                  </p>
                </div>
              </DesignAnalyticsCard>
            ) : (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="min-w-0 space-y-4">
                  {response.partial.has_unsupported_metric_types && (
                    <DesignAlert
                      variant="warning"
                      title="Some metric types are shown without numeric aggregation"
                      description={`Histogram, exponential histogram, and summary streams remain visible as point counts and exemplars. Numeric min/average/max values are shown only for gauge and sum streams.`}
                    />
                  )}
                  {selected == null ? (
                    <DesignAnalyticsCard gradient="cyan">
                      <div className="p-4 text-sm text-muted-foreground">Select a metric stream to view its series.</div>
                    </DesignAnalyticsCard>
                  ) : (
                    <DesignAnalyticsCard gradient="cyan" className="overflow-hidden">
                      <DesignAnalyticsCardHeader
                        label={selected.metric_name}
                        right={<DesignBadge label={formatMetricType(selected.metric_type)} color="blue" size="sm" />}
                      />
                      <div className="space-y-5 p-4">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{selectedShowsPointVolume ? "Latest bucket points" : "Latest average"}</p>
                            <p className="mt-1 text-xl font-semibold tabular-nums">{selectedShowsPointVolume ? latestPoint?.point_count.toLocaleString() ?? "No points" : formatMetricValue(latestPoint?.numeric_value ?? null, selected.metric_unit)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Metric points</p>
                            <p className="mt-1 text-xl font-semibold tabular-nums">{selected.point_count.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Last observed</p>
                            <p className="mt-1 text-sm font-medium">{formatUnixNano(selected.latest_time_unix_nano)}</p>
                          </div>
                        </div>
                        <MetricSeries response={response} metric={selected} />
                        {response.series.some((point) => point.exemplar != null) && (
                          <div className="space-y-2 border-t border-foreground/[0.06] pt-4">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Trace exemplars</p>
                            {response.series.filter((point) => point.exemplar != null).slice(-3).map((point) => {
                              const exemplar = point.exemplar;
                              if (exemplar == null) return null;
                              return (
                                <Link
                                  key={`${point.bucket_start_unix_nano}-${exemplar.trace_id}`}
                                  href={traceDetailHref(adminApp.projectId, exemplar.trace_id)}
                                  className="flex items-center justify-between gap-3 rounded-xl bg-foreground/[0.025] px-3 py-2 text-xs ring-1 ring-foreground/[0.06] transition-colors duration-150 hover:bg-foreground/[0.05] hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                >
                                  <span className="min-w-0 truncate font-mono">{exemplar.trace_id}</span>
                                  <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                                    Open trace <ArrowUpRightIcon className="h-3.5 w-3.5" />
                                  </span>
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </DesignAnalyticsCard>
                  )}
                  <p className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
                    {selected?.supports_numeric_aggregation === false ? <WarningCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" /> : <CheckCircleIcon className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                    <span>
                      Native metric identity, temporality, point type, and exemplars are preserved. This read model intentionally does not merge metric streams with span-derived service performance.
                    </span>
                  </p>
                </div>
                <MetricCatalog
                  catalog={response.catalog}
                  selected={metricSelector}
                  onSelect={(value) => setMetricSelector(value)}
                />
              </div>
            )}
            <DesignAnalyticsCard gradient="slate" className="overflow-hidden">
              <DesignAnalyticsCardHeader label="Signal paths" right={<DesignBadge label="Separate streams" color="zinc" size="sm" />} />
              <div className="grid gap-3 p-4 text-xs sm:grid-cols-3">
                <div className="rounded-xl bg-cyan-500/[0.05] p-3 ring-1 ring-cyan-500/15">
                  <p className="font-medium">Browser Metrics</p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">Web Vitals, FPS, and browser-generated OTel metric points.</p>
                </div>
                <Link href={urlString`/projects/${adminApp.projectId}/observability/logs`} className="rounded-xl p-3 ring-1 ring-foreground/[0.06] transition-colors duration-150 hover:bg-foreground/[0.04] hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <p className="flex items-center justify-between gap-2 font-medium">Logs <ArrowUpRightIcon className="h-3.5 w-3.5 text-muted-foreground" /></p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">Structured log records and client error signals.</p>
                </Link>
                <Link href={urlString`/projects/${adminApp.projectId}/observability/traces`} className="rounded-xl p-3 ring-1 ring-foreground/[0.06] transition-colors duration-150 hover:bg-foreground/[0.04] hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <p className="flex items-center justify-between gap-2 font-medium">Traces <ArrowUpRightIcon className="h-3.5 w-3.5 text-muted-foreground" /></p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">Request spans, page views, and trace exemplars.</p>
                </Link>
              </div>
            </DesignAnalyticsCard>
          </div>
        )}
      </PageLayout>
    </AppEnabledGuard>
  );
}

export default PerformancePageClient;
