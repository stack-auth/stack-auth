import { AdminTeamPermission } from "../permissions";


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

export type AdminProjectConfig = {
  readonly signUpEnabled: boolean,
  readonly credentialEnabled: boolean,
  readonly magicLinkEnabled: boolean,
  readonly passkeyEnabled: boolean,
  readonly clientTeamCreationEnabled: boolean,
  readonly clientUserDeletionEnabled: boolean,
  readonly allowLocalhost: boolean,
  readonly oauthProviders: AdminOAuthProviderConfig[],
  readonly emailConfig?: AdminEmailConfig,
  readonly domains: AdminDomainConfig[],
  readonly createTeamOnSignUp: boolean,
  readonly teamCreatorDefaultPermissions: AdminTeamPermission[],
  readonly teamMemberDefaultPermissions: AdminTeamPermission[],
  readonly userDefaultPermissions: AdminTeamPermission[],
  readonly oauthAccountMergeStrategy: 'link_method' | 'raise_error' | 'allow_duplicates',
  readonly allowUserApiKeys: boolean,
  readonly allowTeamApiKeys: boolean,
};

export type AdminEmailConfig = (
  {
    type: "standard",
    senderName: string,
    senderEmail: string,
    host: string,
    port: number,
    username: string,
    password: string,
  }
  | {
    type: "shared",
  }
);

export type AdminDomainConfig = {
  domain: string,
  handlerPath: string,
};

export type AdminOAuthProviderConfig = {
  id: string,
} & (
  | { type: 'shared' }
  | {
    type: 'standard',
    clientId: string,
    clientSecret: string,
    facebookConfigId?: string,
    microsoftTenantId?: string,
  }
) & OAuthProviderConfig;

export type AdminProjectConfigUpdateOptions = {
  domains?: {
    domain: string,
    handlerPath: string,
  }[],
  oauthProviders?: AdminOAuthProviderConfig[],
  signUpEnabled?: boolean,
  credentialEnabled?: boolean,
  magicLinkEnabled?: boolean,
  passkeyEnabled?: boolean,
  clientTeamCreationEnabled?: boolean,
  clientUserDeletionEnabled?: boolean,
  allowLocalhost?: boolean,
  createTeamOnSignUp?: boolean,
  emailConfig?: AdminEmailConfig,
  teamCreatorDefaultPermissions?: { id: string }[],
  teamMemberDefaultPermissions?: { id: string }[],
  userDefaultPermissions?: { id: string }[],
  oauthAccountMergeStrategy?: 'link_method' | 'raise_error' | 'allow_duplicates',
  allowUserApiKeys?: boolean,
  allowTeamApiKeys?: boolean,
};
