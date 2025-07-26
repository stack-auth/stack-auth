import { Prisma } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { EnvironmentConfigOverrideOverride, OrganizationRenderedConfig, ProjectConfigOverrideOverride } from "@stackframe/stack-shared/dist/config/schema";
import { AdminUserProjectsCrud, ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined, typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { RawQuery, getPrismaClientForSourceOfTruth, globalPrismaClient, rawQuery, retryTransaction } from "../prisma-client";
import { getRenderedEnvironmentConfigQuery, overrideEnvironmentConfigOverride, overrideProjectConfigOverride } from "./config";
import { DEFAULT_BRANCH_ID } from "./tenancies";

function isStringArray(value: any): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string");
}

export function listManagedProjectIds(projectUser: UsersCrud["Admin"]["Read"]) {
  const serverMetadata = projectUser.server_metadata;
  if (typeof serverMetadata !== "object") {
    throw new StackAssertionError("Invalid server metadata, did something go wrong?", { serverMetadata });
  }
  const managedProjectIds = (serverMetadata as any)?.managedProjectIds ?? [];
  if (!isStringArray(managedProjectIds)) {
    throw new StackAssertionError("Invalid server metadata, did something go wrong? Expected string array", { managedProjectIds });
  }

  return managedProjectIds;
}

export function getProjectQuery(projectId: string): RawQuery<Promise<Omit<ProjectsCrud["Admin"]["Read"], "config"> | null>> {
  return {
    supportedPrismaClients: ["global"],
    sql: Prisma.sql`
          SELECT "Project".*
          FROM "Project"
          WHERE "Project"."id" = ${projectId}
        `,
    postProcess: async (queryResult) => {
      if (queryResult.length > 1) {
        throw new StackAssertionError(`Expected 0 or 1 projects with id ${projectId}, got ${queryResult.length}`, { queryResult });
      }
      if (queryResult.length === 0) {
        return null;
      }
      const row = queryResult[0];
      return {
        id: row.id,
        display_name: row.displayName,
        description: row.description,
        created_at_millis: new Date(row.createdAt + "Z").getTime(),
        is_production_mode: row.isProductionMode,
      };
    },
  };
}

export async function getProject(projectId: string): Promise<Omit<ProjectsCrud["Admin"]["Read"], "config"> | null> {
  const result = await rawQuery(globalPrismaClient, getProjectQuery(projectId));
  return result;
}

