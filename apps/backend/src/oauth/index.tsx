import { DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { DiscordProvider } from "@/oauth/providers/discord";
import OAuth2Server from "@node-oauth/oauth2-server";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
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
import { XProvider } from "./providers/x";
import { TwitchProvider } from "./providers/twitch";

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

export async function getProvider(provider: ProjectsCrud['Admin']['Read']['config']['oauth_providers'][number]): Promise<OAuthBaseProvider> {
  if (provider.type === 'shared') {
    const clientId = _getEnvForProvider(provider.id).clientId;
    const clientSecret = _getEnvForProvider(provider.id).clientSecret;
    if (clientId === "MOCK") {
      if (clientSecret !== "MOCK") {
        throw new StackAssertionError("If OAuth provider client ID is set to MOCK, then client secret must also be set to MOCK");
      }
      return await mockProvider.create(provider.id);
    } else {
      return await _providers[provider.id].create({
        clientId,
        clientSecret,
      });
    }
  } else {
    return await _providers[provider.id].create({
      clientId: provider.client_id || throwErr("Client ID is required for standard providers"),
      clientSecret: provider.client_secret || throwErr("Client secret is required for standard providers"),
      facebookConfigId: provider.facebook_config_id,
      microsoftTenantId: provider.microsoft_tenant_id,
    });
  }
}

export const oauthServer = new OAuth2Server({
  model: new OAuthModel(),
  allowExtendedTokenAttributes: true,
});
