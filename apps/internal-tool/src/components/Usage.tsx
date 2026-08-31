import { useEffect, useMemo, useState } from "react";
import type { AiQueryLogRow } from "../types";
import { toDate } from "../utils";
import {
  Alert,
  Badge,
  BarRow,
  Button,
  Card,
  chartColors,
  cn,
  Divider,
  EmptyState,
  FieldLabel,
  Input,
  LegendItem,
  MetricCard,
  Pill,
  SortHeader,
  tableClasses,
} from "./design";

type TimeRange = "24h" | "7d" | "30d" | "all";
type AuthFilter = "all" | "authed" | "anon";
type ModeFilter = "all" | "stream" | "generate";
type StatusFilter = "all" | "ok" | "error";
type SortKey = "createdAt" | "systemPromptId" | "modelId" | "mode" | "inputTokens" | "outputTokens" | "cachedInputTokens" | "cacheCreationTokens" | "cacheSavingsUsd" | "costUsd" | "durationMs" | "status";
type SortDir = "asc" | "desc";
const PAGE_SIZES = [25, 50, 100, 500] as const;
type PageSize = typeof PAGE_SIZES[number];

type Props = {
  rows: AiQueryLogRow[],
  connectionState: "connecting" | "connected" | "error",
  connectionErrorMessage: string | null,
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

export function Usage({ rows, connectionState, connectionErrorMessage, onSelect, selectedId }: Props) {
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
        case "cacheCreationTokens": {
          av = a.cacheCreationTokens ?? -1;
          bv = b.cacheCreationTokens ?? -1;
          break;
        }
        case "cacheSavingsUsd": {
          av = a.cacheDiscountUsd ?? Number.NEGATIVE_INFINITY;
          bv = b.cacheDiscountUsd ?? Number.NEGATIVE_INFINITY;
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
    const cacheCreationTokens = filtered.reduce((a, r) => a + (r.cacheCreationTokens ?? 0), 0);
    const cacheSavingsUsd = filtered.reduce((a, r) => a + (r.cacheDiscountUsd ?? 0), 0);
    const totalCost = filtered.reduce((a, r) => a + (r.costUsd ?? 0), 0);
    const durations = filtered.map(r => Number(r.durationMs)).filter(d => d > 0).sort((a, b) => a - b);
    const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const p95Duration = durations.length > 0 ? durations[Math.min(Math.floor(durations.length * 0.95), durations.length - 1)] : 0;

    let seriesStart: number;
    let seriesEnd: number;
    if (timeRange === "all" && filtered.length > 0) {
      seriesStart = Infinity;
      seriesEnd = -Infinity;
      for (const r of filtered) {
        const ts = toDate(r.createdAt).getTime();
        if (ts < seriesStart) seriesStart = ts;
        if (ts > seriesEnd) seriesEnd = ts;
      }
    } else {
      seriesStart = rangeStart;
      seriesEnd = now;
    }
    const spanMs = Math.max(0, seriesEnd - seriesStart);
    let bucketMs = spanMs <= 24 * 60 * 60 * 1000 ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const bucketCount = Math.min(48, Math.max(1, Math.ceil(spanMs / bucketMs)));
    if (spanMs > bucketCount * bucketMs) {
      bucketMs = Math.ceil(spanMs / bucketCount);
    }
    const bucketLabelFmt: Intl.DateTimeFormatOptions = bucketMs === 60 * 60 * 1000
      ? { hour: "numeric" }
      : { month: "short", day: "numeric" };
    const bucketStart = seriesEnd - bucketCount * bucketMs;
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
      // Clamp the top boundary: a row at exactly seriesEnd computes idx === bucketCount
      // and would otherwise be dropped (the newest call always disappeared from charts).
      const idx = Math.min(Math.floor((ts - bucketStart) / bucketMs), bucketCount - 1);
      if (idx >= 0) {
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
      totalCalls, errorCalls, inputTokens, outputTokens, cachedInputTokens, cacheCreationTokens, cacheSavingsUsd, totalCost,
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
      {connectionState === "error" && (
        <Alert>
          <p>
            Failed to connect to SpacetimeDB. Check the browser session response below, then verify the{" "}
            <code>hexclave-ai-analytics</code> module is published and the local SpacetimeDB container is reachable.
          </p>
          {connectionErrorMessage != null && connectionErrorMessage !== "" && (
            <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-destructive/30 bg-destructive/10 p-3 font-mono text-xs">
              {connectionErrorMessage}
            </pre>
          )}
        </Alert>
      )}
      {/* Filter bar */}
      <div className="sticky top-0 z-10 space-y-2 rounded-2xl bg-surface p-2.5 ring-1 ring-inset ring-border">
        <div className="flex items-center gap-1.5 flex-wrap">
          <FieldLabel>Range</FieldLabel>
          {(["24h", "7d", "30d", "all"] as TimeRange[]).map(r => (
            <Pill key={r} active={timeRange === r} onClick={() => setTimeRange(r)}>{r}</Pill>
          ))}
          <Divider />
          <FieldLabel>Mode</FieldLabel>
          {(["all", "stream", "generate"] as ModeFilter[]).map(m => (
            <Pill key={m} active={modeFilter === m} onClick={() => setModeFilter(m)}>{m}</Pill>
          ))}
          <Divider />
          <FieldLabel>Auth</FieldLabel>
          {(["all", "authed", "anon"] as AuthFilter[]).map(a => (
            <Pill key={a} active={authFilter === a} onClick={() => setAuthFilter(a)}>{a}</Pill>
          ))}
          <Divider />
          <FieldLabel>Status</FieldLabel>
          {(["all", "ok", "error"] as StatusFilter[]).map(s => (
            <Pill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>{s}</Pill>
          ))}
          <Divider />
          <Input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search messages / response"
            className="w-64"
          />
          <span className="ml-auto text-[10px] text-muted-foreground">
            {connectionState === "connected" ? `${filtered.length} / ${rows.length} calls` : connectionState}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <FieldLabel>System prompt</FieldLabel>
          {allSystemPrompts.map(sp => (
            <Pill
              key={sp}
              mono
              active={systemPromptFilter.has(sp)}
              onClick={() => toggle(systemPromptFilter, sp, setSystemPromptFilter)}
            >
              {sp}
            </Pill>
          ))}
        </div>
        {allModels.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <FieldLabel>Model</FieldLabel>
            {allModels.map(m => (
              <Pill
                key={m}
                mono
                active={modelFilter.has(m)}
                onClick={() => toggle(modelFilter, m, setModelFilter)}
              >
                {m}
              </Pill>
            ))}
          </div>
        )}
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-9 gap-3">
        <MetricCard
          label="Total Calls"
          value={stats.totalCalls.toLocaleString()}
          tooltip="Number of AI requests in the filtered window. Counts every row visible after filters are applied."
        />
        <MetricCard
          label="Errors"
          value={stats.errorCalls.toLocaleString()}
          valueClassName={stats.errorCalls > 0 ? "text-destructive" : undefined}
          tooltip="Requests that failed. Counted as rows where errorMessage is non-empty (upstream provider error, timeout, or client abort)."
        />
        <MetricCard
          label="Input Tokens"
          value={stats.inputTokens.toLocaleString()}
          tooltip="Sum of prompt tokens across all filtered requests. Includes fresh + cached + written tokens."
        />
        <MetricCard
          label="Output Tokens"
          value={stats.outputTokens.toLocaleString()}
          tooltip="Sum of generated tokens across all filtered requests."
        />
        <MetricCard
          label="Cache Hit %"
          value={stats.inputTokens > 0 ? `${Math.round((stats.cachedInputTokens / stats.inputTokens) * 100)}%` : "—"}
          valueClassName={stats.inputTokens > 0 && stats.cachedInputTokens / stats.inputTokens > 0.5 ? "text-success" : undefined}
          tooltip="Share of input tokens served from cache vs. processed fresh. Computed as sum(cachedInputTokens) / sum(inputTokens). Higher = caching is doing its job."
        />
        <MetricCard
          label="Total Cost"
          value={formatUsd(stats.totalCost)}
          tooltip="Sum of dollar costs across all filtered requests."
        />
        <MetricCard
          label="Cache Savings"
          value={`${stats.cacheSavingsUsd >= 0 ? "+" : "−"}${formatUsd(Math.abs(stats.cacheSavingsUsd))}`}
          valueClassName={stats.cacheSavingsUsd >= 0 ? "text-success" : "text-destructive"}
          tooltip="Sum of cache_discount values across filtered requests. Positive (green) means caching net-saved money; negative (red) means cold-start writes outweighed reads. Filter by systemPromptId to judge whether caching is worth keeping on a specific flow."
        />
        <MetricCard
          label="Avg Duration"
          value={`${stats.avgDuration.toLocaleString()}ms`}
          tooltip="Mean wall-clock time per request, in milliseconds."
        />
        <MetricCard
          label="p95 Duration"
          value={`${stats.p95Duration.toLocaleString()}ms`}
          tooltip="95th percentile request duration. 95% of requests completed faster than this. Useful for spotting tail latency."
        />
      </div>

      {/* Time-series charts */}
      <div className="grid grid-cols-2 gap-3">
        <Card title="Calls Over Time">
          <div className="flex items-end gap-0.5 h-32">
            {stats.timeBuckets.map((b, i) => (
              <div key={i} className="flex-1 flex flex-col items-center" title={`${b.label}: ${b.calls}`}>
                <div className="w-full flex-1 flex items-end">
                  <div className={cn("w-full rounded-t", chartColors.blue)} style={{ height: `${(b.calls / stats.maxCalls) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
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
                  <div className={chartColors.emerald} style={{ height: `${outPct}%` }} />
                  <div className={cn("rounded-b", chartColors.cyan)} style={{ height: `${100 - outPct}%` }} />
                </div>
              );
            })}
          </div>
          <div className="flex gap-3 mt-1">
            <LegendItem colorClass={chartColors.cyan}>input</LegendItem>
            <LegendItem colorClass={chartColors.emerald}>output</LegendItem>
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
                  <div className={chartColors.neutral} style={{ height: `${100 - cachedPct}%` }} />
                  <div className={cn("rounded-b", chartColors.green)} style={{ height: `${cachedPct}%` }} />
                </div>
              );
            })}
          </div>
          <div className="flex gap-3 mt-1">
            <LegendItem colorClass={chartColors.neutral}>fresh</LegendItem>
            <LegendItem colorClass={chartColors.green}>cached</LegendItem>
          </div>
        </Card>

        <Card title="Cache Hit % by System Prompt">
          {stats.cacheHitBySystemPrompt.length === 0 ? (
            <EmptyState>No data</EmptyState>
          ) : (
            <div className="space-y-1.5">
              {stats.cacheHitBySystemPrompt.map(entry => (
                <BarRow
                  key={entry.id}
                  title={entry.id}
                  label={entry.id}
                  labelClassName="w-40 font-mono"
                  barClassName={
                    entry.hitPct >= 50 ? chartColors.emerald : entry.hitPct >= 20 ? chartColors.amber : chartColors.red
                  }
                  pct={entry.hitPct}
                  value={`${entry.hitPct}%`}
                  extra={<span className="w-12 text-right font-mono text-[10px] tabular-nums text-muted-foreground">{entry.calls} calls</span>}
                />
              ))}
            </div>
          )}
        </Card>

        <Card title="By System Prompt">
          <DistributionBars items={stats.sysPromptDist} color={chartColors.purple} />
        </Card>

        <Card title="By Model">
          <DistributionBars items={stats.modelDist} color={chartColors.indigo} />
        </Card>

        <Card title="Tool Usage (from request)">
          <DistributionBars items={stats.toolDist} color={chartColors.orange} />
        </Card>

        <Card title="Latency Distribution">
          <div className="space-y-2">
            {stats.latencyBuckets.map(b => (
              <BarRow
                key={b.label}
                label={b.label}
                labelClassName="w-20"
                barClassName={chartColors.pink}
                pct={(b.count / stats.maxLatencyBucket) * 100}
                value={b.count}
              />
            ))}
          </div>
        </Card>
      </div>

      {/* Call list */}
      <Card title={`Calls (${filtered.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className={tableClasses.headRow}>
                <SortHeader align="left" active={sortKey === "createdAt"} dir={sortDir} onClick={() => toggleSort("createdAt")} tooltip="When the request was logged.">Time</SortHeader>
                <SortHeader align="left" active={sortKey === "systemPromptId"} dir={sortDir} onClick={() => toggleSort("systemPromptId")} tooltip="Which app flow triggered the AI call (e.g. create-dashboard, docs-ask-ai).">System Prompt</SortHeader>
                <SortHeader align="left" active={sortKey === "modelId"} dir={sortDir} onClick={() => toggleSort("modelId")} tooltip="Which LLM processed the request.">Model</SortHeader>
                <SortHeader align="left" active={sortKey === "mode"} dir={sortDir} onClick={() => toggleSort("mode")} tooltip="stream — tokens streamed as generated (streamText). generate — single JSON response after completion (generateText).">Mode</SortHeader>
                <SortHeader align="right" active={sortKey === "inputTokens"} dir={sortDir} onClick={() => toggleSort("inputTokens")} tooltip="Total prompt tokens sent to the model">In tok</SortHeader>
                <SortHeader align="right" active={sortKey === "outputTokens"} dir={sortDir} onClick={() => toggleSort("outputTokens")} tooltip="Tokens the model generated in its response.">Out tok</SortHeader>
                <SortHeader align="right" active={sortKey === "cachedInputTokens"} dir={sortDir} onClick={() => toggleSort("cachedInputTokens")} tooltip="Prompt tokens read from the provider prompt cache. Higher = caching is paying off.">Cache Read</SortHeader>
                <SortHeader align="right" active={sortKey === "cacheCreationTokens"} dir={sortDir} onClick={() => toggleSort("cacheCreationTokens")} tooltip="Prompt tokens written to cache on this request. High on cold-start; should be near zero on warm hits.">Cache W</SortHeader>
                <SortHeader align="right" active={sortKey === "cacheSavingsUsd"} dir={sortDir} onClick={() => toggleSort("cacheSavingsUsd")} tooltip="Dollars saved by caching on this request, computed by OpenRouter.">Cache $</SortHeader>
                <SortHeader align="right" active={sortKey === "costUsd"} dir={sortDir} onClick={() => toggleSort("costUsd")} tooltip="Total dollar cost of this request, billed by OpenRouter. Includes prompt, completion, cache reads, and cache writes.">Cost</SortHeader>
                <SortHeader align="right" active={sortKey === "durationMs"} dir={sortDir} onClick={() => toggleSort("durationMs")} tooltip="Total wall-clock time from request start to onFinish, in milliseconds. Measured via performance.now() in the backend handler.">Duration</SortHeader>
                <SortHeader align="left" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")} tooltip="ok = success. error = upstream provider returned an error, the request was aborted, or the AI SDK threw.">Status</SortHeader>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(row => {
                const isError = row.errorMessage != null && row.errorMessage !== "";
                return (
                  <tr
                    key={String(row.id)}
                    role="button"
                    tabIndex={0}
                    aria-selected={selectedId === row.id}
                    onClick={() => onSelect(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(row);
                      }
                    }}
                    className={cn(tableClasses.bodyRow, selectedId === row.id && tableClasses.selectedRow)}
                  >
                    <td className="py-2 pr-3 font-mono text-muted-foreground">
                      {toDate(row.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge color="purple" mono>{row.systemPromptId}</Badge>
                      {row.conversationId != null && (
                        <Badge color="orange" size="xs" className="ml-1">MCP</Badge>
                      )}
                      {!row.isAuthenticated && (
                        <Badge size="xs" className="ml-1">anon</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 max-w-[200px] truncate font-mono text-foreground">{row.modelId}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{row.mode}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-foreground">{row.inputTokens?.toLocaleString() ?? "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-foreground">{row.outputTokens?.toLocaleString() ?? "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {row.cachedInputTokens != null && row.cachedInputTokens > 0 ? (
                        <span className="text-success">{row.cachedInputTokens.toLocaleString()}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {row.cacheCreationTokens != null && row.cacheCreationTokens > 0 ? (
                        <span className="text-warning">{row.cacheCreationTokens.toLocaleString()}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {(() => {
                        const savings = row.cacheDiscountUsd;
                        if (savings == null) return <span className="text-muted-foreground">—</span>;
                        const sign = savings >= 0 ? "+" : "−";
                        const color = savings >= 0 ? "text-success" : "text-destructive";
                        return <span className={color}>{sign}{formatUsd(Math.abs(savings))}</span>;
                      })()}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-foreground">{row.costUsd != null ? formatUsd(row.costUsd) : "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-foreground">{Number(row.durationMs).toLocaleString()}ms</td>
                    <td className="py-2 pr-3">
                      <Badge color={isError ? "red" : "green"}>{isError ? "error" : "ok"}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <FieldLabel>Page size</FieldLabel>
              {PAGE_SIZES.map(s => (
                <Pill key={s} active={pageSize === s} onClick={() => setPageSize(s)}>{s}</Pill>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">
                {sorted.length === 0
                  ? "No results"
                  : `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, sorted.length)} of ${sorted.length}`}
              </span>
              <Button size="xs" onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0}>
                Prev
              </Button>
              <span className="font-mono tabular-nums text-muted-foreground">{currentPage + 1} / {pageCount}</span>
              <Button size="xs" onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))} disabled={currentPage >= pageCount - 1}>
                Next
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function formatUsd(value: number): string {
  if (value === 0) return "$0";
  return `$${value.toFixed(4)}`;
}

function DistributionBars({ items, color }: { items: Array<[string, number]>, color: string }) {
  if (items.length === 0) {
    return <EmptyState>No data</EmptyState>;
  }
  const max = Math.max(...items.map(i => i[1]), 1);
  return (
    <div className="space-y-1.5">
      {items.map(([label, count]) => (
        <BarRow
          key={label}
          label={label}
          labelClassName="w-40 font-mono"
          barClassName={color}
          pct={(count / max) * 100}
          value={count}
        />
      ))}
    </div>
  );
}
