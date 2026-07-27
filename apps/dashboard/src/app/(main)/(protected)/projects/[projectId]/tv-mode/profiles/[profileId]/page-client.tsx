"use client";

import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  BroadcastIcon,
  CheckCircleIcon,
  ClockIcon,
  ConfettiIcon,
  EyeIcon,
  GearSixIcon,
  MonitorPlayIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  DesignAlert,
  DesignButton,
  DesignCard,
  DesignInput,
  DesignSelectorDropdown,
} from "@/components/design-components";
import { Link } from "@/components/link";
import { useRouterConfirm } from "@/components/router";
import { Switch } from "@/components/ui/switch";
import { Typography } from "@/components/ui";
import { TvPresentation } from "@/components/tv-mode/tv-presentation";
import { useTvPresentationLauncher } from "@/components/tv-mode/presentation-window";
import { getTvScreenDefinition } from "@/components/tv-mode/screen-registry";
import { createTvFixtureSnapshot, getTvProfileFixture } from "@/lib/tv-mode/fixtures";
import type { TvProfileFixture, TvScreenId } from "@/lib/tv-mode/types";
import { PageLayout } from "../../../page-layout";
import { useProjectId } from "../../../use-admin-app";

function getProfileIdFromPath(pathname: string): string {
  const segments = pathname.split("/");
  const profilesIndex = segments.indexOf("profiles");
  const profileId = segments.at(profilesIndex + 1);
  if (profileId == null || profileId.length === 0) {
    throw new Error("TV profile ID is missing from the route");
  }
  return decodeURIComponent(profileId);
}

function cloneProfile(profile: TvProfileFixture): TvProfileFixture {
  return structuredClone(profile);
}

function parseDurationOption(value: string): number {
  switch (value) {
    case "15": {
      return 15;
    }
    case "16": {
      return 16;
    }
    case "18": {
      return 18;
    }
    case "20": {
      return 20;
    }
    case "30": {
      return 30;
    }
    default: {
      throw new Error(`Unexpected TV duration option "${value}"`);
    }
  }
}

function updatePlaylistEntry(
  profile: TvProfileFixture,
  screenId: TvScreenId,
  update: (entry: TvProfileFixture["playlist"][number]) => TvProfileFixture["playlist"][number],
): TvProfileFixture {
  return {
    ...profile,
    playlist: profile.playlist.map((entry) => entry.screenId === screenId ? update(entry) : entry),
  };
}

