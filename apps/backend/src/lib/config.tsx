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

// These are placeholder types that should be replaced after the config json db migration
type ProjectDB = DBProject;
type BranchDB = { id: string };
type EnvironmentDB = {};
type OrganizationDB = { id: string | null };

type projectOptions = { project: ProjectDB };
type branchOptions = projectOptions & { branch: BranchDB };
type environmentOptions = branchOptions & { environment: EnvironmentDB };
type organizationOptions = environmentOptions & { organization: OrganizationDB };

// ---------------------------------------------------------------------------------------------------------------------
// getRendered<$$$>Config
// ---------------------------------------------------------------------------------------------------------------------

export async function getRenderedProjectConfig(options: projectOptions): Promise<ProjectRenderedConfig> {
  // returns the same object as the incomplete config, although with a restricted type so we don't accidentally use the
  // fields that may still be overridden by other layers
  // see packages/stack-shared/src/config/README.md for more details
  // TODO actually strip the fields that are not part of the type
  return await getIncompleteProjectConfig(options);
}

export async function getRenderedBranchConfig(options: branchOptions): Promise<BranchRenderedConfig> {
  // returns the same object as the incomplete config, although with a restricted type so we don't accidentally use the
  // fields that may still be overridden by other layers
  // see packages/stack-shared/src/config/README.md for more details
  // TODO actually strip the fields that are not part of the type
  return await getIncompleteBranchConfig(options);
}

export async function getRenderedEnvironmentConfig(options: environmentOptions): Promise<EnvironmentRenderedConfig> {
  // returns the same object as the incomplete config, although with a restricted type so we don't accidentally use the
  // fields that may still be overridden by other layers
  // see packages/stack-shared/src/config/README.md for more details
  // TODO actually strip the fields that are not part of the type
  return await getIncompleteEnvironmentConfig(options);
}

export async function getRenderedOrganizationConfig(options: organizationOptions): Promise<OrganizationRenderedConfig> {
  // returns the same object as the incomplete config, although with a restricted type so we don't accidentally use the
  // fields that may still be overridden by other layers
  // see packages/stack-shared/src/config/README.md for more details
  // TODO actually strip the fields that are not part of the type
  return await getIncompleteOrganizationConfig(options);
}


// ---------------------------------------------------------------------------------------------------------------------
// validate<$$$>ConfigOverride
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Validates a project config override, based on the base config.
 */
export async function validateProjectConfigOverride(options: { projectConfigOverride: ProjectConfigOverride }): Promise<Result<null, string>> {
  return await validateAndReturn(projectConfigSchema, baseConfig, options.projectConfigOverride);
}

/**
 * Validates a branch config override, based on the given project's rendered project config.
 */
export async function validateBranchConfigOverride(options: { branchConfigOverride: BranchConfigOverride } & projectOptions): Promise<Result<null, string>> {
  return await validateAndReturn(branchConfigSchema, await getIncompleteProjectConfig(options), options.branchConfigOverride);
}

/**
 * Validates an environment config override, based on the given branch's rendered branch config.
 */
export async function validateEnvironmentConfigOverride(options: { environmentConfigOverride: EnvironmentConfigOverride } & branchOptions): Promise<Result<null, string>> {
  return await validateAndReturn(environmentConfigSchema, await getIncompleteBranchConfig(options), options.environmentConfigOverride);
}

/**
 * Validates an organization config override, based on the given environment's rendered environment config.
 */
export async function validateOrganizationConfigOverride(options: { organizationConfigOverride: OrganizationConfigOverride } & environmentOptions): Promise<Result<null, string>> {
  return await validateAndReturn(organizationConfigSchema, await getIncompleteEnvironmentConfig(options), options.organizationConfigOverride);
}


// ---------------------------------------------------------------------------------------------------------------------
// get<$$$>ConfigOverride
// ---------------------------------------------------------------------------------------------------------------------

// Placeholder types that should be replaced after the config json db migration

export async function getProjectConfigOverride(options: projectOptions): Promise<ProjectConfigOverride> {
  // fetch project config from our own DB
  // (currently it's just empty)
  return {};
}

