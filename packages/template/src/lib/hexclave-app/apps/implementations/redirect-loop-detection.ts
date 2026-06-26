import { HexclaveAssertionError, captureError } from "@hexclave/shared/dist/utils/errors";

const STORAGE_KEY = "hexclave-redirect-breadcrumbs";
const MAX_BREADCRUMBS = 10;
// Only consider redirects within the last 30 seconds as part of a potential loop
const LOOP_WINDOW_MS = 30_000;

type Breadcrumb = { from: string, to: string, timestamp: number };

/**
 * Records the current redirect in sessionStorage and checks for redirect loops (A→B→A pattern).
 * Fires captureError when a loop is detected so it shows up in Sentry.
 *
 * Called from _redirectTo() before every browser-side navigation.
 */
export function detectRedirectLoop(options: {
  targetUrl: string,
  projectId: string,
}) {
  try {
    const now = performance.now();
    const currentPathname = window.location.pathname;
    const targetPathname = (() => {
      try {
        return new URL(options.targetUrl, window.location.origin).pathname;
      } catch {
        return options.targetUrl;
      }
    })();

    const stored = sessionStorage.getItem(STORAGE_KEY);
    const breadcrumbs: Breadcrumb[] = stored != null ? JSON.parse(stored) : [];

    // Trim old entries outside the time window
    const recentBreadcrumbs = breadcrumbs.filter(b => now - b.timestamp < LOOP_WINDOW_MS);

    // Detect loop: if the same (from → to) redirect pair has been seen recently, we're in a loop
    const isLoop = recentBreadcrumbs.some(b => b.from === currentPathname && b.to === targetPathname);

    // Record this redirect pair
    recentBreadcrumbs.push({ from: currentPathname, to: targetPathname, timestamp: now });

    // Keep only the most recent entries
    const trimmed = recentBreadcrumbs.slice(-MAX_BREADCRUMBS);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));

    if (isLoop) {
      const recentPathnames = trimmed.map(b => b.from);
      captureError(
        "redirect-loop-detected",
        new HexclaveAssertionError(
          `Redirect loop detected: the redirect ${currentPathname} → ${targetPathname} was observed multiple times within ${LOOP_WINDOW_MS / 1000}s. ` +
          `Recent redirect chain: ${recentPathnames.join(" → ")} → ${targetPathname}`,
          {
            targetUrl: options.targetUrl,
            currentUrl: window.location.href,
            recentPathnames,
            projectId: options.projectId,
          },
        ),
      );

      // Clear breadcrumbs so we don't keep firing on every subsequent redirect in the same loop
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // sessionStorage may be unavailable (eg. in incognito/iframe with restrictions); silently ignore
  }
}
