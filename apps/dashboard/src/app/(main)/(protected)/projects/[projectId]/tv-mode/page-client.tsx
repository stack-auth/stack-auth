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
import { DesignAlert, DesignBadge, DesignCard } from "@/components/design-components";
import { Link } from "@/components/link";
import { useTvPresentationLauncher } from "@/components/tv-mode/presentation-window";
import { Typography } from "@/components/ui";
import { TV_PROFILE_FIXTURES } from "@/lib/tv-mode/fixtures";
import { getTvScreenDefinition } from "@/components/tv-mode/screen-registry";
import { PageLayout } from "../page-layout";
import { useProjectId } from "../use-admin-app";

function actionLinkClass(variant: "primary" | "secondary"): string {
  return variant === "primary"
    ? "inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-medium text-background transition-opacity duration-150 hover:opacity-90 hover:transition-none"
    : "inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-foreground/[0.1] bg-foreground/[0.035] px-4 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-foreground/[0.07] hover:transition-none";
}

export default function PageClient() {
  const projectId = useProjectId();
  const { launchPresentation, popupBlocked } = useTvPresentationLauncher(projectId);

  return (
    <PageLayout
      title="TV Mode"
      description="Ambient, full-screen project awareness built for shared displays."
      allowContentOverflow
      actions={
        <span className="inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-xl border border-foreground/[0.08] px-4 text-sm text-muted-foreground opacity-60" title="Profile creation will be connected after fixture validation">
          <PlusIcon className="h-4 w-4" weight="bold" />
          New profile
        </span>
      }
    >
      <DesignAlert
        variant="info"
        title="Fixture-driven foundation"
        description="This slice uses centralized, typed snapshots only. Profile changes and previews are intentionally not connected to project metrics or persisted configuration yet."
      />
      {popupBlocked ? (
        <DesignAlert
          variant="error"
          title="TV presentation was blocked"
          description="Allow popups for this dashboard, then start TV Mode again. Your dashboard has remained open."
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.55fr)]">
        <div className="space-y-4">
          {TV_PROFILE_FIXTURES.map((profile) => {
            const enabledScreens = profile.playlist.filter((entry) => entry.enabled);
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
                          <Typography className="text-base font-semibold text-foreground">{profile.displayName}</Typography>
                          <DesignBadge label="General Mode" color="cyan" size="sm" />
                        </div>
                        <Typography variant="secondary" className="mt-1 text-sm">{profile.description}</Typography>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Link href={`/projects/${projectId}/tv-mode/profiles/${profile.id}`} className={actionLinkClass("secondary")}>
                        <GearSixIcon className="h-4 w-4" />
                        Configure
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
                      <p className="mt-1 text-sm font-medium text-foreground">{profile.defaultDurationSeconds}s default</p>
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
                "2 named General Mode profiles",
                "2 event preview types",
                "13 presentation states",
                "No live project data",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm text-foreground">
                  <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-500" weight="fill" />
                  {item}
                </div>
              ))}
            </div>
          </DesignCard>

          <DesignCard title="Next data boundary" subtitle="Intentionally deferred" icon={StackIcon} gradient="blue" glassmorphic>
            <Typography variant="secondary" className="text-sm leading-relaxed">
              The next slice will connect this approved four-screen contract to one validated TV snapshot assembled from project metrics.
            </Typography>
          </DesignCard>
        </div>
      </div>
    </PageLayout>
  );
}
