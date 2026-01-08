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

type StatsData = {
  aggregate: AggregateStats,
  mostCommon: RequestStat[],
  mostTimeConsuming: RequestStat[],
  slowest: RequestStat[],
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
              Click the &ldquo;Refresh&rdquo; button to load request statistics.
              Stats are collected automatically when requests hit the API.
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
