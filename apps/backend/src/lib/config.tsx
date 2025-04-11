import { Prisma } from "@prisma/client";
import { NormalizationError, getInvalidConfigReason, normalize, override } from "@stackframe/stack-shared/dist/config/format";
import { BranchConfigOverride, BranchIncompleteConfig, BranchRenderedConfig, EnvironmentConfigOverride, EnvironmentIncompleteConfig, EnvironmentRenderedConfig, OrganizationConfigOverride, OrganizationIncompleteConfig, OrganizationRenderedConfig, ProjectConfigOverride, ProjectIncompleteConfig, ProjectRenderedConfig, baseConfig, branchConfigSchema, environmentConfigSchema, organizationConfigSchema, projectConfigSchema } from "@stackframe/stack-shared/dist/config/schema";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined, pick, typedEntries, typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { stringCompare, typedToLowercase } from "@stackframe/stack-shared/dist/utils/strings";
import { base64url } from "jose";
import * as yup from "yup";
import { RawQuery, prismaClient } from "../prisma-client";
import { permissionDefinitionJsonFromDbType, permissionDefinitionJsonFromSystemDbType } from "./permissions";
import { DBProject, fullProjectInclude } from "./projects";

// These are placeholder types that should be replaced after the config json db migration
type ProjectData = DBProject;
type BranchData = { id: string };
type EnvironmentData = {};
type OrganizationData = { id: string | null };

type ProjectOptions = { project: ProjectData };
type BranchOptions = ProjectOptions & { branch: BranchData };
type EnvironmentOptions = BranchOptions & { environment: EnvironmentData };
type OrganizationOptions = EnvironmentOptions & { organization: OrganizationData };

// ---------------------------------------------------------------------------------------------------------------------
// getRendered<$$$>Config
// ---------------------------------------------------------------------------------------------------------------------

async function _getDbProject(options: { projectId: string }): Promise<ProjectData | null> {
  return await prismaClient.project.findUnique({
    where: { id: options.projectId },
    include: fullProjectInclude,
  });
}

// returns the same object as the incomplete config, although with a restricted type so we don't accidentally use the
// fields that may still be overridden by other layers
// see packages/stack-shared/src/config/README.md for more details
// TODO actually strip the fields that are not part of the type

export function getRenderedProjectConfigQuery(options: { projectId: string }): RawQuery<Promise<ProjectRenderedConfig | null>> {
  return {
    sql: Prisma.sql`SELECT 1`,
    postProcess: async () => {
      const dbProject = await _getDbProject(options);
      if (!dbProject) {
        return null;
      }
      return await getIncompleteProjectConfig({ project: dbProject });
    },
  };
}

export function getRenderedBranchConfigQuery(options: { projectId: string, branchId: string }): RawQuery<Promise<BranchRenderedConfig | null>> {
  return {
    sql: Prisma.sql`SELECT 1`,
    postProcess: async () => {
      const dbProject = await _getDbProject(options);
      if (!dbProject) {
        return null;
      }
      return await getIncompleteBranchConfig({ project: dbProject, branch: { id: options.branchId } });
    },
  };
}

export function getRenderedEnvironmentConfigQuery(options: { projectId: string, branchId: string }): RawQuery<Promise<EnvironmentRenderedConfig | null>> {
  return {
    sql: Prisma.sql`SELECT 1`,
    postProcess: async () => {
      const dbProject = await _getDbProject(options);
      if (!dbProject) {
        return null;
      }
      return await getIncompleteEnvironmentConfig({ project: dbProject, branch: { id: options.branchId }, environment: {} });
    },
  };
}

