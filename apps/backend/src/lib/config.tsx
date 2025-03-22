import { Tenancy } from "@/lib/tenancies";
import { NormalizationError, getInvalidConfigReason, normalize, override } from "@stackframe/stack-shared/dist/config/format/index";
import { BranchConfigOverride, BranchIncompleteConfig, BranchRenderedConfig, EnvironmentConfigOverride, EnvironmentIncompleteConfig, EnvironmentRenderedConfig, OrganizationConfigOverride, OrganizationIncompleteConfig, OrganizationRenderedConfig, ProjectConfigOverride, ProjectIncompleteConfig, ProjectRenderedConfig, baseConfig, branchConfigSchema, environmentConfigSchema, organizationConfigSchema, projectConfigSchema } from "@stackframe/stack-shared/dist/config/schema";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { pick } from "@stackframe/stack-shared/dist/utils/objects";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { expect } from "vitest";
import * as yup from "yup";

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
  throw new Error('Not implemented');
}

type t = EnvironmentConfigOverride['emailConfig']

export async function getEnvironmentConfigOverride(project: Project, branchId: string): Promise<EnvironmentConfigOverride> {
  // fetch environment config from DB (either our own, or the source of truth one)
  if (branchId !== 'main') {
    throw new Error('Not implemented');
  }

  const config = project.config;

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

import.meta.vitest?.describe('validateAndReturn(...)', async () => {
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
