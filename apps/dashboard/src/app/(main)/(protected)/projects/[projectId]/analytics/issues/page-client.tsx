"use client";

import { Link } from "@/components/link";
import { Alert, Button, Input, Skeleton, Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { MagnifyingGlassIcon, SparkleIcon } from "@phosphor-icons/react";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useEffect, useMemo, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

type IssueCluster = Awaited<ReturnType<ReturnType<typeof useAdminApp>["listReplayIssueClusters"]>>["items"][number];

const severityTone = {
  critical: "text-red-600 bg-red-500/10 border-red-500/20",
  high: "text-orange-600 bg-orange-500/10 border-orange-500/20",
  medium: "text-amber-600 bg-amber-500/10 border-amber-500/20",
  low: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20",
} as const;

export default function PageClient() {
  const adminApp = useAdminApp();
  const [search, setSearch] = useState("");
  const [clusters, setClusters] = useState<IssueCluster[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    runAsynchronously(async () => {
      try {
        const result = await adminApp.listReplayIssueClusters({ search: search.trim() || undefined, limit: 50 });
        if (cancelled) return;
        setClusters(result.items);
        setSelectedClusterId((current) => current && result.items.some((item) => item.id === current) ? current : result.items[0]?.id ?? null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load replay issues.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, { noErrorLogging: true });
    return () => {
      cancelled = true;
    };
  }, [adminApp, search]);

  const selectedCluster = useMemo(
    () => clusters.find((cluster) => cluster.id === selectedClusterId) ?? null,
    [clusters, selectedClusterId],
  );

  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout
        title="Replay Issues"
        description="Clustered AI-detected issues across session replays."
      >
        <div className="flex h-full min-h-0 overflow-hidden rounded-2xl border border-border/50 bg-background/70 backdrop-blur-xl">
          <div className="w-[340px] shrink-0 border-r border-border/40 flex flex-col min-h-0">
            <div className="p-3 border-b border-border/40">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search replay issues"
                  className="pl-9"
                />
              </div>
            </div>

            {error && (
              <div className="p-3">
                <Alert variant="destructive">{error}</Alert>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {loading ? (
                Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="rounded-xl border border-border/40 p-3 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                ))
              ) : clusters.length === 0 ? (
                <div className="h-full grid place-items-center p-6 text-center">
                  <div className="space-y-2">
                    <SparkleIcon className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                    <Typography className="text-sm text-muted-foreground">
                      No replay issues detected yet.
                    </Typography>
                  </div>
                </div>
              ) : (
                clusters.map((cluster) => (
                  <button
                    key={cluster.id}
                    type="button"
                    onClick={() => setSelectedClusterId(cluster.id)}
                    className={cn(
                      "w-full rounded-xl border p-3 text-left transition-colors hover:transition-none",
                      cluster.id === selectedClusterId
                        ? "border-border bg-muted/50"
                        : "border-border/40 hover:bg-muted/20",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{cluster.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{cluster.occurrenceCount} replays · {cluster.affectedUserCount} users</div>
                      </div>
                      <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase", severityTone[cluster.severity])}>
                        {cluster.severity}
                      </span>
                    </div>
                    {cluster.summary && (
                      <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{cluster.summary}</p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
            {selectedCluster ? (
              <div className="p-6 space-y-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase", severityTone[selectedCluster.severity])}>
                        {selectedCluster.severity}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Confidence {(selectedCluster.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <Typography className="text-2xl font-semibold text-foreground">
                      {selectedCluster.title}
                    </Typography>
                    {selectedCluster.summary && (
                      <Typography className="text-sm text-muted-foreground max-w-2xl">
                        {selectedCluster.summary}
                      </Typography>
                    )}
                  </div>

                  <Button asChild variant="secondary">
                    <Link href={`/projects/${encodeURIComponent(adminApp.projectId)}/analytics/replays`}>
                      Open Replays
                    </Link>
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <MetricCard label="Affected replays" value={String(selectedCluster.occurrenceCount)} />
                  <MetricCard label="Affected users" value={String(selectedCluster.affectedUserCount)} />
                  <MetricCard label="Fingerprint" value={selectedCluster.fingerprint} mono />
                </div>

                <section className="space-y-3">
                  <Typography className="text-sm font-medium text-foreground">Top evidence</Typography>
                  <div className="grid gap-3">
                    {selectedCluster.topEvidence.map((evidence, index) => (
                      <div key={`${evidence.label}-${index}`} className="rounded-2xl border border-border/40 bg-muted/20 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <Typography className="text-sm font-medium">{evidence.label}</Typography>
                          <Typography className="text-[11px] text-muted-foreground">
                            {formatOffset(evidence.startOffsetMs)} - {formatOffset(evidence.endOffsetMs)}
                          </Typography>
                        </div>
                        <Typography className="mt-2 text-sm text-muted-foreground">
                          {evidence.reason}
                        </Typography>
                        {evidence.eventType && (
                          <Typography className="mt-2 text-[11px] font-mono text-muted-foreground/80">
                            {evidence.eventType}
                          </Typography>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            ) : (
              <div className="h-full grid place-items-center p-8">
                <div className="text-center space-y-2">
                  <SparkleIcon className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                  <Typography className="text-sm text-muted-foreground">
                    Pick an issue cluster to inspect its evidence.
                  </Typography>
                </div>
              </div>
            )}
          </div>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}

function MetricCard(props: { label: string, value: string, mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-border/40 bg-muted/20 p-4">
      <Typography className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{props.label}</Typography>
      <Typography className={cn("mt-2 text-lg font-semibold text-foreground", props.mono && "font-mono text-sm break-all")}>
        {props.value}
      </Typography>
    </div>
  );
}

function formatOffset(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
