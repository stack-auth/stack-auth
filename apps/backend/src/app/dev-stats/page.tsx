"use client";

import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { useCallback, useMemo, useState } from "react";

type RequestStat = {
  method: string,
  path: string,
  count: number,
  totalTimeMs: number,
  minTimeMs: number,
  maxTimeMs: number,
  lastCalledAt: number,
};

type AggregateStats = {
  totalRequests: number,
  totalTimeMs: number,
  uniqueEndpoints: number,
  averageTimeMs: number,
};

type PgPoolStats = {
  total: number,
  idle: number,
  waiting: number,
};

type EventLoopDelayStats = {
  minMs: number,
  maxMs: number,
  meanMs: number,
  p50Ms: number,
  p95Ms: number,
  p99Ms: number,
};

type EventLoopUtilizationStats = {
  utilization: number,
  idle: number,
  active: number,
};

type MemoryStats = {
  heapUsedMB: number,
  heapTotalMB: number,
  rssMB: number,
  externalMB: number,
  arrayBuffersMB: number,
};

type PerformanceSnapshot = {
  timestamp: number,
  pgPool: PgPoolStats | null,
  eventLoopDelay: EventLoopDelayStats | null,
  eventLoopUtilization: EventLoopUtilizationStats | null,
  memory: MemoryStats,
};

type PerfAggregate = {
  pgPool: { avgTotal: number, avgIdle: number, maxWaiting: number } | null,
  eventLoopDelay: { avgP50Ms: number, avgP99Ms: number, maxP99Ms: number } | null,
  eventLoopUtilization: { avgUtilization: number, maxUtilization: number } | null,
  memory: { avgHeapUsedMB: number, avgRssMB: number, maxRssMB: number },
};

type StatsData = {
  aggregate: AggregateStats,
  mostCommon: RequestStat[],
  mostTimeConsuming: RequestStat[],
  slowest: RequestStat[],
  perfCurrent: PerformanceSnapshot,
  perfHistory: PerformanceSnapshot[],
  perfAggregate: PerfAggregate,
};

type SortColumn = "endpoint" | "count" | "totalTime" | "avgTime" | "minTime" | "maxTime" | "lastCalled";
type SortDirection = "asc" | "desc";

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 1000) return "just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

const methodColors: Record<string, { bg: string, text: string, border: string }> = {
  GET: { bg: "rgba(16, 185, 129, 0.2)", text: "#6ee7b7", border: "rgba(16, 185, 129, 0.3)" },
  POST: { bg: "rgba(59, 130, 246, 0.2)", text: "#93c5fd", border: "rgba(59, 130, 246, 0.3)" },
  PUT: { bg: "rgba(245, 158, 11, 0.2)", text: "#fcd34d", border: "rgba(245, 158, 11, 0.3)" },
  PATCH: { bg: "rgba(249, 115, 22, 0.2)", text: "#fdba74", border: "rgba(249, 115, 22, 0.3)" },
  DELETE: { bg: "rgba(239, 68, 68, 0.2)", text: "#fca5a5", border: "rgba(239, 68, 68, 0.3)" },
  OPTIONS: { bg: "rgba(100, 116, 139, 0.2)", text: "#cbd5e1", border: "rgba(100, 116, 139, 0.3)" },
};

function MethodBadge({ method }: { method: string }) {
  const colors = methodColors[method] ?? { bg: "rgba(107, 114, 128, 0.2)", text: "#d1d5db", border: "rgba(107, 114, 128, 0.3)" };

  return (
    <span
      style={{
        padding: "2px 8px",
        fontSize: "12px",
        fontFamily: "monospace",
        fontWeight: 500,
        borderRadius: "4px",
        border: `1px solid ${colors.border}`,
        backgroundColor: colors.bg,
        color: colors.text,
      }}
    >
      {method}
    </span>
  );
}

