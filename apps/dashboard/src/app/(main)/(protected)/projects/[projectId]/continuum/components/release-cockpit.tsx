"use client";

import { DesignButton } from "@/components/design-components";
import { useSyncExternalStore } from "react";
import {
  getContinuumState,
  patchContinuumState,
  subscribeContinuum,
} from "../continuum-store";
import { MIGRATIONS } from "../fixtures/databases";
import type { Release } from "../fixtures/types";
import { BuildLogViewer } from "./build-log-viewer";
import { CompatMatrix } from "./compat-matrix";
import { RolloutStages } from "./rollout-stages";
import { CxChip, CxPanel, StatusDot, cx } from "./ui-kit";

const affectedTenants = [
  { id: "tenant-atlas", name: "Atlas Health" },
  { id: "tenant-northstar", name: "Northstar Legal" },
  { id: "tenant-lumen", name: "Lumen Finance" },
] as const;

export type ReleaseCockpitProps = {
  release: Release,
  paused: boolean,
};

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value}`;
}

function stepKindLabel(kind: "expand" | "contract"): string {
  return kind === "expand" ? "safe now" : "cleanup later";
}

export function ReleaseCockpit({ release, paused }: ReleaseCockpitProps) {
  const continuumState = useSyncExternalStore(
    subscribeContinuum,
    getContinuumState,
    getContinuumState,
  );
  const migration = MIGRATIONS.find((candidate) => candidate.releaseVersion === release.version);

  const startRollout = () => {
    patchContinuumState((previous) => {
      const stageStatuses = new Map(previous.stageStatuses);
      stageStatuses.set("stage-1", "complete");
      stageStatuses.set("stage-2", "healthy");
      return {
        ...previous,
        releaseStatus: "rolling_out",
        stageStatuses,
      };
    });
  };

  const resumeRollout = () => {
    patchContinuumState({ releaseStatus: "rolling_out" });
  };

  const pinTenant = (tenantId: string) => {
    patchContinuumState((previous) => {
      const pinnedVersions = new Map(previous.pinnedVersions);
      pinnedVersions.set(tenantId, release.versionWindow.from);
      return { ...previous, pinnedVersions };
    });
  };

  const protectAffectedTenants = () => {
    patchContinuumState((previous) => {
      const pinnedVersions = new Map(previous.pinnedVersions);
      for (const tenant of affectedTenants) {
        pinnedVersions.set(tenant.id, release.versionWindow.from);
      }
      return { ...previous, pinnedVersions };
    });
  };

  return (
    <div className="min-w-0 space-y-3">
      <CxPanel
        title={release.title}
        meta={<span className={cx.mono}>{release.version}</span>}
        bodyClassName="space-y-4 p-4"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CxChip tone="accent">{release.status.replace("_", " ")}</CxChip>
              <CxChip>{release.framework}</CxChip>
              <span className={cx.mono}>{release.connectedRepo}</span>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              Move customers forward in stages. Undo one tenant without changing everyone else.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {paused ? (
              <>
                <DesignButton variant="outline" size="sm" onClick={protectAffectedTenants}>
                  Protect affected
                </DesignButton>
                <DesignButton size="sm" onClick={resumeRollout}>
                  Resume
                </DesignButton>
              </>
            ) : release.status === "draft" ? (
              <DesignButton size="sm" onClick={startRollout}>
                Start rollout
              </DesignButton>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            { label: "Commits", value: String(release.commits.length) },
            { label: "Migrations", value: String(release.migrationCount) },
            { label: "Flags", value: String(release.featureFlags.length) },
            { label: "Users", value: release.blastRadiusUsers.toLocaleString() },
            { label: "ARR", value: formatUsd(release.blastRadiusArrUsd) },
          ].map((stat) => (
            <div key={stat.label} className="rounded-md border border-black/[0.06] px-3 py-2.5 dark:border-white/[0.06]">
              <p className={cx.label}>{stat.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight">{stat.value}</p>
            </div>
          ))}
        </div>
      </CxPanel>

      {migration != null && (
        <CxPanel title="Migration" meta={<span className="text-[11px] text-muted-foreground">{migration.orm}</span>} bodyClassName="space-y-2 p-4">
          <p className="text-sm text-muted-foreground">{migration.title}</p>
          {migration.steps.map((step) => (
            <div key={step.id} className="rounded-md border border-black/[0.06] px-3 py-2.5 dark:border-white/[0.06]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StatusDot status={step.kind === "expand" ? "ok" : "warn"} />
                  <span className="text-[13px] font-medium">{step.plainLabel}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CxChip tone={step.kind === "expand" ? "ok" : "warn"}>{stepKindLabel(step.kind)}</CxChip>
                  <CxChip>{step.status}</CxChip>
                </div>
              </div>
              <pre className="mt-2 overflow-x-auto font-mono text-[10px] text-muted-foreground">{step.sql}</pre>
              {step.heldBy != null && (
                <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-200">{step.heldBy}</p>
              )}
            </div>
          ))}
        </CxPanel>
      )}

      <CompatMatrix />
      <RolloutStages stages={release.stages} stageStatuses={continuumState.stageStatuses} />
      <BuildLogViewer
        buildLog={release.buildLog}
        running={release.status === "rolling_out"}
      />

      <CxPanel
        title="Pin a customer back"
        meta={<span className="text-[11px] text-muted-foreground">Everyone else stays</span>}
        bodyClassName="divide-y divide-black/[0.06] dark:divide-white/[0.06]"
      >
        {affectedTenants.map((tenant) => {
          const pinnedVersion = continuumState.pinnedVersions.get(tenant.id);
          return (
            <div key={tenant.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-[13px] font-medium">{tenant.name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {pinnedVersion == null ? `On ${release.version}` : `Pinned to ${pinnedVersion}`}
                </p>
              </div>
              <DesignButton
                variant="outline"
                size="sm"
                disabled={pinnedVersion != null}
                onClick={() => pinTenant(tenant.id)}
              >
                {pinnedVersion == null ? `Pin to ${release.versionWindow.from}` : "Pinned"}
              </DesignButton>
            </div>
          );
        })}
      </CxPanel>
    </div>
  );
}
