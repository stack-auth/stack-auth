import { Tenancy } from "@/lib/tenancies";
import { NormalizationError, getInvalidConfigReason, normalize, override } from "@stackframe/stack-shared/dist/config/format/index";
import { BranchConfigOverride, BranchIncompleteConfig, BranchRenderedConfig, EnvironmentConfigOverride, EnvironmentIncompleteConfig, EnvironmentRenderedConfig, OrganizationConfigOverride, OrganizationIncompleteConfig, OrganizationRenderedConfig, ProjectConfigOverride, ProjectIncompleteConfig, ProjectRenderedConfig, baseConfig, branchConfigSchema, environmentConfigSchema, organizationConfigSchema, projectConfigSchema } from "@stackframe/stack-shared/dist/config/schema";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined, pick, typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { stringCompare, typedToLowercase } from "@stackframe/stack-shared/dist/utils/strings";
import { base64url } from "jose";
import * as yup from "yup";
import { getPermissionDefinitionsFromProjectConfig, permissionDefinitionJsonFromDbType, teamPermissionDefinitionJsonFromTeamSystemDbType } from "./permissions";
import { DBProject } from "./projects";

type Project = ProjectsCrud["Admin"]["Read"];


// ---------------------------------------------------------------------------------------------------------------------
// getRendered<$$$>Config
// ---------------------------------------------------------------------------------------------------------------------

export async function getRenderedProjectConfig(project: Project): Promise<ProjectRenderedConfig> {
  // returns the same object as the incomplete config, although with a restricted type so we don't accidentally use the
  // fields that may still be overridden by other layers
  // see packages/stack-shared/src/config/README.md for more details
  // TODO actually strip the fields that are not part of the type
  return await getIncompleteProjectConfig(project);
}

export async function getRenderedBranchConfig(project: Project, branchId: string): Promise<BranchRenderedConfig> {
  // returns the same object as the incomplete config, although with a restricted type so we don't accidentally use the
  // fields that may still be overridden by other layers
  // see packages/stack-shared/src/config/README.md for more details
  // TODO actually strip the fields that are not part of the type
  return await getIncompleteBranchConfig(project, branchId);
}

export async function getRenderedEnvironmentConfig(project: Project, branchId: string): Promise<EnvironmentRenderedConfig> {
  // returns the same object as the incomplete config, although with a restricted type so we don't accidentally use the
  // fields that may still be overridden by other layers
  // see packages/stack-shared/src/config/README.md for more details
  // TODO actually strip the fields that are not part of the type
  return await getIncompleteEnvironmentConfig(project, branchId);
}

export async function getRenderedOrganizationConfig(tenancy: Tenancy): Promise<OrganizationRenderedConfig> {
  // returns the same object as the incomplete config, although with a restricted type so we don't accidentally use the
  // fields that may still be overridden by other layers
  // see packages/stack-shared/src/config/README.md for more details
  // TODO actually strip the fields that are not part of the type
  return await getIncompleteOrganizationConfig(tenancy);
}


// ---------------------------------------------------------------------------------------------------------------------
// validate<$$$>ConfigOverride
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Validates a project config override, based on the base config.
 */
export async function validateProjectConfigOverride(projectConfigOverride: ProjectConfigOverride): Promise<Result<null, string>> {
  return await validateAndReturn(projectConfigSchema, baseConfig, projectConfigOverride);
}

/**
 * Validates a branch config override, based on the given project's rendered project config.
 */
export async function validateBranchConfigOverride(project: Project, branchConfigOverride: BranchConfigOverride): Promise<Result<null, string>> {
  return await validateAndReturn(branchConfigSchema, await getIncompleteProjectConfig(project), branchConfigOverride);
}

/**
 * Validates an environment config override, based on the given branch's rendered branch config.
 */
export async function validateEnvironmentConfigOverride(project: Project, branchId: string, environmentConfigOverride: EnvironmentConfigOverride): Promise<Result<null, string>> {
  return await validateAndReturn(environmentConfigSchema, await getIncompleteBranchConfig(project, branchId), environmentConfigOverride);
}

/**
 * Validates an organization config override, based on the given environment's rendered environment config.
 */
export async function validateOrganizationConfigOverride(project: Project, branchId: string, organizationConfigOverride: OrganizationConfigOverride): Promise<Result<null, string>> {
  return await validateAndReturn(organizationConfigSchema, await getIncompleteEnvironmentConfig(project, branchId), organizationConfigOverride);
}


