"use client";

import { DesignAlert, DesignBadge, DesignButton, DesignSelectorDropdown } from "@/components/design-components";
import { useRouter } from "@/components/router";
import { Switch } from "@/components/ui/switch";
import { GrowthStatusProvider, useGrowthStatus } from "@/lib/growth/growth-data";
import { getGrowthDemoPhase, isGrowthDemoMode, isGrowthDemoModeAvailable } from "@/lib/growth/growth-mode";
import { GROWTH_PHASES } from "@/lib/growth/growth-status";
import type { GrowthStatus } from "@/lib/growth/growth-types";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { useAdminApp, useProjectId } from "../../use-admin-app";

/**
 * The one wrapper every growth page renders inside: app-enabled gating, demo-mode resolution from the
 * query string, and the shared status provider. Keeping this in one place means the demo/authorization
 * wiring can never drift between pages.
 */
export function GrowthAppFrame(props: { children: ReactNode }) {
  const projectId = useProjectId();
  // A project's growth workspace has to be read through that project's own admin app. `useStackApp()` here
  // would return the dashboard's app, which is authenticated against the `internal` project, so every read
  // would come back with the internal project's records instead of this project's.
  const app = useAdminApp();
  const searchParams = useSearchParams();
  const demo = isGrowthDemoMode(projectId, searchParams.get("demo"));
  const demoPhase = getGrowthDemoPhase(projectId, searchParams.get("demoPhase"));
  return (
    <AppEnabledGuard appId="gtm">
      <GrowthStatusProvider demo={demo} demoPhase={demoPhase} app={app}>
        {props.children}
      </GrowthStatusProvider>
    </AppEnabledGuard>
  );
}

const DEMO_PHASE_LABELS = new Map(GROWTH_PHASES.map((phase) => [phase, phase.replace(/-/g, " ")]));

/**
 * Internal-only demo controls: toggle demo mode and jump between lifecycle-phase fixtures. Rendered on the
 * overview only — deeper pages inherit whatever the query string says.
 */
export function GrowthDemoToolbar() {
  const projectId = useProjectId();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { demo } = useGrowthStatus();
  if (!isGrowthDemoModeAvailable(projectId)) return null;

  const setParams = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    const query = next.toString();
    router.push(query.length === 0 ? pathname : `${pathname}?${query}`);
  };

  const demoPhase = getGrowthDemoPhase(projectId, searchParams.get("demoPhase"));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] px-4 py-3">
      <div className="flex items-center gap-2">
        {demo && <DesignBadge label="Demo mode" color="orange" size="sm" />}
        <span className="text-sm text-muted-foreground">
          {demo ? "You are looking at fixture data." : "You are looking at your live growth workspace."}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-3">
        {demo && (
          <DesignSelectorDropdown
            value={demoPhase}
            onValueChange={(value) => setParams((next) => next.set("demoPhase", value))}
            options={GROWTH_PHASES.map((phase) => ({ value: phase, label: DEMO_PHASE_LABELS.get(phase) ?? phase }))}
            size="sm"
          />
        )}
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch checked={demo} onCheckedChange={(value) => setParams((next) => next.set("demo", value ? "true" : "false"))} aria-label="Use demo mode" />
          Demo mode
        </label>
      </div>
    </div>
  );
}

/**
 * Renders the shared loading/error states around anything that needs the status snapshot. The loading
 * skeleton is layout-shaped (stacked card-sized blocks) rather than a spinner so phase panels don't jump
 * when the data arrives.
 */
export function GrowthStatusGate(props: { children: (status: GrowthStatus) => ReactNode }) {
  const { data, refresh } = useGrowthStatus();
  if (data.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading growth status">
        <div className="h-40 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="h-24 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
          <div className="h-24 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
          <div className="h-24 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
        </div>
      </div>
    );
  }
  if (data.status === "error") {
    return (
      <DesignAlert variant="error" className="items-center">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>Could not load your growth workspace: {data.message}</span>
          <DesignButton variant="outline" size="sm" onClick={async () => await refresh()}>Retry</DesignButton>
        </div>
      </DesignAlert>
    );
  }
  return <>{props.children(data.value)}</>;
}
