import type { TvProfileResource } from "@hexclave/shared/dist/interface/admin-tv-mode";

export const TV_EVENT_PREVIEW_GROUPS = [
  {
    title: "Celebration Previews",
    previews: [
      { fixture: "celebration-takeover", label: "Milestone Screen" },
      { fixture: "celebration-highlight", label: "Milestone Highlight" },
      { fixture: "event-long-content", label: "Long Event Content Highlight" },
    ],
  },
  {
    title: "Incident Previews",
    previews: [
      { fixture: "incident-takeover", label: "Incident Screen · Email Degradation" },
      { fixture: "incident-highlight", label: "Incident Highlight · Email Degradation" },
      { fixture: "incident-recovery", label: "Incident Recovery Screen" },
      { fixture: "incident-recovery-highlight", label: "Incident Recovery Highlight" },
    ],
  },
] as const;

export function getTvProfileEditorCopy(
  origin: TvProfileResource["origin"],
  createFromTemplate: boolean,
): {
  isTemplateDraft: boolean,
  breadcrumb: string,
  pageDescription: string,
  alertTitle: string,
  alertDescription: string,
  saveLabel: string,
} {
  const isTemplateDraft = origin === "built-in" || createFromTemplate;
  return isTemplateDraft ? {
    isTemplateDraft,
    breadcrumb: "Template Draft",
    pageDescription: "Customize this template without creating a project profile until you choose to save.",
    alertTitle: "Template Draft",
    alertDescription: "This Hexclave template remains unchanged. Save when ready to create a new project-owned profile.",
    saveLabel: "Save as New Profile",
  } : {
    isTemplateDraft,
    breadcrumb: "Saved Profile",
    pageDescription: "Configure this named General Mode presentation profile.",
    alertTitle: "Persisted Project Profile",
    alertDescription: "Changes are versioned and saved only to this project.",
    saveLabel: "Save Profile",
  };
}

export function getTvProfileOverviewAction(origin: TvProfileResource["origin"]): "Customize" | "Configure" {
  return origin === "built-in" ? "Customize" : "Configure";
}
