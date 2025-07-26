export type ProjectConfig = {
  readonly signUpEnabled: boolean,
  readonly credentialEnabled: boolean,
  readonly magicLinkEnabled: boolean,
  readonly passkeyEnabled: boolean,
  readonly clientTeamCreationEnabled: boolean,
  readonly clientUserDeletionEnabled: boolean,
  readonly oauthProviders: OAuthProviderConfig[],
  readonly allowUserApiKeys: boolean,
  readonly allowTeamApiKeys: boolean,
};

export type OAuthProviderConfig = {
  readonly id: string,
};
