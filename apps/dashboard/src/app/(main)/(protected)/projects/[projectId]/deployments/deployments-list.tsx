"use client";

// The Deployments app's top level: a list of deployments, one per `hexclave
// deploy`. Opening one shows that deploy's service map.
//
// This inverts the previous hierarchy, where the page was a board of SERVICES
// and each service had a "Deployments" tab listing its runs. A deploy ships
// several services together, so "what shipped, and did all of it land?" is the
// question the list answers first; the map is one level down.

import { DesignBadge, DesignButton } from "@/components/design-components";
import { Skeleton, Typography, cn } from "@/components/ui";
import type { AdminDeploymentJson, AdminDeploymentRunJson, AdminProject } from "@hexclave/next";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { ArrowClockwiseIcon, CaretRightIcon, CheckCircleIcon, CircleNotchIcon, ClockIcon, ProhibitIcon, RocketLaunchIcon, XCircleIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

type DesignBadgeColor = "blue" | "cyan" | "purple" | "green" | "orange" | "red";

type StatusMeta = { label: string, color: DesignBadgeColor, icon: React.ElementType, spin: boolean };

function deploymentStatusMeta(status: AdminDeploymentJson["status"]): StatusMeta {
  switch (status) {
    case "queued": { return { label: "Queued", color: "blue", icon: ClockIcon, spin: false }; }
    case "building": { return { label: "Building", color: "cyan", icon: CircleNotchIcon, spin: true }; }
    case "deployed": { return { label: "Deployed", color: "green", icon: CheckCircleIcon, spin: false }; }
    case "failed": { return { label: "Failed", color: "red", icon: XCircleIcon, spin: false }; }
    case "canceled": { return { label: "Cancelled", color: "orange", icon: ProhibitIcon, spin: false }; }
    // A status the server added and this build doesn't know: render it rather
    // than crashing the whole list on one unexpected row.
    default: { return { label: status, color: "blue", icon: ClockIcon, spin: false }; }
  }
}

function isTerminalDeployment(deployment: AdminDeploymentJson): boolean {
  return deployment.status !== "queued" && deployment.status !== "building";
}

function formatTime(millis: number): string {
  return new Date(millis).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDuration(deployment: AdminDeploymentJson): string | null {
  if (deployment.finished_at_millis == null) return null;
  const seconds = Math.max(0, Math.round((deployment.finished_at_millis - deployment.created_at_millis) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * One deployment. The whole row is the affordance for opening that deploy's
 * service map — there is no expansion, so the row summarises the outcome
 * (status, how many services, how long) and the map shows the detail.
 */
function DeploymentCard({ deployment, onOpen }: {
  deployment: AdminDeploymentJson,
  onOpen: () => void,
}) {
  const meta = deploymentStatusMeta(deployment.status);
  const Icon = meta.icon;
  const duration = formatDuration(deployment);
  const serviceCount = deployment.services.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl border border-border/60 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/40"
    >
      <span className="flex shrink-0 items-center gap-1.5">
        <Icon className={cn("h-4 w-4", meta.spin && "animate-spin")} />
        <DesignBadge label={meta.label} color={meta.color} size="sm" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {serviceCount} service{serviceCount === 1 ? "" : "s"}
        {duration != null && ` · ${duration}`}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatTime(deployment.created_at_millis)}</span>
      <CaretRightIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function DeploymentsList({ project, onOpenDeployment }: {
  project: AdminProject,
  onOpenDeployment: (deployment: AdminDeploymentJson) => void,
}) {
  const [deployments, setDeployments] = useState<AdminDeploymentJson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setDeployments(await project.listDeployments({ limit: 20 }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [project]);

  useEffect(() => {
    runAsynchronously(load());
  }, [load]);

  // Always poll while the tab is open — a deploy can start from a terminal at
  // any time, and a deployment whose services all failed before starting a run
  // stays non-terminal forever, so gating on "something is in flight" would both
  // miss new deploys and poll one of those at full speed indefinitely. In-flight
  // work just gets a tighter interval.
  const hasInFlight = deployments?.some((deployment) => !isTerminalDeployment(deployment)) ?? false;
  useEffect(() => {
    const interval = setInterval(() => runAsynchronously(load()), hasInFlight ? 5000 : 20000);
    return () => clearInterval(interval);
  }, [hasInFlight, load]);

  // A failed refresh shows as a banner ABOVE whatever is already loaded, rather
  // than replacing it: returning early here would take the list and the Refresh
  // button away together, leaving no way to retry in-page.
  const errorBanner = error === null ? null : (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3">
      <Typography type="p" className="text-sm">Could not load deployments: {error}</Typography>
    </div>
  );

  if (deployments === null) {
    return (
      <div className="flex flex-col gap-2">
        {errorBanner}
        {error === null && [0, 1, 2].map((index) => <Skeleton key={index} className="h-14 w-full rounded-xl" />)}
      </div>
    );
  }

  if (deployments.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {errorBanner}
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-6 py-12 text-center">
          <RocketLaunchIcon className="h-8 w-8 text-muted-foreground" />
          <Typography type="h3" className="text-base font-semibold">No deployments yet</Typography>
          <Typography type="p" className="max-w-md text-sm text-muted-foreground">
            Define your services in the <code className="font-mono">deployment</code> export of{" "}
            <code className="font-mono">hexclave.config.ts</code>, then run{" "}
            <code className="font-mono">hexclave deploy</code>. Each deploy shows up here with the services it shipped.
          </Typography>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {errorBanner}
      <div className="flex items-center justify-end">
        <DesignButton
          variant="ghost"
          size="sm"
          onClick={() => {
            setRefreshing(true);
            runAsynchronously(load().finally(() => setRefreshing(false)));
          }}
        >
          <ArrowClockwiseIcon className={cn("mr-1.5 h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh
        </DesignButton>
      </div>
      {deployments.map((deployment) => (
        <DeploymentCard
          key={deployment.id}
          deployment={deployment}
          onOpen={() => onOpenDeployment(deployment)}
        />
      ))}
    </div>
  );
}

function runStatusMeta(status: AdminDeploymentRunJson["status"]): StatusMeta {
  switch (status) {
    case "queued": { return { label: "Queued", color: "blue", icon: ClockIcon, spin: false }; }
    case "building": { return { label: "Building", color: "cyan", icon: CircleNotchIcon, spin: true }; }
    case "ready": { return { label: "Ready", color: "green", icon: CheckCircleIcon, spin: false }; }
    case "error": { return { label: "Failed", color: "red", icon: XCircleIcon, spin: false }; }
    case "canceled": { return { label: "Cancelled", color: "orange", icon: ProhibitIcon, spin: false }; }
    default: { return { label: status, color: "blue", icon: ClockIcon, spin: false }; }
  }
}

/**
 * What ONE deployment shipped: its planned services and the run each got.
 *
 * Reads only the deployment handed to it. The previous view rendered the service
 * BOARD here, which fetches current definitions and latest statuses of its own —
 * so opening a months-old deploy showed today's topology and today's statuses
 * under that deploy's timestamp, with nothing marking the discrepancy. A
 * deployment is a historical record, so it has to be drawn from the record.
 *
 * A service with `run: null` never started one (a dependency failed first, or
 * the CLI failed locally before it could): shown as skipped rather than omitted,
 * so the reader sees everything the deploy intended to ship.
 */
export function DeploymentServices({ deployment }: {
  deployment: AdminDeploymentJson,
}) {
  if (deployment.services.length === 0) {
    return (
      <Typography type="label" variant="secondary">
        This deployment recorded no services.
      </Typography>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {deployment.services.map(({ service_id, run }) => {
        const meta = run === null ? null : runStatusMeta(run.status);
        const Icon = meta?.icon;
        return (
          <div
            key={service_id}
            className="flex items-center gap-3 rounded-xl border border-border/60 px-4 py-3"
          >
            <span className="flex shrink-0 items-center gap-1.5">
              {Icon != null && <Icon className={cn("h-4 w-4", meta?.spin && "animate-spin")} />}
              <DesignBadge
                label={meta?.label ?? "Skipped"}
                color={meta?.color ?? "orange"}
                size="sm"
              />
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-sm">{service_id}</span>
            {run?.url != null && (
              <a
                href={run.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 truncate text-xs text-muted-foreground underline underline-offset-2"
              >
                {run.url.replace(/^https?:\/\//, "")}
              </a>
            )}
            {run?.error != null && (
              <span className="min-w-0 shrink truncate text-xs text-destructive" title={run.error}>
                {run.error}
              </span>
            )}
            {run === null && (
              <span className="shrink-0 text-xs text-muted-foreground">
                Never started — a service it depends on failed
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
