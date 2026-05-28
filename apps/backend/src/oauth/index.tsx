import { DEFAULT_BRANCH_ID, Tenancy } from "@/lib/tenancies";
import { DiscordProvider } from "@/oauth/providers/discord";
import OAuth2Server from "@node-oauth/oauth2-server";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { HexclaveAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { OAuthModel } from "./model";
import { AppleProvider } from "./providers/apple";
import { OAuthBaseProvider } from "./providers/base";
import { BitbucketProvider } from "./providers/bitbucket";
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

type GetProviderOptions = {
  // Host-derived API URL — gets stamped into the OAuth provider's
  // `redirect_uri` (the URL sent to Google/GitHub/etc. and registered in their
  // app config). See `request-api-url.ts`. Pass `getApiUrlForRequest(fullReq)`
  // from a route handler. Customers whose providers were registered against
  // `api.stack-auth.com` will continue to have authorize calls send that exact
  // URL; customers on `api.hexclave.com` will see the hexclave-branded URL.
  apiUrl: string,
};

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

export async function getProvider(
  provider: Tenancy['config']['auth']['oauth']['providers'][string],
  options: GetProviderOptions,
): Promise<OAuthBaseProvider> {
  const { apiUrl } = options;
  const providerType = provider.type || throwErr("Provider type is required for shared providers");
  if (provider.isShared) {
    const clientId = _getEnvForProvider(providerType).clientId;
    const clientSecret = _getEnvForProvider(providerType).clientSecret;
    if (clientId === "MOCK") {
      if (clientSecret !== "MOCK") {
        throw new HexclaveAssertionError("If OAuth provider client ID is set to MOCK, then client secret must also be set to MOCK");
      }
      return await mockProvider.create(providerType, { apiUrl });
    } else {
      return await _providers[providerType].create({
        clientId,
        clientSecret,
        apiUrl,
      });
    }
  } else {
    return await _providers[providerType].create({
      clientId: provider.clientId || throwErr("Client ID is required for standard providers"),
      clientSecret: provider.clientSecret || throwErr("Client secret is required for standard providers"),
      facebookConfigId: provider.facebookConfigId,
      microsoftTenantId: provider.microsoftTenantId,
      apiUrl,
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
