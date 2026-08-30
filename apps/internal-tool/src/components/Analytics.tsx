import { useMemo } from "react";
import type { McpCallLogRow, QaEntriesRow } from "../types";
import { toDate } from "../utils";
import { Badge, BarRow, Card, chartColors, cn, EmptyState, MetricCard } from "./design";

export function Analytics({ rows, qaEntries }: { rows: McpCallLogRow[], qaEntries: QaEntriesRow[] }) {
  const stats = useMemo(() => {
    const reviewed = rows.filter(r => r.qaOverallScore != null);
    const scores = reviewed.map(r => r.qaOverallScore ?? 0);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

    const needsReview = rows.filter(r => r.qaNeedsHumanReview && !r.humanReviewedAt).length;
    const humanReviewed = rows.filter(r => r.humanReviewedAt != null).length;
    const publishedCount = qaEntries.filter(r => r.published).length;
    const draftCount = qaEntries.filter(r => !r.published).length;

    // Score buckets
    const scoreBuckets = [
      { label: "90-100", min: 90, max: 100, color: chartColors.emerald },
      { label: "70-89", min: 70, max: 89, color: chartColors.green },
      { label: "50-69", min: 50, max: 69, color: chartColors.amber },
      { label: "30-49", min: 30, max: 49, color: chartColors.orange },
      { label: "0-29", min: 0, max: 29, color: chartColors.red },
    ].map(b => ({
      ...b,
      count: scores.filter(s => s >= b.min && s <= b.max).length,
    }));
    const maxScoreBucket = Math.max(...scoreBuckets.map(b => b.count), 1);

    // Flag types
    const flagCounts = new Map<string, number>();
    for (const row of reviewed) {
      if (!row.qaFlagsJson) continue;
      try {
        const flags = JSON.parse(row.qaFlagsJson) as Array<{ type: string }>;
        for (const flag of flags) {
          flagCounts.set(flag.type, (flagCounts.get(flag.type) ?? 0) + 1);
        }
      } catch {
        // ignore
      }
    }
    const topFlags = Array.from(flagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const maxFlagCount = Math.max(...topFlags.map(f => f[1]), 1);

    // Calls over time (last 14 days)
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const daysBack = 14;
    const dayBuckets: Array<{ label: string; count: number; date: Date }> = [];
    for (let i = daysBack - 1; i >= 0; i--) {
      const d = new Date(now - i * dayMs);
      d.setHours(0, 0, 0, 0);
      dayBuckets.push({
        label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        count: 0,
        date: d,
      });
    }
    for (const row of rows) {
      const rowDate = toDate(row.createdAt);
      const dayStart = new Date(rowDate);
      dayStart.setHours(0, 0, 0, 0);
      const bucket = dayBuckets.find(b => b.date.getTime() === dayStart.getTime());
      if (bucket) bucket.count++;
    }
    const maxDayCount = Math.max(...dayBuckets.map(b => b.count), 1);

    // Duration stats
    const durations = rows.map(r => Number(r.durationMs)).filter(d => d > 0).sort((a, b) => a - b);
    const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const p95Duration = durations.length > 0 ? durations[Math.min(Math.floor(durations.length * 0.95), durations.length - 1)] : 0;
    const maxDuration = durations.length > 0 ? durations[durations.length - 1] : 0;

    // Tool usage
    const toolCounts = new Map<string, number>();
    for (const row of rows) {
      toolCounts.set(row.toolName, (toolCounts.get(row.toolName) ?? 0) + 1);
    }
    const toolUsage = Array.from(toolCounts.entries()).sort((a, b) => b[1] - a[1]);

    return {
      total: rows.length,
      reviewed: reviewed.length,
      avgScore,
      needsReview,
      humanReviewed,
      publishedCount,
      draftCount,
      scoreBuckets,
      maxScoreBucket,
      topFlags,
      maxFlagCount,
      dayBuckets,
      maxDayCount,
      avgDuration,
      p95Duration,
      maxDuration,
      toolUsage,
    };
  }, [rows, qaEntries]);

  const humanReviewRate = stats.total > 0 ? Math.round((stats.humanReviewed / stats.total) * 100) : 0;
  const reviewRate = stats.total > 0 ? Math.round((stats.reviewed / stats.total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="Total Calls" value={stats.total.toLocaleString()} />
        <MetricCard
          label="Avg QA Score"
          value={stats.avgScore.toString()}
          valueClassName={
            stats.avgScore >= 80 ? "text-emerald-600 dark:text-emerald-400" :
              stats.avgScore >= 50 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"
          }
          subtitle={`${reviewRate}% reviewed`}
        />
        <MetricCard
          label="Needs Review"
          value={stats.needsReview.toString()}
          valueClassName={stats.needsReview > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}
          subtitle={`${humanReviewRate}% human-reviewed`}
        />
        <MetricCard
          label="Published Q&A"
          value={stats.publishedCount.toString()}
          subtitle={`${stats.draftCount} drafts`}
        />
      </div>

      {/* Calls Over Time */}
      <Card title="Calls Over Time (last 14 days)">
        <div className="flex items-end gap-1 h-32">
          {stats.dayBuckets.map(bucket => (
            <div key={bucket.label} className="flex-1 flex flex-col items-center gap-1" title={`${bucket.label}: ${bucket.count}`}>
              <div className="w-full flex-1 flex items-end">
                <div
                  className={cn("w-full rounded-t", chartColors.blue)}
                  style={{ height: `${(bucket.count / stats.maxDayCount) * 100}%` }}
                />
              </div>
              <span className="text-[9px] text-muted-foreground">{bucket.label}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        {/* QA Score Distribution */}
        <Card title="QA Score Distribution">
          {stats.reviewed === 0 ? (
            <EmptyState>No QA reviews yet</EmptyState>
          ) : (
            <div className="space-y-2">
              {stats.scoreBuckets.map(bucket => (
                <BarRow
                  key={bucket.label}
                  label={bucket.label}
                  labelClassName="w-16"
                  barClassName={bucket.color}
                  pct={(bucket.count / stats.maxScoreBucket) * 100}
                  value={bucket.count}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Top Flag Types */}
        <Card title="Top Flag Types">
          {stats.topFlags.length === 0 ? (
            <EmptyState>No flags raised</EmptyState>
          ) : (
            <div className="space-y-2">
              {stats.topFlags.map(([type, count]) => (
                <BarRow
                  key={type}
                  label={type}
                  labelClassName="w-32 font-mono"
                  barClassName={chartColors.orange}
                  pct={(count / stats.maxFlagCount) * 100}
                  value={count}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Response Time */}
        <Card title="Response Time">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Average</span>
              <span className="font-mono tabular-nums">{stats.avgDuration.toLocaleString()}ms</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">p95</span>
              <span className="font-mono tabular-nums">{stats.p95Duration.toLocaleString()}ms</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max</span>
              <span className="font-mono tabular-nums">{stats.maxDuration.toLocaleString()}ms</span>
            </div>
          </div>
        </Card>

        {/* Tool Usage */}
        <Card title="Tool Usage">
          {stats.toolUsage.length === 0 ? (
            <EmptyState>No calls yet</EmptyState>
          ) : (
            <div className="space-y-2">
              {stats.toolUsage.map(([tool, count]) => (
                <div key={tool} className="flex items-center justify-between">
                  <Badge color="purple" mono>{tool}</Badge>
                  <span className="font-mono text-sm tabular-nums text-muted-foreground">{count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
