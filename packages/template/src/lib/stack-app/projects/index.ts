import { ProductionModeError } from "@stackframe/stack-shared/dist/helpers/production-mode";
import { AdminUserProjectsCrud, ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";

import { CompleteConfig, EnvironmentConfigNormalizedOverride, EnvironmentConfigOverrideOverride } from "@stackframe/stack-shared/dist/config/schema";
import { StackAdminApp } from "../apps/interfaces/admin-app";
import { AdminProjectConfig, AdminProjectConfigUpdateOptions, ProjectConfig } from "../project-configs";


export type Project = {
  readonly id: string,
  readonly displayName: string,
  readonly config: ProjectConfig,
};

export type AdminProject = {
  readonly id: string,
  readonly displayName: string,
  readonly description: string | null,
  readonly createdAt: Date,
  readonly isProductionMode: boolean,
  readonly ownerTeamId: string | null,
  readonly logoUrl: string | null | undefined,
  readonly logoFullUrl: string | null | undefined,
  readonly logoDarkModeUrl: string | null | undefined,
  readonly logoFullDarkModeUrl: string | null | undefined,

  readonly config: AdminProjectConfig,

  update(this: AdminProject, update: AdminProjectUpdateOptions): Promise<void>,
  delete(this: AdminProject): Promise<void>,

  getConfig(this: AdminProject): Promise<CompleteConfig>,
  // NEXT_LINE_PLATFORM react-like
  useConfig(this: AdminProject): CompleteConfig,

  // We have some strict types here in order to prevent accidental overwriting of a top-level property of a config object
  updateConfig(
    this: AdminProject,
    config: EnvironmentConfigOverrideOverride & {
      [K in keyof EnvironmentConfigNormalizedOverride]: "............................ERROR MESSAGE AFTER THIS LINE............................ You have attempted to update a config object with a top-level property in it (for example `emails`). This is very likely a mistake, and you probably meant to update a nested property instead (for example `emails.server`). If you really meant to update a top-level property (resetting all nested properties to their defaults), cast as any (the code will work at runtime) ............................ERROR MESSAGE BEFORE THIS LINE............................";
    }
  ): Promise<void>,

  getProductionModeErrors(this: AdminProject): Promise<ProductionModeError[]>,
  // NEXT_LINE_PLATFORM react-like
  useProductionModeErrors(this: AdminProject): ProductionModeError[],
} & Project;

export type AdminOwnedProject = {
  readonly app: StackAdminApp<false>,
} & AdminProject;

export type AdminProjectUpdateOptions = {
  displayName?: string,
  description?: string,
  isProductionMode?: boolean,
  logoUrl?: string | null,
  logoFullUrl?: string | null,
  logoDarkModeUrl?: string | null,
  logoFullDarkModeUrl?: string | null,
  config?: AdminProjectConfigUpdateOptions,
};
export function adminProjectUpdateOptionsToCrud(options: AdminProjectUpdateOptions): ProjectsCrud["Admin"]["Update"] {
  return {
    display_name: options.displayName,
    description: options.description,
    is_production_mode: options.isProductionMode,
    logo_url: options.logoUrl,
    logo_full_url: options.logoFullUrl,
    logo_dark_mode_url: options.logoDarkModeUrl,
    logo_full_dark_mode_url: options.logoFullDarkModeUrl,
    /**
     * NOTE: Do not update this config anymore. It's been superseded by the new config in schema.ts.
     * @deprecated
     */
    config: {
      domains: options.config?.domains?.map((d) => ({
        domain: d.domain,
        handler_path: d.handlerPath
      })),
      oauth_providers: options.config?.oauthProviders?.map((p) => ({
        id: p.id as any,
        type: p.type,
        ...(p.type === 'standard' && {
          client_id: p.clientId,
          client_secret: p.clientSecret,
          facebook_config_id: p.facebookConfigId,
          microsoft_tenant_id: p.microsoftTenantId,
        }),
      })),
      email_config: options.config?.emailConfig && (
        options.config.emailConfig.type === 'shared' ? {
          type: 'shared',
        } : {
          type: 'standard',
          host: options.config.emailConfig.host,
          port: options.config.emailConfig.port,
          username: options.config.emailConfig.username,
          password: options.config.emailConfig.password,
          sender_name: options.config.emailConfig.senderName,
          sender_email: options.config.emailConfig.senderEmail,
        }
      ),
      email_theme: options.config?.emailTheme,
      sign_up_enabled: options.config?.signUpEnabled,
      credential_enabled: options.config?.credentialEnabled,
      magic_link_enabled: options.config?.magicLinkEnabled,
      passkey_enabled: options.config?.passkeyEnabled,
      allow_localhost: options.config?.allowLocalhost,
      create_team_on_sign_up: options.config?.createTeamOnSignUp,
      client_team_creation_enabled: options.config?.clientTeamCreationEnabled,
      client_user_deletion_enabled: options.config?.clientUserDeletionEnabled,
      team_creator_default_permissions: options.config?.teamCreatorDefaultPermissions,
      team_member_default_permissions: options.config?.teamMemberDefaultPermissions,
      user_default_permissions: options.config?.userDefaultPermissions,
      oauth_account_merge_strategy: options.config?.oauthAccountMergeStrategy,
      allow_user_api_keys: options.config?.allowUserApiKeys,
      allow_team_api_keys: options.config?.allowTeamApiKeys,
    },
  };
}

export type AdminProjectCreateOptions = Omit<AdminProjectUpdateOptions, 'displayName'> & {
  displayName: string,
  teamId: string,
};
export function adminProjectCreateOptionsToCrud(options: AdminProjectCreateOptions): AdminUserProjectsCrud["Server"]["Create"] {
  return {
    ...adminProjectUpdateOptionsToCrud(options),
    display_name: options.displayName,
    owner_team_id: options.teamId,
  };
}
