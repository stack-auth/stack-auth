import { Prisma } from "@prisma/client";
import { Config, NormalizationError, NormalizedConfig, getInvalidConfigReason, normalize, override } from "@stackframe/stack-shared/dist/config/format";
import { BranchConfigOverride, BranchConfigOverrideOverride, BranchIncompleteConfig, BranchRenderedConfig, EnvironmentConfigOverride, EnvironmentConfigOverrideOverride, EnvironmentIncompleteConfig, EnvironmentRenderedConfig, OrganizationConfigOverride, OrganizationConfigOverrideOverride, OrganizationIncompleteConfig, OrganizationRenderedConfig, ProjectConfigOverride, ProjectConfigOverrideOverride, ProjectIncompleteConfig, ProjectRenderedConfig, applyDefaults, branchConfigDefaults, branchConfigSchema, environmentConfigDefaults, environmentConfigSchema, organizationConfigDefaults, organizationConfigSchema, projectConfigDefaults, projectConfigSchema } from "@stackframe/stack-shared/dist/config/schema";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { yupMixed, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { isTruthy } from "@stackframe/stack-shared/dist/utils/booleans";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined, pick, typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import * as yup from "yup";
import { PrismaClientTransaction, RawQuery, globalPrismaClient, rawQuery } from "../prisma-client";
import { DEFAULT_BRANCH_ID } from "./tenancies";

type ProjectOptions = { projectId: string };
type BranchOptions = ProjectOptions & { branchId: string };
type EnvironmentOptions = BranchOptions;
type OrganizationOptions = EnvironmentOptions & { organizationId: string | null };

// ---------------------------------------------------------------------------------------------------------------------
// getRendered<$$$>Config
// ---------------------------------------------------------------------------------------------------------------------
// returns the same object as the incomplete config, although with a restricted type so we don't accidentally use the
// fields that may still be overridden by other layers
// see packages/stack-shared/src/config/README.md for more details
// TODO actually strip the fields that are not part of the type

export function getRenderedProjectConfigQuery(options: ProjectOptions): RawQuery<Promise<ProjectRenderedConfig>> {
  return RawQuery.then(
    getIncompleteProjectConfigQuery(options),
    async (incompleteConfig) => applyDefaults(projectConfigDefaults, await incompleteConfig),
  );
}

export function getRenderedBranchConfigQuery(options: BranchOptions): RawQuery<Promise<BranchRenderedConfig>> {
  return RawQuery.then(
    getIncompleteBranchConfigQuery(options),
    async (incompleteConfig) => applyDefaults(branchConfigDefaults, await incompleteConfig),
  );
}

export function getRenderedEnvironmentConfigQuery(options: EnvironmentOptions): RawQuery<Promise<EnvironmentRenderedConfig>> {
  return RawQuery.then(
    getIncompleteEnvironmentConfigQuery(options),
    async (incompleteConfig) => applyDefaults(environmentConfigDefaults, await incompleteConfig),
  );
}

export function getRenderedOrganizationConfigQuery(options: OrganizationOptions): RawQuery<Promise<OrganizationRenderedConfig>> {
  return RawQuery.then(
    getIncompleteOrganizationConfigQuery(options),
    async (incompleteConfig) => applyDefaults(organizationConfigDefaults, await incompleteConfig),
  );
}


// ---------------------------------------------------------------------------------------------------------------------
// validate<$$$>ConfigOverride
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Validates a project config override ([sanity-check valid](./README.md)).
 */
export async function validateProjectConfigOverride(options: { projectConfigOverride: ProjectConfigOverride }): Promise<Result<null, string>> {
  return await schematicallyValidateAndReturn(projectConfigSchema, {}, options.projectConfigOverride);
}

/**
 * Validates a branch config override ([sanity-check valid](./README.md)), based on the given project's rendered project config.
 */
export async function validateBranchConfigOverride(options: { branchConfigOverride: BranchConfigOverride } & ProjectOptions): Promise<Result<null, string>> {
  return await schematicallyValidateAndReturn(branchConfigSchema, await rawQuery(globalPrismaClient, getIncompleteProjectConfigQuery(options)), options.branchConfigOverride);
  // TODO add some more checks that depend on the base config; eg. an override config shouldn't set email server connection if isShared==true
  // (these are schematically valid, but make no sense, so we should be nice and reject them)
}

/**
 * Validates an environment config override ([sanity-check valid](./README.md)), based on the given branch's rendered branch config.
 */
export async function validateEnvironmentConfigOverride(options: { environmentConfigOverride: EnvironmentConfigOverride } & BranchOptions): Promise<Result<null, string>> {
  return await schematicallyValidateAndReturn(environmentConfigSchema, await rawQuery(globalPrismaClient, getIncompleteBranchConfigQuery(options)), options.environmentConfigOverride);
  // TODO add some more checks that depend on the base config; eg. an override config shouldn't set email server connection if isShared==true
  // (these are schematically valid, but make no sense, so we should be nice and reject them)
}

/**
 * Validates an organization config override ([sanity-check valid](./README.md)), based on the given environment's rendered environment config.
 */
export async function validateOrganizationConfigOverride(options: { organizationConfigOverride: OrganizationConfigOverride } & EnvironmentOptions): Promise<Result<null, string>> {
  return await schematicallyValidateAndReturn(organizationConfigSchema, await rawQuery(globalPrismaClient, getIncompleteEnvironmentConfigQuery(options)), options.organizationConfigOverride);
  // TODO add some more checks that depend on the base config; eg. an override config shouldn't set email server connection if isShared==true
  // (these are schematically valid, but make no sense, so we should be nice and reject them)
}


// ---------------------------------------------------------------------------------------------------------------------
// get<$$$>ConfigOverride
// ---------------------------------------------------------------------------------------------------------------------

// Placeholder types that should be replaced after the config json db migration

export function getProjectConfigOverrideQuery(options: ProjectOptions): RawQuery<Promise<ProjectConfigOverride>> {
  // fetch project config from our own DB
  // (currently it's just empty)
  return {
    supportedPrismaClients: ["global"],
    sql: Prisma.sql`
      SELECT "Project"."projectConfigOverride"
      FROM "Project"
      WHERE "Project"."id" = ${options.projectId}
    `,
    postProcess: async (queryResult) => {
      return queryResult[0].projectConfigOverride ?? {};
    },
  };
}

export function getBranchConfigOverrideQuery(options: BranchOptions): RawQuery<Promise<BranchConfigOverride>> {
  // fetch branch config from GitHub
  // (currently it's just empty)
  if (options.branchId !== DEFAULT_BRANCH_ID) {
    throw new StackAssertionError('Not implemented');
  }
  return {
    supportedPrismaClients: ["global"],
    sql: Prisma.sql`SELECT 1`,
    postProcess: async () => {
      return {};
    },
  };
}

export function getEnvironmentConfigOverrideQuery(options: EnvironmentOptions): RawQuery<Promise<EnvironmentConfigOverride>> {
  // fetch environment config from DB (either our own, or the source of truth one)
  return {
    supportedPrismaClients: ["global"],
    sql: Prisma.sql`
      SELECT "EnvironmentConfigOverride".*
      FROM "EnvironmentConfigOverride"
      WHERE "EnvironmentConfigOverride"."branchId" = ${options.branchId}
      AND "EnvironmentConfigOverride"."projectId" = ${options.projectId}
    `,
    postProcess: async (queryResult) => {
      if (queryResult.length > 1) {
        throw new StackAssertionError(`Expected 0 or 1 environment config overrides for project ${options.projectId} and branch ${options.branchId}, got ${queryResult.length}`, { queryResult });
      }
      if (queryResult.length === 0) {
        return {};
      }
      return queryResult[0].config;
    },
  };
}

export function getOrganizationConfigOverrideQuery(options: OrganizationOptions): RawQuery<Promise<OrganizationConfigOverride>> {
  // fetch organization config from DB (either our own, or the source of truth one)
  if (options.organizationId !== null) {
    throw new StackAssertionError('Not implemented');
  }

  return {
    supportedPrismaClients: ["global"],
    sql: Prisma.sql`SELECT 1`,
    postProcess: async () => {
      return {};
    },
  };
}


// ---------------------------------------------------------------------------------------------------------------------
// override<$$$>ConfigOverride
// ---------------------------------------------------------------------------------------------------------------------

// Note that the arguments passed in here override the override; they are therefore OverrideOverrides.

export async function overrideProjectConfigOverride(options: {
  projectId: string,
  projectConfigOverrideOverride: ProjectConfigOverrideOverride,
  tx: PrismaClientTransaction,
}): Promise<void> {
  // set project config override on our own DB

  // TODO put this in a serializable transaction (or a single SQL query) to prevent race conditions
  const oldConfig = await rawQuery(options.tx, getProjectConfigOverrideQuery(options));
  const newConfig = override(
    oldConfig,
    options.projectConfigOverrideOverride,
  );
  await options.tx.project.update({
    where: {
      id: options.projectId,
    },
    data: {
      projectConfigOverride: newConfig,
    },
  });
}

export function overrideBranchConfigOverride(options: {
  projectId: string,
  branchId: string,
  branchConfigOverrideOverride: BranchConfigOverrideOverride,
}): Promise<void> {
  // update config.json if on local emulator
  // throw error otherwise
  throw new StackAssertionError('Not implemented');
}

export async function overrideEnvironmentConfigOverride(options: {
  projectId: string,
  branchId: string,
  environmentConfigOverrideOverride: EnvironmentConfigOverrideOverride,
  tx: PrismaClientTransaction,
}): Promise<void> {
  // save environment config override on DB

  // TODO put this in a serializable transaction (or a single SQL query) to prevent race conditions
  const oldConfig = await rawQuery(options.tx, getEnvironmentConfigOverrideQuery(options));
  const newConfig = override(
    oldConfig,
    options.environmentConfigOverrideOverride,
  );
  await options.tx.environmentConfigOverride.upsert({
    where: {
      projectId_branchId: {
        projectId: options.projectId,
        branchId: options.branchId,
      }
    },
    update: {
      config: newConfig,
    },
    create: {
      projectId: options.projectId,
      branchId: options.branchId,
      config: newConfig,
    },
  });
}

export function overrideOrganizationConfigOverride(options: {
  projectId: string,
  branchId: string,
  organizationId: string | null,
  organizationConfigOverrideOverride: OrganizationConfigOverrideOverride,
}): Promise<void> {
  // save organization config override on DB (either our own, or the source of truth one)
  throw new StackAssertionError('Not implemented');
}


// ---------------------------------------------------------------------------------------------------------------------
// internal functions
// ---------------------------------------------------------------------------------------------------------------------

function getIncompleteProjectConfigQuery(options: ProjectOptions): RawQuery<Promise<ProjectIncompleteConfig>> {
  return makeIncompleteConfigQuery({
    override: getProjectConfigOverrideQuery(options),
    defaults: projectConfigDefaults,
  });
}

function getIncompleteBranchConfigQuery(options: BranchOptions): RawQuery<Promise<BranchIncompleteConfig>> {
  return makeIncompleteConfigQuery({
    previous: getIncompleteProjectConfigQuery(options),
    override: getBranchConfigOverrideQuery(options),
    defaults: branchConfigDefaults,
  });
}

function getIncompleteEnvironmentConfigQuery(options: EnvironmentOptions): RawQuery<Promise<EnvironmentIncompleteConfig>> {
  return makeIncompleteConfigQuery({
    previous: getIncompleteBranchConfigQuery(options),
    override: getEnvironmentConfigOverrideQuery(options),
    defaults: environmentConfigDefaults,
  });
}

function getIncompleteOrganizationConfigQuery(options: OrganizationOptions): RawQuery<Promise<OrganizationIncompleteConfig>> {
  return makeIncompleteConfigQuery({
    previous: getIncompleteEnvironmentConfigQuery(options),
    override: getOrganizationConfigOverrideQuery(options),
    defaults: organizationConfigDefaults,
  });
}

function makeIncompleteConfigQuery<T, O>(options: { previous?: RawQuery<Promise<NormalizedConfig>>, override: RawQuery<Promise<Config>>, defaults: any }): RawQuery<Promise<any>> {
  return RawQuery.then(
    RawQuery.all([
      options.previous ?? RawQuery.resolve(Promise.resolve({})),
      options.override,
    ] as const),
    async ([prev, over]) => applyDefaults(options.defaults, normalize(override(await prev, await over))),
  );
}

/**
 * For the difference between schematically valid and sanity-check valid, see `README.md`.
 */
async function schematicallyValidateAndReturn(schema: yup.ObjectSchema<any>, base: any, configOverride: any): Promise<Result<null, string>> {
  // First, we check whether the override is valid on its own, in the hypothetical case where all parent configs are empty.
  const basicRes = await schematicallyValidateAndReturnImpl(schema, {}, configOverride);
  if (basicRes.status === "error") return basicRes;

  // As a sanity check, we also validate that the override is valid if we merge it with the base config. Because of
  // how we design schemas, this should always be the case (as changing a base config should not make the yup schema
  // invalid).
  const mergedRes = await schematicallyValidateAndReturnImpl(schema, base, configOverride);
  if (mergedRes.status === "error") {
    throw new StackAssertionError('Invalid override is not compatible with the base config: ' + mergedRes.error, { mergedRes });
  }

  return Result.ok(null);
}

async function schematicallyValidateAndReturnImpl(schema: yup.ObjectSchema<any>, base: any, configOverride: any): Promise<Result<null, string>> {
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

import.meta.vitest?.test('schematicallyValidateAndReturn(...)', async ({ expect }) => {
  const schema1 = yupObject({
    a: yupString().optional(),
  });

  expect(await schematicallyValidateAndReturn(schema1, {}, {})).toEqual(Result.ok(null));
  expect(await schematicallyValidateAndReturn(schema1, { a: 'b' }, {})).toEqual(Result.ok(null));
  expect(await schematicallyValidateAndReturn(schema1, {}, { a: 'b' })).toEqual(Result.ok(null));
  expect(await schematicallyValidateAndReturn(schema1, { a: 'b' }, { a: 'c' })).toEqual(Result.ok(null));
  expect(await schematicallyValidateAndReturn(schema1, {}, { a: null })).toEqual(Result.ok(null));
  expect(await schematicallyValidateAndReturn(schema1, { a: 'b' }, { a: null })).toEqual(Result.ok(null));
  expect(await schematicallyValidateAndReturn(yupObject({ a: yupMixed() }), {}, { "a.b": "c" })).toEqual(Result.ok(null));

  expect(await schematicallyValidateAndReturn(yupObject({}), { a: 'b' }, { "a.b": "c" })).toEqual(Result.error(`Object contains unknown properties: a`));
  expect(await schematicallyValidateAndReturn(schema1, {}, { a: 123 })).toEqual(Result.error('a must be a `string` type, but the final value was: `123`.'));

  await expect(schematicallyValidateAndReturn(yupObject({ a: yupMixed() }), { a: 'b' }, { "a.b": "c" })).rejects.toThrow(`Invalid override is not compatible with the base config: Tried to use dot notation to access "a.b", but "a" is not an object. Maybe this config is not normalizable?`);
});

// ---------------------------------------------------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------------------------------------------------

// C -> A
export const renderedOrganizationConfigToProjectCrud = (renderedConfig: OrganizationRenderedConfig): ProjectsCrud["Admin"]["Read"]['config'] => {
  const oauthProviders = typedEntries(renderedConfig.auth.oauth.providers)
    .map(([oauthProviderId, oauthProvider]) => {
      if (!oauthProvider.type) {
        return undefined;
      }
      if (!oauthProvider.allowSignIn) {
        return undefined;
      }
      return filterUndefined({
        provider_config_id: oauthProviderId,
        id: oauthProvider.type,
        type: oauthProvider.isShared ? 'shared' : 'standard',
        client_id: oauthProvider.clientId,
        client_secret: oauthProvider.clientSecret,
        facebook_config_id: oauthProvider.facebookConfigId,
        microsoft_tenant_id: oauthProvider.microsoftTenantId,
      } as const) satisfies ProjectsCrud["Admin"]["Read"]['config']['oauth_providers'][number];
    })
    .filter(isTruthy)
    .sort((a, b) => stringCompare(a.id, b.id));

  return {
    allow_localhost: renderedConfig.domains.allowLocalhost,
    client_team_creation_enabled: renderedConfig.teams.allowClientTeamCreation,
    client_user_deletion_enabled: renderedConfig.users.allowClientUserDeletion,
    sign_up_enabled: renderedConfig.auth.allowSignUp,
    oauth_account_merge_strategy: renderedConfig.auth.oauth.accountMergeStrategy,
    create_team_on_sign_up: renderedConfig.teams.createPersonalTeamOnSignUp,
    credential_enabled: renderedConfig.auth.password.allowSignIn,
    magic_link_enabled: renderedConfig.auth.otp.allowSignIn,
    passkey_enabled: renderedConfig.auth.passkey.allowSignIn,

    oauth_providers: oauthProviders,
    enabled_oauth_providers: oauthProviders,

    domains: typedEntries(renderedConfig.domains.trustedDomains)
      .map(([_, domainConfig]) => domainConfig.baseUrl === undefined ? undefined : ({
        domain: domainConfig.baseUrl,
        handler_path: domainConfig.handlerPath,
      }))
      .filter(isTruthy)
      .sort((a, b) => stringCompare(a.domain, b.domain)),

    email_config: renderedConfig.emails.server.isShared ? {
      type: 'shared',
    } : {
      type: 'standard',
      host: renderedConfig.emails.server.host,
      port: renderedConfig.emails.server.port,
      username: renderedConfig.emails.server.username,
      password: renderedConfig.emails.server.password,
      sender_name: renderedConfig.emails.server.senderName,
      sender_email: renderedConfig.emails.server.senderEmail,
    },
    email_theme: renderedConfig.emails.selectedThemeId,

    team_creator_default_permissions: typedEntries(renderedConfig.rbac.defaultPermissions.teamCreator)
      .filter(([_, perm]) => perm)
      .map(([id, perm]) => ({ id }))
      .sort((a, b) => stringCompare(a.id, b.id)),
    team_member_default_permissions: typedEntries(renderedConfig.rbac.defaultPermissions.teamMember)
      .filter(([_, perm]) => perm)
      .map(([id, perm]) => ({ id }))
      .sort((a, b) => stringCompare(a.id, b.id)),
    user_default_permissions: typedEntries(renderedConfig.rbac.defaultPermissions.signUp)
      .filter(([_, perm]) => perm)
      .map(([id, perm]) => ({ id }))
      .sort((a, b) => stringCompare(a.id, b.id)),

    allow_user_api_keys: renderedConfig.apiKeys.enabled.user,
    allow_team_api_keys: renderedConfig.apiKeys.enabled.team,
  };
};