export function getRenderedOrganizationConfigQuery(options: { projectId: string, branchId: string, organizationId: string | null }): RawQuery<Promise<OrganizationRenderedConfig | null>> {
  return {
    sql: Prisma.sql`SELECT 1`,
    postProcess: async () => {
      const dbProject = await _getDbProject(options);
      if (!dbProject) {
        return null;
      }
      return await getIncompleteOrganizationConfig({ project: dbProject, branch: { id: options.branchId }, environment: {}, organization: { id: options.organizationId } });
    },
  };
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
export async function validateBranchConfigOverride(options: { branchConfigOverride: BranchConfigOverride } & ProjectOptions): Promise<Result<null, string>> {
  return await validateAndReturn(branchConfigSchema, await getIncompleteProjectConfig(options), options.branchConfigOverride);
}

/**
 * Validates an environment config override, based on the given branch's rendered branch config.
 */
export async function validateEnvironmentConfigOverride(options: { environmentConfigOverride: EnvironmentConfigOverride } & BranchOptions): Promise<Result<null, string>> {
  return await validateAndReturn(environmentConfigSchema, await getIncompleteBranchConfig(options), options.environmentConfigOverride);
}

/**
 * Validates an organization config override, based on the given environment's rendered environment config.
 */
export async function validateOrganizationConfigOverride(options: { organizationConfigOverride: OrganizationConfigOverride } & EnvironmentOptions): Promise<Result<null, string>> {
  return await validateAndReturn(organizationConfigSchema, await getIncompleteEnvironmentConfig(options), options.organizationConfigOverride);
}


// ---------------------------------------------------------------------------------------------------------------------
// get<$$$>ConfigOverride
// ---------------------------------------------------------------------------------------------------------------------

// Placeholder types that should be replaced after the config json db migration

export async function getProjectConfigOverride(options: ProjectOptions): Promise<ProjectConfigOverride> {
  // fetch project config from our own DB
  // (currently it's just empty)
  return {};
}

export async function getBranchConfigOverride(options: BranchOptions): Promise<BranchConfigOverride> {
  // fetch branch config from GitHub
  // (currently it's just empty)
  if (options.branch.id !== 'main') {
    throw new Error('Not implemented');
  }
  return {};
}

export async function getEnvironmentConfigOverride(options: EnvironmentOptions): Promise<EnvironmentConfigOverride> {
  // fetch environment config from DB (either our own, or the source of truth one)
  if (options.branch.id !== 'main') {
    throw new Error('Not implemented');
  }
  const configOverride: EnvironmentConfigOverride = {};

  const oldConfig = options.project.config;

  // =================== TEAM ===================

  if (oldConfig.clientTeamCreationEnabled !== baseConfig.teams.clientTeamCreationEnabled) {
    configOverride['teams.clientTeamCreationEnabled'] = oldConfig.clientTeamCreationEnabled;
  }

  if (oldConfig.createTeamOnSignUp !== baseConfig.teams.createTeamOnSignUp) {
    configOverride['teams.createTeamOnSignUp'] = oldConfig.createTeamOnSignUp;
  }

  // =================== USER ===================

  if (oldConfig.clientUserDeletionEnabled !== baseConfig.users.clientUserDeletionEnabled) {
    configOverride['users.clientUserDeletionEnabled'] = oldConfig.clientUserDeletionEnabled;
  }

  if (oldConfig.signUpEnabled !== baseConfig.users.signUpEnabled) {
    configOverride['users.signUpEnabled'] = oldConfig.signUpEnabled;
  }

  // =================== DOMAIN ===================

  if (oldConfig.allowLocalhost !== baseConfig.domains.allowLocalhost) {
    configOverride['domains.allowLocalhost'] = oldConfig.allowLocalhost;
  }

  for (const domain of oldConfig.domains) {
    configOverride['domains.trustedDomains.' + base64url.encode(domain.domain)] = {
      baseUrl: domain.domain,
      handlerPath: domain.handlerPath,
    } satisfies OrganizationRenderedConfig['domains']['trustedDomains'][string];
  }

  // =================== AUTH ===================

  if (oldConfig.oauthAccountMergeStrategy !== baseConfig.auth.oauthAccountMergeStrategy) {
    configOverride['auth.oauthAccountMergeStrategy'] = typedToLowercase(oldConfig.oauthAccountMergeStrategy) satisfies OrganizationRenderedConfig['auth']['oauthAccountMergeStrategy'];
  }

  for (const authMethodConfig of oldConfig.authMethodConfigs) {
    const baseAuthMethod = {
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

    configOverride['auth.authMethods.' + authMethodConfig.id] = authMethodOverride;
  }

  for (const provider of oldConfig.oauthProviderConfigs) {
    let providerOverride: OrganizationRenderedConfig['auth']['oauthProviders'][string];
    if (provider.proxiedOAuthConfig) {
      providerOverride = {
        type: typedToLowercase(provider.proxiedOAuthConfig.type),
        isShared: true,
      } as const;
    } else if (provider.standardOAuthConfig) {
      providerOverride = filterUndefined({
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

  for (const provider of oldConfig.oauthProviderConfigs) {
    const authMethodConfig = oldConfig.authMethodConfigs.find(config => config.oauthProviderConfig?.id === provider.id);

    if (!authMethodConfig) {
      throw new StackAssertionError('No auth method config found for oauth provider', { provider });
    }

    configOverride['auth.connectedAccounts.' + provider.id] = {
      enabled: authMethodConfig.enabled,
      oauthProviderId: provider.id,
    } satisfies OrganizationRenderedConfig['auth']['connectedAccounts'][string];
  }

  // =================== EMAIL ===================

  if (oldConfig.emailServiceConfig?.standardEmailServiceConfig) {
    configOverride['emails.emailServer'] = {
      isShared: false,
      host: oldConfig.emailServiceConfig.standardEmailServiceConfig.host,
      port: oldConfig.emailServiceConfig.standardEmailServiceConfig.port,
      username: oldConfig.emailServiceConfig.standardEmailServiceConfig.username,
      password: oldConfig.emailServiceConfig.standardEmailServiceConfig.password,
      senderName: oldConfig.emailServiceConfig.standardEmailServiceConfig.senderName,
      senderEmail: oldConfig.emailServiceConfig.standardEmailServiceConfig.senderEmail,
    } satisfies OrganizationRenderedConfig['emails']['emailServer'];
  }

  // =================== PERMISSIONS ===================

  // Team permission definitions
  for (const perm of oldConfig.permissions.filter(perm => perm.scope === 'TEAM')
    .map(permissionDefinitionJsonFromDbType)
    .sort((a, b) => stringCompare(a.id, b.id))) {
    configOverride[`teams.teamPermissionDefinitions.${perm.id}`] = filterUndefined({
      description: perm.description,
      containedPermissions: typedFromEntries(perm.contained_permission_ids.map(containedPerm => [containedPerm, {}]))
    });
  }

  // Default creator team permissions
  const defaultCreatorTeamPermissions = oldConfig.permissions.filter(perm => perm.isDefaultTeamCreatorPermission)
    .map(permissionDefinitionJsonFromDbType)
    .concat(oldConfig.teamCreateDefaultSystemPermissions.map(db => permissionDefinitionJsonFromSystemDbType(db, oldConfig)))
    .sort((a, b) => stringCompare(a.id, b.id));

  for (const perm of defaultCreatorTeamPermissions) {
    configOverride[`teams.defaultCreatorTeamPermissions.${perm.id}`] = {};
  }

  // Default member team permissions
  const defaultMemberTeamPermissions = oldConfig.permissions.filter(perm => perm.isDefaultTeamMemberPermission)
    .map(permissionDefinitionJsonFromDbType)
    .concat(oldConfig.teamMemberDefaultSystemPermissions.map(db => permissionDefinitionJsonFromSystemDbType(db, oldConfig)))
    .sort((a, b) => stringCompare(a.id, b.id));

  for (const perm of defaultMemberTeamPermissions) {
    configOverride[`teams.defaultMemberTeamPermissions.${perm.id}`] = {};
  }

  // Project permission definitions
  const projectPermissionDefinitions = oldConfig.permissions.filter(perm => perm.scope === 'PROJECT')
    .map(permissionDefinitionJsonFromDbType)
    .sort((a, b) => stringCompare(a.id, b.id));

  for (const perm of projectPermissionDefinitions) {
    configOverride[`teams.projectPermissionDefinitions.${perm.id}`] = filterUndefined({
      description: perm.description,
      containedPermissions: typedFromEntries(perm.contained_permission_ids.map(containedPerm => [containedPerm, {}]))
    });
  }

  // Default project permissions
  const defaultProjectPermissions = oldConfig.permissions.filter(perm => perm.isDefaultProjectPermission)
    .map(permissionDefinitionJsonFromDbType)
    // TODO: add project default system permissions after creating the first project system permission
    .sort((a, b) => stringCompare(a.id, b.id));

  for (const perm of defaultProjectPermissions) {
    configOverride[`users.defaultProjectPermissions.${perm.id}`] = {};
  }

  // =================== API KEYS ===================

  if (oldConfig.allowUserApiKeys !== baseConfig.users.allowUserApiKeys) {
    configOverride['users.allowUserApiKeys'] = oldConfig.allowUserApiKeys;
  }

  if (oldConfig.allowTeamApiKeys !== baseConfig.teams.allowTeamApiKeys) {
    configOverride['teams.allowTeamApiKeys'] = oldConfig.allowTeamApiKeys;
  }

  return configOverride;
}

export async function getOrganizationConfigOverride(options: OrganizationOptions): Promise<OrganizationConfigOverride> {
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

async function getIncompleteProjectConfig(options: ProjectOptions): Promise<ProjectIncompleteConfig> {
  return normalize(override(baseConfig, await getProjectConfigOverride(options)), { onDotIntoNull: "ignore" }) as any;
}

async function getIncompleteBranchConfig(options: BranchOptions): Promise<BranchIncompleteConfig> {
  return normalize(override(await getIncompleteProjectConfig(options), await getBranchConfigOverride(options)), { onDotIntoNull: "ignore" }) as any;
}

async function getIncompleteEnvironmentConfig(options: EnvironmentOptions): Promise<EnvironmentIncompleteConfig> {
  return normalize(override(await getIncompleteBranchConfig(options), await getEnvironmentConfigOverride(options)), { onDotIntoNull: "ignore" }) as any;
}

async function getIncompleteOrganizationConfig(options: OrganizationOptions): Promise<OrganizationIncompleteConfig> {
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

// C -> A
export const renderedOrganizationConfigToProjectCrud = (renderedConfig: OrganizationRenderedConfig, configId: string): ProjectsCrud["Admin"]["Read"]['config'] => {
  const oauthProviders = typedEntries(renderedConfig.auth.authMethods)
    .filter(([_, authMethod]) => authMethod.type === 'oauth')
    .map(([_, authMethod]) => {
      if (authMethod.type !== 'oauth') {
        throw new StackAssertionError('Expected oauth provider', { authMethod });
      }
      const oauthProvider = renderedConfig.auth.oauthProviders[authMethod.oauthProviderId];

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
    allow_localhost: renderedConfig.domains.allowLocalhost,
    client_team_creation_enabled: renderedConfig.teams.clientTeamCreationEnabled,
    client_user_deletion_enabled: renderedConfig.users.clientUserDeletionEnabled,
    sign_up_enabled: renderedConfig.users.signUpEnabled,
    oauth_account_merge_strategy: renderedConfig.auth.oauthAccountMergeStrategy,
    create_team_on_sign_up: renderedConfig.teams.createTeamOnSignUp,
    credential_enabled: typedEntries(renderedConfig.auth.authMethods).filter(([_, authMethod]) => authMethod.enabled && authMethod.type === 'password').length > 0,
    magic_link_enabled: typedEntries(renderedConfig.auth.authMethods).filter(([_, authMethod]) => authMethod.enabled && authMethod.type === 'otp').length > 0,
    passkey_enabled: typedEntries(renderedConfig.auth.authMethods).filter(([_, authMethod]) => authMethod.enabled && authMethod.type === 'passkey').length > 0,

    oauth_providers: oauthProviders,
    enabled_oauth_providers: oauthProviders.filter(provider => provider.enabled),

    domains: typedEntries(renderedConfig.domains.trustedDomains)
      .map(([_, domainConfig]) => ({
        domain: domainConfig.baseUrl,
        handler_path: domainConfig.handlerPath,
      }))
      .sort((a, b) => stringCompare(a.domain, b.domain)),

    email_config: renderedConfig.emails.emailServer.isShared ? {
      type: 'shared',
    } : {
      type: 'standard',
      host: renderedConfig.emails.emailServer.host,
      port: renderedConfig.emails.emailServer.port,
      username: renderedConfig.emails.emailServer.username,
      password: renderedConfig.emails.emailServer.password,
      sender_name: renderedConfig.emails.emailServer.senderName,
      sender_email: renderedConfig.emails.emailServer.senderEmail,
    },

    team_creator_default_permissions: typedEntries(renderedConfig.teams.defaultCreatorTeamPermissions)
      .map(([id, perm]) => ({ id }))
      .sort((a, b) => stringCompare(a.id, b.id)),
    team_member_default_permissions: typedEntries(renderedConfig.teams.defaultMemberTeamPermissions)
      .map(([id, perm]) => ({ id }))
      .sort((a, b) => stringCompare(a.id, b.id)),
    user_default_permissions: typedEntries(renderedConfig.users.defaultProjectPermissions)
      .map(([id, perm]) => ({ id }))
      .sort((a, b) => stringCompare(a.id, b.id)),

    allow_user_api_keys: renderedConfig.users.allowUserApiKeys,
    allow_team_api_keys: renderedConfig.teams.allowTeamApiKeys,
  };
};
