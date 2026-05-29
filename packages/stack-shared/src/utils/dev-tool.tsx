/**
 * Shared identity of the Hexclave in-page dev tool / heatmap overlay.
 *
 * These constants are the single source of truth for "is this DOM / event /
 * stored click part of the dev tool itself?". They are consumed across package
 * boundaries:
 *  - the dev tool mounts its root element with {@link DEV_TOOL_ROOT_ID} and
 *    prefixes every generated class with {@link DEV_TOOL_CLASS_PREFIX};
 *  - the event tracker uses them to skip self-clicks at ingest;
 *  - the backend clickmap query uses them to filter dev-tool clicks out of
 *    aggregate heatmaps server-side.
 *
 * Keep them here so a rename can never silently desync the SQL filter from the
 * actual DOM identity.
 */
export const DEV_TOOL_ROOT_ID = "__hexclave-dev-tool-root";

/** Prefix applied to every class/generated id the dev tool renders. */
export const DEV_TOOL_CLASS_PREFIX = "sdt-";

/** Legacy class marker still present on older dev-tool builds. */
export const DEV_TOOL_LEGACY_CLASS = "stack-devtool";