// ---------------------------------------------------------------------------------------------------------------------
// get<$$$>ConfigOverride
// ---------------------------------------------------------------------------------------------------------------------

export async function getProjectConfigOverride(project: Project): Promise<ProjectConfigOverride> {
  // fetch project config from our own DB
  return {
    sourceOfTruthDbConnectionString: '123',
  };
}

export async function getBranchConfigOverride(project: Project, branchId: string): Promise<BranchConfigOverride> {
  // fetch branch config from GitHub
  // (currently it's just empty)
  return {};
}

export async function getEnvironmentConfigOverride(project: Project, branchId: string): Promise<EnvironmentConfigOverride> {
  // fetch environment config from DB (either our own, or the source of truth one)
  if (branchId !== 'main') {
    throw new Error('Not implemented');
  }

  const config = project.config;
  console.log(config.domains);
  return {
    createTeamOnSignUp: config.create_team_on_sign_up,
    allowLocalhost: config.allow_localhost,
    clientTeamCreationEnabled: config.client_team_creation_enabled,
    clientUserDeletionEnabled: config.client_user_deletion_enabled,
    signUpEnabled: config.sign_up_enabled,
    oauthAccountMergeStrategy: config.oauth_account_merge_strategy,
    authMethods: {},
    connectedAccounts: {},
    oauthProviders: config.oauth_providers.map(provider => ({
      id: provider.id,
      type: provider.id,
      isShared: provider.type === 'shared',
      clientId: provider.client_id,
      clientSecret: provider.client_secret,
      facebookConfigId: provider.facebook_config_id,
      microsoftTenantId: provider.microsoft_tenant_id,
    })).reduce((acc, provider) => {
      (acc as any)[provider.id] = provider;
      return acc;
    }, {}),
    emailConfig: config.email_config.type === 'shared' ? {
      isShared: true,
    } : {
      isShared: false,
      host: config.email_config.host || throwErr('email_config.host is required'),
      port: config.email_config.port || throwErr('email_config.port is required'),
      username: config.email_config.username || throwErr('email_config.username is required'),
      password: config.email_config.password || throwErr('email_config.password is required'),
      senderName: config.email_config.sender_name || throwErr('email_config.sender_name is required'),
      senderEmail: config.email_config.sender_email || throwErr('email_config.sender_email is required'),
    },
    domains: config.domains.map(domain => ({
      domain: domain.domain,
      handle: domain.handler_path,
    })).reduce((acc, domain) => {
      (acc as any)[domain.domain] = domain;
      return acc;
    }, {}),
    permissionDefinitions: {},
    teamCreateDefaultSystemPermissions: config.team_creator_default_permissions.map(permission => ({
      id: permission.id,
    })).reduce((acc, permission) => {
      (acc as any)[permission.id] = permission;
      return acc;
    }, {}),
    teamCreateDefaultUserPermissions: config.team_creator_default_permissions.map(permission => ({
      id: permission.id,
    })),
  };
}

export async function getOrganizationConfigOverride(tenancy: Tenancy): Promise<OrganizationConfigOverride> {
  // fetch organization config from DB (either our own, or the source of truth one)
  throw new Error('Not implemented');
}


// ---------------------------------------------------------------------------------------------------------------------
// set<$$$>ConfigOverride
// ---------------------------------------------------------------------------------------------------------------------

export async function setProjectConfigOverride(project: Project, projectConfigOverride: ProjectConfigOverride): Promise<void> {
  // set project config override on our own DB
  throw new Error('Not implemented');
}

export function setBranchConfigOverride(project: Project, branchId: string, branchConfigOverride: BranchConfigOverride): Promise<void> {
  // update config.json if on local emulator
  // throw error otherwise
  throw new Error('Not implemented');
}

export function setEnvironmentConfigOverride(project: Project, branchId: string, environmentConfigOverride: EnvironmentConfigOverride): Promise<void> {
  // save environment config override on DB (either our own, or the source of truth one)
  throw new Error('Not implemented');
}

export function setOrganizationConfigOverride(tenancy: Tenancy, organizationConfigOverride: OrganizationConfigOverride): Promise<void> {
  // save organization config override on DB (either our own, or the source of truth one)
  throw new Error('Not implemented');
}


// ---------------------------------------------------------------------------------------------------------------------
// internal functions
// ---------------------------------------------------------------------------------------------------------------------

async function getIncompleteProjectConfig(project: Project): Promise<ProjectIncompleteConfig> {
  return normalize(override(baseConfig, await getProjectConfigOverride(project)), { onDotIntoNull: "ignore" });
}

