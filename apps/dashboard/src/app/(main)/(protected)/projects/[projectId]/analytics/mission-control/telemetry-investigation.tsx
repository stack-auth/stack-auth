"use client";

import {
  DesignAlert,
  DesignAnalyticsCard,
  DesignAnalyticsCardHeader,
  DesignBadge,
} from "@/components/design-components";
import { cn } from "@/lib/utils";
import {
  BugIcon,
  PulseIcon,
  StackIcon,
  TerminalWindowIcon,
  TreeStructureIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import type {
  IncidentError,
  IncidentMetric,
  IncidentStory,
  StructuredLog,
  TopologyEdge,
  TopologyNode,
  WaterfallSpan,
} from "./stories";

export type TelemetryInvestigationProps = {
  story: IncidentStory,
  activeStageIndex: number,
  selectedSpanId: string | null,
  onSelectSpan: (spanId: string) => void,
};

type SemanticState = "healthy" | "degraded" | "critical";
type BadgeColor = "blue" | "cyan" | "purple" | "green" | "orange" | "red";

const topologyColumns = 3;

function formatMetricValue(metric: IncidentMetric, value: number): string {
  switch (metric.unit) {
    case "percent": {
      return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
    }
    case "milliseconds": {
      return `${value.toLocaleString()} ms`;
    }
    case "count": {
      return value.toLocaleString();
    }
    case "requests-per-minute": {
      return `${value.toLocaleString()} rpm`;
    }
    case "dollars": {
      return value.toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });
    }
    default: {
      const exhaustiveUnit: never = metric.unit;
      return exhaustiveUnit;
    }
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs.toLocaleString()} ms`;
  return `${(durationMs / 1_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} s`;
}

function formatOffset(offsetMs: number): string {
  const minutes = Math.floor(offsetMs / 60_000);
  const seconds = Math.floor((offsetMs % 60_000) / 1_000);
  const milliseconds = offsetMs % 1_000;
  return `+${minutes}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
}

function badgeColorForHealth(health: SemanticState): BadgeColor {
  switch (health) {
    case "healthy": {
      return "green";
    }
    case "degraded": {
      return "orange";
    }
    case "critical": {
      return "red";
    }
    default: {
      const exhaustiveHealth: never = health;
      return exhaustiveHealth;
    }
  }
}

function badgeColorForLog(level: StructuredLog["level"]): BadgeColor {
  switch (level) {
    case "debug": {
      return "purple";
    }
    case "info": {
      return "blue";
    }
    case "warn": {
      return "orange";
    }
    case "error": {
      return "red";
    }
    default: {
      const exhaustiveLevel: never = level;
      return exhaustiveLevel;
    }
  }
}

function topologyStateClass(health: SemanticState): string {
  switch (health) {
    case "healthy": {
      return "text-emerald-600 dark:text-emerald-400";
    }
    case "degraded": {
      return "text-amber-600 dark:text-amber-400";
    }
    case "critical": {
      return "text-red-600 dark:text-red-400";
    }
    default: {
      const exhaustiveHealth: never = health;
      return exhaustiveHealth;
    }
  }
}

function getCriticalPath(spans: WaterfallSpan[], error: IncidentError | undefined): Set<string> {
  const criticalPath = new Set<string>();
  let spanId: string | null | undefined = error?.spanId;
  while (spanId != null) {
    if (criticalPath.has(spanId)) break;
    criticalPath.add(spanId);
    spanId = spans.find((span) => span.id === spanId)?.parentId;
  }
  return criticalPath;
}

