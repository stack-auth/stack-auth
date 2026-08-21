"use client";

import { DesignAlert, DesignButton, DesignCard, DesignInput } from "@/components/design-components";
import { ArrowClockwiseIcon, FunnelIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { useCallback, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { pageViewTelemetrySubquery } from "../page-view-query";

type FunnelRow = { step: number, users: number };

function funnelQuery(): string {
  return `
WITH
  {steps:Array(String)} AS steps,
  visits AS (
    SELECT user_id, JSONExtractString(data, 'path') AS path, min(started_at) AS first_at
    FROM ${pageViewTelemetrySubquery()}
    WHERE user_id != ''
      AND JSONExtractString(data, 'path') IN {steps:Array(String)}
    GROUP BY user_id, path
  )
SELECT
  indexOf(steps, path) AS step,
  uniqExact(user_id) AS users
FROM visits
WHERE indexOf(steps, path) > 0
GROUP BY step
ORDER BY step ASC
`;
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const [stepA, setStepA] = useState("/");
  const [stepB, setStepB] = useState("/pricing");
  const [stepC, setStepC] = useState("/signup");
  const [rows, setRows] = useState<FunnelRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const steps = [stepA, stepB, stepC].map((step) => step.trim()).filter((step) => step !== "");
    if (steps.length < 2) {
      setError("Enter at least two page paths.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await adminApp.queryAnalytics({
        query: funnelQuery(),
        params: { steps },
        include_all_branches: false,
        timeout_ms: 30_000,
      });
      setRows(response.result.flatMap((row) => {
        const step = Number(row.step);
        const users = Number(row.users);
        if (!Number.isFinite(step) || !Number.isFinite(users)) return [];
        return [{ step, users }];
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [adminApp, stepA, stepB, stepC]);

  const baseline = rows?.find((row) => row.step === 1)?.users ?? 0;

  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout title="Funnels" description="Users who visited each exact page path. This is not a sequential funnel — a user can count at a later step without having hit an earlier one." scrollMain>
        {error != null && <DesignAlert variant="error" title="Couldn't load funnel" description={error} />}
        <DesignCard title="Steps" subtitle="Enter 2–3 paths" icon={FunnelIcon}>
          <div className="grid gap-2 sm:grid-cols-3">
            <DesignInput size="sm" value={stepA} onChange={(event) => setStepA(event.target.value)} placeholder="/ " aria-label="Funnel step 1" />
            <DesignInput size="sm" value={stepB} onChange={(event) => setStepB(event.target.value)} placeholder="/pricing" aria-label="Funnel step 2" />
            <DesignInput size="sm" value={stepC} onChange={(event) => setStepC(event.target.value)} placeholder="/signup" aria-label="Funnel step 3" />
          </div>
          <DesignButton size="sm" variant="secondary" className="mt-3 gap-1.5" loading={loading} onClick={load}>
            {loading ? <SpinnerGapIcon className="h-3.5 w-3.5 animate-spin" /> : <ArrowClockwiseIcon className="h-3.5 w-3.5" />}
            Run funnel
          </DesignButton>
        </DesignCard>
        {rows != null && (
          <div className="mt-3">
            <DesignCard title="Conversion" icon={FunnelIcon}>
              <ol className="space-y-2">
                {rows.map((row) => (
                  <li key={row.step} className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-3 py-2 text-sm ring-1 ring-foreground/[0.06]">
                    <span>Step {row.step}</span>
                    <span className="tabular-nums">
                      {row.users}
                      {baseline > 0 ? ` · ${Math.round((row.users / baseline) * 100)}%` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </DesignCard>
          </div>
        )}
      </PageLayout>
    </AppEnabledGuard>
  );
}
