import { ProductionModeError } from "@stackframe/stack-shared/dist/helpers/production-mode";
import { AdminUserProjectsCrud, ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";

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
  readonly userCount: number,
  readonly isProductionMode: boolean,
  readonly config: AdminProjectConfig,

  update(this: AdminProject, update: AdminProjectUpdateOptions): Promise<void>,
  delete(this: AdminProject): Promise<void>,

  getProductionModeErrors(this: AdminProject): Promise<ProductionModeError[]>,
  useProductionModeErrors(this: AdminProject): ProductionModeError[],
} & Project;

export type AdminOwnedProject = {
  readonly app: StackAdminApp<false>,
} & AdminProject;

export type AdminProjectUpdateOptions = {
  displayName?: string,
  description?: string,
  isProductionMode?: boolean,
  config?: AdminProjectConfigUpdateOptions,
};
export function adminProjectUpdateOptionsToCrud(options: AdminProjectUpdateOptions): ProjectsCrud["Admin"]["Update"] {
  return {
    display_name: options.displayName,
    description: options.description,
    is_production_mode: options.isProductionMode,
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
};
export function adminProjectCreateOptionsToCrud(options: AdminProjectCreateOptions): AdminUserProjectsCrud["Server"]["Create"] {
  return {
    ...adminProjectUpdateOptionsToCrud(options),
    display_name: options.displayName,
  };
}