export async function getBranchConfigOverride(options: branchOptions): Promise<BranchConfigOverride> {
  // fetch branch config from GitHub
  // (currently it's just empty)
  if (options.branch.id !== 'main') {
    throw new Error('Not implemented');
  }
  return {};
}

export async function getEnvironmentConfigOverride(options: environmentOptions): Promise<EnvironmentConfigOverride> {
  // fetch environment config from DB (either our own, or the source of truth one)
  if (options.branch.id !== 'main') {
    throw new Error('Not implemented');
  }
  const configOverride: EnvironmentConfigOverride = {};

  const oldConfig = options.project.config;

  // =================== TEAM ===================

  if (oldConfig.clientTeamCreationEnabled !== baseConfig.team.clientTeamCreationEnabled) {
    configOverride['team.clientTeamCreationEnabled'] = oldConfig.clientTeamCreationEnabled;
  }

  if (oldConfig.clientUserDeletionEnabled !== baseConfig.user.clientUserDeletionEnabled) {
    configOverride['team.clientUserDeletionEnabled'] = oldConfig.clientUserDeletionEnabled;
  }

  if (oldConfig.createTeamOnSignUp !== baseConfig.team.createTeamOnSignUp) {
    configOverride['team.createTeamOnSignUp'] = oldConfig.createTeamOnSignUp;
  }

  // =================== USER ===================

  if (oldConfig.signUpEnabled !== baseConfig.user.signUpEnabled) {
    configOverride['user.signUpEnabled'] = oldConfig.signUpEnabled;
  }

  // =================== DOMAIN ===================

  if (oldConfig.allowLocalhost !== baseConfig.domain.allowLocalhost) {
    configOverride['domain.allowLocalhost'] = oldConfig.allowLocalhost;
  }

  for (const domain of oldConfig.domains) {
    configOverride['domain.' + base64url.encode(domain.domain)] = {
      baseUrl: domain.domain,
      handlerPath: domain.handlerPath,
    } satisfies OrganizationRenderedConfig['domain']['trustedDomains'][string];
  }

  // =================== AUTH ===================

  if (oldConfig.oauthAccountMergeStrategy !== baseConfig.auth.oauthAccountMergeStrategy) {
    configOverride['auth.oauthAccountMergeStrategy'] = oldConfig.oauthAccountMergeStrategy;
  }

  for (const authMethodConfig of oldConfig.authMethodConfigs) {
    const baseAuthMethod = {
      id: authMethodConfig.id,
      enabled: authMethodConfig.enabled,
    };

    let authMethodOverride: OrganizationRenderedConfig['auth']['authMethods'][string];
    if (authMethodConfig.oauthProviderConfig) {
      const oauthConfig = authMethodConfig.oauthProviderConfig.proxiedOAuthConfig || authMethodConfig.oauthProviderConfig.standardOAuthConfig;
      if (!oauthConfig) {
        throw new StackAssertionError('Either ProxiedOAuthConfig or StandardOAuthConfig must be set on authMethodConfigs.oauthProviderConfig', { authMethodConfig });
      }
      authMethodOverride = {
        ...baseAuthMethod,
        type: 'oauth',
        oauthProviderId: oauthConfig.id,
      } as const;
    } else if (authMethodConfig.passwordConfig) {
      authMethodOverride = {
        ...baseAuthMethod,
        type: 'password',
      } as const;
    } else if (authMethodConfig.otpConfig) {
      authMethodOverride = {
        ...baseAuthMethod,
        type: 'otp',
      } as const;
    } else if (authMethodConfig.passkeyConfig) {
      authMethodOverride = {
        ...baseAuthMethod,
        type: 'passkey',
      } as const;
    } else {
      throw new StackAssertionError('Unknown auth method config', { authMethodConfig });
    }

    configOverride['auth.authMethodConfigs.' + authMethodConfig.id] = authMethodOverride;
  }

  for (const provider of oldConfig.oauthProviderConfigs) {
    let providerOverride: OrganizationRenderedConfig['auth']['oauthProviders'][string];
    if (provider.proxiedOAuthConfig) {
      providerOverride = {
        id: provider.id,
        type: typedToLowercase(provider.proxiedOAuthConfig.type),
        isShared: true,
      } as const;
    } else if (provider.standardOAuthConfig) {
      providerOverride = filterUndefined({
        id: provider.id,
        type: typedToLowercase(provider.standardOAuthConfig.type),
        isShared: false,
        clientId: provider.standardOAuthConfig.clientId,
        clientSecret: provider.standardOAuthConfig.clientSecret,
        facebookConfigId: provider.standardOAuthConfig.facebookConfigId ?? undefined,
        microsoftTenantId: provider.standardOAuthConfig.microsoftTenantId ?? undefined,
      } as const);
    } else {
      throw new StackAssertionError('Unknown oauth provider config', { provider });
    }

    configOverride['auth.oauthProviders.' + provider.id] = providerOverride;
  }

  // =================== EMAIL ===================

  if (oldConfig.emailServiceConfig?.standardEmailServiceConfig) {
    configOverride['email.emailServer'] = {
      isShared: false,
      host: oldConfig.emailServiceConfig.standardEmailServiceConfig.host,
      port: oldConfig.emailServiceConfig.standardEmailServiceConfig.port,
      username: oldConfig.emailServiceConfig.standardEmailServiceConfig.username,
      password: oldConfig.emailServiceConfig.standardEmailServiceConfig.password,
      senderName: oldConfig.emailServiceConfig.standardEmailServiceConfig.senderName,
      senderEmail: oldConfig.emailServiceConfig.standardEmailServiceConfig.senderEmail,
    } satisfies OrganizationRenderedConfig['email']['emailServer'];
  }

  return configOverride;
}