async function getIncompleteBranchConfig(project: Project, branchId: string): Promise<BranchIncompleteConfig> {
  return normalize(override(await getIncompleteProjectConfig(project), await getBranchConfigOverride(project, branchId)), { onDotIntoNull: "ignore" }) as any;
}

async function getIncompleteEnvironmentConfig(project: Project, branchId: string): Promise<EnvironmentIncompleteConfig> {
  return normalize(override(await getIncompleteBranchConfig(project, branchId), await getEnvironmentConfigOverride(project, branchId)), { onDotIntoNull: "ignore" }) as any;
}

async function getIncompleteOrganizationConfig(tenancy: Tenancy): Promise<OrganizationIncompleteConfig> {
  return normalize(override(await getIncompleteEnvironmentConfig(tenancy.project, tenancy.branchId), await getOrganizationConfigOverride(tenancy)), { onDotIntoNull: "ignore" }) as any;
}

async function validateAndReturn(schema: yup.ObjectSchema<any>, base: any, configOverride: any): Promise<Result<null, string>> {
  const reason = getInvalidConfigReason(configOverride, { configName: 'override' });
  if (reason) return Result.error(reason);
  const value = override(pick(base, Object.keys(schema.fields)), configOverride);
  let normalizedValue;
  try {
    normalizedValue = normalize(value);
  } catch (error) {
    if (error instanceof NormalizationError) {
      return Result.error(error.message);
    }
    throw error;
  }
  try {
    await schema.validate(normalizedValue, {
      strict: true,
      context: {
        noUnknownPathPrefixes: [''],
      },
    });
    return Result.ok(null);
  } catch (error) {
    if (error instanceof yup.ValidationError) {
      return Result.error(error.message);
    }
    throw error;
  }
}

import.meta.vitest?.test('validateAndReturn(...)', async ({ expect }) => {
  const schema1 = yupObject({
    a: yupString().optional(),
  });

  expect(await validateAndReturn(schema1, {}, {})).toEqual(Result.ok(null));
  expect(await validateAndReturn(schema1, { a: 'b' }, {})).toEqual(Result.ok(null));
  expect(await validateAndReturn(schema1, {}, { a: 'b' })).toEqual(Result.ok(null));
  expect(await validateAndReturn(schema1, { a: 'b' }, { a: 'c' })).toEqual(Result.ok(null));
  expect(await validateAndReturn(schema1, {}, { a: null })).toEqual(Result.ok(null));
  expect(await validateAndReturn(schema1, { a: 'b' }, { a: null })).toEqual(Result.ok(null));

  expect(await validateAndReturn(yupObject({}), { a: 'b' }, { "a.b": "c" })).toEqual(Result.error(`Tried to use dot notation to access "a.b", but "a" doesn't exist on the object (or is null). Maybe this config is not normalizable?`));
});

// ---------------------------------------------------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------------------------------------------------

/*
A: AdminProjectCrudRead
U: AdminProjectCrudUpdate
D: DB legacy config
C: config override

Get project
- old: D -> A
- new: D -> C -> A
        ---- ----
Update project
- old: U -> D
- new: U -> C -> U -> D
        ---- ----
*/