function SortArrow({ direction, active }: { direction: SortDirection, active: boolean }) {
  return (
    <span
      style={{
        marginLeft: "4px",
        opacity: active ? 1 : 0.3,
        display: "inline-block",
        transition: "opacity 0.15s",
      }}
    >
      {direction === "asc" ? "↑" : "↓"}
    </span>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  gradient,
}: {
  title: string,
  value: string | number,
  subtitle?: string,
  gradient: string,
}) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: "12px",
        padding: "24px",
        background: gradient,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to bottom right, rgba(255,255,255,0.05), transparent)",
        }}
      />
      <div style={{ position: "relative" }}>
        <p style={{ fontSize: "14px", fontWeight: 500, color: "rgba(255,255,255,0.7)", margin: 0 }}>{title}</p>
        <p
          style={{
            marginTop: "8px",
            marginBottom: 0,
            fontSize: "30px",
            fontWeight: 700,
            color: "white",
            letterSpacing: "-0.025em",
          }}
        >
          {value}
        </p>
        {subtitle && (
          <p style={{ marginTop: "4px", marginBottom: 0, fontSize: "14px", color: "rgba(255,255,255,0.5)" }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Health Status Indicator
// ============================================================================

type HealthStatus = "good" | "warning" | "critical" | "unknown";

function getHealthColor(status: HealthStatus): { bg: string, text: string, border: string } {
  if (status === "good") {
    return { bg: "rgba(16, 185, 129, 0.2)", text: "#6ee7b7", border: "rgba(16, 185, 129, 0.4)" };
  } else if (status === "warning") {
    return { bg: "rgba(245, 158, 11, 0.2)", text: "#fcd34d", border: "rgba(245, 158, 11, 0.4)" };
  } else if (status === "critical") {
    return { bg: "rgba(239, 68, 68, 0.2)", text: "#fca5a5", border: "rgba(239, 68, 68, 0.4)" };
  } else {
    return { bg: "rgba(100, 116, 139, 0.2)", text: "#cbd5e1", border: "rgba(100, 116, 139, 0.4)" };
  }
}

function HealthBadge({ status, label }: { status: HealthStatus, label: string }) {
  const colors = getHealthColor(status);
  return (
    <span
      style={{
        padding: "4px 12px",
        fontSize: "12px",
        fontWeight: 600,
        borderRadius: "6px",
        border: `1px solid ${colors.border}`,
        backgroundColor: colors.bg,
        color: colors.text,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {label}
    </span>
  );
}

// ============================================================================
// Mini Sparkline Graph
// ============================================================================

function Sparkline({
  data,
  width = 200,
  height = 40,
  color = "#22d3ee",
  showDots = false,
}: {
  data: number[],
  width?: number,
  height?: number,
  color?: string,
  showDots?: boolean,
}) {
  if (data.length === 0) {
    return (
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#64748b", fontSize: "12px" }}>No data</span>
      </div>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 4;

  const points = data.map((v, i) => {
    const x = padding + (i / Math.max(data.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return { x, y, v };
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`sparkline-gradient-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Area fill */}
      <path
        d={`${pathD} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`}
        fill={`url(#sparkline-gradient-${color.replace("#", "")})`}
      />
      {/* Line */}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Dots */}
      {showDots && points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} />
      ))}
    </svg>
  );
}

// ============================================================================
// Performance Metric Card with Graph
// ============================================================================

function PerfMetricCard({
  title,
  description,
  value,
  unit,
  history,
  status,
  statusLabel,
  color,
  thresholds,
}: {
  title: string,
  description: string,
  value: number | null,
  unit: string,
  history: number[],
  status: HealthStatus,
  statusLabel: string,
  color: string,
  thresholds: { good: string, warning: string, critical: string },
}) {
  const [showThresholds, setShowThresholds] = useState(false);

  return (
    <div
      style={{
        borderRadius: "12px",
        backgroundColor: "rgba(30, 41, 59, 0.5)",
        border: "1px solid rgba(51, 65, 85, 0.5)",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h4 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "white" }}>{title}</h4>
          <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#94a3b8" }}>{description}</p>
        </div>
        <HealthBadge status={status} label={statusLabel} />
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
        <span style={{ fontSize: "32px", fontWeight: 700, color, fontFamily: "monospace" }}>
          {value !== null ? value.toFixed(2) : "—"}
        </span>
        <span style={{ fontSize: "14px", color: "#94a3b8" }}>{unit}</span>
      </div>

      <div style={{ marginTop: "4px" }}>
        <Sparkline data={history} width={280} height={50} color={color} />
      </div>

      <button
        onClick={() => setShowThresholds(!showThresholds)}
        style={{
          background: "transparent",
          border: "none",
          color: "#64748b",
          fontSize: "11px",
          cursor: "pointer",
          padding: "4px 0",
          textAlign: "left",
          textDecoration: "underline",
          textDecorationStyle: "dotted",
        }}
      >
        {showThresholds ? "Hide" : "Show"} thresholds
      </button>

      {showThresholds && (
        <div style={{ fontSize: "11px", color: "#94a3b8", lineHeight: "1.6" }}>
          <div><span style={{ color: "#6ee7b7" }}>● Good:</span> {thresholds.good}</div>
          <div><span style={{ color: "#fcd34d" }}>● Warning:</span> {thresholds.warning}</div>
          <div><span style={{ color: "#fca5a5" }}>● Critical:</span> {thresholds.critical}</div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Performance Section
// ============================================================================

// ============================================================================
// Raw History Table
// ============================================================================

function RawHistoryTable({ perfHistory }: { perfHistory: PerformanceSnapshot[] }) {
  const reversedHistory = useMemo(() => [...perfHistory].reverse(), [perfHistory]);

  if (reversedHistory.length === 0) {
    return (
      <div style={{ padding: "32px", textAlign: "center", color: "#94a3b8" }}>
        No measurements recorded yet. Wait a few seconds for data to accumulate.
      </div>
    );
  }

  const cellStyle: React.CSSProperties = {
    padding: "8px 12px",
    fontFamily: "monospace",
    fontSize: "12px",
    whiteSpace: "nowrap",
    borderBottom: "1px solid rgba(51, 65, 85, 0.3)",
  };

  const headerStyle: React.CSSProperties = {
    ...cellStyle,
    fontWeight: 600,
    color: "#94a3b8",
    textTransform: "uppercase",
    fontSize: "10px",
    letterSpacing: "0.05em",
    position: "sticky" as const,
    top: 0,
    backgroundColor: "rgba(15, 23, 42, 0.95)",
    borderBottom: "1px solid rgba(51, 65, 85, 0.5)",
  };

  return (
    <div
      style={{
        borderRadius: "8px",
        backgroundColor: "rgba(15, 23, 42, 0.5)",
        border: "1px solid rgba(51, 65, 85, 0.5)",
        overflow: "hidden",
      }}
    >
      <div style={{ maxHeight: "500px", overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...headerStyle, textAlign: "left" }}>Timestamp</th>
              <th style={{ ...headerStyle, textAlign: "right" }}>ELU</th>
              <th style={{ ...headerStyle, textAlign: "right" }}>EL p50</th>
              <th style={{ ...headerStyle, textAlign: "right" }}>EL p99</th>
              <th style={{ ...headerStyle, textAlign: "right" }}>EL Max</th>
              <th style={{ ...headerStyle, textAlign: "right" }}>Heap MB</th>
              <th style={{ ...headerStyle, textAlign: "right" }}>RSS MB</th>
              <th style={{ ...headerStyle, textAlign: "right" }}>PG Total</th>
              <th style={{ ...headerStyle, textAlign: "right" }}>PG Idle</th>
              <th style={{ ...headerStyle, textAlign: "right" }}>PG Wait</th>
            </tr>
          </thead>
          <tbody>
            {reversedHistory.map((snapshot, i) => {
              const date = new Date(snapshot.timestamp);
              const timeStr = date.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
              const msStr = String(date.getMilliseconds()).padStart(3, "0");

              return (
                <tr key={snapshot.timestamp} style={{ backgroundColor: i % 2 === 0 ? "transparent" : "rgba(30, 41, 59, 0.3)" }}>
                  <td style={{ ...cellStyle, textAlign: "left", color: "#e2e8f0" }}>
                    {timeStr}.{msStr}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right", color: "#22d3ee" }}>
                    {snapshot.eventLoopUtilization?.utilization.toFixed(3) ?? "—"}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right", color: "#a78bfa" }}>
                    {snapshot.eventLoopDelay?.p50Ms.toFixed(2) ?? "—"}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right", color: "#f472b6" }}>
                    {snapshot.eventLoopDelay?.p99Ms.toFixed(2) ?? "—"}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right", color: "#fb923c" }}>
                    {snapshot.eventLoopDelay?.maxMs.toFixed(2) ?? "—"}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right", color: "#34d399" }}>
                    {snapshot.memory.heapUsedMB.toFixed(1)}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right", color: "#fb923c" }}>
                    {snapshot.memory.rssMB.toFixed(1)}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right", color: "#60a5fa" }}>
                    {snapshot.pgPool?.total ?? "—"}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right", color: "#34d399" }}>
                    {snapshot.pgPool?.idle ?? "—"}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right", color: "#f87171" }}>
                    {snapshot.pgPool?.waiting ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(51, 65, 85, 0.5)", fontSize: "12px", color: "#64748b" }}>
        Showing {reversedHistory.length} measurements (newest first)
      </div>
    </div>
  );
}

function PerformanceSection({ perfCurrent, perfHistory, perfAggregate }: {
  perfCurrent: PerformanceSnapshot,
  perfHistory: PerformanceSnapshot[],
  perfAggregate: PerfAggregate,
}) {
  const [viewMode, setViewMode] = useState<"graphs" | "table">("graphs");

  // Extract time series for graphs
  const eluHistory = perfHistory.map(s => s.eventLoopUtilization?.utilization ?? 0).slice(-60);
  const p50History = perfHistory.map(s => s.eventLoopDelay?.p50Ms ?? 0).slice(-60);
  const p99History = perfHistory.map(s => s.eventLoopDelay?.p99Ms ?? 0).slice(-60);
  const heapHistory = perfHistory.map(s => s.memory.heapUsedMB).slice(-60);
  const rssHistory = perfHistory.map(s => s.memory.rssMB).slice(-60);
  const pgTotalHistory = perfHistory.map(s => s.pgPool?.total ?? 0).slice(-60);
  const pgWaitingHistory = perfHistory.map(s => s.pgPool?.waiting ?? 0).slice(-60);

  // Calculate health status for each metric
  function getELUStatus(elu: number | null): { status: HealthStatus, label: string } {
    if (elu === null) return { status: "unknown", label: "N/A" };
    if (elu < 0.5) return { status: "good", label: "Healthy" };
    if (elu < 0.8) return { status: "warning", label: "Elevated" };
    return { status: "critical", label: "High Load" };
  }

  function getEventLoopDelayStatus(p99: number | null): { status: HealthStatus, label: string } {
    if (p99 === null) return { status: "unknown", label: "N/A" };
    if (p99 < 50) return { status: "good", label: "Fast" };
    if (p99 < 200) return { status: "warning", label: "Slow" };
    return { status: "critical", label: "Very Slow" };
  }

  function getPgPoolStatus(waiting: number, total: number): { status: HealthStatus, label: string } {
    if (total === 0) return { status: "unknown", label: "No Pool" };
    if (waiting === 0) return { status: "good", label: "Healthy" };
    if (waiting < 5) return { status: "warning", label: "Queueing" };
    return { status: "critical", label: "Saturated" };
  }

  function getMemoryStatus(rss: number): { status: HealthStatus, label: string } {
    if (rss < 500) return { status: "good", label: "Low" };
    if (rss < 1000) return { status: "warning", label: "Moderate" };
    return { status: "critical", label: "High" };
  }

  const eluStatus = getELUStatus(perfCurrent.eventLoopUtilization?.utilization ?? null);
  const delayStatus = getEventLoopDelayStatus(perfCurrent.eventLoopDelay?.p99Ms ?? null);
  const pgStatus = getPgPoolStatus(perfCurrent.pgPool?.waiting ?? 0, perfCurrent.pgPool?.total ?? 0);
  const memStatus = getMemoryStatus(perfCurrent.memory.rssMB);

  return (
    <div
      style={{
        borderRadius: "12px",
        backgroundColor: "rgba(30, 41, 59, 0.3)",
        border: "1px solid rgba(51, 65, 85, 0.5)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(51, 65, 85, 0.5)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h3 style={{ fontSize: "20px", fontWeight: 600, color: "white", margin: 0 }}>
            🔬 Performance Metrics
          </h3>
          <p style={{ fontSize: "14px", color: "#94a3b8", marginTop: "4px", marginBottom: 0 }}>
            Real-time Node.js process and PostgreSQL pool statistics
          </p>
        </div>
        <div style={{ display: "flex", gap: "4px", backgroundColor: "rgba(15, 23, 42, 0.5)", borderRadius: "8px", padding: "4px" }}>
          <button
            onClick={() => setViewMode("graphs")}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "none",
              fontSize: "12px",
              fontWeight: 500,
              cursor: "pointer",
              backgroundColor: viewMode === "graphs" ? "rgba(34, 211, 238, 0.2)" : "transparent",
              color: viewMode === "graphs" ? "#67e8f9" : "#94a3b8",
              transition: "background-color 0.15s, color 0.15s",
            }}
          >
            📊 Graphs
          </button>
          <button
            onClick={() => setViewMode("table")}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "none",
              fontSize: "12px",
              fontWeight: 500,
              cursor: "pointer",
              backgroundColor: viewMode === "table" ? "rgba(34, 211, 238, 0.2)" : "transparent",
              color: viewMode === "table" ? "#67e8f9" : "#94a3b8",
              transition: "background-color 0.15s, color 0.15s",
            }}
          >
            📋 Raw Data ({perfHistory.length})
          </button>
        </div>
      </div>

      {viewMode === "table" ? (
        <div style={{ padding: "24px" }}>
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "#67e8f9", margin: "0 0 16px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Raw Measurements
          </h4>
          <RawHistoryTable perfHistory={perfHistory} />
        </div>
      ) : (
        <div style={{ padding: "24px" }}>
          {/* Event Loop Section */}
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "#67e8f9", margin: "0 0 16px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Event Loop
          </h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px", marginBottom: "32px" }}>
            <PerfMetricCard
              title="Event Loop Utilization"
              description="Ratio of time the event loop is busy (0-1)"
              value={perfCurrent.eventLoopUtilization?.utilization ?? null}
              unit=""
              history={eluHistory}
              status={eluStatus.status}
              statusLabel={eluStatus.label}
              color="#22d3ee"
              thresholds={{
                good: "< 0.5 — Plenty of headroom for handling requests",
                warning: "0.5–0.8 — Getting busy, consider optimizing",
                critical: "> 0.8 — Event loop is saturated, requests may queue",
              }}
            />
            <PerfMetricCard
              title="Event Loop Delay (p50)"
              description="Median delay between scheduled callbacks"
              value={perfCurrent.eventLoopDelay?.p50Ms ?? null}
              unit="ms"
              history={p50History}
              status={delayStatus.status}
              statusLabel={delayStatus.label}
              color="#a78bfa"
              thresholds={{
                good: "< 20ms — Callbacks run promptly",
                warning: "20–100ms — Some blocking occurring",
                critical: "> 100ms — Significant blocking, impacts responsiveness",
              }}
            />
            <PerfMetricCard
              title="Event Loop Delay (p99)"
              description="99th percentile callback delay"
              value={perfCurrent.eventLoopDelay?.p99Ms ?? null}
              unit="ms"
              history={p99History}
              status={delayStatus.status}
              statusLabel={delayStatus.label}
              color="#f472b6"
              thresholds={{
                good: "< 50ms — Rare spikes only",
                warning: "50–200ms — Occasional blocking spikes",
                critical: "> 200ms — Frequent blocking, tail latency issues",
              }}
            />
          </div>

          {/* Memory Section */}
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "#67e8f9", margin: "0 0 16px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Memory
          </h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px", marginBottom: "32px" }}>
            <PerfMetricCard
              title="Heap Used"
              description="V8 heap memory currently in use"
              value={perfCurrent.memory.heapUsedMB}
              unit="MB"
              history={heapHistory}
              status={memStatus.status}
              statusLabel={memStatus.label}
              color="#34d399"
              thresholds={{
                good: "< 200 MB — Normal for development",
                warning: "200–500 MB — Getting large, watch for leaks",
                critical: "> 500 MB — May cause GC pressure",
              }}
            />
            <PerfMetricCard
              title="RSS (Resident Set Size)"
              description="Total memory allocated by the OS for this process"
              value={perfCurrent.memory.rssMB}
              unit="MB"
              history={rssHistory}
              status={memStatus.status}
              statusLabel={memStatus.label}
              color="#fb923c"
              thresholds={{
                good: "< 500 MB — Normal footprint",
                warning: "500–1000 MB — Getting heavy",
                critical: "> 1000 MB — Very large, may impact system",
              }}
            />
          </div>

          {/* PostgreSQL Pool Section */}
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "#67e8f9", margin: "0 0 16px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            PostgreSQL Connection Pool
          </h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px", marginBottom: "32px" }}>
            <PerfMetricCard
              title="Total Connections"
              description="Active + idle connections in the pool"
              value={perfCurrent.pgPool?.total ?? null}
              unit="connections"
              history={pgTotalHistory}
              status={pgStatus.status}
              statusLabel={pgStatus.label}
              color="#60a5fa"
              thresholds={{
                good: "< 15 — Pool is sized appropriately",
                warning: "15–23 — Nearing max pool size (25)",
                critical: "≥ 25 — Pool is maxed out",
              }}
            />
            <PerfMetricCard
              title="Waiting Queries"
              description="Queries waiting for a connection"
              value={perfCurrent.pgPool?.waiting ?? null}
              unit="queries"
              history={pgWaitingHistory}
              status={pgStatus.status}
              statusLabel={pgStatus.label}
              color="#f87171"
              thresholds={{
                good: "0 — No queue, instant connection",
                warning: "1–5 — Short queue, slight delays",
                critical: "> 5 — Long queue, significant delays",
              }}
            />
            <div
              style={{
                borderRadius: "12px",
                backgroundColor: "rgba(30, 41, 59, 0.5)",
                border: "1px solid rgba(51, 65, 85, 0.5)",
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
              }}
            >
              <h4 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: 600, color: "white" }}>Pool Breakdown</h4>
              <div style={{ display: "flex", gap: "24px" }}>
                <div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: "#60a5fa", fontFamily: "monospace" }}>
                    {perfCurrent.pgPool?.total ?? "—"}
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>Total</div>
                </div>
                <div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: "#34d399", fontFamily: "monospace" }}>
                    {perfCurrent.pgPool?.idle ?? "—"}
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>Idle</div>
                </div>
                <div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: "#f87171", fontFamily: "monospace" }}>
                    {perfCurrent.pgPool?.waiting ?? "—"}
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>Waiting</div>
                </div>
              </div>
            </div>
          </div>

          {/* Aggregate Stats Table */}
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "#67e8f9", margin: "0 0 16px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Aggregate Statistics (Last 60 seconds)
          </h4>
          <div
            style={{
              borderRadius: "8px",
              backgroundColor: "rgba(15, 23, 42, 0.5)",
              border: "1px solid rgba(51, 65, 85, 0.5)",
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(51, 65, 85, 0.5)" }}>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase" }}>Metric</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "12px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase" }}>Average</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "12px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase" }}>Max</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: "1px solid rgba(51, 65, 85, 0.3)" }}>
                  <td style={{ padding: "12px 16px", color: "#e2e8f0" }}>Event Loop Utilization</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", color: "#22d3ee" }}>
                    {perfAggregate.eventLoopUtilization?.avgUtilization.toFixed(3) ?? "—"}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", color: "#f472b6" }}>
                    {perfAggregate.eventLoopUtilization?.maxUtilization.toFixed(3) ?? "—"}
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid rgba(51, 65, 85, 0.3)" }}>
                  <td style={{ padding: "12px 16px", color: "#e2e8f0" }}>Event Loop Delay (p50)</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", color: "#22d3ee" }}>
                    {perfAggregate.eventLoopDelay?.avgP50Ms.toFixed(2) ?? "—"} ms
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", color: "#94a3b8" }}>—</td>
                </tr>
                <tr style={{ borderBottom: "1px solid rgba(51, 65, 85, 0.3)" }}>
                  <td style={{ padding: "12px 16px", color: "#e2e8f0" }}>Event Loop Delay (p99)</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", color: "#22d3ee" }}>
                    {perfAggregate.eventLoopDelay?.avgP99Ms.toFixed(2) ?? "—"} ms
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", color: "#f472b6" }}>
                    {perfAggregate.eventLoopDelay?.maxP99Ms.toFixed(2) ?? "—"} ms
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid rgba(51, 65, 85, 0.3)" }}>
                  <td style={{ padding: "12px 16px", color: "#e2e8f0" }}>Heap Used</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", color: "#22d3ee" }}>
                    {perfAggregate.memory.avgHeapUsedMB.toFixed(1)} MB
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", color: "#94a3b8" }}>—</td>
                </tr>
                <tr style={{ borderBottom: "1px solid rgba(51, 65, 85, 0.3)" }}>
                  <td style={{ padding: "12px 16px", color: "#e2e8f0" }}>RSS</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", color: "#22d3ee" }}>
                    {perfAggregate.memory.avgRssMB.toFixed(1)} MB
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", color: "#f472b6" }}>
                    {perfAggregate.memory.maxRssMB.toFixed(1)} MB
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "12px 16px", color: "#e2e8f0" }}>PG Pool Connections</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", color: "#22d3ee" }}>
                    {perfAggregate.pgPool?.avgTotal.toFixed(1) ?? "—"}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "monospace", color: "#94a3b8" }}>—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RequestTable({
  title,
  description,
  requests,
  defaultSortColumn,
}: {
  title: string,
  description: string,
  requests: RequestStat[],
  defaultSortColumn: SortColumn,
}) {
  const [sortColumn, setSortColumn] = useState<SortColumn>(defaultSortColumn);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedRequests = useMemo(() => {
    const sorted = [...requests];

    const getSortValue = (stat: RequestStat, column: SortColumn): number | string => {
      const columnGetters: Record<SortColumn, () => number | string> = {
        endpoint: () => `${stat.method}:${stat.path}`,
        count: () => stat.count,
        totalTime: () => stat.totalTimeMs,
        avgTime: () => stat.totalTimeMs / stat.count,
        minTime: () => stat.minTimeMs,
        maxTime: () => stat.maxTimeMs,
        lastCalled: () => stat.lastCalledAt,
      };
      return columnGetters[column]();
    };

    sorted.sort((a, b) => {
      const aVal = getSortValue(a, sortColumn);
      const bVal = getSortValue(b, sortColumn);

      if (typeof aVal === "string" && typeof bVal === "string") {
        const cmp = stringCompare(aVal, bVal);
        return sortDirection === "asc" ? cmp : -cmp;
      }

      return sortDirection === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return sorted;
  }, [requests, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const headerStyle: React.CSSProperties = {
    padding: "12px 24px",
    textAlign: "left",
    fontSize: "11px",
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#94a3b8",
    cursor: "pointer",
    userSelect: "none",
    transition: "color 0.15s",
  };

  const headerStyleRight: React.CSSProperties = { ...headerStyle, textAlign: "right" };

  const cellStyle: React.CSSProperties = {
    padding: "16px 24px",
    whiteSpace: "nowrap",
  };

  const cellStyleRight: React.CSSProperties = { ...cellStyle, textAlign: "right" };

  const getHeaderColor = (column: SortColumn) => sortColumn === column ? "#22d3ee" : "#94a3b8";

  if (requests.length === 0) {
    return (
      <div
        style={{
          borderRadius: "12px",
          backgroundColor: "rgba(30, 41, 59, 0.5)",
          border: "1px solid rgba(51, 65, 85, 0.5)",
          padding: "32px",
          textAlign: "center",
        }}
      >
        <p style={{ color: "#94a3b8", margin: 0 }}>No requests recorded yet</p>
      </div>
    );
  }

  return (
    <div
      style={{
        borderRadius: "12px",
        backgroundColor: "rgba(30, 41, 59, 0.5)",
        border: "1px solid rgba(51, 65, 85, 0.5)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "16px 24px", borderBottom: "1px solid rgba(51, 65, 85, 0.5)" }}>
        <h3 style={{ fontSize: "18px", fontWeight: 600, color: "white", margin: 0 }}>{title}</h3>
        <p style={{ fontSize: "14px", color: "#94a3b8", marginTop: "4px", marginBottom: 0 }}>{description}</p>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(51, 65, 85, 0.5)" }}>
              <th
                style={{ ...headerStyle, color: getHeaderColor("endpoint") }}
                onClick={() => handleSort("endpoint")}
              >
                Endpoint
                <SortArrow direction={sortColumn === "endpoint" ? sortDirection : "desc"} active={sortColumn === "endpoint"} />
              </th>
              <th
                style={{ ...headerStyleRight, color: getHeaderColor("count") }}
                onClick={() => handleSort("count")}
              >
                Count
                <SortArrow direction={sortColumn === "count" ? sortDirection : "desc"} active={sortColumn === "count"} />
              </th>
              <th
                style={{ ...headerStyleRight, color: getHeaderColor("totalTime") }}
                onClick={() => handleSort("totalTime")}
              >
                Total Time
                <SortArrow direction={sortColumn === "totalTime" ? sortDirection : "desc"} active={sortColumn === "totalTime"} />
              </th>
              <th
                style={{ ...headerStyleRight, color: getHeaderColor("avgTime") }}
                onClick={() => handleSort("avgTime")}
              >
                Avg Time
                <SortArrow direction={sortColumn === "avgTime" ? sortDirection : "desc"} active={sortColumn === "avgTime"} />
              </th>
              <th
                style={{ ...headerStyleRight, color: getHeaderColor("minTime") }}
                onClick={() => handleSort("minTime")}
              >
                Min
                <SortArrow direction={sortColumn === "minTime" ? sortDirection : "desc"} active={sortColumn === "minTime"} />
              </th>
              <th
                style={{ ...headerStyleRight, color: getHeaderColor("maxTime") }}
                onClick={() => handleSort("maxTime")}
              >
                Max
                <SortArrow direction={sortColumn === "maxTime" ? sortDirection : "desc"} active={sortColumn === "maxTime"} />
              </th>
              <th
                style={{ ...headerStyleRight, color: getHeaderColor("lastCalled") }}
                onClick={() => handleSort("lastCalled")}
              >
                Last Called
                <SortArrow direction={sortColumn === "lastCalled" ? sortDirection : "desc"} active={sortColumn === "lastCalled"} />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRequests.map((stat) => (
              <tr
                key={`${stat.method}:${stat.path}`}
                style={{ borderBottom: "1px solid rgba(51, 65, 85, 0.3)" }}
              >
                <td style={cellStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <MethodBadge method={stat.method} />
                    <span
                      style={{
                        fontFamily: "monospace",
                        fontSize: "14px",
                        color: "#e2e8f0",
                        maxWidth: "400px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {stat.path}
                    </span>
                  </div>
                </td>
                <td
                  style={{
                    ...cellStyleRight,
                    fontFamily: "monospace",
                    fontSize: "14px",
                    color: sortColumn === "count" ? "#67e8f9" : "#cbd5e1",
                    fontWeight: sortColumn === "count" ? 600 : 400,
                  }}
                >
                  {stat.count.toLocaleString()}
                </td>
                <td
                  style={{
                    ...cellStyleRight,
                    fontFamily: "monospace",
                    fontSize: "14px",
                    color: sortColumn === "totalTime" ? "#67e8f9" : "#cbd5e1",
                    fontWeight: sortColumn === "totalTime" ? 600 : 400,
                  }}
                >
                  {formatDuration(stat.totalTimeMs)}
                </td>
                <td
                  style={{
                    ...cellStyleRight,
                    fontFamily: "monospace",
                    fontSize: "14px",
                    color: sortColumn === "avgTime" ? "#67e8f9" : "#cbd5e1",
                    fontWeight: sortColumn === "avgTime" ? 600 : 400,
                  }}
                >
                  {formatDuration(stat.totalTimeMs / stat.count)}
                </td>
                <td
                  style={{
                    ...cellStyleRight,
                    fontFamily: "monospace",
                    fontSize: "12px",
                    color: sortColumn === "minTime" ? "#67e8f9" : "#94a3b8",
                    fontWeight: sortColumn === "minTime" ? 600 : 400,
                  }}
                >
                  {formatDuration(stat.minTimeMs)}
                </td>
                <td
                  style={{
                    ...cellStyleRight,
                    fontFamily: "monospace",
                    fontSize: "12px",
                    color: sortColumn === "maxTime" ? "#67e8f9" : "#94a3b8",
                    fontWeight: sortColumn === "maxTime" ? 600 : 400,
                  }}
                >
                  {formatDuration(stat.maxTimeMs)}
                </td>
                <td
                  style={{
                    ...cellStyleRight,
                    fontSize: "14px",
                    color: sortColumn === "lastCalled" ? "#67e8f9" : "#94a3b8",
                    fontWeight: sortColumn === "lastCalled" ? 600 : 400,
                  }}
                >
                  {formatRelativeTime(stat.lastCalledAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DevStatsPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/dev-stats/api");
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      setStats(data);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch stats");
    } finally {
      setLoading(false);
    }
  }, []);

  const clearStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/dev-stats/api", { method: "DELETE" });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      setStats(null);
      setLastRefresh(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear stats");
    } finally {
      setLoading(false);
    }
  }, []);

  const buttonStyle: React.CSSProperties = {
    padding: "8px 16px",
    borderRadius: "8px",
    fontWeight: 500,
    fontSize: "14px",
    border: "1px solid",
    cursor: "pointer",
    transition: "all 0.2s",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(to bottom right, #020617, #0f172a, #020617)",
      }}
    >
      {/* Background pattern */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          opacity: 0.3,
          backgroundImage: "radial-gradient(circle at 1px 1px, rgb(51, 65, 85) 1px, transparent 0)",
          backgroundSize: "32px 32px",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          maxWidth: "1280px",
          margin: "0 auto",
          padding: "48px 24px",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            marginBottom: "32px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <h1
                style={{
                  fontSize: "30px",
                  fontWeight: 700,
                  margin: 0,
                  background: "linear-gradient(to right, #22d3ee, #3b82f6)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Dev Request Stats
              </h1>
              <p style={{ color: "#94a3b8", marginTop: "4px", marginBottom: 0 }}>
                Monitor API performance during development
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {lastRefresh && (
                <span style={{ fontSize: "12px", color: "#64748b" }}>
                  Last refresh: {lastRefresh.toLocaleTimeString()}
                </span>
              )}
              <button
                onClick={() => runAsynchronously(fetchStats())}
                disabled={loading}
                style={{
                  ...buttonStyle,
                  backgroundColor: "rgba(6, 182, 212, 0.2)",
                  borderColor: "rgba(6, 182, 212, 0.3)",
                  color: "#67e8f9",
                  opacity: loading ? 0.5 : 1,
                }}
              >
                {loading ? "Loading..." : "Refresh"}
              </button>
              <button
                onClick={() => runAsynchronously(clearStats())}
                disabled={loading}
                style={{
                  ...buttonStyle,
                  backgroundColor: "rgba(239, 68, 68, 0.2)",
                  borderColor: "rgba(239, 68, 68, 0.3)",
                  color: "#fca5a5",
                  opacity: loading ? 0.5 : 1,
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div
            style={{
              marginBottom: "32px",
              padding: "16px",
              borderRadius: "12px",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#fca5a5",
            }}
          >
            {error}
          </div>
        )}

        {!stats ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "96px 0",
            }}
          >
            <div
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "50%",
                backgroundColor: "#1e293b",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "24px",
              }}
            >
              <svg
                style={{ width: "32px", height: "32px", color: "#64748b" }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            </div>
            <h2 style={{ fontSize: "20px", fontWeight: 600, color: "white", margin: "0 0 8px 0" }}>
              No stats loaded yet
            </h2>
            <p style={{ color: "#94a3b8", marginBottom: "24px", textAlign: "center", maxWidth: "400px" }}>
              Click the &ldquo;Refresh&rdquo; button to load request and performance statistics.
              Stats are collected automatically in development mode.
            </p>
            <button
              onClick={() => runAsynchronously(fetchStats())}
              disabled={loading}
              style={{
                padding: "12px 24px",
                background: "linear-gradient(to right, #06b6d4, #2563eb)",
                color: "white",
                borderRadius: "12px",
                fontWeight: 600,
                fontSize: "16px",
                border: "none",
                cursor: "pointer",
                boxShadow: "0 10px 25px -5px rgba(6, 182, 212, 0.25)",
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? "Loading..." : "Load Stats"}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
            {/* Aggregate stats cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                gap: "16px",
              }}
            >
              <StatCard
                title="Total Requests"
                value={stats.aggregate.totalRequests.toLocaleString()}
                gradient="linear-gradient(to bottom right, #0891b2, #164e63)"
              />
              <StatCard
                title="Unique Endpoints"
                value={stats.aggregate.uniqueEndpoints.toLocaleString()}
                gradient="linear-gradient(to bottom right, #2563eb, #1e3a8a)"
              />
              <StatCard
                title="Total Time"
                value={formatDuration(stats.aggregate.totalTimeMs)}
                subtitle="Cumulative processing time"
                gradient="linear-gradient(to bottom right, #7c3aed, #4c1d95)"
              />
              <StatCard
                title="Average Time"
                value={formatDuration(stats.aggregate.averageTimeMs)}
                subtitle="Per request"
                gradient="linear-gradient(to bottom right, #db2777, #831843)"
              />
            </div>

            {/* Performance Metrics */}
            <PerformanceSection
              perfCurrent={stats.perfCurrent}
              perfHistory={stats.perfHistory}
              perfAggregate={stats.perfAggregate}
            />

            {/* Tables */}
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              <RequestTable
                title="Most Common Requests"
                description="Endpoints called most frequently (click column headers to sort)"
                requests={stats.mostCommon}
                defaultSortColumn="count"
              />

              <RequestTable
                title="Most Time Consuming"
                description="Endpoints that consumed the most total processing time (click column headers to sort)"
                requests={stats.mostTimeConsuming}
                defaultSortColumn="totalTime"
              />

              <RequestTable
                title="Slowest Endpoints"
                description="Endpoints with the highest average response time (click column headers to sort)"
                requests={stats.slowest}
                defaultSortColumn="avgTime"
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: "48px", textAlign: "center", color: "#64748b", fontSize: "14px" }}>
          <p style={{ margin: 0 }}>
            This page is only available in development mode.
            <br />
            Stats are stored in memory and will be cleared when the server restarts.
          </p>
        </div>
      </div>
    </div>
  );
}
