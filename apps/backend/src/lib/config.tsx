import { Prisma } from "@prisma/client";
import { Config, getInvalidConfigReason, normalize, override } from "@stackframe/stack-shared/dist/config/format";
import { BranchConfigOverride, BranchConfigOverrideOverride, BranchIncompleteConfig, BranchRenderedConfig, EnvironmentConfigOverride, EnvironmentConfigOverrideOverride, EnvironmentIncompleteConfig, EnvironmentRenderedConfig, OrganizationConfigOverride, OrganizationConfigOverrideOverride, OrganizationIncompleteConfig, OrganizationRenderedConfig, ProjectConfigOverride, ProjectConfigOverrideOverride, ProjectIncompleteConfig, ProjectRenderedConfig, applyBranchDefaults, applyEnvironmentDefaults, applyOrganizationDefaults, applyProjectDefaults, assertNoConfigOverrideErrors, branchConfigSchema, environmentConfigSchema, getConfigOverrideErrors, getIncompleteConfigWarnings, migrateConfigOverride, organizationConfigSchema, projectConfigSchema, sanitizeBranchConfig, sanitizeEnvironmentConfig, sanitizeOrganizationConfig, sanitizeProjectConfig } from "@stackframe/stack-shared/dist/config/schema";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { yupBoolean, yupMixed, yupObject, yupRecord, yupString, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
import { isTruthy } from "@stackframe/stack-shared/dist/utils/booleans";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined, typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { deindent, stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
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
    async (incompleteConfig) => await sanitizeProjectConfig(normalize(applyProjectDefaults(await incompleteConfig), { onDotIntoNonObject: "ignore" }) as any),
  );
}

export function getRenderedBranchConfigQuery(options: BranchOptions): RawQuery<Promise<BranchRenderedConfig>> {
  return RawQuery.then(
    getIncompleteBranchConfigQuery(options),
    async (incompleteConfig) => await sanitizeBranchConfig(normalize(applyBranchDefaults(await incompleteConfig), { onDotIntoNonObject: "ignore" }) as any),
  );
}

export function getRenderedEnvironmentConfigQuery(options: EnvironmentOptions): RawQuery<Promise<EnvironmentRenderedConfig>> {
  return RawQuery.then(
    getIncompleteEnvironmentConfigQuery(options),
    async (incompleteConfig) => await sanitizeEnvironmentConfig(normalize(applyEnvironmentDefaults(await incompleteConfig), { onDotIntoNonObject: "ignore" }) as any),
  );
}

export function getRenderedOrganizationConfigQuery(options: OrganizationOptions): RawQuery<Promise<OrganizationRenderedConfig>> {
  return RawQuery.then(
    getIncompleteOrganizationConfigQuery(options),
    async (incompleteConfig) => await sanitizeOrganizationConfig(normalize(applyOrganizationDefaults(await incompleteConfig), { onDotIntoNonObject: "ignore" }) as any),
  );
}


// ---------------------------------------------------------------------------------------------------------------------
// validate<$$$>ConfigOverride
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Validates a project config override ([sanity-check valid](./README.md)).
 */
export async function validateProjectConfigOverride(options: { projectConfigOverride: ProjectConfigOverride }): Promise<Result<null, string>> {
  return await validateConfigOverrideSchema(
    projectConfigSchema,
    {},
    options.projectConfigOverride,
  );
}

/**
 * Validates a branch config override ([sanity-check valid](./README.md)), based on the given project's rendered project config.
 */
export async function validateBranchConfigOverride(options: { branchConfigOverride: BranchConfigOverride } & ProjectOptions): Promise<Result<null, string>> {
  return await validateConfigOverrideSchema(
    branchConfigSchema,
    await rawQuery(globalPrismaClient, getIncompleteProjectConfigQuery(options)),
    options.branchConfigOverride,
  );
  // TODO add some more checks that depend on the base config; eg. an override config shouldn't set email server connection if isShared==true
  // (these are schematically valid, but make no sense, so we should be nice and reject them)
}

/**
 * Validates an environment config override ([sanity-check valid](./README.md)), based on the given branch's rendered branch config.
 */
