"use client";

import { DesignAlert, DesignButton, DesignCard } from "@/components/design-components";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { ArrowClockwiseIcon, ChartLineIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

const RETENTION_QUERY = `
SELECT
  toStartOfWeek(first_seen) AS cohort,
  dateDiff('week', toStartOfWeek(first_seen), event_week) AS week_n,
  uniqExact(user_id) AS users
FROM (
  SELECT
    user_id,
    min(started_at) AS first_seen,
    toStartOfWeek(started_at) AS event_week
  FROM default.spans
  WHERE span_type = '$page-view'
    AND user_id != ''
  GROUP BY user_id, event_week
)
WHERE dateDiff('week', toStartOfWeek(first_seen), event_week) BETWEEN 0 AND 7
GROUP BY cohort, week_n
ORDER BY cohort DESC, week_n ASC
LIMIT 400
`;

type RetentionRow = { cohort: string, week_n: number, users: number };

function parseRows(result: readonly Record<string, unknown>[]): RetentionRow[] {
  return result.flatMap((row) => {
    const cohort = row.cohort;
    const weekN = Number(row.week_n);
    const users = Number(row.users);
    if (typeof cohort !== "string" || !Number.isFinite(weekN) || !Number.isFinite(users)) return [];
    return [{ cohort, week_n: weekN, users }];
  });
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const [rows, setRows] = useState<RetentionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await adminApp.queryAnalytics({
        query: RETENTION_QUERY,
        include_all_branches: false,
        timeout_ms: 30_000,
      });
      setRows(parseRows(response.result));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [adminApp]);

  useEffect(() => {
    runAsynchronously(load);
  }, [load]);

  const cohorts = [...new Set(rows.map((row) => row.cohort))];

  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout
        title="Retention"
        description="Weekly cohorts of users who sent a page view, and how many returned in later weeks."
        actions={<DesignButton size="sm" variant="ghost" loading={loading} onClick={load} className="gap-1.5"><ArrowClockwiseIcon className="h-3.5 w-3.5" />Refresh</DesignButton>}
        scrollMain
      >
        {error != null && <DesignAlert variant="error" title="Couldn't load retention" description={error} />}
        {loading && rows.length === 0 && (
          <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
            <SpinnerGapIcon className="h-4 w-4 animate-spin" /> Loading cohorts…
          </div>
        )}
        {!loading && rows.length === 0 && error == null && (
          <DesignAlert variant="info" title="No page-view cohorts yet" description="Retention is computed from $page-view spans with a user id." />
        )}
        {cohorts.length > 0 && (
          <DesignCard title="Weekly return" subtitle="Week 0 is the cohort's first page view" icon={ChartLineIcon}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Cohort</th>
                    {Array.from({ length: 8 }, (_, week) => (
                      <th key={week} className="py-1.5 pr-3 font-medium tabular-nums">W{week}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cohorts.map((cohort) => {
                    const byWeek = new Map(rows.filter((row) => row.cohort === cohort).map((row) => [row.week_n, row.users]));
                    const baseline = byWeek.get(0) ?? 0;
                    return (
                      <tr key={cohort} className="border-t border-foreground/[0.06]">
                        <td className="py-1.5 pr-3 font-mono">{cohort}</td>
                        {Array.from({ length: 8 }, (_, week) => {
                          const users = byWeek.get(week);
                          const label = users == null ? "—" : baseline === 0 ? String(users) : `${Math.round((users / baseline) * 100)}%`;
                          return <td key={week} className="py-1.5 pr-3 tabular-nums">{label}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </DesignCard>
        )}
      </PageLayout>
    </AppEnabledGuard>
  );
}
