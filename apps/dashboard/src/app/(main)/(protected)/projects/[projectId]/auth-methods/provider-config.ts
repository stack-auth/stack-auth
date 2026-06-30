import type { AdminProject } from "@hexclave/next";
import type { CompleteConfig, EnvironmentConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { filterUndefined, typedFromEntries } from "@hexclave/shared/dist/utils/objects";
import { allProviders } from "@hexclave/shared/dist/utils/oauth";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";

export type AdminOAuthProviderConfig = AdminProject['config']['oauthProviders'][number];
type ConfigOAuthProvider = CompleteConfig['auth']['oauth']['providers'][string];

/**
 * An OAuth provider save spans the two config layers the provider lives in:
 *   - `branchUpdate` carries the enable fields (`type`, `allowSignIn`,
 *     `allowConnectedAccounts`). These live in the branch config and are always
 *     writable — even in development environments. Written via
 *     `updateConfig({ pushable: true })`.
 *   - `envWrite` carries the credentials. These live in the environment config and
 *     are only writable in production. Written via `updateConfig({ pushable: false })`.
 *     Absent for shared providers (a provider present only in the branch config
 *     renders as `isShared: true` by default).
 *
 * Both are written as ordinary `auth.oauth.providers.<id>` objects — there's no
 * leaf-key bookkeeping here. `migrateConfigOverride("environment", …)` normalizes the
 * environment object into credential leaf keys and drops any branch field, so the
 * environment write can never clobber the branch-owned roster at render.
 */
export type ProviderConfigUpdate = {
  branchUpdate: EnvironmentConfigOverrideOverride,
  envWrite?: EnvironmentConfigOverrideOverride,
};

// `provider.id` is just a string at the type level; check it's actually a known provider so a
// bad id fails loudly instead of creating a config key for a provider that doesn't exist.
function assertKnownProviderId(id: string): (typeof allProviders)[number] {
  const known = allProviders.find((candidate) => candidate === id);
  if (known === undefined) {
    throw new HexclaveAssertionError(`Unknown OAuth provider id: ${id}`);
  }
  return known;
}

export function buildProviderConfigUpdate(
  provider: AdminOAuthProviderConfig,
  existing: ConfigOAuthProvider | undefined,
  newProviderCallbackUrl: string,
): ProviderConfigUpdate {
  const id = assertKnownProviderId(provider.id);
  const branchUpdate = {
    [`auth.oauth.providers.${id}`]: { type: id, allowSignIn: true, allowConnectedAccounts: true },
  };

  switch (provider.type) {
    case 'shared': {
      // Shared == branch-only, no environment credentials.
      return { branchUpdate };
    }
    case 'standard': {
      // Setting up a standard provider (brand-new, or converting shared ->
      // standard) means registering a fresh OAuth app, so it gets the
      // hexclave-branded callback URL. A provider that was already standard
      // keeps whatever it had — legacy ones without a customCallbackUrl keep
      // falling back to the stack-auth callback so edits never silently change
      // an already-registered redirect URL.
      const customCallbackUrl = (existing && !existing.isShared) ? existing.customCallbackUrl : newProviderCallbackUrl;
      // The hook resets the whole provider env subtree before this write, so an
      // omitted (undefined) field is how a removed credential is cleared.
      const credentials = filterUndefined({
        isShared: false,
        clientId: provider.clientId,
        clientSecret: provider.clientSecret,
        customCallbackUrl,
        facebookConfigId: provider.facebookConfigId,
        microsoftTenantId: provider.microsoftTenantId,
        appleBundles: provider.appleBundleIds?.length
          ? typedFromEntries(provider.appleBundleIds.map((bundleId: string) => [generateUuid(), { bundleId }] as const))
          : undefined,
      });
      return { branchUpdate, envWrite: { [`auth.oauth.providers.${id}`]: credentials } };
    }
    default: {
      throw new HexclaveAssertionError(`Unknown provider type: ${(provider as { type: unknown }).type}`);
    }
  }
}

/**
 * Custom OIDC providers span the same two layers as standard providers; they just have
 * a user-chosen id, a `type` of `"custom_oidc"`, and extra credential fields
 * (`issuerUrl`, `scope`, `displayName`).
 */
export function buildCustomOidcConfigUpdate(
  values: {
    providerId: string,
    displayName: string,
    issuerUrl: string,
    clientId: string,
    clientSecret: string,
    scope?: string,
  },
  existing: ConfigOAuthProvider | undefined,
  newProviderCallbackUrl: string,
): ProviderConfigUpdate {
  const key = `auth.oauth.providers.${values.providerId}`;
  // A provider that already has its own (non-shared) callback keeps it, so edits
  // never silently change an already-registered redirect URL; otherwise it gets a
  // fresh hexclave-branded callback.
  const customCallbackUrl = (existing && !existing.isShared) ? existing.customCallbackUrl : newProviderCallbackUrl;
  // The hook resets the whole provider env subtree first, so an omitted (undefined)
  // field is how a previously-set value (e.g. a removed scope) gets cleared.
  const credentials = filterUndefined({
    isShared: false,
    clientId: values.clientId,
    clientSecret: values.clientSecret,
    customCallbackUrl,
    issuerUrl: values.issuerUrl,
    displayName: values.displayName,
    scope: values.scope || undefined,
  });
  return {
    branchUpdate: { [key]: { type: "custom_oidc" as any, allowSignIn: true, allowConnectedAccounts: true } },
    envWrite: { [key]: credentials },
  };
}

/**
 * The environment config layer is read-only in development environments (the
 * backend blocks every environment-level write via
 * `assertConfigOverrideWriteAllowed`). `isDevelopmentEnvironment` is the
 * authoritative backend flag and covers the RDE-env-var dashboard too, since it
 * always runs against a development project.
 */
export function envConfigIsWritable(project: { isDevelopmentEnvironment: boolean }): boolean {
  return !project.isDevelopmentEnvironment;
}

/** The whole-subtree env key for a provider, reset before writing fresh creds. */
export function providerEnvKey(id: string): string {
  return `auth.oauth.providers.${id}`;
}
