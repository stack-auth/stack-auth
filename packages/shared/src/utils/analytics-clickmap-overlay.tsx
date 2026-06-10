/**
 * Wire protocol for handing a clickmap overlay token from the dashboard to the
 * in-page dev tool via `sessionStorage` + a window event.
 *
 * The token is a self-describing JWT: its payload already carries the
 * `project_id` and `origin` it was minted for, so the reader derives both from
 * the token itself and the writer only has to hand over a single value. The
 * dashboard (writer) and the dev tool (reader) live in different packages but
 * must agree on these exact names — this module is the single source of truth so
 * they can never silently desync.
 */

export const CLICKMAP_OVERLAY_TOKEN_STORAGE_KEY = "hexclave-clickmap-token";
export const CLICKMAP_OVERLAY_RESUME_STORAGE_KEY = "hexclave-clickmap-resume";
export const CLICKMAP_OVERLAY_TOKEN_UPDATED_EVENT = "hexclave:clickmap-token-updated";