export async function validateEnvironmentConfigOverride(options: { environmentConfigOverride: EnvironmentConfigOverride } & BranchOptions): Promise<Result<null, string>> {
  return await validateConfigOverrideSchema(
    environmentConfigSchema,
    await rawQuery(globalPrismaClient, getIncompleteBranchConfigQuery(options)),
    options.environmentConfigOverride,
  );
  // TODO add some more checks that depend on the base config; eg. an override config shouldn't set email server connection if isShared==true
  // (these are schematically valid, but make no sense, so we should be nice and reject them)
}

/**
 * Validates an organization config override ([sanity-check valid](./README.md)), based on the given environment's rendered environment config.
 */
export async function validateOrganizationConfigOverride(options: { organizationConfigOverride: OrganizationConfigOverride } & EnvironmentOptions): Promise<Result<null, string>> {
  return await validateConfigOverrideSchema(
    organizationConfigSchema,
    await rawQuery(globalPrismaClient, getIncompleteEnvironmentConfigQuery(options)),
    options.organizationConfigOverride,
  );
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
      if (queryResult.length > 1) {
        throw new StackAssertionError(`Expected 0 or 1 project config overrides for project ${options.projectId}, got ${queryResult.length}`, { queryResult });
      }
      if (queryResult.length === 0) {
        throw new StackAssertionError(`Expected a project row for project ${options.projectId}, got 0`, { queryResult, options });
      }
      return migrateConfigOverride("project", queryResult[0].projectConfigOverride ?? {});
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
      return migrateConfigOverride("branch", {});
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
      return migrateConfigOverride("environment", queryResult[0]?.config ?? {});
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
      return migrateConfigOverride("organization", {});
    },
  };
}


// ---------------------------------------------------------------------------------------------------------------------
// override<$$$>ConfigOverride
// ---------------------------------------------------------------------------------------------------------------------

// Note that the arguments passed in here override the override; they are therefore OverrideOverrides.
// Also, note that the CALLER of these functions is responsible for validating the override, and making sure that
// there are no errors (warnings are allowed, but most UIs should probably ensure there are no warnings before allowing
// a user to save the override).

