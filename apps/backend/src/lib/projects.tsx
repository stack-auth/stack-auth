import { Prisma } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { override } from "@stackframe/stack-shared/dist/config/format";
import { EnvironmentConfigOverride, OrganizationRenderedConfig } from "@stackframe/stack-shared/dist/config/schema";
import { AdminUserProjectsCrud, ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { RawQuery, rawQuery, retryTransaction } from "../prisma-client";
import { getRenderedOrganizationConfigQuery, renderedOrganizationConfigToProjectCrud } from "./config";
import { getSoleTenancyFromProject } from "./tenancies";

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

export function getProjectQuery(projectId: string): RawQuery<Promise<ProjectsCrud["Admin"]["Read"] | null>> {
  return RawQuery.then(
    RawQuery.all([
      {
        sql: Prisma.sql`
          SELECT "Project".*
          FROM "Project"
          WHERE "Project"."id" = ${projectId}
        `,
        postProcess: (queryResult) => {
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
            user_count: row.userCount,
            is_production_mode: row.isProductionMode,
          };
        },
      } as const,
      getRenderedOrganizationConfigQuery({ projectId, branchId: "main", organizationId: null }),
    ] as const),
    async (result) => {
      const projectPart = result[0];
      if (!projectPart) {
        return null;
      }
      const renderedConfig = await result[1];

      return {
        ...projectPart,
        config: renderedOrganizationConfigToProjectCrud(renderedConfig),
      };
    }
  );
}

export async function getProject(projectId: string): Promise<ProjectsCrud["Admin"]["Read"] | null> {
  const result = await rawQuery(getProjectQuery(projectId));
  return result;
}

export async function createOrUpdateProject(
  options: {
    ownerIds?: string[],
    branchId: string,
  } & ({
    type: "create",
    data: AdminUserProjectsCrud["Admin"]["Create"],
  } | {
    type: "update",
    projectId: string,
    data: ProjectsCrud["Admin"]["Update"],
  })
) {
  const projectId = await retryTransaction(async (tx) => {
    let project: Prisma.ProjectGetPayload<{ include: { environmentConfigOverrides: true } }>;
    let tenancyId: string;
    if (options.type === "create") {
      project = await tx.project.create({
        data: {
          id: generateUuid(),
          displayName: options.data.display_name,
          description: options.data.description ?? "",
          isProductionMode: options.data.is_production_mode ?? false,
        },
        include: {
          environmentConfigOverrides: true,
        },
      });

      tenancyId = (await tx.tenancy.create({
        data: {
          projectId: project.id,
          branchId: options.branchId,
          organizationId: null,
          hasNoOrganization: "TRUE",
        },
      })).id;
    } else {
      const projectFound = await tx.project.findUnique({
        where: {
          id: options.projectId,
        },
        include: {
          environmentConfigOverrides: true,
        },
      });

      if (!projectFound) {
        throw new KnownErrors.ProjectNotFound(options.projectId);
      }

      project = projectFound;

      tenancyId = (await getSoleTenancyFromProject(projectFound.id)).id;
    }

    const dataOptions = options.data.config || {};
    const newConfigOverride: EnvironmentConfigOverride = filterUndefined({
      // ======================= auth =======================
      'auth.allowSignUp': dataOptions.sign_up_enabled,
      'auth.password.allowSignIn': dataOptions.credential_enabled,
      'auth.otp.allowSignIn': dataOptions.magic_link_enabled,
      'auth.passkey.allowSignIn': dataOptions.passkey_enabled,
      'auth.oauth.accountMergeStrategy': dataOptions.oauth_account_merge_strategy,
      'auth.oauth.providers': dataOptions.oauth_providers ? dataOptions.oauth_providers
        .filter((provider) => provider.enabled)
        .map((provider) => {
          return {
            type: provider.id,
            allowSignIn: true,
            allowConnectedAccounts: true,
          } satisfies OrganizationRenderedConfig['auth']['oauth']['providers'][string];
        }) : undefined,
      // ======================= users =======================
      'users.allowClientUserDeletion': dataOptions.client_user_deletion_enabled,
      // ======================= teams =======================
      'teams.allowClientTeamCreation': dataOptions.client_team_creation_enabled,
      'teams.createPersonalTeamOnSignUp': dataOptions.create_team_on_sign_up,
      // ======================= domains =======================
      'domains.allowLocalhost': dataOptions.allow_localhost,
      'domains.trustedDomains': dataOptions.domains ? dataOptions.domains.map((domain) => {
        return {
          baseUrl: domain.domain,
          handlerPath: domain.handler_path,
        } satisfies OrganizationRenderedConfig['domains']['trustedDomains'][string];
      }) : undefined,
      // ======================= api keys =======================
      'apiKeys.enabled.user': dataOptions.allow_user_api_keys,
      'apiKeys.enabled.team': dataOptions.allow_team_api_keys,
      // ======================= emails =======================
      'emails.emailServer': dataOptions.email_config ? {
        isShared: dataOptions.email_config.type === 'shared',
        host: dataOptions.email_config.host,
        port: dataOptions.email_config.port,
        username: dataOptions.email_config.username,
        password: dataOptions.email_config.password,
        senderName: dataOptions.email_config.sender_name,
        senderEmail: dataOptions.email_config.sender_email,
      } satisfies OrganizationRenderedConfig['emails']['server'] : undefined,
    });

    if (options.type === "create") {
      newConfigOverride['rbac.permissions'] = {
        'member': {
          description: "Default permission for team members",
          scope: "team",
          containedPermissionIds: {
            '$read_members': true,
            '$invite_members': true,
          },
        },
        'team_admin': {
          description: "Default permission for team admins",
          scope: "team",
          containedPermissionIds: {
            '$update_team': true,
            '$delete_team': true,
            '$read_members': true,
            '$invite_members': true,
            '$manage_api_keys': true,
          },
        }
      } satisfies OrganizationRenderedConfig['rbac']['permissions'];
    }

    const oldConfigOverride = project.environmentConfigOverrides.find((override) => override.branchId === options.branchId)?.config as EnvironmentConfigOverride | undefined;
    if (!oldConfigOverride) {
      // TODO: make this a KnownError once we have branches
      throw new StackAssertionError(`Expected config override for branch ${options.branchId}, but none found`, { project });
    }


    await tx.environmentConfigOverride.update({
      where: {
        projectId_branchId: {
          projectId: project.id,
          branchId: options.branchId,
        },
      },
      data: {
        config: override(oldConfigOverride, newConfigOverride),
      },
    });

    // Update owner metadata
    for (const userId of options.ownerIds ?? []) {
      const projectUserTx = await tx.projectUser.findUnique({
        where: {
          mirroredProjectId_mirroredBranchId_projectUserId: {
            mirroredProjectId: "internal",
            mirroredBranchId: "main",
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
            mirroredBranchId: "main",
            projectUserId: projectUserTx.projectUserId,
          },
        },
        data: {
          serverMetadata: {
            ...serverMetadataTx ?? {},
            managedProjectIds: [
              ...serverMetadataTx?.managedProjectIds ?? [],
              project.id,
            ],
          },
        },
      });
    }

    return project.id;
  });

  const result = await getProject(projectId);

  if (!result) {
    throw new StackAssertionError("Project not found after creation/update");
  }

  return result;
}
