import { Prisma } from "@/generated/prisma/client";
import { uploadAndGetUrl } from "@/s3";
import { KnownErrors } from "@hexclave/shared";
import { CompleteConfig, EnvironmentConfigOverrideOverride, ProjectConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import { AdminUserProjectsCrud, ProjectsCrud } from "@hexclave/shared/dist/interface/crud/projects";
import { UsersCrud } from "@hexclave/shared/dist/interface/crud/users";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { filterUndefined, typedEntries, typedFromEntries } from "@hexclave/shared/dist/utils/objects";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import { RawQuery, getPrismaClientForTenancy, globalPrismaClient, rawQuery, retryTransaction } from "../prisma-client";
import { overrideBranchConfigOverride, overrideEnvironmentConfigOverride, overrideProjectConfigOverride, resetEnvironmentConfigOverrideKeys } from "./config";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "./tenancies";

export async function listManagedProjectIds(projectUser: UsersCrud["Admin"]["Read"]) {
  const internalTenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);
  const internalPrisma = await getPrismaClientForTenancy(internalTenancy);
  const teams = await internalPrisma.team.findMany({
    where: {
      tenancyId: internalTenancy.id,
      teamMembers: {
        some: {
          projectUserId: projectUser.id,
        }
      }
    },
  });
  const projectIds = await globalPrismaClient.project.findMany({
    where: {
      ownerTeamId: {
        in: teams.map((team) => team.teamId),
      },
    },
    select: {
      id: true,
    },
  });
  return projectIds.map((project) => project.id);
}

export function getProjectQuery(projectId: string): RawQuery<Promise<Omit<ProjectsCrud["Admin"]["Read"], "config"> | null>> {
  return {
    supportedPrismaClients: ["global"],
    readOnlyQuery: true,
    sql: Prisma.sql`
          SELECT "Project".*
          FROM "Project"
          WHERE "Project"."id" = ${projectId}
        `,
    postProcess: async (queryResult) => {
      if (queryResult.length > 1) {
        throw new HexclaveAssertionError(`Expected 0 or 1 projects with id ${projectId}, got ${queryResult.length}`, { queryResult });
      }
      if (queryResult.length === 0) {
        return null;
      }
      const row = queryResult[0];
      const onboardingState = row.onboardingState;
      if (onboardingState != null && (typeof onboardingState !== "object" || Array.isArray(onboardingState))) {
        throw new HexclaveAssertionError("Expected Project.onboardingState to be an object or null.", {
          projectId,
          onboardingState,
        });
      }
      return {
        id: row.id,
        display_name: row.displayName,
        description: row.description,
        logo_url: row.logoUrl,
        logo_full_url: row.logoFullUrl,
        logo_dark_mode_url: row.logoDarkModeUrl,
        logo_full_dark_mode_url: row.logoFullDarkModeUrl,
        created_at_millis: new Date(row.createdAt + "Z").getTime(),
        is_production_mode: row.isProductionMode,
        is_development_environment: row.isDevelopmentEnvironment,
        owner_team_id: row.ownerTeamId,
        onboarding_status: row.onboardingStatus,
        onboarding_state: onboardingState ?? undefined,
        pushed_config_error: null,
        config_warnings: [],
      };
    },
  };
}

export async function getProject(projectId: string): Promise<Omit<ProjectsCrud["Admin"]["Read"], "config"> | null> {
  const result = await rawQuery(globalPrismaClient, getProjectQuery(projectId));
  return result;
}

