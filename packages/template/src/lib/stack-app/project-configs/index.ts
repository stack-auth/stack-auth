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
  readonly emailTheme: 'default-light' | 'default-dark',
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
    isShared: false,
    senderName: string,
    senderEmail: string,
    host: string,
    port: number,
    username: string,
    password: string,
  }
  | {
    isShared: true,
  }
);

export type AdminDomainConfig = {
  domain: string,
  handlerPath: string,
};

export type AdminOAuthProviderConfig = {
  readonly type: string,
} & (
  | {
    readonly isShared: true,
  }
  | {
    readonly isShared: false,
    readonly clientId: string,
    readonly clientSecret: string,
    readonly facebookConfigId?: string,
    readonly microsoftTenantId?: string,
  }
);

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
  emailTheme?: 'default-light' | 'default-dark',
  teamCreatorDefaultPermissions?: { id: string }[],
  teamMemberDefaultPermissions?: { id: string }[],
  userDefaultPermissions?: { id: string }[],
  oauthAccountMergeStrategy?: 'link_method' | 'raise_error' | 'allow_duplicates',
  allowUserApiKeys?: boolean,
  allowTeamApiKeys?: boolean,
};
