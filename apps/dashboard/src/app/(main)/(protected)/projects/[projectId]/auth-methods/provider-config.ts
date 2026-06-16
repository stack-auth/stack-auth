import type { AdminProject } from "@hexclave/next";
import { splitOAuthProvider } from "@hexclave/shared/dist/config/oauth-providers";
import type { CompleteConfig, EnvironmentConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { typedFromEntries } from "@hexclave/shared/dist/utils/objects";
import { allProviders } from "@hexclave/shared/dist/utils/oauth";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";

export type AdminOAuthProviderConfig = AdminProject['config']['oauthProviders'][number];
type ConfigOAuthProvider = CompleteConfig['auth']['oauth']['providers'][string];

/**
 * Splitting an OAuth provider save into the two config layers it actually
 * spans:
 *   - `branchUpdate` carries ONLY the enable fields (`type`, `allowSignIn`,
 *     `allowConnectedAccounts`). These live in the branch config schema and are
 *     always writable — even in development environments (where the environment
 *     layer is read-only). Written via `updateConfig({ pushable: true })`.
 *   - `envWrite` carries the credentials as INDIVIDUAL LEAF KEYS
 *     (`auth.oauth.providers.<id>.clientId`, etc.). These only exist in the
 *     environment config schema. Written via `updateConfig({ pushable: false })`
 *     and only possible in production. Absent for shared providers (a provider
 *     present only in branch config renders as `isShared: true` by default).
 *
 * Env credentials MUST be leaf keys, never a whole `auth.oauth.providers.<id>`
 * object: a whole-object env override would clobber the branch enable fields at
 * render time (the env layer wins per-layer precedence), dropping `type` and
 * making the provider vanish. See the layering tests in
 * `packages/shared/src/config/schema.ts`.
 */
export type ProviderConfigSplit = {
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

export function splitProviderConfig(
  provider: AdminOAuthProviderConfig,
  existing: ConfigOAuthProvider | undefined,
  newProviderCallbackUrl: string,
): ProviderConfigSplit {
  const id = assertKnownProviderId(provider.id);

  switch (provider.type) {
    case 'shared': {
      // Shared == branch-only, no env credentials. Nothing to write to env.
      const { branchEnable } = splitOAuthProvider({ id, shared: true });
      return { branchUpdate: { [`auth.oauth.providers.${id}`]: branchEnable } };
    }
    case 'standard': {
      // Setting up a standard provider (brand-new, or converting shared ->
      // standard) means registering a fresh OAuth app, so it gets the
      // hexclave-branded callback URL. A provider that was already standard
      // keeps whatever it had — legacy ones without a customCallbackUrl keep
      // falling back to the stack-auth callback so edits never silently change
      // an already-registered redirect URL.
      const customCallbackUrl = (existing && !existing.isShared) ? existing.customCallbackUrl : newProviderCallbackUrl;
      // The branch/env split (and the leaf-key shape of the env credentials) is
      // single-sourced in `splitOAuthProvider`. Only defined values are emitted:
      // the hook resets the whole provider env subtree before this write, so an
      // omitted field is how a removed credential is cleared.
      const { branchEnable, envCredentialLeafKeys } = splitOAuthProvider({
        id,
        shared: false,
        credentials: {
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
          customCallbackUrl,
          facebookConfigId: provider.facebookConfigId,
          microsoftTenantId: provider.microsoftTenantId,
          appleBundles: provider.appleBundleIds?.length
            ? typedFromEntries(provider.appleBundleIds.map((bundleId: string) => [generateUuid(), { bundleId }] as const))
            : undefined,
        },
      });
      return {
        branchUpdate: { [`auth.oauth.providers.${id}`]: branchEnable },
        envWrite: envCredentialLeafKeys,
      };
    }
    default: {
      throw new HexclaveAssertionError(`Unknown provider type: ${(provider as { type: unknown }).type}`);
    }
  }
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
