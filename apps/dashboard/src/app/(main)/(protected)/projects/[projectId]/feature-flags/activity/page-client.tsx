"use client";

import {
  DesignBadge,
  DesignCard,
  DesignCategoryTabs,
  DesignEmptyState,
  DesignSelectorDropdown,
  DesignSkeleton,
  type DesignBadgeColor,
} from "@/components/design-components";
import {
  getFeatureFlagActivity,
  type FeatureFlagLifecycleAction,
} from "@/lib/feature-flags/admin-adapter";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import {
  AdapterErrorAlert,
  BackendUnavailableAlert,
  formatRelativeTime,
  useAdapterData,
  useFeatureFlagsSection,
} from "../shared";

const ALL_OPTION = "__all__";
type ActionCategory = "all" | FeatureFlagLifecycleAction;

const KIND_BADGE: ReadonlyMap<"lifecycle", { label: string, color: DesignBadgeColor }> = new Map([
  ["lifecycle", { label: "Lifecycle", color: "purple" }],
]);

export default function PageClient() {
  const adminApp = useAdminApp();
  const section = useFeatureFlagsSection();

  const [action, setAction] = useState<ActionCategory>("all");
  const [experimentId, setExperimentId] = useState("");

  const activityState = useAdapterData(
    async () => await getFeatureFlagActivity(adminApp, {
      ...experimentId.length > 0 ? { experimentId } : {},
      ...action === "all" ? {} : { action },
    }),
    [adminApp, experimentId, action],
  );

  // Radix Select items cannot use an empty-string value, so "all" gets an
  // explicit sentinel that is mapped back to "" in the change handlers.
  const experimentOptions = useMemo(() => [
    { value: ALL_OPTION, label: "All experiments" },
    ...[...section.experiments.entries()].map(([id, experiment]) => ({ value: id, label: experiment.displayName })),
  ], [section]);

  return (
    <PageLayout
      title="Activity"
      description="Experiment run creation, lifecycle transitions, and revisions"
    >
      <div className="flex flex-wrap items-center gap-3">
        <DesignCategoryTabs
          categories={[
            { id: "all", label: "All" },
            { id: "created", label: "Created" },
            { id: "started", label: "Started" },
            { id: "paused", label: "Paused" },
            { id: "resumed", label: "Resumed" },
            { id: "completed", label: "Completed" },
            { id: "revision_created", label: "Revisions" },
          ]}
          selectedCategory={action}
          onSelect={(id) => {
            if (id === "all" || id === "created" || id === "started" || id === "paused" || id === "resumed" || id === "completed" || id === "revision_created") setAction(id);
          }}
          gradient="cyan"
          size="sm"
        />
        <div className="ml-auto flex items-center gap-2">
          <DesignSelectorDropdown
            size="sm"
            className="w-44"
            value={experimentId.length > 0 ? experimentId : ALL_OPTION}
            placeholder="All experiments"
            onValueChange={(value) => setExperimentId(value === ALL_OPTION ? "" : value)}
            options={experimentOptions}
          />
        </div>
      </div>

      <DesignCard title="Recent experiment activity" icon={ClockCounterClockwiseIcon} gradient="cyan">
        {activityState.status === "loading" && (
          <div className="flex flex-col gap-2">
            <DesignSkeleton className="h-8 rounded-lg" />
            <DesignSkeleton className="h-8 rounded-lg" />
            <DesignSkeleton className="h-8 rounded-lg" />
          </div>
        )}
        {activityState.status === "unavailable" && <BackendUnavailableAlert what="Activity data" />}
        {activityState.status === "error" && <AdapterErrorAlert what="activity" message={activityState.message} />}
        {activityState.status === "ok" && (
          activityState.data.length === 0 ? (
            <DesignEmptyState
              icon={ClockCounterClockwiseIcon}
              title="No activity for these filters"
              description="Experiment starts, pauses, resumes, completions, and revisions appear here as they happen."
            />
          ) : (
            <ol className="flex flex-col">
              {activityState.data.map((entry) => {
                const badge = KIND_BADGE.get(entry.kind);
                return (
                  <li
                    key={entry.id}
                    className="flex items-start gap-3 py-2.5 border-b border-black/[0.04] dark:border-white/[0.04] last:border-b-0 text-sm"
                  >
                    <span className="text-xs text-muted-foreground w-20 shrink-0 pt-0.5 tabular-nums" title={entry.timestampIso}>
                      {formatRelativeTime(entry.timestampIso)}
                    </span>
                    {badge != null && (
                      <span className="shrink-0">
                        <DesignBadge label={badge.label} color={badge.color} size="sm" />
                      </span>
                    )}
                    <span className="min-w-0">
                      {entry.message}
                      <span className="text-xs text-muted-foreground">
                        {' '}· run <span className="font-mono">{entry.resourceId.slice(0, 8)}</span>
                        {' '}· {entry.source === "schedule_processor" ? "Scheduled automation" : entry.source === "admin_api" ? "Admin API" : entry.source.replaceAll("_", " ")}
                        {entry.actor != null && <> · {entry.actor}</>}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )
        )}
      </DesignCard>
    </PageLayout>
  );
}
