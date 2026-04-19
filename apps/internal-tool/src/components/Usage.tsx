import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import type { AiQueryLogRow } from "../types";
import { toDate } from "../utils";

type TimeRange = "24h" | "7d" | "30d" | "all";
type AuthFilter = "all" | "authed" | "anon";
type ModeFilter = "all" | "stream" | "generate";
type StatusFilter = "all" | "ok" | "error";
type SortKey = "createdAt" | "systemPromptId" | "modelId" | "mode" | "inputTokens" | "outputTokens" | "cachedInputTokens" | "costUsd" | "durationMs" | "status";
type SortDir = "asc" | "desc";
const PAGE_SIZES = [25, 50, 100, 500] as const;
type PageSize = typeof PAGE_SIZES[number];

type Props = {
  rows: AiQueryLogRow[],
  connectionState: "connecting" | "connected" | "error",
  onSelect: (row: AiQueryLogRow) => void,
  selectedId?: bigint,
};

const ALL_SYSTEM_PROMPTS = [
  "command-center-ask-ai",
  "docs-ask-ai",
  "wysiwyg-edit",
  "email-wysiwyg-editor",
  "email-assistant-template",
  "email-assistant-theme",
  "email-assistant-draft",
  "create-dashboard",
  "run-query",
  "rewrite-template-source",
];

