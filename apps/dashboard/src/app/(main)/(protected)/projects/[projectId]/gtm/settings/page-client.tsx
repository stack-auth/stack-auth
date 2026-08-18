"use client";

import { DesignAlert, DesignBadge, DesignButton, DesignCard, DesignInput, DesignSelectorDropdown } from "@/components/design-components";
import { ActionDialog } from "@/components/ui/action-dialog";
import { createGrowthMilestone, deleteGrowthMilestone, updateGrowthMilestone } from "@/lib/growth/growth-api";
import { listGrowthMilestones } from "@/lib/growth/growth-api";
import { useGrowthStatus } from "@/lib/growth/growth-data";
import { buildGrowthDemoMilestones, GROWTH_DEMO_NOW_MILLIS } from "@/lib/growth/growth-demo-data";
import { formatGrowthThreshold, getGrowthMetricLabel } from "@/lib/growth/growth-format";
import { GROWTH_METRIC_IDS, type GrowthMetricId, type GrowthMilestone, type GrowthStatus } from "@/lib/growth/growth-types";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { FlagIcon, GlobeIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { useAdminApp } from "../../use-admin-app";
import { PageLayout } from "../../page-layout";
import { GrowthAppFrame, GrowthStatusGate } from "../components/frame";
import { GrowthLifecycleTimeline } from "../components/lifecycle-panels";

// ------------------------------------------------------------------ onboarding details ------------------------------------------------------------------

function OnboardingDetailsCard(props: { status: GrowthStatus }) {
  const { onboarding } = props.status;
  // The status payload deliberately exposes only the website URL from onboarding (the company summary
  // feeds the agent's context bundle and is not echoed back over the wire), so this card renders what
  // the frozen API provides rather than pretending to a fuller settings surface.
  return (
    <DesignCard title="Onboarding details" subtitle="What you told us when setting up Growth" icon={GlobeIcon} gradient="blue">
      {onboarding.completed ? (
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-muted-foreground">Website</span>
            {onboarding.websiteUrl != null ? (
              <a href={onboarding.websiteUrl} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">{onboarding.websiteUrl}</a>
            ) : (
              <span className="text-muted-foreground/70">not set</span>
            )}
          </div>
          {onboarding.completedAtMillis != null && (
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-muted-foreground">Completed</span>
              <span className="font-medium tabular-nums">{new Date(onboarding.completedAtMillis).toLocaleDateString()}</span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">You have not completed onboarding yet — head to the Growth overview to get started.</p>
      )}
    </DesignCard>
  );
}

// ------------------------------------------------------------------ milestones ------------------------------------------------------------------

type MilestonesState =
  | { status: "loading" }
  | { status: "error", message: string }
  | { status: "loaded", items: GrowthMilestone[] };

function milestoneStatusBadge(status: GrowthMilestone["status"]): React.ReactNode {
  switch (status) {
    case "armed": { return <DesignBadge label="Armed" color="blue" size="sm" />; }
    case "reached": { return <DesignBadge label="Reached" color="green" size="sm" />; }
    case "disabled": { return <DesignBadge label="Disabled" color="orange" size="sm" />; }
  }
}

function milestoneSourceBadge(source: GrowthMilestone["source"]): React.ReactNode {
  switch (source) {
    case "default": { return <DesignBadge label="Default" color="cyan" size="sm" />; }
    case "user": { return <DesignBadge label="Added by you" color="blue" size="sm" />; }
    case "agent": { return <DesignBadge label="Added by the agent" color="purple" size="sm" />; }
  }
}

function MilestoneRow(props: {
  milestone: GrowthMilestone,
  demo: boolean,
  onUpdated: (milestone: GrowthMilestone) => void,
  onDeleted: (milestoneId: string) => void,
}) {
  const { milestone, demo, onUpdated, onDeleted } = props;
  const app = useAdminApp();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2 border-b border-foreground/[0.06] py-3 last:border-b-0 last:pb-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {getGrowthMetricLabel(milestone.metricId)} reaches {formatGrowthThreshold(milestone.threshold)}
          </span>
          {milestoneStatusBadge(milestone.status)}
          {milestoneSourceBadge(milestone.source)}
        </div>
        {!demo && (
          <div className="flex items-center gap-1">
            {/* A reached milestone already fired its report run; re-arming it would be a lie, so only the armed↔disabled pair is toggleable. */}
            {milestone.status !== "reached" && (
              <DesignButton
                variant="ghost"
                size="sm"
                onClick={async () => {
                  setActionError(null);
                  try {
                    onUpdated(await updateGrowthMilestone(app, milestone.id, { status: milestone.status === "armed" ? "disabled" : "armed" }));
                  } catch (error) {
                    captureError("growth-milestone-update", error);
                    setActionError(error instanceof Error ? error.message : String(error));
                  }
                }}
              >
                {milestone.status === "armed" ? "Disable" : "Enable"}
              </DesignButton>
            )}
            <DesignButton variant="ghost" size="icon" aria-label="Delete milestone" className="text-destructive" onClick={() => setDeleteOpen(true)}>
              <TrashIcon className="size-4" />
            </DesignButton>
          </div>
        )}
      </div>
      {actionError != null && <DesignAlert variant="error">Could not update this milestone: {actionError}</DesignAlert>}
      <ActionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this milestone?"
        description={`The milestone "${getGrowthMetricLabel(milestone.metricId)} reaches ${formatGrowthThreshold(milestone.threshold)}" will be deleted and will no longer trigger reports.`}
        danger
        okButton={{
          label: "Delete",
          onClick: async () => {
            setActionError(null);
            try {
              await deleteGrowthMilestone(app, milestone.id);
              onDeleted(milestone.id);
            } catch (error) {
              captureError("growth-milestone-delete", error);
              setActionError(error instanceof Error ? error.message : String(error));
            }
          },
        }}
        cancelButton
      />
    </div>
  );
}

export function MilestonesCard() {
  const app = useAdminApp();
  const { demo } = useGrowthStatus();
  const [state, setState] = useState<MilestonesState>({ status: "loading" });
  const [newMetricId, setNewMetricId] = useState<GrowthMetricId>("total_users");
  const [newThreshold, setNewThreshold] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (demo) {
      setState({ status: "loaded", items: buildGrowthDemoMilestones(GROWTH_DEMO_NOW_MILLIS) });
      return;
    }
    try {
      setState({ status: "loaded", items: await listGrowthMilestones(app) });
    } catch (error) {
      captureError("growth-milestones-load", error);
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [app, demo]);

  useEffect(() => {
    setState({ status: "loading" });
    runAsynchronously(load());
  }, [load]);

  return (
    <DesignCard title="Milestones" subtitle="When a metric crosses one of these thresholds, we run a fresh analysis and report" icon={FlagIcon} gradient="purple">
      <div className="flex flex-col gap-4">
        {state.status === "loading" && (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading milestones">
            {[0, 1, 2].map((index) => <div key={index} className="h-10 animate-pulse rounded-xl bg-foreground/[0.03]" />)}
          </div>
        )}
        {state.status === "error" && (
          <DesignAlert variant="error">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>Could not load milestones: {state.message}</span>
              <DesignButton variant="outline" size="sm" onClick={async () => await load()}>Retry</DesignButton>
            </div>
          </DesignAlert>
        )}
        {state.status === "loaded" && (
          state.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No milestones yet — add one below.</p>
          ) : (
            <div className="flex flex-col">
              {state.items.map((milestone) => (
                <MilestoneRow
                  key={milestone.id}
                  milestone={milestone}
                  demo={demo}
                  onUpdated={(updated) => setState((previous) => previous.status === "loaded"
                    ? { status: "loaded", items: previous.items.map((item) => item.id === updated.id ? updated : item) }
                    : previous)}
                  onDeleted={(milestoneId) => setState((previous) => previous.status === "loaded"
                    ? { status: "loaded", items: previous.items.filter((item) => item.id !== milestoneId) }
                    : previous)}
                />
              ))}
            </div>
          )
        )}
        {demo ? (
          <p className="text-xs text-muted-foreground">Demo mode — adding or changing milestones is disabled.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2 border-t border-foreground/[0.06] pt-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="growth-milestone-metric">Metric</label>
              <DesignSelectorDropdown
                triggerId="growth-milestone-metric"
                size="md"
                value={newMetricId}
                onValueChange={(value) => {
                  const match = GROWTH_METRIC_IDS.find((metricId) => metricId === value);
                  if (match != null) setNewMetricId(match);
                }}
                options={GROWTH_METRIC_IDS.map((metricId) => ({ value: metricId, label: getGrowthMetricLabel(metricId) }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="growth-milestone-threshold">Reaches at least</label>
              <DesignInput id="growth-milestone-threshold" type="number" min={1} step={1} placeholder="5000" className="w-36" value={newThreshold} onChange={(event) => setNewThreshold(event.target.value)} />
            </div>
            <DesignButton
              size="sm"
              onClick={async () => {
                setCreateError(null);
                const threshold = Number(newThreshold);
                if (!Number.isFinite(threshold) || threshold <= 0) {
                  setCreateError("Enter a positive threshold.");
                  return;
                }
                try {
                  const created = await createGrowthMilestone(app, { metricId: newMetricId, threshold });
                  setState((previous) => previous.status === "loaded" ? { status: "loaded", items: [...previous.items, created] } : previous);
                  setNewThreshold("");
                } catch (error) {
                  captureError("growth-milestone-create", error);
                  setCreateError(error instanceof Error ? error.message : String(error));
                }
              }}
            >
              <span className="flex items-center gap-1.5"><PlusIcon className="size-4" />Add</span>
            </DesignButton>
            {createError != null && <p className="w-full text-sm text-destructive">{createError}</p>}
          </div>
        )}
      </div>
    </DesignCard>
  );
}

function SettingsBody(props: { status: GrowthStatus }) {
  return (
    <div className="flex flex-col gap-4">
      <OnboardingDetailsCard status={props.status} />
      {/* <MilestonesCard /> */}
      <section className="mt-4 rounded-2xl border border-foreground/[0.08] bg-background p-5 sm:p-7">
        <div className="mb-6">
          <h2 className="text-lg font-semibold">Growth lifecycle</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your complete setup, analysis, interview, report, and ongoing brief history.</p>
        </div>
        <GrowthLifecycleTimeline status={props.status} />
      </section>
    </div>
  );
}

export default function PageClient() {
  return (
    <GrowthAppFrame>
      <PageLayout title="Growth Settings" description="Onboarding details and lifecycle history">
        <GrowthStatusGate>
          {(status) => <SettingsBody status={status} />}
        </GrowthStatusGate>
      </PageLayout>
    </GrowthAppFrame>
  );
}
