import { describe, expect, it } from "vitest";
import { getTvProfileEditorCopy, getTvProfileOverviewAction } from "./profile-editor-copy";

describe("TV profile customization copy", () => {
  it("frames a built-in profile as an unsaved template draft", () => {
    expect(getTvProfileEditorCopy("built-in", false)).toMatchInlineSnapshot(`
      {
        "alertDescription": "This Hexclave template remains unchanged. Save when ready to create a new project-owned profile.",
        "alertTitle": "Template draft",
        "breadcrumb": "Template draft",
        "isTemplateDraft": true,
        "pageDescription": "Customize this template without creating a project profile until you choose to save.",
        "saveLabel": "Save as new profile",
      }
    `);
    expect(getTvProfileOverviewAction("built-in")).toBe("Customize");
  });

  it("retains normal edit-and-save language for a persisted profile", () => {
    expect(getTvProfileEditorCopy("saved", false)).toMatchInlineSnapshot(`
      {
        "alertDescription": "Changes are versioned and saved only to this project.",
        "alertTitle": "Persisted project profile",
        "breadcrumb": "Saved profile",
        "isTemplateDraft": false,
        "pageDescription": "Configure this named General Mode presentation profile.",
        "saveLabel": "Save profile",
      }
    `);
    expect(getTvProfileOverviewAction("saved")).toBe("Configure");
  });

  it("keeps an explicit create-from-template route in draft-first mode", () => {
    expect(getTvProfileEditorCopy("saved", true)).toMatchObject({
      isTemplateDraft: true,
      saveLabel: "Save as new profile",
    });
  });
});
