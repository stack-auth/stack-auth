import { getTvBuiltInProfile } from "@hexclave/shared/dist/interface/admin-tv-mode";
import { describe, expect, it } from "vitest";
import {
  createTvProfileEditorDraft,
  editorDraftToProfileConfiguration,
  profileResourceToEditorDraft,
} from "./profile-editor-model";

describe("TV profile editor model", () => {
  it("round-trips a resolved profile without changing persisted configuration", () => {
    const profile = getTvBuiltInProfile("company-pulse");
    if (profile == null) throw new Error("Company Pulse must exist.");

    expect(editorDraftToProfileConfiguration(profileResourceToEditorDraft(profile)))
      .toEqual(profile.configuration);
  });

  it("keeps disabled screens out of persisted playlist order", () => {
    const profile = getTvBuiltInProfile("engineering-office");
    if (profile == null) throw new Error("Engineering Office must exist.");

    const draft = profileResourceToEditorDraft(profile);
    expect(draft.playlist).toHaveLength(4);
    expect(editorDraftToProfileConfiguration(draft).playlist.map((entry) => entry.screenId))
      .toEqual(["live-pulse", "audience-momentum", "email-health"]);
  });

  it("starts a template copy with its own name and description", () => {
    const profile = getTvBuiltInProfile("company-pulse");
    if (profile == null) throw new Error("Company Pulse must exist.");

    expect(createTvProfileEditorDraft(profile, true)).toMatchObject({
      displayName: "Company Pulse Copy",
      description: "New Profile",
    });
    expect(createTvProfileEditorDraft(profile, false)).toMatchObject({
      displayName: profile.configuration.displayName,
      description: profile.configuration.description,
    });
  });
});
