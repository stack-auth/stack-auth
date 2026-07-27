"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { TvPresentation } from "@/components/tv-mode/tv-presentation";
import {
  exitStandaloneTvPresentation,
  getBrowserTvPresentationExitEnvironment,
} from "@/components/tv-mode/presentation-window";
import { getTvFixtureSnapshot } from "@/lib/tv-mode/fixtures";
import { useTvLiveSnapshot } from "@/lib/tv-mode/live-snapshot";
import {
  TV_FIXTURE_VARIANTS,
  TV_SCREEN_IDS,
  type TvFixtureVariant,
  type TvScreenId,
} from "@/lib/tv-mode/types";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useAdminApp } from "../../../use-admin-app";

const TV_FIXTURE_VARIANT_SET = new Set<string>(TV_FIXTURE_VARIANTS);
const TV_SCREEN_ID_SET = new Set<string>(TV_SCREEN_IDS);

function isTvFixtureVariant(value: string | null): value is TvFixtureVariant {
  return value != null && TV_FIXTURE_VARIANT_SET.has(value);
}

function isTvScreenId(value: string | null): value is TvScreenId {
  return value != null && TV_SCREEN_ID_SET.has(value);
}

function getRouteValues(pathname: string): { projectId: string, profileId: string } {
  const segments = pathname.split("/");
  const projectsIndex = segments.indexOf("projects");
  const presentIndex = segments.indexOf("present");
  const projectId = segments.at(projectsIndex + 1);
  const profileId = segments.at(presentIndex + 1);
  if (projectId == null || projectId.length === 0) {
    throw new Error("Project ID is missing from the TV presentation route");
  }
  if (profileId == null || profileId.length === 0) {
    throw new Error("Profile ID is missing from the TV presentation route");
  }
  return {
    projectId: decodeURIComponent(projectId),
    profileId: decodeURIComponent(profileId),
  };
}

export default function PageClient() {
  const { projectId, profileId } = getRouteValues(usePathname());
  const fixtureParam = useSearchParams().get("fixture");
  const screenParam = useSearchParams().get("screen");
  const fixtureVariant = isTvFixtureVariant(fixtureParam) ? fixtureParam : null;
  const adminApp = useAdminApp();
  const liveSnapshot = useTvLiveSnapshot({
    adminApp,
    profileId,
    enabled: fixtureVariant == null,
  });
  const snapshot = fixtureVariant == null
    ? liveSnapshot.snapshot
    : getTvFixtureSnapshot(projectId, profileId, fixtureVariant);

  return (
    <TvPresentation
      snapshot={snapshot}
      loading={fixtureVariant === "loading" || (fixtureVariant == null && liveSnapshot.loading)}
      unavailableReason={fixtureVariant == null ? liveSnapshot.unavailableReason : null}
      onExit={() => runAsynchronouslyWithAlert(exitStandaloneTvPresentation({
        fallbackHref: `/projects/${projectId}/tv-mode`,
        environment: getBrowserTvPresentationExitEnvironment(),
      }))}
      initialScreenId={isTvScreenId(screenParam) ? screenParam : undefined}
    />
  );
}
