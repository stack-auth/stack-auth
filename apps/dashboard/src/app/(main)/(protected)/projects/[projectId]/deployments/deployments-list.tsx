"use client";

// The Deployments app's top level: a list of deployments (one per `hexclave
// deploy`), each expandable into the services it deployed.
//
// This inverts the previous hierarchy, where the page was a board of SERVICES
// and each service had a "Deployments" tab listing its runs. A deploy ships
// several services together, so "what shipped, and did all of it land?" is the
// question the list answers first; a single service's history is now reached
// through the deploy it was part of.

import { DesignBadge, DesignButton } from "@/components/design-components";
import { Skeleton, Typography, cn } from "@/components/ui";
import type { AdminDeploymentJson, AdminDeploymentRunJson, AdminProject } from "@hexclave/next";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { ArrowClockwiseIcon, CaretRightIcon, CheckCircleIcon, CircleNotchIcon, ClockIcon, CubeIcon, ProhibitIcon, RocketLaunchIcon, XCircleIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { runStatusMeta } from "./panel-content";

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
 * One service inside a deployment. A null run means the deploy never started
 * one for it — it was planned but skipped, almost always because a service it
 * depends on failed first. Showing it as "Skipped" rather than omitting it is
 * what makes a partial deploy legible.
 */
function ServiceRow({ service, onOpenRun }: {
  service: AdminDeploymentJson["services"][number],
  onOpenRun: (run: AdminDeploymentRunJson) => void,
}) {
  const meta: StatusMeta = service.run === null
    ? { label: "Skipped", color: "orange", icon: ProhibitIcon, spin: false }
    : runStatusMeta(service.run.status);
  const Icon = meta.icon;
  const run = service.run;
  return (
    <button
      type="button"
      disabled={run === null}
      onClick={() => run !== null && onOpenRun(run)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border border-border/60 px-3 py-2 text-left transition-colors duration-150",
        run === null ? "cursor-default opacity-70" : "hover:bg-muted/50",
      )}
    >
      <CubeIcon className="h-4 w-4 shrink-0 text-muted-foreground" weight="fill" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{service.service_id}</span>
      {run?.url != null && (
        <span className="hidden truncate text-xs text-muted-foreground sm:block">{run.url.replace(/^https?:\/\//, "")}</span>
      )}
      <span className="flex shrink-0 items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5", meta.spin && "animate-spin")} />
        <DesignBadge label={meta.label} color={meta.color} size="sm" />
      </span>
      {run !== null && <CaretRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );
}

function DeploymentCard({ deployment, expanded, onToggle, onOpenRun }: {
  deployment: AdminDeploymentJson,
  expanded: boolean,
  onToggle: () => void,
  onOpenRun: (run: AdminDeploymentRunJson) => void,
}) {
  const meta = deploymentStatusMeta(deployment.status);
  const Icon = meta.icon;
  const duration = formatDuration(deployment);
  const serviceCount = deployment.services.length;
  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/40"
      >
        <CaretRightIcon className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150", expanded && "rotate-90")} />
        <span className="shrink-0 font-mono text-sm font-semibold">#{deployment.number}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Icon className={cn("h-4 w-4", meta.spin && "animate-spin")} />
          <DesignBadge label={meta.label} color={meta.color} size="sm" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {serviceCount} service{serviceCount === 1 ? "" : "s"}
          {duration != null && ` · ${duration}`}
          {` · ${deployment.triggered_by}`}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{formatTime(deployment.created_at_millis)}</span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-1.5 border-t border-border/60 bg-muted/20 p-3">
          {deployment.services.map((service) => (
            <ServiceRow key={service.service_id} service={service} onOpenRun={onOpenRun} />
          ))}
        </div>
      )}
    </div>
  );
}

export function DeploymentsList({ project, onOpenRun }: {
  project: AdminProject,
  onOpenRun: (run: AdminDeploymentRunJson) => void,
}) {
  const [deployments, setDeployments] = useState<AdminDeploymentJson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // `expandedId` alone cannot distinguish "not loaded yet" from "the user
  // collapsed everything" — both are null. Without this flag every poll would
  // re-expand the card the user just closed.
  const hasAutoExpanded = useRef(false);

  const load = useCallback(async () => {
    try {
      const items = await project.listDeployments({ limit: 20 });
      setDeployments(items);
      setError(null);
      // Expand the newest deployment on FIRST load only: it is what the reader
      // came for after running `hexclave deploy`. Indexing is guarded explicitly
      // — TS types `items[0]` as present, so `?.` would not narrow an empty list.
      if (!hasAutoExpanded.current && items.length > 0) {
        hasAutoExpanded.current = true;
        setExpandedId(items[0].id);
      }
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
          expanded={expandedId === deployment.id}
          onToggle={() => setExpandedId((current) => current === deployment.id ? null : deployment.id)}
          onOpenRun={onOpenRun}
        />
      ))}
    </div>
  );
}
