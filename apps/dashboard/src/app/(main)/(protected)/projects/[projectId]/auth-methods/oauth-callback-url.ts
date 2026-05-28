import { getPublicEnvVar } from "@/lib/env";
import type { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { getHexclaveApiBaseUrl, getStackAuthApiBaseUrl } from "@stackframe/stack-shared/dist/utils/cloud-hosts";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";

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
 * The redirect URL a customer should register with the provider. Mirrors the
 * backend's `getProvider()` resolution so the dashboard always displays exactly
 * what we send to the provider.
 */
export function resolveProviderCallbackUrl(providerId: string, existing: ConfigOAuthProvider | undefined): string {
  if (existing && !existing.isShared && existing.customCallbackUrl) {
    return existing.customCallbackUrl;
  }
  if (existing) {
    return getDefaultProviderCallbackUrl(providerId);
  }
  return getNewProviderCallbackUrl(providerId);
}