function MetricSummary({ metric }: { metric: IncidentMetric }) {
  const currentDelta = metric.current - metric.baseline;
  const recoveredNearBaseline = Math.abs(metric.recovered - metric.baseline)
    <= Math.max(Math.abs(metric.baseline) * 0.1, 0.1);

  return (
    <div className="min-w-0 border-r border-foreground/[0.06] px-4 py-3 last:border-r-0">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {metric.label}
        </span>
        <DesignBadge
          label={recoveredNearBaseline ? "Recovered" : "Elevated"}
          color={recoveredNearBaseline ? "green" : "orange"}
          size="sm"
        />
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
          {formatMetricValue(metric, metric.current)}
        </span>
        <span className={cn(
          "pb-0.5 font-mono text-[10px] tabular-nums",
          metric.higherIsWorse === (currentDelta > 0)
            ? "text-red-600 dark:text-red-400"
            : "text-emerald-600 dark:text-emerald-400",
        )}>
          {currentDelta > 0 ? "+" : ""}{formatMetricValue(metric, currentDelta)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
        <span>base {formatMetricValue(metric, metric.baseline)}</span>
        <span>now {formatMetricValue(metric, metric.recovered)}</span>
      </div>
    </div>
  );
}

function TraceWaterfall({
  story,
  selectedSpanId,
  onSelectSpan,
}: {
  story: IncidentStory,
  selectedSpanId: string | null,
  onSelectSpan: (spanId: string) => void,
}) {
  const shouldReduceMotion = useReducedMotion();
  const spans = story.waterfallSpans;
  const traceStart = spans.reduce(
    (minimum, span) => Math.min(minimum, span.startOffsetMs),
    spans[0]?.startOffsetMs ?? 0,
  );
  const traceEnd = spans.reduce(
    (maximum, span) => Math.max(maximum, span.startOffsetMs + span.durationMs),
    traceStart + 1,
  );
  const traceDuration = Math.max(traceEnd - traceStart, 1);
  const relevantError = story.errors.find((error) => error.spanId === selectedSpanId)
    ?? story.errors[0];
  const criticalPath = useMemo(
    () => getCriticalPath(spans, relevantError),
    [relevantError, spans],
  );

  return (
    <DesignAnalyticsCard gradient="cyan" chart={{ type: "none" }}>
      <DesignAnalyticsCardHeader
        label="Distributed trace waterfall"
        right={(
          <div className="flex items-center gap-2">
            <DesignBadge label={`${spans.length} spans`} color="cyan" size="sm" />
            <span className="font-mono text-[10px] text-muted-foreground">
              {formatDuration(traceDuration)}
            </span>
          </div>
        )}
      />
      <div className="overflow-x-auto p-4">
        <div className="min-w-[680px]" role="tree" aria-label={`Trace waterfall for ${story.shortTitle}`}>
          <div className="mb-2 grid grid-cols-[220px_1fr_68px] gap-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Service · operation</span>
            <span>Relative duration</span>
            <span className="text-right">Latency</span>
          </div>
          <div className="space-y-1">
            {spans.map((span, index) => {
              const left = ((span.startOffsetMs - traceStart) / traceDuration) * 100;
              const width = Math.max((span.durationMs / traceDuration) * 100, 1.2);
              const selected = selectedSpanId === span.id;
              const isCritical = criticalPath.has(span.id);
              const spanEvents = story.logs.filter((log) => log.spanId === span.id);

              return (
                <button
                  key={span.id}
                  type="button"
                  role="treeitem"
                  aria-selected={selected}
                  onClick={() => onSelectSpan(span.id)}
                  className={cn(
                    "grid w-full grid-cols-[220px_1fr_68px] items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors duration-150 hover:bg-foreground/[0.04] hover:transition-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected && "bg-foreground/[0.06] ring-1 ring-foreground/[0.1]",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${Math.min(index, 3) * 8}px` }}>
                    <span className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      span.status === "error" ? "bg-red-500" : "bg-emerald-500",
                    )} />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-foreground">{span.operation}</span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">{span.service}</span>
                    </span>
                  </span>
                  <span className="relative h-7 overflow-hidden rounded-md bg-foreground/[0.035]">
                    <motion.span
                      initial={shouldReduceMotion ? false : { scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: shouldReduceMotion ? 0 : 0.28, delay: shouldReduceMotion ? 0 : index * 0.035 }}
                      className={cn(
                        "absolute top-1 h-5 origin-left rounded",
                        span.status === "error"
                          ? "bg-red-500/75"
                          : isCritical
                            ? "bg-amber-500/75"
                            : "bg-cyan-500/65",
                      )}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                    {spanEvents.map((event) => {
                      const markerLeft = ((event.offsetMs - traceStart) / traceDuration) * 100;
                      return (
                        <span
                          key={event.id}
                          className="absolute top-0 h-7 w-px bg-foreground/80"
                          style={{ left: `${Math.max(0, Math.min(markerLeft, 100))}%` }}
                          title={`${event.level}: ${event.message}`}
                          aria-label={`Event: ${event.message}`}
                        >
                          <span className="absolute -left-0.5 top-0 h-1.5 w-1.5 rotate-45 bg-foreground" />
                        </span>
                      );
                    })}
                  </span>
                  <span className="text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                    {formatDuration(span.durationMs)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-foreground/[0.05] pt-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-amber-500/75" />Critical path</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-cyan-500/65" />Healthy span</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-red-500/75" />Failed span</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-px bg-foreground" />Structured event</span>
          </div>
        </div>
      </div>
    </DesignAnalyticsCard>
  );
}

function StructuredLogs({
  logs,
  selectedSpanId,
  onSelectSpan,
}: {
  logs: StructuredLog[],
  selectedSpanId: string | null,
  onSelectSpan: (spanId: string) => void,
}) {
  return (
    <DesignAnalyticsCard gradient="slate" chart={{ type: "none" }}>
      <DesignAnalyticsCardHeader
        label="Stage-aligned logs"
        right={<DesignBadge label={`${logs.length} events`} color="blue" size="sm" />}
      />
      {logs.length === 0 ? (
        <div className="p-4">
          <DesignAlert
            variant="info"
            title="No logs in this stage"
            description="Advance playback to inspect stage-specific telemetry."
          />
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto" role="log" aria-label="Structured logs for the active incident stage">
          {logs.map((log) => (
            <button
              key={log.id}
              type="button"
              onClick={() => onSelectSpan(log.spanId)}
              className={cn(
                "grid w-full grid-cols-[76px_64px_minmax(0,1fr)] gap-2 border-b border-foreground/[0.05] px-4 py-3 text-left outline-none transition-colors duration-150 last:border-b-0 hover:bg-foreground/[0.035] hover:transition-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                selectedSpanId === log.spanId && "bg-foreground/[0.05]",
              )}
            >
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{formatOffset(log.offsetMs)}</span>
              <DesignBadge label={log.level} color={badgeColorForLog(log.level)} size="sm" />
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-xs font-medium text-foreground">{log.message}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{log.service}</span>
                </span>
                <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                  trace={log.traceId} · span={log.spanId}
                </span>
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
                  {log.attributes.map((attribute) => (
                    <span key={attribute.key}>{attribute.key}={String(attribute.value)}</span>
                  ))}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </DesignAnalyticsCard>
  );
}

function ErrorIssue({
  error,
  activeStageKind,
}: {
  error: IncidentError | undefined,
  activeStageKind: IncidentStory["stages"][number]["kind"],
}) {
  const regressionLabel = activeStageKind === "recovery"
    ? "Resolved"
    : activeStageKind === "mitigation"
      ? "Recovering"
      : "Regressed";
  const regressionColor: BadgeColor = activeStageKind === "recovery"
    ? "green"
    : activeStageKind === "mitigation"
      ? "orange"
      : "red";

  return (
    <DesignAnalyticsCard gradient="orange" chart={{ type: "none" }}>
      <DesignAnalyticsCardHeader
        label="Grouped error issue"
        right={<DesignBadge label={regressionLabel} color={regressionColor} size="sm" />}
      />
      {error == null ? (
        <div className="p-4">
          <DesignAlert variant="success" title="No grouped issue" description="No error fingerprint is associated with this incident." />
        </div>
      ) : (
        <div className="p-4">
          <div className="flex flex-col gap-3 border-b border-foreground/[0.06] pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <BugIcon className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" weight="fill" />
                <h3 className="truncate text-sm font-semibold text-foreground">{error.title}</h3>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{error.message}</p>
              <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">fingerprint={error.fingerprint}</p>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-4 text-right">
              <div>
                <div className="font-mono text-base font-semibold tabular-nums text-foreground">{error.count.toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">events</div>
              </div>
              <div>
                <div className="font-mono text-base font-semibold tabular-nums text-foreground">{error.affectedUsers.toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">users</div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 pt-4 lg:grid-cols-2">
            <section aria-labelledby="stack-frames-heading">
              <h4 id="stack-frames-heading" className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <StackIcon className="h-3.5 w-3.5" />
                Stack frames
              </h4>
              <div className="space-y-1">
                {error.stackFrames.map((frame) => (
                  <div
                    key={`${frame.file}:${frame.line}:${frame.column}`}
                    className={cn(
                      "rounded-lg px-3 py-2 font-mono text-[10px]",
                      frame.inApplication ? "bg-red-500/[0.07]" : "bg-foreground/[0.035]",
                    )}
                  >
                    <div className="truncate font-semibold text-foreground">{frame.functionName}()</div>
                    <div className="truncate text-muted-foreground">{frame.file}:{frame.line}:{frame.column}</div>
                  </div>
                ))}
              </div>
            </section>
            <section aria-labelledby="breadcrumbs-heading">
              <h4 id="breadcrumbs-heading" className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <TerminalWindowIcon className="h-3.5 w-3.5" />
                Breadcrumbs
              </h4>
              <div className="space-y-1">
                {error.breadcrumbs.map((breadcrumb) => (
                  <div key={`${breadcrumb.offsetMs}-${breadcrumb.message}`} className="grid grid-cols-[64px_1fr] gap-2 rounded-lg bg-foreground/[0.035] px-3 py-2">
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{formatOffset(breadcrumb.offsetMs)}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[10px] font-medium text-foreground">{breadcrumb.message}</span>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{breadcrumb.category} · {breadcrumb.level}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </DesignAnalyticsCard>
  );
}

function nodePosition(index: number, nodeCount: number): { x: number, y: number } {
  const columns = Math.min(topologyColumns, Math.max(nodeCount, 1));
  const rows = Math.ceil(nodeCount / columns);
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: columns === 1 ? 300 : 80 + (column * 440) / (columns - 1),
    y: rows === 1 ? 100 : 45 + (row * 110) / (rows - 1),
  };
}

function findNodePosition(nodes: TopologyNode[], nodeId: string): { x: number, y: number } | undefined {
  const index = nodes.findIndex((node) => node.id === nodeId);
  return index === -1 ? undefined : nodePosition(index, nodes.length);
}

function TopologyConnection({ edge, nodes }: { edge: TopologyEdge, nodes: TopologyNode[] }) {
  const source = findNodePosition(nodes, edge.source);
  const target = findNodePosition(nodes, edge.target);
  if (source == null || target == null) return null;

  return (
    <g className={topologyStateClass(edge.health)}>
      <line
        x1={source.x}
        y1={source.y}
        x2={target.x}
        y2={target.y}
        stroke="currentColor"
        strokeWidth={edge.health === "healthy" ? 1.5 : 2.5}
        strokeDasharray={edge.health === "healthy" ? undefined : "5 4"}
        opacity={0.65}
      />
      <text
        x={(source.x + target.x) / 2}
        y={(source.y + target.y) / 2 - 5}
        fill="currentColor"
        textAnchor="middle"
        className="text-[8px] font-medium"
      >
        {edge.protocol} · {edge.requestsPerMinute.toLocaleString()} rpm
      </text>
    </g>
  );
}

function ServiceTopologyView({ story }: { story: IncidentStory }) {
  const nodes = story.topology.nodes;
  return (
    <DesignAnalyticsCard gradient="purple" chart={{ type: "none" }}>
      <DesignAnalyticsCardHeader
        label="Service topology"
        right={(
          <div className="flex items-center gap-1.5">
            <DesignBadge
              label={`${nodes.filter((node) => node.health === "healthy").length} healthy`}
              color="green"
              size="sm"
            />
            <DesignBadge
              label={`${nodes.filter((node) => node.health !== "healthy").length} impaired`}
              color="orange"
              size="sm"
            />
          </div>
        )}
      />
      <div className="p-4">
        <svg
          viewBox="0 0 600 200"
          className="h-auto min-h-52 w-full"
          role="img"
          aria-labelledby={`topology-title-${story.id} topology-description-${story.id}`}
        >
          <title id={`topology-title-${story.id}`}>Service topology for {story.shortTitle}</title>
          <desc id={`topology-description-${story.id}`}>Connections and health states for {nodes.length} services involved in the incident.</desc>
          {story.topology.edges.map((edge) => (
            <TopologyConnection key={edge.id} edge={edge} nodes={nodes} />
          ))}
          {nodes.map((node, index) => {
            const position = nodePosition(index, nodes.length);
            return (
              <g key={node.id} className={topologyStateClass(node.health)}>
                <circle cx={position.x} cy={position.y} r="28" fill="currentColor" opacity="0.1" />
                <circle cx={position.x} cy={position.y} r="22" fill="var(--background)" stroke="currentColor" strokeWidth="2" />
                <circle cx={position.x} cy={position.y - 7} r="4" fill="currentColor" />
                <text x={position.x} y={position.y + 5} textAnchor="middle" fill="currentColor" className="text-[8px] font-semibold">
                  {node.kind}
                </text>
                <text x={position.x} y={position.y + 42} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">
                  {node.label}
                </text>
                <text x={position.x} y={position.y + 54} textAnchor="middle" className="fill-muted-foreground text-[8px]">
                  {node.errorRatePercent}% err · {node.latencyP95Ms}ms p95
                </text>
              </g>
            );
          })}
        </svg>
        <div className="mt-2 flex flex-wrap gap-2" aria-label="Service health summary">
          {nodes.map((node) => (
            <DesignBadge
              key={node.id}
              label={`${node.label}: ${node.health}`}
              color={badgeColorForHealth(node.health)}
              size="sm"
            />
          ))}
        </div>
      </div>
    </DesignAnalyticsCard>
  );
}

function SloBurn({ story }: { story: IncidentStory }) {
  const { slo } = story;
  const budgetConsumed = Math.max(0, slo.budgetRemainingBeforePercent - slo.budgetRemainingCurrentPercent);
  const budgetRemainingWidth = Math.max(0, Math.min(slo.budgetRemainingCurrentPercent, 100));

  return (
    <DesignAnalyticsCard gradient="orange" chart={{ type: "none" }}>
      <DesignAnalyticsCardHeader
        label="SLO & error budget"
        right={(
          <DesignBadge
            label={`${slo.burnRate.toLocaleString(undefined, { maximumFractionDigits: 1 })}× burn`}
            color={slo.burnRate > 2 ? "red" : slo.burnRate > 1 ? "orange" : "green"}
            icon={PulseIcon}
            size="sm"
          />
        )}
      />
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-foreground">{slo.objective}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">{slo.targetPercent}% target · {slo.windowDays}-day window</div>
          </div>
          <div className="text-right">
            <div className={cn(
              "font-mono text-xl font-semibold tabular-nums",
              slo.observedPercent >= slo.targetPercent ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
            )}>
              {slo.observedPercent}%
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">observed</div>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Error budget remaining</span>
            <span className="font-mono tabular-nums">{slo.budgetRemainingCurrentPercent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-foreground/[0.07]">
            <div
              className={cn(
                "h-full rounded-full",
                budgetRemainingWidth < 25 ? "bg-red-500" : budgetRemainingWidth < 50 ? "bg-amber-500" : "bg-emerald-500",
              )}
              style={{ width: `${budgetRemainingWidth}%` }}
            />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 divide-x divide-foreground/[0.06] rounded-xl bg-foreground/[0.035] py-3 text-center">
          <div>
            <div className="font-mono text-sm font-semibold tabular-nums text-foreground">{budgetConsumed.toFixed(1)}%</div>
            <div className="mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">consumed</div>
          </div>
          <div>
            <div className="font-mono text-sm font-semibold tabular-nums text-foreground">{slo.projectedMinutesToExhaustion}m</div>
            <div className="mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">to exhaust</div>
          </div>
          <div>
            <div className="font-mono text-sm font-semibold tabular-nums text-foreground">{slo.budgetRemainingBeforePercent}%</div>
            <div className="mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">before</div>
          </div>
        </div>
      </div>
    </DesignAnalyticsCard>
  );
}

export function TelemetryInvestigation({
  story,
  activeStageIndex,
  selectedSpanId,
  onSelectSpan,
}: TelemetryInvestigationProps) {
  const activeStage = story.stages.at(activeStageIndex) ?? story.stages.at(0);
  if (activeStage == null) {
    return (
      <DesignAlert
        variant="error"
        title="Telemetry unavailable"
        description="This incident story has no investigation stages."
      />
    );
  }

  const stageLogs = story.logs.filter((log) => log.stageId === activeStage.id);
  const stageError = story.errors.find((error) => error.stageId === activeStage.id)
    ?? story.errors.find((error) => error.spanId === selectedSpanId)
    ?? story.errors[0];

  return (
    <section aria-labelledby={`telemetry-investigation-${story.id}`} className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <TreeStructureIcon className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            <h2 id={`telemetry-investigation-${story.id}`} className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Telemetry investigation
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Stage {activeStageIndex + 1} · {activeStage.title}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DesignBadge label={`${story.waterfallSpans.length} spans`} color="cyan" icon={StackIcon} size="sm" />
          <DesignBadge label={`${stageLogs.length} stage logs`} color="blue" icon={TerminalWindowIcon} size="sm" />
          <DesignBadge label={`${story.affectedUsers.toLocaleString()} affected`} color="red" icon={UsersIcon} size="sm" />
        </div>
      </div>

      <div className="grid overflow-hidden rounded-2xl bg-background ring-1 ring-foreground/[0.06] sm:grid-cols-2 lg:grid-cols-3">
        {story.metrics.map((metric) => <MetricSummary key={metric.id} metric={metric} />)}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]">
        <TraceWaterfall story={story} selectedSpanId={selectedSpanId} onSelectSpan={onSelectSpan} />
        <StructuredLogs logs={stageLogs} selectedSpanId={selectedSpanId} onSelectSpan={onSelectSpan} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <ErrorIssue error={stageError} activeStageKind={activeStage.kind} />
        <SloBurn story={story} />
      </div>

      <ServiceTopologyView story={story} />

      {story.topology.nodes.some((node) => node.health !== "healthy") && (
        <DesignAlert
          variant="warning"
          title="Degraded dependency path detected"
          description={`${story.topology.nodes.filter((node) => node.health !== "healthy").map((node) => node.label).join(", ")} show elevated errors or latency for this incident.`}
        />
      )}
    </section>
  );
}
