import { DEFAULT_BRANCH_ID, Tenancy } from "@/lib/tenancies";
import { DiscordProvider } from "@/oauth/providers/discord";
import OAuth2Server from "@node-oauth/oauth2-server";
import { getStackAuthApiBaseUrl } from "@hexclave/shared/dist/utils/cloud-hosts";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { OAuthModel } from "./model";
import { AppleProvider } from "./providers/apple";
import { OAuthBaseProvider } from "./providers/base";
import { BitbucketProvider } from "./providers/bitbucket";
import { CustomOidcProvider } from "./providers/custom-oidc";
import { FacebookProvider } from "./providers/facebook";
import { GithubProvider } from "./providers/github";
import { GitlabProvider } from "./providers/gitlab";
import { GoogleProvider } from "./providers/google";
import { LinkedInProvider } from "./providers/linkedin";
import { MicrosoftProvider } from "./providers/microsoft";
import { MockProvider } from "./providers/mock";
import { SpotifyProvider } from "./providers/spotify";
import { TwitchProvider } from "./providers/twitch";
import { XProvider } from "./providers/x";

const _providers = {
  github: GithubProvider,
  google: GoogleProvider,
  facebook: FacebookProvider,
  microsoft: MicrosoftProvider,
  spotify: SpotifyProvider,
  discord: DiscordProvider,
  gitlab: GitlabProvider,
  apple: AppleProvider,
  bitbucket: BitbucketProvider,
  linkedin: LinkedInProvider,
  x: XProvider,
  twitch: TwitchProvider,
} as const;

const mockProvider = MockProvider;

const _getEnvForProvider = (provider: keyof typeof _providers) => {
  return {
    clientId: getEnvVariable(`STACK_${provider.toUpperCase()}_CLIENT_ID`),
    clientSecret: getEnvVariable(`STACK_${provider.toUpperCase()}_CLIENT_SECRET`),
  };
};

export function getProjectBranchFromClientId(clientId: string): [projectId: string, branchId: string] {
  const hashIndex = clientId.indexOf("#");
  let projectId: string;
  let branchId: string;
  if (hashIndex === -1) {
    projectId = clientId;
    branchId = DEFAULT_BRANCH_ID;
  } else {
    projectId = clientId.slice(0, hashIndex);
    branchId = clientId.slice(hashIndex + 1);
  }
  return [projectId, branchId];
}

// Resolves the OAuth `redirect_uri` we send to the provider (Google/GitHub/...)
// and that the customer registers in their provider app config.
//
//   - shared providers              -> always the stack-auth-branded callback,
//                                       so Stack's shared OAuth apps keep working
//   - custom + `customCallbackUrl`  -> the configured URL verbatim (new custom
//                                       providers get a hexclave-branded URL)
//   - custom without it (legacy)    -> the stack-auth-branded callback, so
//                                       providers registered before this field
//                                       are unaffected
//
// `deploymentApiUrl` is this deployment's `NEXT_PUBLIC_STACK_API_URL`. The
// stack-auth brand is derived from it (mapping cloud siblings), falling back to
// it unchanged for self-hosted / localhost. This intentionally no longer depends
// on the request host header.
function getRedirectUri(
  provider: Tenancy['config']['auth']['oauth']['providers'][string],
  providerType: string,
  deploymentApiUrl: string,
): string {
  if (!provider.isShared && provider.customCallbackUrl) {
    return provider.customCallbackUrl;
  }
  const stackAuthBaseUrl = getStackAuthApiBaseUrl(deploymentApiUrl);
  return `${stackAuthBaseUrl}/api/v1/auth/oauth/callback/${providerType}`;
}

