import { ExpiringPromiseCache } from "@/utils/expiring-promise-cache";
import type Provider from "oidc-provider";
import { createProjectOAuthProvider, getProjectIdpId } from "./project-oauth-provider";
import type { Tenancy } from "./tenancies";

const providerCache = new ExpiringPromiseCache<Provider>(5 * 60 * 1_000, { maxSize: 100 });

export async function getProjectOAuthProvider(
  tenancy: Tenancy,
  options: {
    apiUrl: string,
  },
): Promise<Provider> {
  const key = `${getProjectIdpId(tenancy)}:${options.apiUrl}:${JSON.stringify(tenancy.config.oauthProvider)}`;
  return await providerCache.get(key, async () => await createProjectOAuthProvider(tenancy, options));
}