export async function getOrganizationConfigOverride(options: organizationOptions): Promise<OrganizationConfigOverride> {
  // fetch organization config from DB (either our own, or the source of truth one)
  if (options.branch.id !== 'main' || options.organization.id !== null) {
    throw new Error('Not implemented');
  }

  return {};
}


// ---------------------------------------------------------------------------------------------------------------------
// set<$$$>ConfigOverride
// ---------------------------------------------------------------------------------------------------------------------

export async function setProjectConfigOverride(options: {
  projectId: string,
  projectConfigOverride: ProjectConfigOverride,
}): Promise<void> {
  // set project config override on our own DB
  throw new Error('Not implemented');
}

export function setBranchConfigOverride(options: {
  projectId: string,
  branchId: string,
  branchConfigOverride: BranchConfigOverride,
}): Promise<void> {
  // update config.json if on local emulator
  // throw error otherwise
  throw new Error('Not implemented');
}

export function setEnvironmentConfigOverride(options: {
  projectId: string,
  branchId: string,
  environmentConfigOverride: EnvironmentConfigOverride,
}): Promise<void> {
  // save environment config override on DB (either our own, or the source of truth one)
  throw new Error('Not implemented');
}

export function setOrganizationConfigOverride(options: {
  projectId: string,
  branchId: string,
  organizationId: string | null,
  organizationConfigOverride: OrganizationConfigOverride,
}): Promise<void> {
  // save organization config override on DB (either our own, or the source of truth one)
  throw new Error('Not implemented');
}


// ---------------------------------------------------------------------------------------------------------------------
// internal functions
// ---------------------------------------------------------------------------------------------------------------------

async function getIncompleteProjectConfig(options: projectOptions): Promise<ProjectIncompleteConfig> {
  return normalize(override(baseConfig, await getProjectConfigOverride(options)), { onDotIntoNull: "ignore" }) as any;
}

async function getIncompleteBranchConfig(options: branchOptions): Promise<BranchIncompleteConfig> {
  return normalize(override(await getIncompleteProjectConfig(options), await getBranchConfigOverride(options)), { onDotIntoNull: "ignore" }) as any;
}

async function getIncompleteEnvironmentConfig(options: environmentOptions): Promise<EnvironmentIncompleteConfig> {
  return normalize(override(await getIncompleteBranchConfig(options), await getEnvironmentConfigOverride(options)), { onDotIntoNull: "ignore" }) as any;
}