import.meta.vitest?.test("getRedirectUri keeps existing customers on the stack-auth callback", ({ expect }) => {
  const legacyCustom = { type: "github", isShared: false, customCallbackUrl: undefined } as any;
  const sharedProvider = { type: "github", isShared: true } as any;
  const newCustom = { type: "github", isShared: false, customCallbackUrl: "https://api.hexclave.com/api/v1/auth/oauth/callback/github" } as any;

  // On a hexclave-branded deployment, existing customers (legacy custom + shared)
  // still get the stack-auth callback they registered — unchanged by the rebrand.
  expect(getRedirectUri(legacyCustom, "github", "https://api.hexclave.com")).toBe("https://api.stack-auth.com/api/v1/auth/oauth/callback/github");
  expect(getRedirectUri(sharedProvider, "github", "https://api.hexclave.com")).toBe("https://api.stack-auth.com/api/v1/auth/oauth/callback/github");
  // Only providers that explicitly set customCallbackUrl get the new brand.
  expect(getRedirectUri(newCustom, "github", "https://api.hexclave.com")).toBe("https://api.hexclave.com/api/v1/auth/oauth/callback/github");

  // On a stack-auth-branded deployment, unchanged too.
  expect(getRedirectUri(legacyCustom, "github", "https://api.stack-auth.com")).toBe("https://api.stack-auth.com/api/v1/auth/oauth/callback/github");

  // Self-host / localhost (not a cloud sibling): falls back to the deployment URL.
  expect(getRedirectUri(legacyCustom, "github", "http://localhost:8102")).toBe("http://localhost:8102/api/v1/auth/oauth/callback/github");
});

export async function getProvider(
  provider: Tenancy['config']['auth']['oauth']['providers'][string],
  /** The config key for this provider (e.g. "github", "my-okta"). Needed to
   *  build the callback URL when customCallbackUrl is absent. */
  configId?: string,
): Promise<OAuthBaseProvider> {
  const providerType = provider.type || throwErr("Provider type is required for shared providers");

  // Custom OIDC providers use a generic OIDC implementation with discovery.
  // The callback URL is keyed by the user-chosen config ID (not "custom_oidc"),
  // so customCallbackUrl should always be set for these providers.
  if (providerType === "custom_oidc") {
    const issuerUrl = provider.issuerUrl ?? throwErr("Issuer URL is required for custom OIDC providers");
    const redirectUri = getRedirectUri(provider, configId ?? providerType, getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
    return await CustomOidcProvider.create({
      clientId: provider.clientId ?? throwErr("Client ID is required for custom OIDC providers"),
      clientSecret: provider.clientSecret ?? throwErr("Client secret is required for custom OIDC providers"),
      redirectUri,
      issuerUrl,
      scope: provider.scope,
    });
  }

  const redirectUri = getRedirectUri(provider, providerType, getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
  if (provider.isShared) {
    const clientId = _getEnvForProvider(providerType).clientId;
    const clientSecret = _getEnvForProvider(providerType).clientSecret;
    if (clientId === "MOCK") {
      if (clientSecret !== "MOCK") {
        throw new HexclaveAssertionError("If OAuth provider client ID is set to MOCK, then client secret must also be set to MOCK");
      }
      return await mockProvider.create(providerType, { redirectUri });
    } else {
      return await _providers[providerType].create({
        clientId,
        clientSecret,
        redirectUri,
      });
    }
  } else {
    return await _providers[providerType].create({
      clientId: provider.clientId || throwErr("Client ID is required for standard providers"),
      clientSecret: provider.clientSecret || throwErr("Client secret is required for standard providers"),
      facebookConfigId: provider.facebookConfigId,
      microsoftTenantId: provider.microsoftTenantId,
      redirectUri,
    });
  }
}

// Built per-request because OAuthModel carries an apiUrl that determines the
// `iss` claim on tokens minted via the OAuth2 token-exchange path. Calling
// this once per request is cheap (the library does no expensive setup).
export function createOAuthServer(options: { apiUrl: string }) {
  return new OAuth2Server({
    model: new OAuthModel(options.apiUrl),
    allowExtendedTokenAttributes: true,
  });
}
