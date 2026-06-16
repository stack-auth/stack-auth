import type { ConfigValue } from "./format";
import { allProviders } from "../utils/oauth";

/**
 * OAuth provider config is split across two config layers, and this module is
 * the single source of truth for that split:
 *
 *   - BRANCH owns the provider ROSTER and its enabled state: `type` (presence of
 *     which is what makes a provider show up at all — see the render filter in
 *     `schema.ts`), `allowSignIn`, `allowConnectedAccounts`. These are writable
 *     even in development environments, so providers can be enabled/disabled there.
 *   - ENVIRONMENT owns the CREDENTIALS only: `isShared`, `clientId`,
 *     `clientSecret`, `customCallbackUrl`, `facebookConfigId`,
 *     `microsoftTenantId`, `appleBundles`. The environment layer is read-only in
 *     development environments.
 *
 * Credentials MUST be written as individual leaf keys
 * (`auth.oauth.providers.<id>.clientId`), never as a whole
 * `auth.oauth.providers.<id>` object: a whole-object env override wins over the
 * branch layer per-layer precedence and would clobber the branch enable fields
 * (dropping `type`, making the provider vanish at render). The branch layer, by
 * contrast, may write the enable fields as an object since it is the base for the
 * provider roster.
 *
 * NOTE: the DB migration that backfills this split
 * (`prisma/migrations/.../*_split_oauth_provider_config`) encodes the same field
 * partition in SQL. Keep the two in sync.
 */
export const OAUTH_PROVIDER_BRANCH_ENABLE_FIELDS = ["type", "allowSignIn", "allowConnectedAccounts"] as const;
export const OAUTH_PROVIDER_ENV_CREDENTIAL_FIELDS = ["isShared", "clientId", "clientSecret", "customCallbackUrl", "facebookConfigId", "microsoftTenantId", "appleBundles"] as const;

export type OAuthProviderCredentials = {
  clientId?: string,
  clientSecret?: string,
  customCallbackUrl?: string,
  facebookConfigId?: string,
  microsoftTenantId?: string,
  appleBundles?: Record<string, { bundleId: string }>,
};

export type OAuthProviderBranchEnable = {
  type: (typeof allProviders)[number],
  allowSignIn: boolean,
  allowConnectedAccounts: boolean,
};

export type OAuthProviderSpec = {
  id: (typeof allProviders)[number],
  /** Shared providers use Hexclave-managed keys and have NO environment credentials. */
  shared: boolean,
  /** Credentials for a standard (non-shared) provider; ignored when `shared` is true. */
  credentials?: OAuthProviderCredentials,
  allowSignIn?: boolean,
  allowConnectedAccounts?: boolean,
};

export type OAuthProviderConfigSplit = {
  /** The value for `auth.oauth.providers.<id>` in the BRANCH layer. */
  branchEnable: OAuthProviderBranchEnable,
  /**
   * ENVIRONMENT credential writes, as leaf keys (`auth.oauth.providers.<id>.<field>`).
   * Empty for shared providers (shared == branch-only, no env credentials).
   */
  envCredentialLeafKeys: Record<string, ConfigValue>,
};

export function oauthProviderConfigPrefix(id: string): string {
  return `auth.oauth.providers.${id}`;
}

/**
 * Splits a single OAuth provider into its branch enable object and environment
 * credential leaf keys. See the module doc for why env writes are leaf keys.
 */
export function splitOAuthProvider(spec: OAuthProviderSpec): OAuthProviderConfigSplit {
  const branchEnable: OAuthProviderBranchEnable = {
    type: spec.id,
    allowSignIn: spec.allowSignIn ?? true,
    allowConnectedAccounts: spec.allowConnectedAccounts ?? true,
  };

  if (spec.shared) {
    return { branchEnable, envCredentialLeafKeys: {} };
  }

  const prefix = oauthProviderConfigPrefix(spec.id);
  const creds = spec.credentials ?? {};
  // Only defined values are emitted: callers reset the whole provider env subtree
  // before writing, so an omitted field means "cleared".
  const envCredentialLeafKeys: Record<string, ConfigValue> = {
    [`${prefix}.isShared`]: false,
  };
  if (creds.clientId !== undefined) envCredentialLeafKeys[`${prefix}.clientId`] = creds.clientId;
  if (creds.clientSecret !== undefined) envCredentialLeafKeys[`${prefix}.clientSecret`] = creds.clientSecret;
  if (creds.customCallbackUrl !== undefined) envCredentialLeafKeys[`${prefix}.customCallbackUrl`] = creds.customCallbackUrl;
  if (creds.facebookConfigId !== undefined) envCredentialLeafKeys[`${prefix}.facebookConfigId`] = creds.facebookConfigId;
  if (creds.microsoftTenantId !== undefined) envCredentialLeafKeys[`${prefix}.microsoftTenantId`] = creds.microsoftTenantId;
  if (creds.appleBundles !== undefined) envCredentialLeafKeys[`${prefix}.appleBundles`] = creds.appleBundles;

  return { branchEnable, envCredentialLeafKeys };
}

import.meta.vitest?.test("splitOAuthProvider: shared provider is branch-only", ({ expect }) => {
  expect(splitOAuthProvider({ id: "spotify", shared: true })).toEqual({
    branchEnable: { type: "spotify", allowSignIn: true, allowConnectedAccounts: true },
    envCredentialLeafKeys: {},
  });
});

import.meta.vitest?.test("splitOAuthProvider: standard provider emits env credential leaf keys", ({ expect }) => {
  expect(splitOAuthProvider({
    id: "google",
    shared: false,
    credentials: { clientId: "cid", clientSecret: "secret" },
  })).toEqual({
    branchEnable: { type: "google", allowSignIn: true, allowConnectedAccounts: true },
    envCredentialLeafKeys: {
      "auth.oauth.providers.google.isShared": false,
      "auth.oauth.providers.google.clientId": "cid",
      "auth.oauth.providers.google.clientSecret": "secret",
    },
  });
});

import.meta.vitest?.test("splitOAuthProvider: omits undefined credential fields and respects enable overrides", ({ expect }) => {
  expect(splitOAuthProvider({
    id: "microsoft",
    shared: false,
    allowSignIn: false,
    allowConnectedAccounts: false,
    credentials: { clientId: "cid", clientSecret: "secret", microsoftTenantId: "tenant" },
  })).toEqual({
    branchEnable: { type: "microsoft", allowSignIn: false, allowConnectedAccounts: false },
    envCredentialLeafKeys: {
      "auth.oauth.providers.microsoft.isShared": false,
      "auth.oauth.providers.microsoft.clientId": "cid",
      "auth.oauth.providers.microsoft.clientSecret": "secret",
      "auth.oauth.providers.microsoft.microsoftTenantId": "tenant",
    },
  });
});