export async function createOrUpdateProject(
  options: {
    ownerIds?: string[],
    sourceOfTruth?: ProjectConfigOverrideOverride["sourceOfTruth"],
  } & ({
    type: "create",
    projectId?: string,
    data: AdminUserProjectsCrud["Admin"]["Create"],
  } | {
    type: "update",
    projectId: string,
    /** The old config is specific to a tenancy, so this branchId specifies which tenancy it will update */
    branchId: string,
    data: ProjectsCrud["Admin"]["Update"],
  })
) {
  const [projectId, branchId] = await retryTransaction(globalPrismaClient, async (tx) => {
    let project: Prisma.ProjectGetPayload<{}>;
    let branchId: string;
    if (options.type === "create") {
      branchId = DEFAULT_BRANCH_ID;
      project = await tx.project.create({
        data: {
          id: options.projectId ?? generateUuid(),
          displayName: options.data.display_name,
          description: options.data.description ?? "",
          isProductionMode: options.data.is_production_mode ?? false,
        },
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

      project = await tx.project.update({
        where: {
          id: projectFound.id,
        },
        data: {
          displayName: options.data.display_name,
          description: options.data.description === null ? "" : options.data.description,
          isProductionMode: options.data.is_production_mode,
        },
      });
      branchId = options.branchId;
    }

    const translateDefaultPermissions = (permissions: { id: string }[] | undefined) => {
      return permissions ? typedFromEntries(permissions.map((permission) => [permission.id, true])) : undefined;
    };

    await overrideProjectConfigOverride({
      tx,
      projectId: project.id,
      projectConfigOverrideOverride: {
        sourceOfTruth: options.sourceOfTruth || (JSON.parse(getEnvVariable("STACK_OVERRIDE_SOURCE_OF_TRUTH", "null")) ?? undefined),
      },
    });

    const dataOptions = options.data.config || {};
    const configOverrideOverride: EnvironmentConfigOverrideOverride = filterUndefined({
      // ======================= auth =======================
      'auth.allowSignUp': dataOptions.sign_up_enabled,
      'auth.password.allowSignIn': dataOptions.credential_enabled,
      'auth.otp.allowSignIn': dataOptions.magic_link_enabled,
      'auth.passkey.allowSignIn': dataOptions.passkey_enabled,
      'auth.oauth.accountMergeStrategy': dataOptions.oauth_account_merge_strategy,
      'auth.oauth.providers': dataOptions.oauth_providers ? typedFromEntries(dataOptions.oauth_providers
        .map((provider) => {
          return [
            provider.id,
            {
              type: provider.id,
              isShared: provider.type === "shared",
              clientId: provider.client_id,
              clientSecret: provider.client_secret,
              facebookConfigId: provider.facebook_config_id,
              microsoftTenantId: provider.microsoft_tenant_id,
              allowSignIn: true,
              allowConnectedAccounts: true,
            } satisfies OrganizationRenderedConfig['auth']['oauth']['providers'][string]
          ];
        })) : undefined,
      // ======================= users =======================
      'users.allowClientUserDeletion': dataOptions.client_user_deletion_enabled,
      // ======================= teams =======================
      'teams.allowClientTeamCreation': dataOptions.client_team_creation_enabled,
      'teams.createPersonalTeamOnSignUp': dataOptions.create_team_on_sign_up,
      // ======================= domains =======================
      'domains.allowLocalhost': dataOptions.allow_localhost ?? true,
      'domains.trustedDomains': dataOptions.domains ? typedFromEntries(dataOptions.domains.map((domain) => {
        return [
          generateUuid(),
          {
            baseUrl: domain.domain,
            handlerPath: domain.handler_path,
          } satisfies OrganizationRenderedConfig['domains']['trustedDomains'][string],
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
      } satisfies OrganizationRenderedConfig['emails']['server'] : undefined,
      'emails.selectedThemeId': dataOptions.email_theme,
      // ======================= rbac =======================
      'rbac.defaultPermissions.teamMember': translateDefaultPermissions(dataOptions.team_member_default_permissions),
      'rbac.defaultPermissions.teamCreator': translateDefaultPermissions(dataOptions.team_creator_default_permissions),
      'rbac.defaultPermissions.signUp': translateDefaultPermissions(dataOptions.user_default_permissions),
    });

    if (options.type === "create") {
      configOverrideOverride['rbac.permissions.team_member'] ??= {
        description: "Default permission for team members",
        scope: "team",
        containedPermissionIds: {
          '$read_members': true,
          '$invite_members': true,
        },
      } satisfies OrganizationRenderedConfig['rbac']['permissions'][string];
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
      } satisfies OrganizationRenderedConfig['rbac']['permissions'][string];

      configOverrideOverride['rbac.defaultPermissions.teamCreator'] ??= { 'team_admin': true };
      configOverrideOverride['rbac.defaultPermissions.teamMember'] ??= { 'team_member': true };

      configOverrideOverride['auth.password.allowSignIn'] ??= true;
    }

    await overrideEnvironmentConfigOverride({
      tx,
      projectId: project.id,
      branchId: branchId,
      environmentConfigOverrideOverride: configOverrideOverride,
    });

    return [project.id, branchId];
  });


  // Update owner metadata
  const internalEnvironmentConfig = await rawQuery(globalPrismaClient, getRenderedEnvironmentConfigQuery({ projectId: "internal", branchId: DEFAULT_BRANCH_ID }));
  const prisma = await getPrismaClientForSourceOfTruth(internalEnvironmentConfig.sourceOfTruth, DEFAULT_BRANCH_ID);
  await prisma.$transaction(async (tx) => {
    for (const userId of options.ownerIds ?? []) {
      const projectUserTx = await tx.projectUser.findUnique({
        where: {
          mirroredProjectId_mirroredBranchId_projectUserId: {
            mirroredProjectId: "internal",
            mirroredBranchId: DEFAULT_BRANCH_ID,
            projectUserId: userId,
          },
        },
      });
      if (!projectUserTx) {
        captureError("project-creation-owner-not-found", new StackAssertionError(`Attempted to create project, but owner user ID ${userId} not found. Did they delete their account? Continuing silently, but if the user is coming from an owner pack you should probably update it.`, { ownerIds: options.ownerIds }));
        continue;
      }

      const serverMetadataTx: any = projectUserTx.serverMetadata ?? {};

      await tx.projectUser.update({
        where: {
          mirroredProjectId_mirroredBranchId_projectUserId: {
            mirroredProjectId: "internal",
            mirroredBranchId: DEFAULT_BRANCH_ID,
            projectUserId: projectUserTx.projectUserId,
          },
        },
        data: {
          serverMetadata: {
            ...serverMetadataTx ?? {},
            managedProjectIds: [
              ...serverMetadataTx?.managedProjectIds ?? [],
              projectId,
            ],
          },
        },
      });
    }
  });

  const result = await getProject(projectId);

  if (!result) {
    throw new StackAssertionError("Project not found after creation/update", { projectId });
  }

  return result;
}
