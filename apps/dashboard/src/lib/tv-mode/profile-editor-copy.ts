import type { TvProfileResource } from "@hexclave/shared/dist/interface/admin-tv-mode";

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
    breadcrumb: "Template draft",
    pageDescription: "Customize this template without creating a project profile until you choose to save.",
    alertTitle: "Template draft",
    alertDescription: "This Hexclave template remains unchanged. Save when ready to create a new project-owned profile.",
    saveLabel: "Save as new profile",
  } : {
    isTemplateDraft,
    breadcrumb: "Saved profile",
    pageDescription: "Configure this named General Mode presentation profile.",
    alertTitle: "Persisted project profile",
    alertDescription: "Changes are versioned and saved only to this project.",
    saveLabel: "Save profile",
  };
}

export function getTvProfileOverviewAction(origin: TvProfileResource["origin"]): "Customize" | "Configure" {
  return origin === "built-in" ? "Customize" : "Configure";
}