export function Usage({ rows, connectionState, onSelect, selectedId }: Props) {
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const [systemPromptFilter, setSystemPromptFilter] = useState<Set<string>>(new Set());
  const [modelFilter, setModelFilter] = useState<Set<string>>(new Set());
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [authFilter, setAuthFilter] = useState<AuthFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(50);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const rangeStart = useMemo(() => {
    switch (timeRange) {
      case "24h": {
        return now - 24 * 60 * 60 * 1000;
      }
      case "7d": {
        return now - 7 * 24 * 60 * 60 * 1000;
      }
      case "30d": {
        return now - 30 * 24 * 60 * 60 * 1000;
      }
      case "all": {
        return 0;
      }
    }
  }, [timeRange, now]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      const ts = toDate(r.createdAt).getTime();
      if (ts < rangeStart) return false;
      if (systemPromptFilter.size > 0 && !systemPromptFilter.has(r.systemPromptId)) return false;
      if (modelFilter.size > 0 && !modelFilter.has(r.modelId)) return false;
      if (modeFilter !== "all" && r.mode !== modeFilter) return false;
      if (authFilter === "authed" && !r.isAuthenticated) return false;
      if (authFilter === "anon" && r.isAuthenticated) return false;
      const isError = r.errorMessage != null && r.errorMessage !== "";
      if (statusFilter === "ok" && isError) return false;
      if (statusFilter === "error" && !isError) return false;
      if (q) {
        const hay = `${r.finalText} ${r.messagesJson}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, rangeStart, systemPromptFilter, modelFilter, modeFilter, authFilter, statusFilter, search]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    const mult = sortDir === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      switch (sortKey) {
        case "createdAt": {
          av = toDate(a.createdAt).getTime();
          bv = toDate(b.createdAt).getTime();
          break;
        }
        case "systemPromptId": {
          av = a.systemPromptId;
          bv = b.systemPromptId;
          break;
        }
        case "modelId": {
          av = a.modelId;
          bv = b.modelId;
          break;
        }
        case "mode": {
          av = a.mode;
          bv = b.mode;
          break;
        }
        case "inputTokens": {
          av = a.inputTokens ?? -1;
          bv = b.inputTokens ?? -1;
          break;
        }
        case "outputTokens": {
          av = a.outputTokens ?? -1;
          bv = b.outputTokens ?? -1;
          break;
        }
        case "cachedInputTokens": {
          av = a.cachedInputTokens ?? -1;
          bv = b.cachedInputTokens ?? -1;
          break;
        }
        case "costUsd": {
          av = a.costUsd ?? -1;
          bv = b.costUsd ?? -1;
          break;
        }
        case "durationMs": {
          av = Number(a.durationMs);
          bv = Number(b.durationMs);
          break;
        }
        case "status": {
          av = (a.errorMessage != null && a.errorMessage !== "") ? 1 : 0;
          bv = (b.errorMessage != null && b.errorMessage !== "") ? 1 : 0;
          break;
        }
      }
      if (av < bv) return -1 * mult;
      if (av > bv) return 1 * mult;
      return 0;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "createdAt" ? "desc" : "asc");
    }
    setPage(0);
  }

  useEffect(() => {
    setPage(0);
  }, [timeRange, systemPromptFilter, modelFilter, modeFilter, authFilter, statusFilter, search, pageSize]);

  const stats = useMemo(() => {
    const totalCalls = filtered.length;
    const errorCalls = filtered.filter(r => r.errorMessage != null && r.errorMessage !== "").length;
    const inputTokens = filtered.reduce((a, r) => a + (r.inputTokens ?? 0), 0);
    const outputTokens = filtered.reduce((a, r) => a + (r.outputTokens ?? 0), 0);
    const cachedInputTokens = filtered.reduce((a, r) => a + (r.cachedInputTokens ?? 0), 0);
    const totalCost = filtered.reduce((a, r) => a + (r.costUsd ?? 0), 0);
    const durations = filtered.map(r => Number(r.durationMs)).filter(d => d > 0).sort((a, b) => a - b);
    const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const p95Duration = durations.length > 0 ? durations[Math.min(Math.floor(durations.length * 0.95), durations.length - 1)] : 0;

    // Time-bucketed series
    const spanMs = now - rangeStart;
    const bucketMs = spanMs <= 24 * 60 * 60 * 1000 ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const bucketLabelFmt: Intl.DateTimeFormatOptions = bucketMs === 60 * 60 * 1000
      ? { hour: "numeric" }
      : { month: "short", day: "numeric" };
    const bucketCount = Math.min(48, Math.max(1, Math.ceil(spanMs / bucketMs)));
    const bucketStart = now - bucketCount * bucketMs;
    const timeBuckets: Array<{ label: string, start: number, calls: number, inputTokens: number, outputTokens: number, cachedInputTokens: number }> = [];
    for (let i = 0; i < bucketCount; i++) {
      const start = bucketStart + i * bucketMs;
      timeBuckets.push({
        label: new Date(start).toLocaleString("en-US", bucketLabelFmt),
        start,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
      });
    }
    for (const r of filtered) {
      const ts = toDate(r.createdAt).getTime();
      const idx = Math.floor((ts - bucketStart) / bucketMs);
      if (idx >= 0 && idx < bucketCount) {
        timeBuckets[idx].calls++;
        timeBuckets[idx].inputTokens += r.inputTokens ?? 0;
        timeBuckets[idx].outputTokens += r.outputTokens ?? 0;
        timeBuckets[idx].cachedInputTokens += r.cachedInputTokens ?? 0;
      }
    }
    const maxCalls = Math.max(...timeBuckets.map(b => b.calls), 1);
    const maxTokenTotal = Math.max(...timeBuckets.map(b => b.inputTokens + b.outputTokens), 1);
    const maxInputTokens = Math.max(...timeBuckets.map(b => b.inputTokens), 1);

    // Distributions
    const sysPromptCounts = new Map<string, number>();
    const modelCounts = new Map<string, number>();
    const toolCounts = new Map<string, number>();
    for (const r of filtered) {
      sysPromptCounts.set(r.systemPromptId, (sysPromptCounts.get(r.systemPromptId) ?? 0) + 1);
      modelCounts.set(r.modelId, (modelCounts.get(r.modelId) ?? 0) + 1);
      try {
        const tools = JSON.parse(r.requestedToolsJson) as string[];
        for (const t of tools) toolCounts.set(t, (toolCounts.get(t) ?? 0) + 1);
      } catch { /* skip */ }
    }
    const sysPromptDist = Array.from(sysPromptCounts.entries()).sort((a, b) => b[1] - a[1]);
    const modelDist = Array.from(modelCounts.entries()).sort((a, b) => b[1] - a[1]);
    const toolDist = Array.from(toolCounts.entries()).sort((a, b) => b[1] - a[1]);

    // Cache Hit % per systemPromptId
    const cacheBySystemPrompt = new Map<string, { input: number, cached: number, calls: number }>();
    for (const r of filtered) {
      const existing = cacheBySystemPrompt.get(r.systemPromptId) ?? { input: 0, cached: 0, calls: 0 };
      existing.input += r.inputTokens ?? 0;
      existing.cached += r.cachedInputTokens ?? 0;
      existing.calls += 1;
      cacheBySystemPrompt.set(r.systemPromptId, existing);
    }
    const cacheHitBySystemPrompt = Array.from(cacheBySystemPrompt.entries())
      .map(([id, v]) => ({
        id,
        calls: v.calls,
        hitPct: v.input > 0 ? Math.round((v.cached / v.input) * 100) : 0,
        cached: v.cached,
        input: v.input,
      }))
      .sort((a, b) => b.input - a.input);

    // Latency histogram
    const latencyBuckets = [
      { label: "<500ms", max: 500, count: 0 },
      { label: "500ms–2s", max: 2000, count: 0 },
      { label: "2–10s", max: 10000, count: 0 },
      { label: "10–30s", max: 30000, count: 0 },
      { label: ">30s", max: Infinity, count: 0 },
    ];
    for (const d of durations) {
      const b = latencyBuckets.find(b => d < b.max);
      if (b) b.count++;
    }
    const maxLatencyBucket = Math.max(...latencyBuckets.map(b => b.count), 1);

    return {
      totalCalls, errorCalls, inputTokens, outputTokens, cachedInputTokens, totalCost,
      avgDuration, p95Duration,
      timeBuckets, maxCalls, maxTokenTotal, maxInputTokens,
      sysPromptDist, modelDist, toolDist,
      cacheHitBySystemPrompt,
      latencyBuckets, maxLatencyBucket,
    };
  }, [filtered, rangeStart, now]);

  const allSystemPrompts = useMemo(() => {
    const seen = new Set<string>(ALL_SYSTEM_PROMPTS);
    for (const r of rows) seen.add(r.systemPromptId);
    return Array.from(seen).sort();
  }, [rows]);

  const allModels = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) seen.add(r.modelId);
    return Array.from(seen).sort();
  }, [rows]);

  function toggle(set: Set<string>, val: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    setter(next);
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2 sticky top-0 z-10">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase text-gray-400 font-medium tracking-wider">Range</span>
          {(["24h", "7d", "30d", "all"] as TimeRange[]).map(r => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={clsx(
                "px-2 py-0.5 text-xs rounded",
                timeRange === r ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {r}
            </button>
          ))}
          <span className="mx-2 w-px h-4 bg-gray-200" />
          <span className="text-[10px] uppercase text-gray-400 font-medium tracking-wider">Mode</span>
          {(["all", "stream", "generate"] as ModeFilter[]).map(m => (
            <button
              key={m}
              onClick={() => setModeFilter(m)}
              className={clsx(
                "px-2 py-0.5 text-xs rounded",
                modeFilter === m ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {m}
            </button>
          ))}
          <span className="mx-2 w-px h-4 bg-gray-200" />
          <span className="text-[10px] uppercase text-gray-400 font-medium tracking-wider">Auth</span>
          {(["all", "authed", "anon"] as AuthFilter[]).map(a => (
            <button
              key={a}
              onClick={() => setAuthFilter(a)}
              className={clsx(
                "px-2 py-0.5 text-xs rounded",
                authFilter === a ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {a}
            </button>
          ))}
          <span className="mx-2 w-px h-4 bg-gray-200" />
          <span className="text-[10px] uppercase text-gray-400 font-medium tracking-wider">Status</span>
          {(["all", "ok", "error"] as StatusFilter[]).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx(
                "px-2 py-0.5 text-xs rounded",
                statusFilter === s ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {s}
            </button>
          ))}
          <span className="mx-2 w-px h-4 bg-gray-200" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search messages / response"
            className="px-2 py-1 text-xs border border-gray-200 rounded w-64"
          />
          <span className="ml-auto text-[10px] text-gray-400">
            {connectionState === "connected" ? `${filtered.length} / ${rows.length} calls` : connectionState}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase text-gray-400 font-medium tracking-wider">System prompt</span>
          {allSystemPrompts.map(sp => (
            <button
              key={sp}
              onClick={() => toggle(systemPromptFilter, sp, setSystemPromptFilter)}
              className={clsx(
                "px-2 py-0.5 text-[11px] rounded font-mono",
                systemPromptFilter.has(sp) ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {sp}
            </button>
          ))}
        </div>
        {allModels.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase text-gray-400 font-medium tracking-wider">Model</span>
            {allModels.map(m => (
              <button
                key={m}
                onClick={() => toggle(modelFilter, m, setModelFilter)}
                className={clsx(
                  "px-2 py-0.5 text-[11px] rounded font-mono",
                  modelFilter.has(m) ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-8 gap-3">
        <MetricCard label="Total Calls" value={stats.totalCalls.toLocaleString()} />
        <MetricCard label="Errors" value={stats.errorCalls.toLocaleString()} valueClass={stats.errorCalls > 0 ? "text-red-600" : undefined} />
        <MetricCard label="Input Tokens" value={stats.inputTokens.toLocaleString()} />
        <MetricCard label="Output Tokens" value={stats.outputTokens.toLocaleString()} />
        <MetricCard
          label="Cache Hit %"
          value={stats.inputTokens > 0 ? `${Math.round((stats.cachedInputTokens / stats.inputTokens) * 100)}%` : "—"}
          valueClass={stats.inputTokens > 0 && stats.cachedInputTokens / stats.inputTokens > 0.5 ? "text-green-600" : undefined}
        />
        <MetricCard label="Total Cost" value={formatUsd(stats.totalCost)} />
        <MetricCard label="Avg Duration" value={`${stats.avgDuration.toLocaleString()}ms`} />
        <MetricCard label="p95 Duration" value={`${stats.p95Duration.toLocaleString()}ms`} />
      </div>

      {/* Time-series charts */}
      <div className="grid grid-cols-2 gap-3">
        <Card title="Calls Over Time">
          <div className="flex items-end gap-0.5 h-32">
            {stats.timeBuckets.map((b, i) => (
              <div key={i} className="flex-1 flex flex-col items-center" title={`${b.label}: ${b.calls}`}>
                <div className="w-full flex-1 flex items-end">
                  <div className="w-full bg-blue-400 rounded-t" style={{ height: `${(b.calls / stats.maxCalls) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-gray-400 mt-1">
            <span>{stats.timeBuckets[0]?.label}</span>
            <span>{stats.timeBuckets[stats.timeBuckets.length - 1]?.label}</span>
          </div>
        </Card>

        <Card title="Token Volume (input + output)">
          <div className="flex items-end gap-0.5 h-32">
            {stats.timeBuckets.map((b, i) => {
              const total = b.inputTokens + b.outputTokens;
              const outPct = total > 0 ? (b.outputTokens / total) * 100 : 0;
              return (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-stretch justify-end"
                  title={`${b.label}: in ${b.inputTokens} / out ${b.outputTokens}`}
                  style={{ height: `${(total / stats.maxTokenTotal) * 100}%` }}
                >
                  <div className="bg-emerald-400" style={{ height: `${outPct}%` }} />
                  <div className="bg-cyan-400 rounded-b" style={{ height: `${100 - outPct}%` }} />
                </div>
              );
            })}
          </div>
          <div className="flex gap-3 text-[9px] text-gray-400 mt-1">
            <span><span className="inline-block w-2 h-2 bg-cyan-400 mr-1 align-middle" />input</span>
            <span><span className="inline-block w-2 h-2 bg-emerald-400 mr-1 align-middle" />output</span>
          </div>
        </Card>

        <Card title="Cached vs Fresh Input Tokens">
          <div className="flex items-end gap-0.5 h-32">
            {stats.timeBuckets.map((b, i) => {
              const cachedPct = b.inputTokens > 0 ? (b.cachedInputTokens / b.inputTokens) * 100 : 0;
              return (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-stretch justify-end"
                  title={`${b.label}: ${b.cachedInputTokens.toLocaleString()} cached / ${b.inputTokens.toLocaleString()} total`}
                  style={{ height: `${(b.inputTokens / stats.maxInputTokens) * 100}%` }}
                >
                  <div className="bg-gray-300" style={{ height: `${100 - cachedPct}%` }} />
                  <div className="bg-green-400 rounded-b" style={{ height: `${cachedPct}%` }} />
                </div>
              );
            })}
          </div>
          <div className="flex gap-3 text-[9px] text-gray-400 mt-1">
            <span><span className="inline-block w-2 h-2 bg-gray-300 mr-1 align-middle" />fresh</span>
            <span><span className="inline-block w-2 h-2 bg-green-400 mr-1 align-middle" />cached</span>
          </div>
        </Card>

        <Card title="Cache Hit % by System Prompt">
          {stats.cacheHitBySystemPrompt.length === 0 ? (
            <p className="text-sm text-gray-400">No data</p>
          ) : (
            <div className="space-y-1.5">
              {stats.cacheHitBySystemPrompt.map(entry => (
                <div key={entry.id} className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-600 font-mono w-40 truncate" title={entry.id}>{entry.id}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                    <div
                      className={clsx(
                        "h-full rounded",
                        entry.hitPct >= 50 ? "bg-green-500" : entry.hitPct >= 20 ? "bg-yellow-400" : "bg-red-400"
                      )}
                      style={{ width: `${entry.hitPct}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-gray-600 w-10 text-right font-mono">{entry.hitPct}%</span>
                  <span className="text-[10px] text-gray-400 w-12 text-right font-mono">{entry.calls} calls</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="By System Prompt">
          <DistributionBars items={stats.sysPromptDist} color="bg-purple-400" />
        </Card>

        <Card title="By Model">
          <DistributionBars items={stats.modelDist} color="bg-indigo-400" />
        </Card>

        <Card title="Tool Usage (from request)">
          <DistributionBars items={stats.toolDist} color="bg-orange-400" />
        </Card>

        <Card title="Latency Distribution">
          <div className="space-y-2">
            {stats.latencyBuckets.map(b => (
              <div key={b.label} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-20">{b.label}</span>
                <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                  <div className="h-full bg-pink-400 rounded" style={{ width: `${(b.count / stats.maxLatencyBucket) * 100}%` }} />
                </div>
                <span className="text-xs text-gray-600 w-8 text-right">{b.count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Call list */}
      <Card title={`Calls (${filtered.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-gray-400 font-medium tracking-wider">
              <tr className="border-b border-gray-200">
                <SortHeader align="left" active={sortKey === "createdAt"} dir={sortDir} onClick={() => toggleSort("createdAt")}>Time</SortHeader>
                <SortHeader align="left" active={sortKey === "systemPromptId"} dir={sortDir} onClick={() => toggleSort("systemPromptId")}>System Prompt</SortHeader>
                <SortHeader align="left" active={sortKey === "modelId"} dir={sortDir} onClick={() => toggleSort("modelId")}>Model</SortHeader>
                <SortHeader align="left" active={sortKey === "mode"} dir={sortDir} onClick={() => toggleSort("mode")}>Mode</SortHeader>
                <SortHeader align="right" active={sortKey === "inputTokens"} dir={sortDir} onClick={() => toggleSort("inputTokens")}>In tok</SortHeader>
                <SortHeader align="right" active={sortKey === "outputTokens"} dir={sortDir} onClick={() => toggleSort("outputTokens")}>Out tok</SortHeader>
                <SortHeader align="right" active={sortKey === "cachedInputTokens"} dir={sortDir} onClick={() => toggleSort("cachedInputTokens")}>Cached</SortHeader>
                <SortHeader align="right" active={sortKey === "costUsd"} dir={sortDir} onClick={() => toggleSort("costUsd")}>Cost</SortHeader>
                <SortHeader align="right" active={sortKey === "durationMs"} dir={sortDir} onClick={() => toggleSort("durationMs")}>Duration</SortHeader>
                <SortHeader align="left" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")}>Status</SortHeader>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(row => {
                const isError = row.errorMessage != null && row.errorMessage !== "";
                return (
                  <tr
                    key={String(row.id)}
                    onClick={() => onSelect(row)}
                    className={clsx(
                      "border-b border-gray-100 cursor-pointer hover:bg-blue-50",
                      selectedId === row.id && "bg-blue-50"
                    )}
                  >
                    <td className="py-2 pr-3 text-gray-500 font-mono">
                      {toDate(row.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-mono text-[10px]">
                        {row.systemPromptId}
                      </span>
                      {row.mcpCorrelationId != null && (
                        <span className="ml-1 inline-flex px-1 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px]">MCP</span>
                      )}
                      {!row.isAuthenticated && (
                        <span className="ml-1 inline-flex px-1 py-0.5 rounded bg-gray-100 text-gray-500 text-[9px]">anon</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-gray-600 font-mono truncate max-w-[200px]">{row.modelId}</td>
                    <td className="py-2 pr-3 text-gray-500">{row.mode}</td>
                    <td className="py-2 pr-3 text-right font-mono text-gray-600">{row.inputTokens?.toLocaleString() ?? "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono text-gray-600">{row.outputTokens?.toLocaleString() ?? "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono text-gray-600">
                      {row.cachedInputTokens != null && row.cachedInputTokens > 0 ? (
                        <span className="text-green-600">{row.cachedInputTokens.toLocaleString()}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-gray-600">{row.costUsd != null ? formatUsd(row.costUsd) : "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono text-gray-600">{Number(row.durationMs).toLocaleString()}ms</td>
                    <td className="py-2 pr-3">
                      {isError ? (
                        <span className="inline-flex px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px]">error</span>
                      ) : (
                        <span className="inline-flex px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[10px]">ok</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between mt-3 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Page size</span>
              {PAGE_SIZES.map(s => (
                <button
                  key={s}
                  onClick={() => setPageSize(s)}
                  className={clsx(
                    "px-2 py-0.5 text-xs rounded",
                    pageSize === s ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">
                {sorted.length === 0
                  ? "No results"
                  : `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, sorted.length)} of ${sorted.length}`}
              </span>
              <button
                onClick={() => setPage(Math.max(0, currentPage - 1))}
                disabled={currentPage === 0}
                className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 disabled:hover:bg-gray-100"
              >
                Prev
              </button>
              <span className="text-gray-500 font-mono">{currentPage + 1} / {pageCount}</span>
              <button
                onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
                disabled={currentPage >= pageCount - 1}
                className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 disabled:hover:bg-gray-100"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function SortHeader({
  children,
  align,
  active,
  dir,
  onClick,
}: {
  children: React.ReactNode,
  align: "left" | "right",
  active: boolean,
  dir: SortDir,
  onClick: () => void,
}) {
  return (
    <th className={clsx("py-2 pr-3", align === "left" ? "text-left" : "text-right")}>
      <button
        onClick={onClick}
        className={clsx(
          "inline-flex items-center gap-1 hover:text-gray-700",
          active ? "text-gray-700" : "text-gray-400"
        )}
      >
        <span>{children}</span>
        <span className="text-[8px]">
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

function formatUsd(value: number): string {
  if (value === 0) return "$0";
  return `$${value.toFixed(4)}`;
}

function MetricCard({ label, value, valueClass }: { label: string, value: string, valueClass?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <p className="text-[10px] uppercase text-gray-400 font-medium tracking-wider mb-1">{label}</p>
      <p className={clsx("text-xl font-bold", valueClass ?? "text-gray-900")}>{value}</p>
    </div>
  );
}

function Card({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  );
}

function DistributionBars({ items, color }: { items: Array<[string, number]>, color: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-400">No data</p>;
  }
  const max = Math.max(...items.map(i => i[1]), 1);
  return (
    <div className="space-y-1.5">
      {items.map(([label, count]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="text-[11px] text-gray-600 font-mono w-40 truncate">{label}</span>
          <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
            <div className={clsx("h-full rounded", color)} style={{ width: `${(count / max) * 100}%` }} />
          </div>
          <span className="text-[11px] text-gray-600 w-8 text-right">{count}</span>
        </div>
      ))}
    </div>
  );
}
