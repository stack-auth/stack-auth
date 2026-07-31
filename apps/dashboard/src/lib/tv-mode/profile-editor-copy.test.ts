import { describe, expect, it } from "vitest";
import {
  getTvProfileEditorCopy,
  getTvProfileOverviewAction,
  TV_EVENT_PREVIEW_GROUPS,
} from "./profile-editor-copy";

describe("TV profile customization copy", () => {
  it("frames a built-in profile as an unsaved template draft", () => {
    expect(getTvProfileEditorCopy("built-in", false)).toMatchInlineSnapshot(`
      {
        "alertDescription": "This Hexclave template remains unchanged. Save when ready to create a new project-owned profile.",
        "alertTitle": "Template Draft",
        "breadcrumb": "Template Draft",
        "isTemplateDraft": true,
        "pageDescription": "Customize this template without creating a project profile until you choose to save.",
        "saveLabel": "Save as New Profile",
      }
    `);
    expect(getTvProfileOverviewAction("built-in")).toBe("Customize");
  });

  it("retains normal edit-and-save language for a persisted profile", () => {
    expect(getTvProfileEditorCopy("saved", false)).toMatchInlineSnapshot(`
      {
        "alertDescription": "Changes are versioned and saved only to this project.",
        "alertTitle": "Persisted Project Profile",
        "breadcrumb": "Saved Profile",
        "isTemplateDraft": false,
        "pageDescription": "Configure this named General Mode presentation profile.",
        "saveLabel": "Save Profile",
      }
    `);
    expect(getTvProfileOverviewAction("saved")).toBe("Configure");
  });

  it("keeps an explicit create-from-template route in draft-first mode", () => {
    expect(getTvProfileEditorCopy("saved", true)).toMatchObject({
      isTemplateDraft: true,
      saveLabel: "Save as New Profile",
    });
  });

  it("exposes only the concise user-facing Event Preview set in display order", () => {
    expect(TV_EVENT_PREVIEW_GROUPS).toMatchInlineSnapshot(`
      [
        {
          "previews": [
            {
              "fixture": "celebration-takeover",
              "label": "Milestone Screen",
            },
            {
              "fixture": "celebration-highlight",
              "label": "Milestone Highlight",
            },
            {
              "fixture": "event-long-content",
              "label": "Long Event Content Highlight",
            },
          ],
          "title": "Celebration Previews",
        },
        {
          "previews": [
            {
              "fixture": "incident-takeover",
              "label": "Incident Screen · Email Degradation",
            },
            {
              "fixture": "incident-highlight",
              "label": "Incident Highlight · Email Degradation",
            },
            {
              "fixture": "incident-recovery",
              "label": "Incident Recovery Screen",
            },
            {
              "fixture": "incident-recovery-highlight",
              "label": "Incident Recovery Highlight",
            },
          ],
          "title": "Incident Previews",
        },
      ]
    `);
  });
});