function settingRow({
  title,
  description,
  control,
}: {
  title: string,
  description: string,
  control: React.ReactNode,
}) {
  return (
    <div className="flex items-center justify-between gap-5 border-b border-foreground/[0.06] py-3 last:border-b-0">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export default function PageClient() {
  const projectId = useProjectId();
  const profileId = getProfileIdFromPath(usePathname());
  const fixtureProfile = getTvProfileFixture(profileId);
  const [draft, setDraft] = useState<TvProfileFixture | null>(() => fixtureProfile == null ? null : cloneProfile(fixtureProfile));
  const [saved, setSaved] = useState<TvProfileFixture | null>(() => fixtureProfile == null ? null : cloneProfile(fixtureProfile));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [savedNoticeVisible, setSavedNoticeVisible] = useState(false);
  const { setNeedConfirm } = useRouterConfirm();
  const { launchPresentation, popupBlocked } = useTvPresentationLauncher(projectId);

  const hasChanges = draft != null && saved != null && JSON.stringify(draft) !== JSON.stringify(saved);
  const previewSnapshot = useMemo(
    () => draft == null ? null : createTvFixtureSnapshot(projectId, draft),
    [draft, projectId],
  );

  useEffect(() => {
    setNeedConfirm(hasChanges);
    return () => setNeedConfirm(false);
  }, [hasChanges, setNeedConfirm]);

  if (draft == null || saved == null) {
    return (
      <PageLayout title="TV profile not found" description="The requested fixture profile does not exist.">
        <DesignAlert variant="error" title="Unknown profile" description={`No centralized TV fixture exists for "${profileId}".`} />
        <Link href={`/projects/${projectId}/tv-mode`} className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to TV Mode
        </Link>
      </PageLayout>
    );
  }

  const enabledCount = draft.playlist.filter((entry) => entry.enabled).length;

  return (
    <>
      <PageLayout
        title={draft.displayName}
        description="Configure this named General Mode presentation profile."
        allowContentOverflow
        actions={
          <div className="flex gap-2">
            <DesignButton variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
              <EyeIcon className="h-4 w-4" />
              Preview changes
            </DesignButton>
            <button
              type="button"
              onClick={() => launchPresentation(`/projects/${projectId}/tv-mode/present/${profileId}`)}
              className="inline-flex h-8 items-center gap-2 rounded-lg bg-foreground px-3 text-xs font-medium text-background"
            >
              <BroadcastIcon className="h-4 w-4" weight="fill" />
              Start TV Mode
              <ArrowSquareOutIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        }
      >
        <div className="flex items-center gap-2">
          <Link href={`/projects/${projectId}/tv-mode`} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            All profiles
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <span className="text-xs text-muted-foreground">Fixture profile</span>
        </div>

        <DesignAlert
          variant="info"
          title="Fixture-only configuration"
          description="Save validates the experience locally for this session. Persistence to project configuration is deliberately deferred to the live snapshot slice."
        />
        {popupBlocked ? (
          <DesignAlert
            variant="error"
            title="TV presentation was blocked"
            description="Allow popups for this dashboard, then launch the presentation again. Your profile changes remain on this page."
          />
        ) : null}
        {savedNoticeVisible ? (
          <DesignAlert variant="success" title="Fixture profile saved locally" description="The saved baseline was updated for this page session. Reloading restores the centralized fixture." />
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
          <div className="space-y-4">
            <DesignCard title="Profile" subtitle="Identity and presentation mode" icon={MonitorPlayIcon} gradient="cyan" glassmorphic>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="tv-profile-name" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">TV name</label>
                  <DesignInput
                    id="tv-profile-name"
                    value={draft.displayName}
                    onChange={(event) => {
                      setDraft({ ...draft, displayName: event.target.value });
                      setSavedNoticeVisible(false);
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="tv-profile-mode" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mode</label>
                  <DesignSelectorDropdown
                    triggerId="tv-profile-mode"
                    value="general"
                    onValueChange={() => undefined}
                    disabled
                    size="lg"
                    options={[{ value: "general", label: "General Mode" }]}
                  />
                </div>
                <div className="sm:col-span-2">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Project</p>
                  <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.025] px-4 py-2.5 text-sm text-foreground">Acme Production</div>
                </div>
              </div>
            </DesignCard>

            <DesignCard title="Playlist" subtitle={`${enabledCount} of ${draft.playlist.length} screens enabled`} icon={GearSixIcon} gradient="blue" glassmorphic>
              <div className="space-y-2">
                {draft.playlist.map((entry, index) => {
                  const definition = getTvScreenDefinition(entry.screenId);
                  const Icon = definition.icon;
                  return (
                    <div key={entry.screenId} className="flex items-center gap-3 rounded-xl border border-foreground/[0.07] bg-foreground/[0.02] p-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05] text-xs font-semibold text-muted-foreground">{index + 1}</span>
                      <Icon className={`h-5 w-5 shrink-0 ${definition.accentClassName}`} weight="fill" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{definition.displayName}</p>
                        <p className="truncate text-xs text-muted-foreground">{definition.description}</p>
                      </div>
                      <DesignSelectorDropdown
                        value={(entry.durationSecondsOverride ?? draft.defaultDurationSeconds).toString()}
                        onValueChange={(value) => setDraft(updatePlaylistEntry(draft, entry.screenId, (current) => ({
                          ...current,
                          durationSecondsOverride: parseDurationOption(value),
                        })))}
                        disabled={!entry.enabled}
                        options={[
                          { value: "15", label: "15 sec" },
                          { value: "16", label: "16 sec" },
                          { value: "18", label: "18 sec" },
                          { value: "20", label: "20 sec" },
                          { value: "30", label: "30 sec" },
                        ]}
                      />
                      <Switch
                        checked={entry.enabled}
                        disabled={entry.enabled && enabledCount === 1}
                        onCheckedChange={(enabled) => {
                          setDraft(updatePlaylistEntry(draft, entry.screenId, (current) => ({ ...current, enabled })));
                          setSavedNoticeVisible(false);
                        }}
                        aria-label={`${entry.enabled ? "Disable" : "Enable"} ${definition.displayName}`}
                      />
                    </div>
                  );
                })}
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-foreground/[0.1] p-3 opacity-60">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground/[0.04] text-xs text-muted-foreground">—</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-muted-foreground">Deployments</p>
                    <p className="text-xs text-muted-foreground">Unavailable · deployment integration required</p>
                  </div>
                  <Switch checked={false} disabled aria-label="Deployments unavailable" />
                </div>
              </div>
            </DesignCard>

            <DesignCard title="Interruption policy" subtitle="How important events take over this TV" icon={WarningCircleIcon} gradient="orange" glassmorphic>
              <div>
                {settingRow({
                  title: "Critical incidents",
                  description: "Persistent takeover until the incident recovers.",
                  control: <DesignSelectorDropdown value={draft.incidentLevels.critical} onValueChange={(critical) => setDraft({ ...draft, incidentLevels: { ...draft.incidentLevels, critical: critical === "disabled" ? "disabled" : "persistent-takeover" } })} options={[
                    { value: "persistent-takeover", label: "Persistent takeover" },
                    { value: "disabled", label: "Disabled" },
                  ]} />,
                })}
                {settingRow({
                  title: "High priority",
                  description: "A bounded full-screen interruption.",
                  control: <DesignSelectorDropdown value={draft.incidentLevels.high} onValueChange={(high) => setDraft({
                    ...draft,
                    incidentLevels: {
                      ...draft.incidentLevels,
                      high: high === "disabled" ? "disabled" : high === "banner" ? "banner" : "temporary-takeover",
                    },
                  })} options={[
                    { value: "temporary-takeover", label: "Temporary takeover" },
                    { value: "banner", label: "Banner" },
                    { value: "disabled", label: "Disabled" },
                  ]} />,
                })}
                {settingRow({
                  title: "Medium priority",
                  description: "A small notification over the ambient playlist.",
                  control: <DesignSelectorDropdown value={draft.incidentLevels.medium} onValueChange={(medium) => setDraft({
                    ...draft,
                    incidentLevels: { ...draft.incidentLevels, medium: medium === "disabled" ? "disabled" : "banner" },
                  })} options={[
                    { value: "banner", label: "Banner" },
                    { value: "disabled", label: "Disabled" },
                  ]} />,
                })}
                {settingRow({
                  title: "Email delivery degradation",
                  description: "Preview the first planned negative detector.",
                  control: <Switch checked={draft.incidentTypes.emailDeliveryDegradation} onCheckedChange={(emailDeliveryDegradation) => setDraft({
                    ...draft,
                    incidentTypes: { emailDeliveryDegradation },
                  })} />,
                })}
              </div>
            </DesignCard>
          </div>

          <div className="space-y-4">
            <DesignCard title="Timing" subtitle="Default pacing for the room" icon={ClockIcon} gradient="purple" glassmorphic>
              <label htmlFor="tv-default-duration" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rotation speed</label>
              <DesignSelectorDropdown
                triggerId="tv-default-duration"
                value={draft.defaultDurationSeconds.toString()}
                onValueChange={(value) => setDraft({ ...draft, defaultDurationSeconds: parseDurationOption(value) })}
                size="lg"
                options={[
                  { value: "15", label: "15 seconds" },
                  { value: "20", label: "20 seconds" },
                  { value: "30", label: "30 seconds" },
                ]}
              />
              <Typography variant="secondary" className="mt-3 text-xs">Individual playlist screens may override this value.</Typography>
            </DesignCard>

            <DesignCard title="Celebrations" subtitle="Positive moments worth sharing" icon={ConfettiIcon} gradient="purple" glassmorphic>
              <div>
                {settingRow({
                  title: "User milestones",
                  description: "500, 1K, 10K, and future growth moments.",
                  control: <Switch checked={draft.celebrations.userMilestone} onCheckedChange={(userMilestone) => setDraft({
                    ...draft,
                    celebrations: { ...draft.celebrations, userMilestone },
                  })} />,
                })}
                {settingRow({
                  title: "Revenue milestones",
                  description: "Requires exact financial visibility.",
                  control: <Switch checked={draft.celebrations.revenueMilestone} disabled={!draft.showExactFinancialValues} onCheckedChange={(revenueMilestone) => setDraft({
                    ...draft,
                    celebrations: { ...draft.celebrations, revenueMilestone },
                  })} />,
                })}
                {settingRow({
                  title: "Successful launches",
                  description: "Unavailable · deployment integration required.",
                  control: <Switch checked={false} disabled />,
                })}
              </div>
            </DesignCard>

            <DesignCard title="Office-safe privacy" subtitle="Control what a shared room can see" icon={ShieldCheckIcon} gradient="green" glassmorphic>
              {settingRow({
                title: "Show exact financial values",
                description: "Shows exact currency in Revenue & Payments. Operational counts and direction remain visible when off.",
                control: <Switch checked={draft.showExactFinancialValues} onCheckedChange={(showExactFinancialValues) => setDraft({
                  ...draft,
                  showExactFinancialValues,
                  celebrations: showExactFinancialValues
                    ? draft.celebrations
                    : { ...draft.celebrations, revenueMilestone: false },
                })} />,
              })}
              <DesignAlert variant="success" title="Aggregate-only foundation" description="No user identity, email subject, recipient, support message, or session replay content exists in the fixture snapshot." />
            </DesignCard>

            <DesignCard title="Event previews" subtitle="Exercise every interruption treatment" icon={BroadcastIcon} gradient="cyan" glassmorphic>
              <div className="grid gap-2">
                <button type="button" onClick={() => launchPresentation(`/projects/${projectId}/tv-mode/present/${profileId}?fixture=banner`)} className="flex items-center justify-between rounded-xl border border-foreground/[0.08] px-3 py-2.5 text-left text-sm font-medium text-foreground hover:bg-foreground/[0.04]">
                  User milestone banner
                  <ArrowSquareOutIcon className="h-4 w-4 text-muted-foreground" />
                </button>
                <button type="button" onClick={() => launchPresentation(`/projects/${projectId}/tv-mode/present/${profileId}?fixture=temporary-takeover`)} className="flex items-center justify-between rounded-xl border border-foreground/[0.08] px-3 py-2.5 text-left text-sm font-medium text-foreground hover:bg-foreground/[0.04]">
                  User milestone takeover
                  <ArrowSquareOutIcon className="h-4 w-4 text-muted-foreground" />
                </button>
                <button type="button" onClick={() => launchPresentation(`/projects/${projectId}/tv-mode/present/${profileId}?fixture=critical-takeover`)} className="flex items-center justify-between rounded-xl border border-foreground/[0.08] px-3 py-2.5 text-left text-sm font-medium text-foreground hover:bg-foreground/[0.04]">
                  Email degradation · critical
                  <ArrowSquareOutIcon className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            </DesignCard>

            <DesignCard title="State previews" subtitle="Validate honest failure and freshness behavior" icon={WarningCircleIcon} gradient="orange" glassmorphic>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "stale", label: "Stale" },
                  { id: "offline", label: "Offline" },
                  { id: "loading", label: "Loading" },
                  { id: "empty", label: "Empty" },
                  { id: "insufficient-data", label: "Insufficient data" },
                  { id: "unavailable", label: "Unavailable source" },
                  { id: "partial-failure", label: "Partial failure" },
                  { id: "financial-redacted", label: "Financial redaction" },
                  { id: "error", label: "Fatal error" },
                ].map((state) => (
                  <button
                    type="button"
                    key={state.id}
                    onClick={() => launchPresentation(`/projects/${projectId}/tv-mode/present/${profileId}?fixture=${state.id}`)}
                    className="flex items-center justify-between rounded-xl border border-foreground/[0.08] px-3 py-2.5 text-left text-xs font-medium text-foreground hover:bg-foreground/[0.04]"
                  >
                    {state.label}
                    <ArrowSquareOutIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </DesignCard>
          </div>
        </div>

        <div className="sticky bottom-4 z-20 flex items-center justify-between rounded-2xl border border-foreground/[0.09] bg-background/90 p-3 shadow-xl backdrop-blur-xl">
          <div className="flex items-center gap-2 text-sm">
            {hasChanges ? <WarningCircleIcon className="h-4 w-4 text-amber-500" weight="fill" /> : <CheckCircleIcon className="h-4 w-4 text-emerald-500" weight="fill" />}
            <span className="text-muted-foreground">{hasChanges ? "Unsaved fixture changes" : "Fixture profile is up to date"}</span>
          </div>
          <div className="flex gap-2">
            <DesignButton variant="outline" size="sm" disabled={!hasChanges} onClick={() => {
              setDraft(cloneProfile(saved));
              setSavedNoticeVisible(false);
            }}>
              Reset
            </DesignButton>
            <DesignButton size="sm" disabled={!hasChanges || draft.displayName.trim().length === 0} onClick={() => {
              setSaved(cloneProfile(draft));
              setSavedNoticeVisible(true);
            }}>
              Save fixture profile
            </DesignButton>
          </div>
        </div>
      </PageLayout>

      {previewOpen && previewSnapshot != null ? (
        <div className="fixed inset-0 z-[200] bg-black">
          <TvPresentation snapshot={previewSnapshot} onExit={() => setPreviewOpen(false)} />
          <button
            type="button"
            className="absolute right-5 top-5 z-[250] flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/60 text-white/80 backdrop-blur-xl"
            onClick={() => setPreviewOpen(false)}
            aria-label="Close preview"
          >
            <XIcon className="h-5 w-5" weight="bold" />
          </button>
        </div>
      ) : null}
    </>
  );
}