async function getIncompleteOrganizationConfig(options: organizationOptions): Promise<OrganizationIncompleteConfig> {
  return normalize(override(await getIncompleteEnvironmentConfig(options), await getOrganizationConfigOverride(options)), { onDotIntoNull: "ignore" }) as any;
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
export const dbProjectToRenderedOrganizationConfig = (dbProject: DBProject): OrganizationRenderedConfig => {
  const config = dbProject.config;

  return {
    allowLocalhost: config.allowLocalhost,
    clientTeamCreationEnabled: config.clientTeamCreationEnabled,
    clientUserDeletionEnabled: config.clientUserDeletionEnabled,
    signUpEnabled: config.signUpEnabled,
    oauthAccountMergeStrategy: typedToLowercase(config.oauthAccountMergeStrategy),
    createTeamOnSignUp: config.createTeamOnSignUp,
    isProductionMode: dbProject.isProductionMode,

    authMethods: config.authMethodConfigs.map((authMethod): NonNullable<OrganizationRenderedConfig['authMethods']>[string] => {
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
      acc.set(authMethod.id, authMethod);
      return acc;
    }, new Map<string, NonNullable<OrganizationRenderedConfig['authMethods']>[string]>()),

    oauthProviders: config.oauthProviderConfigs.map(provider => {
      if (provider.proxiedOAuthConfig) {
        return ({
          id: provider.id,
          type: typedToLowercase(provider.proxiedOAuthConfig.type),
          isShared: true,
        } as const) satisfies OrganizationRenderedConfig['oauthProviders'][string];
      } else if (provider.standardOAuthConfig) {
        return filterUndefined({
          id: provider.id,
          type: typedToLowercase(provider.standardOAuthConfig.type),
          isShared: false,
          clientId: provider.standardOAuthConfig.clientId,
          clientSecret: provider.standardOAuthConfig.clientSecret,
          facebookConfigId: provider.standardOAuthConfig.facebookConfigId ?? undefined,
          microsoftTenantId: provider.standardOAuthConfig.microsoftTenantId ?? undefined,
        } as const) satisfies OrganizationRenderedConfig['oauthProviders'][string];
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
    } satisfies OrganizationRenderedConfig['connectedAccounts'][string])).reduce((acc, account) => {
      (acc as any)[account.id] = account;
      return acc;
    }, {}),

    domains: config.domains.map(domain => ({
      domain: domain.domain,
      handlerPath: domain.handlerPath,
    } satisfies OrganizationRenderedConfig['domains'][string])).reduce((acc, domain) => {
      (acc as any)[base64url.encode(domain.domain)] = domain;
      return acc;
    }, {}),

    emailConfig: ((): OrganizationRenderedConfig['emailConfig'] => {
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
      } satisfies OrganizationRenderedConfig['teamPermissionDefinitions'][string];
      return acc;
    }, {}),

    userDefaultPermissions: config.permissions.filter(perm => perm.isDefaultProjectPermission)
      .map(permissionDefinitionJsonFromDbType)
      .reduce((acc, perm) => {
        (acc as any)[perm.id] = { id: perm.id };
        return acc;
      }, {}),
  };
};

// C -> A
export const renderedOrganizationConfigToProjectCrud = (renderedConfig: OrganizationRenderedConfig, configId: string): ProjectsCrud["Admin"]["Read"]['config'] => {
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

    team_creator_default_permissions: typedEntries(renderedConfig.teamCreateDefaultPermissions)
      .map(([_, perm]) => ({ id: perm.id }))
      .sort((a, b) => stringCompare(a.id, b.id)),
    team_member_default_permissions: typedEntries(renderedConfig.teamMemberDefaultPermissions)
      .map(([_, perm]) => ({ id: perm.id }))
      .sort((a, b) => stringCompare(a.id, b.id)),
    user_default_permissions: typedEntries(renderedConfig.userDefaultPermissions)
      .map(([_, perm]) => ({ id: perm.id }))
      .sort((a, b) => stringCompare(a.id, b.id)),
  };
};