// D -> C
export const dbProjectToRenderedEnvironmentConfig = (dbProject: DBProject): EnvironmentRenderedConfig => {
  const config = dbProject.config;

  return {
    allowLocalhost: config.allowLocalhost,
    clientTeamCreationEnabled: config.clientTeamCreationEnabled,
    clientUserDeletionEnabled: config.clientUserDeletionEnabled,
    signUpEnabled: config.signUpEnabled,
    oauthAccountMergeStrategy: typedToLowercase(config.oauthAccountMergeStrategy),
    createTeamOnSignUp: config.createTeamOnSignUp,
    isProductionMode: dbProject.isProductionMode,

    authMethods: config.authMethodConfigs.map((authMethod): NonNullable<EnvironmentRenderedConfig['authMethods']>[string] => {
      const baseAuthMethod = {
        id: authMethod.id,
        enabled: authMethod.enabled,
      };

      if (authMethod.oauthProviderConfig) {
        const oauthConfig = authMethod.oauthProviderConfig.proxiedOAuthConfig || authMethod.oauthProviderConfig.standardOAuthConfig;
        if (!oauthConfig) {
          throw new StackAssertionError('Either ProxiedOAuthConfig or StandardOAuthConfig must be set on authMethodConfigs.oauthProviderConfig', { authMethod });
        }
        return {
          ...baseAuthMethod,
          type: 'oauth',
          oauthProviderId: oauthConfig.id,
        } as const;
      } else if (authMethod.passwordConfig) {
        return {
          ...baseAuthMethod,
          type: 'password',
        } as const;
      } else if (authMethod.otpConfig) {
        return {
          ...baseAuthMethod,
          type: 'otp',
        } as const;
      } else if (authMethod.passkeyConfig) {
        return {
          ...baseAuthMethod,
          type: 'passkey',
        } as const;
      } else {
        throw new StackAssertionError('Unknown auth method config', { authMethod });
      }
    }).reduce((acc, authMethod) => {
      (acc as any)[authMethod.id] = authMethod;
      return acc;
    }, {}),

    oauthProviders: config.oauthProviderConfigs.map(provider => {
      if (provider.proxiedOAuthConfig) {
        return ({
          id: provider.id,
          type: typedToLowercase(provider.proxiedOAuthConfig.type),
          isShared: true,
        } as const) satisfies EnvironmentRenderedConfig['oauthProviders'][string];
      } else if (provider.standardOAuthConfig) {
        return filterUndefined({
          id: provider.id,
          type: typedToLowercase(provider.standardOAuthConfig.type),
          isShared: false,
          clientId: provider.standardOAuthConfig.clientId,
          clientSecret: provider.standardOAuthConfig.clientSecret,
          facebookConfigId: provider.standardOAuthConfig.facebookConfigId ?? undefined,
          microsoftTenantId: provider.standardOAuthConfig.microsoftTenantId ?? undefined,
        } as const) satisfies EnvironmentRenderedConfig['oauthProviders'][string];
      } else {
        throw new StackAssertionError('Unknown oauth provider config', { provider });
      }
    }).reduce((acc, provider) => {
      (acc as any)[provider.id] = provider;
      return acc;
    }, {}),

    connectedAccounts: config.connectedAccountConfigs.map(account => ({
      id: account.id,
      enabled: account.enabled,
      oauthProviderId: account.oauthProviderConfig?.id || throwErr('oauthProviderConfig.id is required'),
    } satisfies EnvironmentRenderedConfig['connectedAccounts'][string])).reduce((acc, account) => {
      (acc as any)[account.id] = account;
      return acc;
    }, {}),

    domains: config.domains.map(domain => ({
      domain: domain.domain,
      handlerPath: domain.handlerPath,
    } satisfies EnvironmentRenderedConfig['domains'][string])).reduce((acc, domain) => {
      (acc as any)[base64url.encode(domain.domain)] = domain;
      return acc;
    }, {}),

    emailConfig: ((): EnvironmentRenderedConfig['emailConfig'] => {
      if (config.emailServiceConfig?.standardEmailServiceConfig) {
        return {
          isShared: false,
          host: config.emailServiceConfig.standardEmailServiceConfig.host,
          port: config.emailServiceConfig.standardEmailServiceConfig.port,
          username: config.emailServiceConfig.standardEmailServiceConfig.username,
          password: config.emailServiceConfig.standardEmailServiceConfig.password,
          senderName: config.emailServiceConfig.standardEmailServiceConfig.senderName,
          senderEmail: config.emailServiceConfig.standardEmailServiceConfig.senderEmail,
        } as const;
      } else if (config.emailServiceConfig?.proxiedEmailServiceConfig) {
        return {
          isShared: true,
        } as const;
      } else {
        throw new StackAssertionError('Unknown email service config', { config });
      }
    })(),

    teamCreateDefaultPermissions: config.permissions.filter(perm => perm.isDefaultTeamCreatorPermission)
      .map(permissionDefinitionJsonFromDbType)
      .concat(config.teamCreateDefaultSystemPermissions.map(db => teamPermissionDefinitionJsonFromTeamSystemDbType(db, config)))
      .reduce((acc, perm) => {
        (acc as any)[perm.id] = { id: perm.id };
        return acc;
      }, {}),

    teamMemberDefaultPermissions: config.permissions.filter(perm => perm.isDefaultTeamMemberPermission)
      .map(permissionDefinitionJsonFromDbType)
      .concat(config.teamMemberDefaultSystemPermissions.map(db => teamPermissionDefinitionJsonFromTeamSystemDbType(db, config)))
      .reduce((acc, perm) => {
        (acc as any)[perm.id] = { id: perm.id };
        return acc;
      }, {}),

    teamPermissionDefinitions: getPermissionDefinitionsFromProjectConfig(config, 'TEAM').reduce((acc, perm) => {
      (acc as any)[perm.id] = {
        id: perm.id,
        description: perm.description,
        containedPermissions: perm.contained_permission_ids.reduce((acc, id) => {
          (acc as any)[id] = { id };
          return acc;
        }, {}),
      } satisfies EnvironmentRenderedConfig['teamPermissionDefinitions'][string];
      return acc;
    }, {}),

    userDefaultPermissions: config.permissions.filter(perm => perm.isDefaultUserPermission)
      .map(permissionDefinitionJsonFromDbType)
      .reduce((acc, perm) => {
        (acc as any)[perm.id] = { id: perm.id };
        return acc;
      }, {}),
  };
};

