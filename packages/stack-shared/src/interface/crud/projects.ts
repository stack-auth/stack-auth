import { CrudTypeOf, createCrud } from "../../crud";
import * as schemaFields from "../../schema-fields";
import { yupArray, yupObject, yupString } from "../../schema-fields";

const teamPermissionSchema = yupObject({
  id: yupString().defined(),
}).defined();

const oauthProviderReadSchema = yupObject({
  id: schemaFields.oauthProviderIdSchema.defined(),
  type: schemaFields.oauthProviderTypeSchema.defined(),
  is_shared: schemaFields.oauthProviderIsSharedSchema.defined(),
  client_id: schemaFields.yupDefinedAndNonEmptyWhen(
    schemaFields.oauthClientIdSchema,
    { is_shared: false },
  ),
  client_secret: schemaFields.yupDefinedAndNonEmptyWhen(
    schemaFields.oauthClientSecretSchema,
    { is_shared: false },
  ),

  // extra params
  facebook_config_id: schemaFields.oauthFacebookConfigIdSchema.optional(),
  microsoft_tenant_id: schemaFields.oauthMicrosoftTenantIdSchema.optional(),
});

const oauthProviderWriteSchema = oauthProviderReadSchema.omit(['id']);

const enabledOAuthProviderSchema = yupObject({
  // This is legacy, the values are not provider IDs, but provider types like "google" or "facebook"
  // We need to keep this for backwards compatibility
  id: schemaFields.oauthLegacyIdSchema.defined(),
});

export const emailConfigSchema = yupObject({
  is_shared: schemaFields.emailIsSharedSchema.defined(),
  host: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailHostSchema, {
    is_shared: false,
  }),
  port: schemaFields.yupDefinedWhen(schemaFields.emailPortSchema, {
    is_shared: false,
  }),
  username: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailUsernameSchema, {
    is_shared: false,
  }),
  password: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailPasswordSchema, {
    is_shared: false,
  }),
  sender_name: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailSenderNameSchema, {
    is_shared: false,
  }),
  sender_email: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailSenderEmailSchema, {
    is_shared: false,
  }),
});

export const emailConfigWithoutPasswordSchema = emailConfigSchema.pick(['is_shared', 'host', 'port', 'username', 'sender_name', 'sender_email']);

