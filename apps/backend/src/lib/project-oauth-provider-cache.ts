import type Provider from "oidc-provider";
import { createProjectOAuthProvider, getProjectIdpId } from "./project-oauth-provider";
import { deriveScopesFromConfig } from "./permissions";
import type { Tenancy } from "./tenancies";

const PROJECT_PROVIDER_CACHE_TTL_MS = 5 * 60 * 1_000;
const PROJECT_PROVIDER_CACHE_MAX_SIZE = 100;

type CachedProvider = {
  fingerprint: string,
  expiresAt: number,
  provider: Promise<Provider>,
};

const providerCache = new Map<string, CachedProvider>();

function getProviderConfigFingerprint(tenancy: Tenancy): string {
  return JSON.stringify({
    oauthProvider: tenancy.config.oauthProvider,
    scopes: deriveScopesFromConfig(tenancy.config),
  });
}

function evictExpiredProviders(now: number): void {
  for (const [idpId, entry] of providerCache) {
    if (entry.expiresAt <= now) providerCache.delete(idpId);
  }
}

export async function getProjectOAuthProvider(
  tenancy: Tenancy,
  options: {
    apiUrl: string,
  },
): Promise<Provider> {
  const now = performance.now();
  evictExpiredProviders(now);
  const idpId = getProjectIdpId(tenancy);
  const fingerprint = getProviderConfigFingerprint(tenancy);
  const existing = providerCache.get(idpId);
  if (existing?.fingerprint === fingerprint && existing.expiresAt > now) {
    providerCache.delete(idpId);
    providerCache.set(idpId, existing);
    return await existing.provider;
  }

  const entry: CachedProvider = {
    fingerprint,
    expiresAt: now + PROJECT_PROVIDER_CACHE_TTL_MS,
    provider: Promise.resolve().then(async () => await createProjectOAuthProvider(tenancy, options)),
  };
  entry.provider = entry.provider.then(
    (provider) => provider,
    (error) => {
      if (providerCache.get(idpId) === entry) {
        providerCache.delete(idpId);
      }
      throw error;
    },
  );
  providerCache.set(idpId, entry);
  while (providerCache.size > PROJECT_PROVIDER_CACHE_MAX_SIZE) {
    const oldestIdpId = providerCache.keys().next().value;
    if (oldestIdpId === undefined) break;
    providerCache.delete(oldestIdpId);
  }
  return await entry.provider;
}
