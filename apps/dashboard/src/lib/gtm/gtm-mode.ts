import { urlString } from "@hexclave/shared/dist/utils/urls";

// Demo mode is an internal-only affordance: it swaps the live GTM workspace for a deterministic fixture dataset so we
// can demo and screenshot the dashboard without seeding real records. Customers must never see it, so the `demo` query
// param is ignored outright outside the `internal` project rather than just being hidden from the UI — otherwise
// hand-crafting `?demo=true` would show a customer fabricated insights that look like their own data.
export function isGtmDemoModeAvailable(projectId: string): boolean {
  return projectId === "internal";
}

export function isGtmDemoMode(projectId: string, demoParam: string | null): boolean {
  if (!isGtmDemoModeAvailable(projectId)) return false;
  return demoParam !== "false";
}

export function getGtmSuggestionHref(
  projectId: string,
  suggestionType: "insights" | "actions",
  suggestionId: string,
  demo: boolean,
): string | null {
  if (projectId === "internal") {
    return demo
      ? urlString`/projects/${projectId}/gtm/${suggestionType}/${suggestionId}?demo=true`
      : null;
  }
  return urlString`/projects/${projectId}/gtm/${suggestionType}/${suggestionId}`;
}
