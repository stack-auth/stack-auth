import {
  TV_SCREEN_IDS,
  type TvProfileConfiguration,
  type TvProfileResource,
} from "@hexclave/shared/dist/interface/admin-tv-mode";
import type { TvProfileFixture } from "./types";

export function profileResourceToEditorDraft(profile: TvProfileResource): TvProfileFixture {
  const configuredScreens = new Map(
    profile.configuration.playlist.map((entry) => [entry.screenId, entry]),
  );
  const orderedScreenIds = [
    ...profile.configuration.playlist.map((entry) => entry.screenId),
    ...TV_SCREEN_IDS.filter((screenId) => !configuredScreens.has(screenId)),
  ];
  return {
    id: profile.id,
    displayName: profile.configuration.displayName,
    description: profile.configuration.description,
    mode: profile.configuration.mode,
    defaultDurationSeconds: profile.configuration.defaultDurationSeconds,
    playlist: orderedScreenIds.map((screenId) => ({
      screenId,
      enabled: configuredScreens.has(screenId),
      durationSecondsOverride: configuredScreens.get(screenId)?.durationSecondsOverride ?? null,
    })),
    incidentTypes: profile.configuration.interruptionPreferences.incidentTypes,
    celebrations: profile.configuration.interruptionPreferences.celebrations,
    interruptionTiming: profile.configuration.interruptionPreferences.timing,
    showExactFinancialValues: profile.configuration.financialVisibility === "exact",
  };
}

export function editorDraftToProfileConfiguration(draft: TvProfileFixture): TvProfileConfiguration {
  return {
    displayName: draft.displayName,
    description: draft.description,
    mode: draft.mode,
    defaultDurationSeconds: draft.defaultDurationSeconds,
    playlist: draft.playlist
      .filter((entry) => entry.enabled)
      .map((entry) => ({
        screenId: entry.screenId,
        durationSecondsOverride: entry.durationSecondsOverride,
      })),
    interruptionPreferences: {
      incidentTypes: draft.incidentTypes,
      celebrations: draft.celebrations,
      timing: draft.interruptionTiming,
    },
    financialVisibility: draft.showExactFinancialValues ? "exact" : "redacted",
  };
}