const domainSchema = yupObject({
  domain: schemaFields.urlSchema.defined()
    .matches(/^https?:\/\//, 'URL must start with http:// or https://')
    .meta({ openapiField: { description: 'URL. Must start with http:// or https://', exampleValue: 'https://example.com' } }),
  handler_path: schemaFields.handlerPathSchema.defined(),
});

export const projectsCrudAdminReadSchema = yupObject({
  id: schemaFields.projectIdSchema.defined(),
  display_name: schemaFields.projectDisplayNameSchema.defined(),
  description: schemaFields.projectDescriptionSchema.nonNullable().defined(),
  created_at_millis: schemaFields.projectCreatedAtMillisSchema.defined(),
  user_count: schemaFields.projectUserCountSchema.defined(),
  is_production_mode: schemaFields.projectIsProductionModeSchema.defined(),
  /** @deprecated */
  config: yupObject({
    allow_localhost: schemaFields.projectAllowLocalhostSchema.defined(),
    sign_up_enabled: schemaFields.projectSignUpEnabledSchema.defined(),
    credential_enabled: schemaFields.projectCredentialEnabledSchema.defined(),
    magic_link_enabled: schemaFields.projectMagicLinkEnabledSchema.defined(),
    passkey_enabled: schemaFields.projectPasskeyEnabledSchema.defined(),
    // TODO: remove this
    client_team_creation_enabled: schemaFields.projectClientTeamCreationEnabledSchema.defined(),
    client_user_deletion_enabled: schemaFields.projectClientUserDeletionEnabledSchema.defined(),
    allow_user_api_keys: schemaFields.yupBoolean().defined(),
    allow_team_api_keys: schemaFields.yupBoolean().defined(),
    oauth_providers: yupArray(oauthProviderReadSchema.defined()).defined(),
    enabled_oauth_providers: yupArray(enabledOAuthProviderSchema.defined()).defined().meta({ openapiField: { hidden: true } }),
    domains: yupArray(domainSchema.defined()).defined(),
    email_config: emailConfigSchema.defined(),
    email_theme: schemaFields.emailThemeSchema.defined(),
    create_team_on_sign_up: schemaFields.projectCreateTeamOnSignUpSchema.defined(),
    team_creator_default_permissions: yupArray(teamPermissionSchema.defined()).defined(),
    team_member_default_permissions: yupArray(teamPermissionSchema.defined()).defined(),
    user_default_permissions: yupArray(teamPermissionSchema.defined()).defined(),
    oauth_account_merge_strategy: schemaFields.oauthAccountMergeStrategySchema.defined(),
  }).defined().meta({ openapiField: { hidden: true } }),
}).defined();

export const projectsCrudClientReadSchema = yupObject({
  id: schemaFields.projectIdSchema.defined(),
  display_name: schemaFields.projectDisplayNameSchema.defined(),
  config: yupObject({
    sign_up_enabled: schemaFields.projectSignUpEnabledSchema.defined(),
    credential_enabled: schemaFields.projectCredentialEnabledSchema.defined(),
    magic_link_enabled: schemaFields.projectMagicLinkEnabledSchema.defined(),
    passkey_enabled: schemaFields.projectPasskeyEnabledSchema.defined(),
    client_team_creation_enabled: schemaFields.projectClientTeamCreationEnabledSchema.defined(),
    client_user_deletion_enabled: schemaFields.projectClientUserDeletionEnabledSchema.defined(),
    allow_user_api_keys: schemaFields.yupBoolean().defined(),
    allow_team_api_keys: schemaFields.yupBoolean().defined(),
    enabled_oauth_providers: yupArray(enabledOAuthProviderSchema.defined()).defined().meta({ openapiField: { hidden: true } }),
  }).defined().meta({ openapiField: { hidden: true } }),
}).defined();


export const projectsCrudAdminUpdateSchema = yupObject({
  display_name: schemaFields.projectDisplayNameSchema.optional(),
  description: schemaFields.projectDescriptionSchema.optional(),
  is_production_mode: schemaFields.projectIsProductionModeSchema.optional(),
  config: yupObject({
    sign_up_enabled: schemaFields.projectSignUpEnabledSchema.optional(),
    credential_enabled: schemaFields.projectCredentialEnabledSchema.optional(),
    magic_link_enabled: schemaFields.projectMagicLinkEnabledSchema.optional(),
    passkey_enabled: schemaFields.projectPasskeyEnabledSchema.optional(),
    client_team_creation_enabled: schemaFields.projectClientTeamCreationEnabledSchema.optional(),
    client_user_deletion_enabled: schemaFields.projectClientUserDeletionEnabledSchema.optional(),
    allow_localhost: schemaFields.projectAllowLocalhostSchema.optional(),
    allow_user_api_keys: schemaFields.yupBoolean().optional(),
    allow_team_api_keys: schemaFields.yupBoolean().optional(),
    email_config: emailConfigSchema.optional().default(undefined),
    email_theme: schemaFields.emailThemeSchema.optional(),
    domains: yupArray(domainSchema.defined()).optional().default(undefined),
    oauth_providers: yupArray(oauthProviderWriteSchema.defined()).optional().default(undefined),
    create_team_on_sign_up: schemaFields.projectCreateTeamOnSignUpSchema.optional(),
    team_creator_default_permissions: yupArray(teamPermissionSchema.defined()).optional(),
    team_member_default_permissions: yupArray(teamPermissionSchema.defined()).optional(),
    user_default_permissions: yupArray(teamPermissionSchema.defined()).optional(),
    oauth_account_merge_strategy: schemaFields.oauthAccountMergeStrategySchema.optional(),
  }).optional().default(undefined),
}).defined();

export const projectsCrudAdminCreateSchema = projectsCrudAdminUpdateSchema.concat(yupObject({
  display_name: schemaFields.projectDisplayNameSchema.defined(),
}).defined());

export const projectsCrudAdminDeleteSchema = schemaFields.yupMixed();

export const clientProjectsCrud = createCrud({
  clientReadSchema: projectsCrudClientReadSchema,
  docs: {
    clientRead: {
      summary: 'Get the current project',
      description: 'Get the current project information including display name, OAuth providers and authentication methods. Useful for display the available login options to the user.',
      tags: ['Projects'],
    },
  },
});
export type ClientProjectsCrud = CrudTypeOf<typeof clientProjectsCrud>;

export const projectsCrud = createCrud({
  adminReadSchema: projectsCrudAdminReadSchema,
  adminUpdateSchema: projectsCrudAdminUpdateSchema,
  adminDeleteSchema: projectsCrudAdminDeleteSchema,
  docs: {
    adminRead: {
      summary: 'Get the current project',
      description: 'Get the current project information and configuration including display name, OAuth providers, email configuration, etc.',
      tags: ['Projects'],
    },
    adminUpdate: {
      summary: 'Update the current project',
      description: 'Update the current project information and configuration including display name, OAuth providers, email configuration, etc.',
      tags: ['Projects'],
    },
    adminDelete: {
      summary: 'Delete the current project',
      description: 'Delete the current project and all associated data (including users, teams, API keys, project configs, etc.). Be careful, this action is irreversible.',
      tags: ['Projects'],
    },
  },
});
export type ProjectsCrud = CrudTypeOf<typeof projectsCrud>;

export const adminUserProjectsCrud = createCrud({
  clientReadSchema: projectsCrudAdminReadSchema,
  clientCreateSchema: projectsCrudAdminCreateSchema,
  docs: {
    clientList: {
      hidden: true,
    },
    clientCreate: {
      hidden: true,
    },
  },
});
export type AdminUserProjectsCrud = CrudTypeOf<typeof adminUserProjectsCrud>;
