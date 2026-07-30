"use client";

import {
  ArrowSquareOutIcon,
  BroadcastIcon,
  CheckCircleIcon,
  GearSixIcon,
  MonitorPlayIcon,
  PlusIcon,
  StackIcon,
} from "@phosphor-icons/react";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import type { TvProfileResource } from "@hexclave/shared/dist/interface/admin-tv-mode";
import { useEffect, useState } from "react";
import { DesignAlert, DesignBadge, DesignCard } from "@/components/design-components";
import { Link } from "@/components/link";
import { useTvPresentationLauncher } from "@/components/tv-mode/presentation-window";
import { Typography } from "@/components/ui";
import { fetchTvProfilesOrThrow } from "@/lib/hexclave-app-internals";
import { getTvScreenDefinition } from "@/components/tv-mode/screen-registry";
import { getTvProfileOverviewAction } from "@/lib/tv-mode/profile-editor-copy";
import { PageLayout } from "../page-layout";
import { useAdminApp, useProjectId } from "../use-admin-app";

function actionLinkClass(variant: "primary" | "secondary"): string {
  return variant === "primary"
    ? "inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-medium text-background transition-opacity duration-150 hover:opacity-90 hover:transition-none"
    : "inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-foreground/[0.1] bg-foreground/[0.035] px-4 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-foreground/[0.07] hover:transition-none";
}

export default function PageClient() {
  const projectId = useProjectId();
  const adminApp = useAdminApp();
  const { launchPresentation, popupBlocked } = useTvPresentationLauncher(projectId);
  const [profiles, setProfiles] = useState<TvProfileResource[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [persistenceReady, setPersistenceReady] = useState(true);

  useEffect(() => {
    let active = true;
    runAsynchronously(async () => {
      try {
        const result = await fetchTvProfilesOrThrow(adminApp);
        if (!active) return;
        setProfiles([...result.savedProfiles, ...result.templates]);
        setPersistenceReady(result.persistenceReady);
      } catch {
        if (active) setLoadError(true);
      }
    });
    return () => {
      active = false;
    };
  }, [adminApp]);

  return (
    <PageLayout
      title="TV Mode"
      description="Ambient, full-screen project awareness built for shared displays."
      allowContentOverflow
      actions={
        <Link href={`/projects/${projectId}/tv-mode/profiles/company-pulse?create=1`} className={actionLinkClass("secondary")}>
          <PlusIcon className="h-4 w-4" weight="bold" />
          New profile
        </Link>
      }
    >
      <DesignAlert
        variant="info"
        title="Project presentation profiles"
        description="Saved profiles are project-scoped. Built-in profiles remain available as safe templates and defaults."
      />
      {!persistenceReady ? <DesignAlert variant="error" title="Profile storage is not ready" description="The additive TV profile migration must complete before profiles can be saved." /> : null}
      {loadError ? <DesignAlert variant="error" title="Profiles could not be loaded" description="Refresh the page to retry. Existing presentations have not been changed." /> : null}
      {popupBlocked ? (
        <DesignAlert
          variant="error"
          title="TV presentation was blocked"
          description="Allow popups for this dashboard, then start TV Mode again. Your dashboard has remained open."
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.55fr)]">
        <div className="space-y-4">
          {profiles == null && !loadError ? (
            <DesignCard gradient="default" glassmorphic>
              <Typography variant="secondary">Loading presentation profiles…</Typography>
            </DesignCard>
          ) : null}
          {profiles?.map((profile) => {
            const configuration = profile.configuration;
            const enabledScreens = configuration.playlist;
            return (
              <DesignCard key={profile.id} gradient="default" glassmorphic>
                <div className="flex flex-col gap-5 p-1">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-600 ring-1 ring-cyan-500/15 dark:text-cyan-300">
                        <MonitorPlayIcon className="h-6 w-6" weight="fill" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Typography className="text-base font-semibold text-foreground">{configuration.displayName}</Typography>
                          <DesignBadge label="General Mode" color="cyan" size="sm" />
                          <DesignBadge label={profile.origin === "built-in" ? "Template" : "Saved"} color={profile.origin === "built-in" ? "blue" : "green"} size="sm" />
                        </div>
                        <Typography variant="secondary" className="mt-1 text-sm">{configuration.description}</Typography>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Link
                        href={`/projects/${projectId}/tv-mode/profiles/${profile.id}${profile.origin === "built-in" ? "?create=1" : ""}`}
                        className={actionLinkClass("secondary")}
                      >
                        <GearSixIcon className="h-4 w-4" />
                        {getTvProfileOverviewAction(profile.origin)}
                      </Link>
                      <button
                        type="button"
                        onClick={() => launchPresentation(`/projects/${projectId}/tv-mode/present/${profile.id}`)}
                        className={actionLinkClass("primary")}
                      >
                        <BroadcastIcon className="h-4 w-4" weight="fill" />
                        Start TV Mode
                        <ArrowSquareOutIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 border-t border-foreground/[0.06] pt-4 sm:grid-cols-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Playlist</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{enabledScreens.length} screens</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Rotation</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{configuration.defaultDurationSeconds}s default</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Interruptions</p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <CheckCircleIcon className="h-4 w-4 text-emerald-500" weight="fill" />
                        Critical, high, medium
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {enabledScreens.map((entry) => {
                      const definition = getTvScreenDefinition(entry.screenId);
                      const Icon = definition.icon;
                      return (
                        <span key={entry.screenId} className="inline-flex items-center gap-1.5 rounded-lg bg-foreground/[0.04] px-2.5 py-1.5 text-xs text-muted-foreground ring-1 ring-foreground/[0.06]">
                          <Icon className="h-3.5 w-3.5" weight="fill" />
                          {definition.displayName}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </DesignCard>
            );
          })}
        </div>

        <div className="space-y-4">
          <DesignCard title="Foundation status" subtitle="Current fixture slice" icon={CheckCircleIcon} gradient="green" glassmorphic>
            <div className="space-y-3">
              {[
                "4 registered TV screens",
                "Multiple project-scoped profiles",
                "2 event preview types",
                "13 presentation states",
                "Live project snapshots",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm text-foreground">
                  <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-500" weight="fill" />
                  {item}
                </div>
              ))}
            </div>
          </DesignCard>

          <DesignCard title="Safe defaults" subtitle="No setup required" icon={StackIcon} gradient="blue" glassmorphic>
            <Typography variant="secondary" className="text-sm leading-relaxed">
              Company Pulse remains available virtually when a project has no saved profiles. Duplicate any template to create an editable project profile.
            </Typography>
          </DesignCard>
        </div>
      </div>
    </PageLayout>
  );
}