export async function createOrUpdateProjectWithLegacyConfig(
  options: {
    sourceOfTruth?: ProjectConfigOverrideOverride["sourceOfTruth"],
  } & ({
    type: "create",
    projectId?: string,
    data: Omit<AdminUserProjectsCrud["Admin"]["Create"], "owner_team_id"> & { owner_team_id: string | null },
  } | {
    type: "update",
    projectId: string,
    /** The old config is specific to a tenancy, so this branchId specifies which tenancy it will update */
    branchId: string,
    data: ProjectsCrud["Admin"]["Update"],
  })
) {
  const logoFields = ['logo_url', 'logo_full_url', 'logo_dark_mode_url', 'logo_full_dark_mode_url'] as const;
  const logoUrls: Record<string, string | null | undefined> = {};

  for (const field of logoFields) {
    if (options.data[field] !== undefined) {
      logoUrls[field] = await uploadAndGetUrl(options.data[field], "project-logos");
    }
  }

  const [projectId, branchId] = await retryTransaction(globalPrismaClient, async (tx) => {
    const onboardingColumnExistsRows = await tx.$queryRaw<Array<{ onboardingStatusExists: boolean, onboardingStateExists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Project'
          AND column_name = 'onboardingStatus'
      ) AS "onboardingStatusExists",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Project'
          AND column_name = 'onboardingState'
      ) AS "onboardingStateExists"
    `;
    const onboardingStatusColumnExists = onboardingColumnExistsRows[0]?.onboardingStatusExists === true;
    const onboardingStateColumnExists = onboardingColumnExistsRows[0]?.onboardingStateExists === true;

    let project: Prisma.ProjectGetPayload<{}>;
    let branchId: string;
    if (options.type === "create") {
      branchId = DEFAULT_BRANCH_ID;
      const createData: Prisma.ProjectCreateInput = {
        id: options.projectId ?? generateUuid(),
        displayName: options.data.display_name,
        description: options.data.description ?? "",
        isProductionMode: options.data.is_production_mode ?? false,
        ownerTeamId: options.data.owner_team_id,
        logoUrl: logoUrls['logo_url'],
        logoFullUrl: logoUrls['logo_full_url'],
        logoDarkModeUrl: logoUrls['logo_dark_mode_url'],
        logoFullDarkModeUrl: logoUrls['logo_full_dark_mode_url'],
      };
      if (onboardingStatusColumnExists && options.data.onboarding_status !== undefined) {
        createData.onboardingStatus = options.data.onboarding_status;
      }
      project = await tx.project.create({
        data: createData,
      });
      await tx.tenancy.create({
        data: {
          projectId: project.id,
          branchId,
          organizationId: null,
          hasNoOrganization: "TRUE",
        },
      });
    } else {
      const projectFound = await tx.project.findUnique({
        where: {
          id: options.projectId,
        },
      });

      if (!projectFound) {
        throw new KnownErrors.ProjectNotFound(options.projectId);
      }

      const updateData: Prisma.ProjectUpdateInput = {
        displayName: options.data.display_name,
        description: options.data.description === null ? "" : options.data.description,
        isProductionMode: options.data.is_production_mode,
        logoUrl: logoUrls['logo_url'],
        logoFullUrl: logoUrls['logo_full_url'],
        logoDarkModeUrl: logoUrls['logo_dark_mode_url'],
        logoFullDarkModeUrl: logoUrls['logo_full_dark_mode_url'],
      };
      if (onboardingStatusColumnExists && options.data.onboarding_status !== undefined) {
        updateData.onboardingStatus = options.data.onboarding_status;
      }

      project = await tx.project.update({
        where: {
          id: projectFound.id,
        },
        data: updateData,
      });
      branchId = options.branchId;
    }

    if (onboardingStateColumnExists && options.data.onboarding_state !== undefined) {
      const onboardingStateString = options.data.onboarding_state == null
        ? null
        : JSON.stringify(options.data.onboarding_state);
      await tx.$executeRaw`
        UPDATE "Project"
        SET "onboardingState" = ${onboardingStateString}::jsonb
        WHERE "id" = ${project.id}
      `;
    }

    return [project.id, branchId];
  });

  // Metadata-only onboarding updates should stay cheap and avoid touching config
  // source state; creation still needs the default project config override.
  if (options.type === "create" || options.sourceOfTruth !== undefined) {
    await overrideProjectConfigOverride({
      projectId: projectId,
      projectConfigOverrideOverride: {
        sourceOfTruth: options.sourceOfTruth || (JSON.parse(getEnvVariable("STACK_OVERRIDE_SOURCE_OF_TRUTH", "null")) ?? undefined),
      },
    });
  }

  // Update environment config override
  const translateDefaultPermissions = (permissions: { id: string }[] | undefined) => {
    return permissions ? typedFromEntries(permissions.map((permission) => [permission.id, true])) : undefined;
  };
  const dataOptions = options.data.config || {};

  // OAuth providers span two config layers: the BRANCH layer owns the provider roster
  // + enable fields, the ENVIRONMENT layer owns credentials. We write each as an
  // ordinary `auth.oauth.providers.<id>` object; `migrateConfigOverride("environment")`
  // flattens the environment objects into credential leaf keys and drops branch fields,
  // so the environment write can't clobber the branch roster at render.
  //
  // This legacy API treats `oauth_providers` as the FULL desired set (a roster
  // replacement, not a patch): we replace the whole branch roster and wipe + rewrite
  // the env credentials.
  //
  // Custom OIDC providers aren't representable in the legacy `oauth_providers` array,
  // so a naive roster replacement would silently delete them — the branch replacement
  // drops their enable fields and the env reset clears their credentials. On update we
  // read the existing custom_oidc providers and merge them back into BOTH layers.
  const oauthProvidersSpecified = dataOptions.oauth_providers !== undefined;
  const oauthBranchProviders: Record<string, { type: string, allowSignIn: boolean, allowConnectedAccounts: boolean }> = {};
  const oauthEnvProviders: EnvironmentConfigOverrideOverride = {};

  if (oauthProvidersSpecified && options.type === "update") {
    // Preserve existing custom_oidc providers (not representable in the legacy array).
    const tenancy = await getSoleTenancyFromProjectBranch(projectId, branchId);
    for (const [id, provider] of typedEntries(tenancy.config.auth.oauth.providers)) {
      if (provider.type !== "custom_oidc") {
        continue;
      }
      oauthBranchProviders[id] = { type: "custom_oidc", allowSignIn: provider.allowSignIn, allowConnectedAccounts: provider.allowConnectedAccounts };
      oauthEnvProviders[`auth.oauth.providers.${id}`] = filterUndefined({
        isShared: false,
        clientId: provider.clientId,
        clientSecret: provider.clientSecret,
        customCallbackUrl: provider.customCallbackUrl,
        issuerUrl: provider.issuerUrl,
        scope: provider.scope,
        displayName: provider.displayName,
      });
    }
  }

  for (const provider of dataOptions.oauth_providers ?? []) {
    oauthBranchProviders[provider.id] = { type: provider.id, allowSignIn: true, allowConnectedAccounts: true };
    if (provider.type !== "shared") {
      oauthEnvProviders[`auth.oauth.providers.${provider.id}`] = filterUndefined({
        isShared: false,
        clientId: provider.client_id,
        clientSecret: provider.client_secret,
        // Injecting the hexclave-branded callback for new providers is the dashboard's
        // job; this legacy path leaves customCallbackUrl unset so providers fall back to
        // the stack-auth callback.
        facebookConfigId: provider.facebook_config_id,
        microsoftTenantId: provider.microsoft_tenant_id,
        appleBundles: provider.apple_bundle_ids ? typedFromEntries(provider.apple_bundle_ids.map(bundleId => [generateUuid(), { bundleId }] as const)) : undefined,
      });
    }
  }
  // The entire branch roster, as a single key, so `override` clobbers the old roster.
  const oauthBranchProvidersWholeObject = oauthProvidersSpecified ? oauthBranchProviders : undefined;

  const configOverrideOverride: EnvironmentConfigOverrideOverride = filterUndefined({
    // ======================= auth =======================
    'auth.allowSignUp': dataOptions.sign_up_enabled,
    'auth.password.allowSignIn': dataOptions.credential_enabled,
    'auth.otp.allowSignIn': dataOptions.magic_link_enabled,
    'auth.passkey.allowSignIn': dataOptions.passkey_enabled,
    'auth.oauth.accountMergeStrategy': dataOptions.oauth_account_merge_strategy,
    // Provider credentials live in the environment layer (shared providers contribute
    // nothing here — they are branch-only). Written as whole `auth.oauth.providers.<id>`
    // objects; the environment config normalizer flattens them to leaf keys.
    ...oauthEnvProviders,
    // ======================= users =======================
    'users.allowClientUserDeletion': dataOptions.client_user_deletion_enabled,
    // ======================= teams =======================
    'teams.allowClientTeamCreation': dataOptions.client_team_creation_enabled,
    'teams.createPersonalTeamOnSignUp': dataOptions.create_team_on_sign_up,
    // ======================= domains =======================
    'domains.allowLocalhost': dataOptions.allow_localhost,
    'domains.trustedDomains': dataOptions.domains ? typedFromEntries(dataOptions.domains.map((domain) => {
      return [
        generateUuid(),
        {
          baseUrl: domain.domain,
          handlerPath: domain.handler_path,
        } satisfies CompleteConfig['domains']['trustedDomains'][string],
      ];
    })) : undefined,
    // ======================= api keys =======================
    'apiKeys.enabled.user': dataOptions.allow_user_api_keys,
    'apiKeys.enabled.team': dataOptions.allow_team_api_keys,
    // ======================= emails =======================
    'emails.server': dataOptions.email_config ? {
      isShared: dataOptions.email_config.type === 'shared',
      host: dataOptions.email_config.host,
      port: dataOptions.email_config.port,
      username: dataOptions.email_config.username,
      password: dataOptions.email_config.password,
      senderName: dataOptions.email_config.sender_name,
      senderEmail: dataOptions.email_config.sender_email,
      provider: "smtp",
      managedSubdomain: undefined,
      managedSenderLocalPart: undefined,
    } satisfies CompleteConfig['emails']['server'] : undefined,
    'emails.selectedThemeId': dataOptions.email_theme,
    // ======================= rbac =======================
    'rbac.defaultPermissions.teamMember': translateDefaultPermissions(dataOptions.team_member_default_permissions),
    'rbac.defaultPermissions.teamCreator': translateDefaultPermissions(dataOptions.team_creator_default_permissions),
    'rbac.defaultPermissions.signUp': translateDefaultPermissions(dataOptions.user_default_permissions),
    // ======================= onboarding =======================
    'onboarding.requireEmailVerification': dataOptions.require_email_verification,
  });

  if (options.type === "create") {
    configOverrideOverride['rbac.permissions.team_member'] ??= {
      description: "Default permission for team members",
      scope: "team",
      containedPermissionIds: {
        '$read_members': true,
        '$invite_members': true,
      },
    } satisfies CompleteConfig['rbac']['permissions'][string];
    configOverrideOverride['rbac.permissions.team_admin'] ??= {
      description: "Default permission for team admins",
      scope: "team",
      containedPermissionIds: {
        '$update_team': true,
        '$delete_team': true,
        '$read_members': true,
        '$remove_members': true,
        '$invite_members': true,
        '$manage_api_keys': true,
      },
    } satisfies CompleteConfig['rbac']['permissions'][string];

    configOverrideOverride['rbac.defaultPermissions.teamCreator'] ??= { 'team_admin': true };
    configOverrideOverride['rbac.defaultPermissions.teamMember'] ??= { 'team_member': true };

    configOverrideOverride['auth.password.allowSignIn'] ??= true;

    configOverrideOverride['apps.installed.authentication.enabled'] ??= true;
    configOverrideOverride['apps.installed.emails.enabled'] ??= true;
  }
  // Wipe the env layer's OAuth credentials FIRST. Removing a provider — or switching one to
  // shared keys — must not leave old credentials behind: at render the env layer takes
  // precedence over the branch layer, so stale credentials would bring back the old custom keys.
  // This has to run before the branch roster goes live, otherwise there's a moment where the new
  // roster plus the old credentials renders as the old custom keys. We remove the keys rather
  // than set them to null — a null in the env layer would itself override the branch roster.
  if (oauthProvidersSpecified) {
    await resetEnvironmentConfigOverrideKeys({
      projectId: projectId,
      branchId: branchId,
      keysToReset: ["auth.oauth.providers"],
    });
  }
  // The branch layer owns the provider roster + enabled state (writable even in development
  // environments); the env layer holds credentials only. We write the whole
  // `auth.oauth.providers` object so the override replaces the old roster, dropping any
  // providers absent from the new list. Branch goes before the env credential write so the
  // in-between moment (or a partial failure) leaves providers falling back to shared keys, never
  // enabled with no credentials.
  if (oauthBranchProvidersWholeObject !== undefined) {
    await overrideBranchConfigOverride({
      projectId: projectId,
      branchId: branchId,
      branchConfigOverrideOverride: { 'auth.oauth.providers': oauthBranchProvidersWholeObject },
    });
  }
  if (options.type === "create" || Object.keys(configOverrideOverride).length > 0) {
    await overrideEnvironmentConfigOverride({
      projectId: projectId,
      branchId: branchId,
      environmentConfigOverrideOverride: configOverrideOverride,
    });
  }
  if (options.type === "create" && options.data.is_development_environment !== undefined) {
    await globalPrismaClient.$executeRaw`
      UPDATE "Project"
      SET "isDevelopmentEnvironment" = ${options.data.is_development_environment}
      WHERE "id" = ${projectId}
    `;
  }
  const result = await getProject(projectId);
  if (!result) {
    throw new HexclaveAssertionError("Project not found after creation/update", { projectId });
  }
  return result;
}