// C -> A
export const renderedEnvironmentConfigToProjectCrud = (renderedConfig: EnvironmentRenderedConfig, configId: string): ProjectsCrud["Admin"]["Read"]['config'] => {
  const oauthProviders = typedEntries(renderedConfig.authMethods)
    .filter(([_, authMethod]) => authMethod.type === 'oauth')
    .map(([_, authMethod]) => {
      if (authMethod.type !== 'oauth') {
        throw new StackAssertionError('Expected oauth provider', { authMethod });
      }
      const oauthProvider = renderedConfig.oauthProviders[authMethod.oauthProviderId];

      return filterUndefined({
        id: oauthProvider.type,
        enabled: authMethod.enabled,
        type: oauthProvider.isShared ? 'shared' : 'standard',
        client_id: oauthProvider.clientId,
        client_secret: oauthProvider.clientSecret,
        facebook_config_id: oauthProvider.facebookConfigId,
        microsoft_tenant_id: oauthProvider.microsoftTenantId,
      } as const) satisfies ProjectsCrud["Admin"]["Read"]['config']['oauth_providers'][number];
    })
    .sort((a, b) => stringCompare(a.id, b.id));

  return {
    id: configId,
    allow_localhost: renderedConfig.allowLocalhost,
    client_team_creation_enabled: renderedConfig.clientTeamCreationEnabled,
    client_user_deletion_enabled: renderedConfig.clientUserDeletionEnabled,
    sign_up_enabled: renderedConfig.signUpEnabled,
    oauth_account_merge_strategy: renderedConfig.oauthAccountMergeStrategy,
    create_team_on_sign_up: renderedConfig.createTeamOnSignUp,
    credential_enabled: typedEntries(renderedConfig.authMethods).filter(([_, authMethod]) => authMethod.enabled && authMethod.type === 'password').length > 0,
    magic_link_enabled: typedEntries(renderedConfig.authMethods).filter(([_, authMethod]) => authMethod.enabled && authMethod.type === 'otp').length > 0,
    passkey_enabled: typedEntries(renderedConfig.authMethods).filter(([_, authMethod]) => authMethod.enabled && authMethod.type === 'passkey').length > 0,

    oauth_providers: oauthProviders,
    enabled_oauth_providers: oauthProviders.filter(provider => provider.enabled),

    domains: typedEntries(renderedConfig.domains)
      .map(([_, domainConfig]) => ({
        domain: domainConfig.domain,
        handler_path: domainConfig.handlerPath,
      }))
      .sort((a, b) => stringCompare(a.domain, b.domain)),

    email_config: renderedConfig.emailConfig.isShared ? {
      type: 'shared',
    } : {
      type: 'standard',
      host: renderedConfig.emailConfig.host,
      port: renderedConfig.emailConfig.port,
      username: renderedConfig.emailConfig.username,
      password: renderedConfig.emailConfig.password,
      sender_name: renderedConfig.emailConfig.senderName,
      sender_email: renderedConfig.emailConfig.senderEmail,
    },

    team_creator_default_permissions: typedEntries(renderedConfig.teamCreateDefaultPermissions).map(([_, perm]) => ({ id: perm.id })).sort((a, b) => stringCompare(a.id, b.id)),
    team_member_default_permissions: typedEntries(renderedConfig.teamMemberDefaultPermissions).map(([_, perm]) => ({ id: perm.id })).sort((a, b) => stringCompare(a.id, b.id)),
    user_default_permissions: typedEntries(renderedConfig.userDefaultPermissions).map(([_, perm]) => ({ id: perm.id })).sort((a, b) => stringCompare(a.id, b.id)),
  };
};
