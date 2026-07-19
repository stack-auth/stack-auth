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
  type FeatureFlagActivityKind,
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

type KindCategory = "all" | FeatureFlagActivityKind;

const ALL_OPTION = "__all__";

const KIND_BADGE: ReadonlyMap<FeatureFlagActivityKind, { label: string, color: DesignBadgeColor }> = new Map([
  ["audit", { label: "Audit", color: "blue" }],
  ["lifecycle", { label: "Lifecycle", color: "purple" }],
  ["exposure_summary", { label: "Exposures", color: "cyan" }],
]);

export default function PageClient() {
  const adminApp = useAdminApp();
  const section = useFeatureFlagsSection();

  const [kind, setKind] = useState<KindCategory>("all");
  const [flagKey, setFlagKey] = useState("");
  const [experimentId, setExperimentId] = useState("");

  const activityState = useAdapterData(
    async () => await getFeatureFlagActivity(adminApp, {
      ...kind !== "all" ? { kind } : {},
      ...flagKey.length > 0 ? { flagKey } : {},
      ...experimentId.length > 0 ? { experimentId } : {},
    }),
    [adminApp, kind, flagKey, experimentId],
  );

  // Radix Select items cannot use an empty-string value, so "all" gets an
  // explicit sentinel that is mapped back to "" in the change handlers.
  const flagOptions = useMemo(() => [
    { value: ALL_OPTION, label: "All flags" },
    ...[...section.flags.entries()].map(([key, flag]) => ({ value: key, label: flag.displayName })),
  ], [section]);

  const experimentOptions = useMemo(() => [
    { value: ALL_OPTION, label: "All experiments" },
    ...[...section.experiments.entries()].map(([id, experiment]) => ({ value: id, label: experiment.displayName })),
  ], [section]);

  return (
    <PageLayout
      title="Activity"
      description="Configuration changes, lifecycle events, and exposure summaries for flags and experiments"
    >
      <div className="flex flex-wrap items-center gap-3">
        <DesignCategoryTabs
          categories={[
            { id: "all", label: "All" },
            { id: "audit", label: "Audit" },
            { id: "lifecycle", label: "Lifecycle" },
            { id: "exposure_summary", label: "Exposures" },
          ]}
          selectedCategory={kind}
          onSelect={(id) => {
            if (id === "all" || id === "audit" || id === "lifecycle" || id === "exposure_summary") setKind(id);
          }}
          gradient="cyan"
          size="sm"
        />
        <div className="ml-auto flex items-center gap-2">
          <DesignSelectorDropdown
            size="sm"
            className="w-44"
            value={flagKey.length > 0 ? flagKey : ALL_OPTION}
            placeholder="All flags"
            onValueChange={(value) => setFlagKey(value === ALL_OPTION ? "" : value)}
            options={flagOptions}
          />
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

      <DesignCard title="Recent activity" icon={ClockCounterClockwiseIcon} gradient="cyan">
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
              description="Flag edits, experiment lifecycle changes, and exposure summaries appear here as they happen."
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
                      {(entry.flagKey != null || entry.actor != null) && (
                        <span className="text-xs text-muted-foreground">
                          {entry.flagKey != null && <> · <span className="font-mono">{entry.flagKey}</span></>}
                          {entry.actor != null && <> · {entry.actor}</>}
                        </span>
                      )}
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
