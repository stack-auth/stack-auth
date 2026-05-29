/**
 * Wire protocol for handing a heatmap overlay token from the dashboard to the
 * in-page dev tool via `sessionStorage` + a window event.
 *
 * The dashboard (writer) and the dev tool (reader) live in different packages
 * but must agree on these exact key names and event name — this module is the
 * single source of truth so they can never silently desync. The reader's
 * legacy-fallback logic and the writer's snippet stay in their respective
 * packages; only the shared names + key builders live here.
 */

export const HEATMAP_OVERLAY_TOKEN_STORAGE_KEY = "hexclave-heatmap-overlay-token";
export const HEATMAP_OVERLAY_ORIGIN_STORAGE_KEY = "hexclave-heatmap-overlay-origin";
export const HEATMAP_OVERLAY_PROJECT_STORAGE_KEY = "hexclave-heatmap-overlay-project-id";
export const HEATMAP_OVERLAY_RESUME_STORAGE_KEY = "hexclave-heatmap-overlay-resume";
export const HEATMAP_OVERLAY_TOKEN_UPDATED_EVENT = "hexclave:heatmap-token-updated";

/** Per-project sessionStorage key holding the overlay token. */
export function getProjectHeatmapTokenStorageKey(projectId: string): string {
  return `${HEATMAP_OVERLAY_TOKEN_STORAGE_KEY}:${projectId}`;
}

/** Per-project sessionStorage key holding the origin the token was minted for. */
export function getProjectHeatmapOriginStorageKey(projectId: string): string {
  return `${HEATMAP_OVERLAY_ORIGIN_STORAGE_KEY}:${projectId}`;
}
