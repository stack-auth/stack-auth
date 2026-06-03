import { getPublicEnvVar } from "@/lib/env";
import type { CompleteConfig } from "@hexclave/shared/dist/config/schema";
import { getHexclaveApiBaseUrl, getStackAuthApiBaseUrl } from "@hexclave/shared/dist/utils/cloud-hosts";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { urlString } from "@hexclave/shared/dist/utils/urls";

type ConfigOAuthProvider = CompleteConfig['auth']['oauth']['providers'][string];

function apiUrlEnv(): string {
  return getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL')
    ?? throwErr("NEXT_PUBLIC_STACK_API_URL is required to build OAuth callback URLs");
}

function callbackPath(providerId: string): string {
  return urlString`/api/v1/auth/oauth/callback/${providerId}`;
}

/**
 * The hexclave-branded callback URL written into `customCallbackUrl` when a new
 * custom OAuth provider is set up. Env-aware: maps this deployment's
 * `NEXT_PUBLIC_STACK_API_URL` to its hexclave sibling (self-host/localhost fall
 * back to the env var unchanged).
 */
export function getNewProviderCallbackUrl(providerId: string): string {
  return getHexclaveApiBaseUrl(apiUrlEnv()) + callbackPath(providerId);
}

/**
 * The stack-auth-branded callback URL used by providers without a
 * `customCallbackUrl` (shared providers and custom providers created before the
 * field existed).
 */
export function getDefaultProviderCallbackUrl(providerId: string): string {
  return getStackAuthApiBaseUrl(apiUrlEnv()) + callbackPath(providerId);
}

/**
 * The redirect URL to register with the provider, shown in the (standard-mode)
 * provider dialog. Mirrors what the standard write path persists and what the
 * backend then sends as `redirect_uri`:
 *   - already standard -> its customCallbackUrl, or the stack-auth fallback for
 *     legacy providers that never had one
 *   - brand-new, or converting shared -> standard -> the new (hexclave) callback
 */
export function resolveProviderCallbackUrl(providerId: string, existing: ConfigOAuthProvider | undefined): string {
  if (existing && !existing.isShared) {
    return existing.customCallbackUrl ?? getDefaultProviderCallbackUrl(providerId);
  }
  return getNewProviderCallbackUrl(providerId);
}
