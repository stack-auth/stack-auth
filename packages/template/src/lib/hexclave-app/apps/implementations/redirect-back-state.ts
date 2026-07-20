import { readSessionStorageItem, removeSessionStorageItem, writeSessionStorageItem } from "../../../../utils/session-storage";
import { crossDomainAuthQueryParams } from "./redirect-page-urls";

/**
 * Resilience layer for the redirect-back ("return to where you came from") state of auth flows.
 *
 * The primary transport for this state is query params (`after_auth_return_to` +
 * `hexclave_cross_domain_*`), which must survive every hop of the auth flow (sign-in page, OAuth
 * provider round-trips, MFA, magic links, ...). Historically, any hop that dropped these params
 * stranded the user on the wrong page after auth — on hosted components, that meant the hosted
 * welcome page instead of the customer's app.
 *
 * This module mirrors the state into sessionStorage whenever it appears in a URL, so
 * `redirectToAfterSignIn`/`redirectToAfterSignUp` can restore it if the params were dropped along
 * the way. Query params always take precedence; the mirror is only a fallback. It is scoped
 * per-tab (sessionStorage), per-origin (sessionStorage again), and per-project, and it expires
 * after a TTL. Restored URLs still go through the exact same trust validation as URLs read from
 * query params (the `_isTrusted` gate client-side and the cross-domain authorize endpoint
 * server-side), so the mirror never widens the set of allowed destinations.
 */

// Deliberately NOT consumed/cleared on use: React can invoke the after-sign-in redirect twice
// (strict mode, remounts), and consuming on first read would make the second invocation fall back
// to the default post-auth page and race the correct redirect. Staleness is bounded by the TTL
// instead, and a stale entry merely returns the user to the last page that started an auth flow
// in this tab — which is also what they'd expect.
//
// The TTL must stay below the 1h lifetime of the outer PKCE verifier cookie (see
// saveVerifierAndState in cookie.ts): the mirrored cross-domain params are useless once their
// verifier cookie on the app domain has expired.
const redirectBackStateTtlMillis = 30 * 60 * 1000;

export type PersistedRedirectBackState = {
  /**
   * The `after_auth_return_to` value exactly as it appeared in the URL (possibly relative).
   * sessionStorage is per-origin, so restoring it into a URL later always resolves it against the
   * same origin it was saved from.
   */
  afterAuthReturnTo: string,
  crossDomainState: string | null,
  crossDomainCodeChallenge: string | null,
  crossDomainAfterCallbackRedirectUrl: string | null,
  /** Wall-clock ms (Date.now()); must survive page loads, so performance.now() is not usable. */
  savedAtMillis: number,
};

function getStorageKey(projectId: string): string {
  return `hexclave-redirect-back-state-${projectId}`;
}

function isPersistedRedirectBackState(value: unknown): value is PersistedRedirectBackState {
  return (
    typeof value === "object"
    && value !== null
    && "afterAuthReturnTo" in value && typeof value.afterAuthReturnTo === "string"
    && "crossDomainState" in value && (value.crossDomainState === null || typeof value.crossDomainState === "string")
    && "crossDomainCodeChallenge" in value && (value.crossDomainCodeChallenge === null || typeof value.crossDomainCodeChallenge === "string")
    && "crossDomainAfterCallbackRedirectUrl" in value && (value.crossDomainAfterCallbackRedirectUrl === null || typeof value.crossDomainAfterCallbackRedirectUrl === "string")
    && "savedAtMillis" in value && typeof value.savedAtMillis === "number"
  );
}

/**
 * Mirrors the redirect-back state from the given URL into sessionStorage, if it has any. Called
 * with the page URL at app construction time (full page loads) and with the target URL of every
 * SDK-driven redirect (client-side navigations, which don't re-run the constructor).
 */
export function saveRedirectBackStateFromUrl(options: { url: URL, projectId: string }): void {
  const afterAuthReturnTo = options.url.searchParams.get("after_auth_return_to");
  if (afterAuthReturnTo == null) {
    return;
  }
  const state: PersistedRedirectBackState = {
    afterAuthReturnTo,
    crossDomainState: options.url.searchParams.get(crossDomainAuthQueryParams.state),
    crossDomainCodeChallenge: options.url.searchParams.get(crossDomainAuthQueryParams.codeChallenge),
    crossDomainAfterCallbackRedirectUrl: options.url.searchParams.get(crossDomainAuthQueryParams.afterCallbackRedirectUrl),
    savedAtMillis: Date.now(),
  };
  writeSessionStorageItem(getStorageKey(options.projectId), JSON.stringify(state));
}

export function readRedirectBackState(options: { projectId: string }): PersistedRedirectBackState | null {
  const storageKey = getStorageKey(options.projectId);
  const raw = readSessionStorageItem(storageKey);
  if (raw == null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupted value (eg. written by a different SDK version); losing the fallback for this flow
    // is the pre-existing behavior, so just discard it.
    removeSessionStorageItem(storageKey);
    return null;
  }
  if (!isPersistedRedirectBackState(parsed)) {
    removeSessionStorageItem(storageKey);
    return null;
  }
  const ageMillis = Date.now() - parsed.savedAtMillis;
  if (ageMillis < 0 || ageMillis > redirectBackStateTtlMillis) {
    removeSessionStorageItem(storageKey);
    return null;
  }
  return parsed;
}

/**
 * Returns a copy of `currentUrl` with any redirect-back query params that were dropped along the
 * way restored from the sessionStorage mirror. If `currentUrl` already carries
 * `after_auth_return_to`, it is returned unchanged — explicit query params always win.
 */
export function augmentUrlWithPersistedRedirectBackState(options: { currentUrl: URL, projectId: string }): URL {
  if (options.currentUrl.searchParams.has("after_auth_return_to")) {
    return options.currentUrl;
  }
  const persisted = readRedirectBackState({ projectId: options.projectId });
  if (persisted == null) {
    return options.currentUrl;
  }
  const augmented = new URL(options.currentUrl.toString());
  augmented.searchParams.set("after_auth_return_to", persisted.afterAuthReturnTo);
  const crossDomainParamValues = [
    [crossDomainAuthQueryParams.state, persisted.crossDomainState],
    [crossDomainAuthQueryParams.codeChallenge, persisted.crossDomainCodeChallenge],
    [crossDomainAuthQueryParams.afterCallbackRedirectUrl, persisted.crossDomainAfterCallbackRedirectUrl],
  ] as const;
  for (const [paramName, persistedValue] of crossDomainParamValues) {
    if (persistedValue != null && !augmented.searchParams.has(paramName)) {
      augmented.searchParams.set(paramName, persistedValue);
    }
  }
  return augmented;
}
