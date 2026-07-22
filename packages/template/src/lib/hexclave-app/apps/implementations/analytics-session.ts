import { Store } from "@hexclave/shared/dist/utils/stores";
import type { TokenObject } from "./common";

const ANALYTICS_TOKEN_STORAGE_PREFIX = "hexclave:analytics-session:v1";

function readPersistedAnonymousAnalyticsTokens(storageKey: string): string | null {
  try {
    return localStorage.getItem(storageKey);
  } catch (error) {
    // Browser privacy settings can expose localStorage while throwing on every
    // operation. Analytics identity persistence is optional, so retain the
    // in-memory session and make the degraded behavior visible for debugging.
    console.warn("Hexclave analytics: browser storage is unavailable; using an in-memory anonymous session", error);
    return null;
  }
}

function persistAnonymousAnalyticsTokens(storageKey: string, tokens: TokenObject): void {
  try {
    if (tokens.accessToken === null && tokens.refreshToken === null) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, JSON.stringify(tokens));
    }
  } catch (error) {
    // Quota and privacy failures must not reject analytics batches. The Store
    // still owns the new value for this page even when it cannot be persisted.
    console.warn("Hexclave analytics: could not persist the anonymous session; continuing in memory", error);
  }
}

export function makeAnonymousAnalyticsTokenStorageKey(projectId: string) {
  return `${ANALYTICS_TOKEN_STORAGE_PREFIX}:${projectId}`;
}

export function parseAnonymousAnalyticsTokens(raw: string | null): TokenObject {
  if (raw === null) return { accessToken: null, refreshToken: null };

  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return { accessToken: null, refreshToken: null };
    if (!("accessToken" in value) || !("refreshToken" in value)) return { accessToken: null, refreshToken: null };
    if (value.accessToken !== null && typeof value.accessToken !== "string") return { accessToken: null, refreshToken: null };
    if (value.refreshToken !== null && typeof value.refreshToken !== "string") return { accessToken: null, refreshToken: null };
    return { accessToken: value.accessToken, refreshToken: value.refreshToken };
  } catch {
    return { accessToken: null, refreshToken: null };
  }
}

/**
 * A browser-only identity used when an app intentionally has no public token
 * store. Keeping it separate preserves `tokenStore: null` semantics while a
 * full-page SSR navigation can still join replay batches to the same anonymous
 * refresh-token/session chain.
 */
export function createAnonymousAnalyticsTokenStore(projectId: string): Store<TokenObject> {
  const storageKey = makeAnonymousAnalyticsTokenStorageKey(projectId);
  const store = new Store<TokenObject>(parseAnonymousAnalyticsTokens(readPersistedAnonymousAnalyticsTokens(storageKey)));
  store.onChange((tokens) => {
    persistAnonymousAnalyticsTokens(storageKey, tokens);
  });
  return store;
}