export async function overrideProjectConfigOverride(options: {
  projectId: string,
  projectConfigOverrideOverride: ProjectConfigOverrideOverride,
}): Promise<void> {
  // set project config override on our own DB

  // TODO put this in a serializable transaction (or a single SQL query) to prevent race conditions
  const oldConfig = await rawQuery(globalPrismaClient, getProjectConfigOverrideQuery(options));
  const newConfig = override(
    oldConfig,
    options.projectConfigOverrideOverride,
  );
  await assertNoConfigOverrideErrors(projectConfigSchema, newConfig);
  await globalPrismaClient.project.update({
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
}): Promise<void> {
  // save environment config override on DB

  // TODO put this in a serializable transaction (or a single SQL query) to prevent race conditions
  const oldConfig = await rawQuery(globalPrismaClient, getEnvironmentConfigOverrideQuery(options));
  const newConfig = override(
    oldConfig,
    options.environmentConfigOverrideOverride,
  );
  await assertNoConfigOverrideErrors(environmentConfigSchema, newConfig);
  await globalPrismaClient.environmentConfigOverride.upsert({
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
  return RawQuery.then(
    makeUnsanitizedIncompleteConfigQuery({
      override: getProjectConfigOverrideQuery(options),
      schema: projectConfigSchema,
      extraInfo: options,
    }),
    async (config) => await config,
  );
}

function getIncompleteBranchConfigQuery(options: BranchOptions): RawQuery<Promise<BranchIncompleteConfig>> {
  return RawQuery.then(
    makeUnsanitizedIncompleteConfigQuery({
      previous: getIncompleteProjectConfigQuery(options),
      override: getBranchConfigOverrideQuery(options),
      schema: branchConfigSchema,
      extraInfo: options,
    }),
    async (config) => await config,
  );
}

function getIncompleteEnvironmentConfigQuery(options: EnvironmentOptions): RawQuery<Promise<EnvironmentIncompleteConfig>> {
  return RawQuery.then(
    makeUnsanitizedIncompleteConfigQuery({
      previous: getIncompleteBranchConfigQuery(options),
      override: getEnvironmentConfigOverrideQuery(options),
      schema: environmentConfigSchema,
      extraInfo: options,
    }),
    async (config) => await config,
  );
}

function getIncompleteOrganizationConfigQuery(options: OrganizationOptions): RawQuery<Promise<OrganizationIncompleteConfig>> {
  return RawQuery.then(
    makeUnsanitizedIncompleteConfigQuery({
      previous: getIncompleteEnvironmentConfigQuery(options),
      override: getOrganizationConfigOverrideQuery(options),
      schema: organizationConfigSchema,
      extraInfo: options,
    }),
    async (config) => await config,
  );
}

function makeUnsanitizedIncompleteConfigQuery<T, O>(options: { previous?: RawQuery<Promise<Config>>, override: RawQuery<Promise<Config>>, schema: yup.AnySchema, extraInfo: any }): RawQuery<Promise<any>> {
  return RawQuery.then(
    RawQuery.all([
      options.previous ?? RawQuery.resolve(Promise.resolve({})),
      options.override,
    ] as const),
    async ([prevPromise, overPromise]) => {
      const prev = await prevPromise;
      const over = await overPromise;
      await assertNoConfigOverrideErrors(options.schema, over, { extraInfo: options.extraInfo });
      return override(prev, over);
    },
  );
}

/**
 * Validates the config override against three different schemas: the base one, the default one, and an empty base.
 *
 *
 */
async function validateConfigOverrideSchema(
  schema: yup.AnySchema,
  base: any,
  configOverride: any,
): Promise<Result<null, string>> {
  const mergedResBase = await _validateConfigOverrideSchemaImpl(schema, base, configOverride);
  if (mergedResBase.status === "error") return mergedResBase;

  return Result.ok(null);
}

async function _validateConfigOverrideSchemaImpl(
  schema: yup.AnySchema,
  base: any,
  configOverride: any,
): Promise<Result<null, string>> {
  // Check config format
  const reason = getInvalidConfigReason(configOverride, { configName: 'override' });
  if (reason) return Result.error("[FORMAT ERROR]" + reason);

  // Ensure there are no errors in the config override
  const errors = await getConfigOverrideErrors(schema, configOverride);
  if (errors.status === "error") {
    return Result.error("[ERROR] " + errors.error);
  }

  // Override
  const overridden = override(base, configOverride);

  // Get warnings
  const warnings = await getIncompleteConfigWarnings(schema, overridden);
  if (warnings.status === "error") {
    return Result.error("[WARNING] " + warnings.error);
  }
  return Result.ok(null);
}

import.meta.vitest?.test('_validateConfigOverrideSchemaImpl(...)', async ({ expect }) => {
  const schema1 = yupObject({
    a: yupString().optional(),
  });
  const recordSchema = yupObject({ a: yupRecord(yupString().defined(), yupString().defined()) }).defined();
  const unionSchema = yupObject({
    a: yupUnion(
      yupString().defined().oneOf(['never']),
      yupObject({ time: yupString().defined().oneOf(['now']) }).defined(),
      yupObject({ time: yupString().defined().oneOf(['tomorrow']), morning: yupBoolean().defined() }).defined()
    ).defined()
  }).defined();

  // Base success cases
  expect(await validateConfigOverrideSchema(schema1, {}, {})).toEqual(Result.ok(null));
  expect(await validateConfigOverrideSchema(schema1, { a: 'b' }, {})).toEqual(Result.ok(null));
  expect(await validateConfigOverrideSchema(schema1, {}, { a: 'b' })).toEqual(Result.ok(null));
  expect(await validateConfigOverrideSchema(schema1, { a: 'b' }, { a: 'c' })).toEqual(Result.ok(null));
  expect(await validateConfigOverrideSchema(schema1, {}, { a: null })).toEqual(Result.ok(null));
  expect(await validateConfigOverrideSchema(schema1, { a: 'b' }, { a: null })).toEqual(Result.ok(null));
  expect(await validateConfigOverrideSchema(yupObject({ a: yupString().defined() }), {}, { a: 'b' })).toEqual(Result.ok(null));
  expect(await validateConfigOverrideSchema(yupObject({ a: yupString().defined().oneOf(['b']) }), {}, { a: 'b' })).toEqual(Result.ok(null));
  expect(await validateConfigOverrideSchema(yupObject({ a: yupObject({ c: yupString().defined() }).defined() }), { a: {} }, { "a.c": 'd' })).toEqual(Result.ok(null));
  expect(await validateConfigOverrideSchema(recordSchema, { a: {} }, { "a.c": 'd' })).toEqual(Result.ok(null));
  expect(await validateConfigOverrideSchema(unionSchema, {}, { "a": 'never' })).toEqual(Result.ok(null));
  expect(await validateConfigOverrideSchema(unionSchema, { a: {} }, { "a": 'never' })).toEqual(Result.ok(null));
  expect(await validateConfigOverrideSchema(unionSchema, { a: {} }, { "a.time": 'now' })).toEqual(Result.ok(null));
  expect(await validateConfigOverrideSchema(unionSchema, { a: { "time": "tomorrow" } }, { "a.morning": true })).toEqual(Result.ok(null));

  // Error cases
  expect(await validateConfigOverrideSchema(yupObject({ a: yupObject({ b: yupObject({ c: yupString().defined() }).defined() }).defined() }), { a: { b: {} } }, { "a.b": { c: 123 } })).toEqual(Result.error("[ERROR] a.b.c must be a `string` type, but the final value was: `123`."));
  expect(await validateConfigOverrideSchema(yupObject({ a: yupString().defined().oneOf(['b']) }), {}, { a: 'c' })).toEqual(Result.error("[ERROR] a must be one of the following values: b"));
  expect(await validateConfigOverrideSchema(yupObject({ a: yupString().defined() }), {}, {})).toEqual(Result.error("[WARNING] a must be defined"));
  expect(await validateConfigOverrideSchema(yupObject({ a: yupMixed() }), {}, { "a.b": "c" })).toEqual(Result.error(`[ERROR] The key \"a.b\" is not valid for the schema.`));
  expect(await validateConfigOverrideSchema(yupObject({ a: yupMixed() }), { a: 'str' }, { "a.b": "c" })).toEqual(Result.error(`[ERROR] The key \"a.b\" is not valid for the schema.`));
  expect(await validateConfigOverrideSchema(schema1, {}, { a: 123 })).toEqual(Result.error('[ERROR] a must be a `string` type, but the final value was: `123`.'));
  expect(await validateConfigOverrideSchema(unionSchema, { a: { "time": "now" } }, { "a.morning": true })).toMatchInlineSnapshot(`
    {
      "error": "[WARNING] a is not matched by any of the provided schemas:
      Schema 0:
        a must be a \`string\` type, but the final value was: \`{
          "time": "\\"now\\"",
          "morning": "true"
        }\`.
      Schema 1:
        a contains unknown properties: morning
      Schema 2:
        a.time must be one of the following values: tomorrow",
      "status": "error",
    }
  `);

  // Actual configs — base cases
  const projectSchemaBase = {};
  expect(await validateConfigOverrideSchema(projectConfigSchema, projectSchemaBase, {})).toEqual(Result.ok(null));
  const branchSchemaBase = projectSchemaBase;
  expect(await validateConfigOverrideSchema(branchConfigSchema, branchSchemaBase, {})).toEqual(Result.ok(null));
  const environmentSchemaBase = branchSchemaBase;
  expect(await validateConfigOverrideSchema(environmentConfigSchema, environmentSchemaBase, {})).toEqual(Result.ok(null));
  const organizationSchemaBase = environmentSchemaBase;
  expect(await validateConfigOverrideSchema(organizationConfigSchema, organizationSchemaBase, {})).toEqual(Result.ok(null));

  // Actual configs — advanced cases
  expect(await validateConfigOverrideSchema(projectConfigSchema, projectSchemaBase, {
    sourceOfTruth: {
      type: 'postgres',
      connectionString: 'postgres://user:pass@host:port/db',
    },
  })).toEqual(Result.ok(null));
  expect(await validateConfigOverrideSchema(projectConfigSchema, projectSchemaBase, {
    sourceOfTruth: {
      type: 'postgres',
    },
  })).toEqual(Result.error(deindent`
    [WARNING] sourceOfTruth is not matched by any of the provided schemas:
      Schema 0:
        sourceOfTruth.type must be one of the following values: hosted
      Schema 1:
        sourceOfTruth.connectionStrings must be defined
      Schema 2:
        sourceOfTruth.connectionString must be defined
  `));
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
