import { rawQuery } from "@/prisma-client";
import { KnownErrors } from "@stackframe/stack-shared";
import { override } from "@stackframe/stack-shared/dist/config/format";
import { EnvironmentConfigOverride, OrganizationRenderedConfig } from "@stackframe/stack-shared/dist/config/schema";
import { ProjectPermissionsCrud } from "@stackframe/stack-shared/dist/interface/crud/project-permissions";
import { TeamPermissionDefinitionsCrud, TeamPermissionsCrud } from "@stackframe/stack-shared/dist/interface/crud/team-permissions";
import { groupBy } from "@stackframe/stack-shared/dist/utils/arrays";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedEntries, typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { getRenderedOrganizationConfigQuery } from "./config";
import { Tenancy } from "./tenancies";
import { PrismaTransaction } from "./types";

const teamSystemPermissionMap: Record<string, string> = {
  "$update_team": "Update the team information",
  "$delete_team": "Delete the team",
  "$read_members": "Read and list the other members of the team",
  "$remove_members": "Remove other members from the team",
  "$invite_members": "Invite other users to the team",
  "$manage_api_keys": "Create and manage API keys for the team",
};

function getDescription(permissionId: string, specifiedDescription?: string) {
  if (specifiedDescription) return specifiedDescription;
  if (permissionId in teamSystemPermissionMap) return teamSystemPermissionMap[permissionId];
  return undefined;
}

export async function listPermissions<S extends "team" | "project">(
  tx: PrismaTransaction,
  options: {
    tenancy: Tenancy,
    userId?: string,
    permissionId?: string,
    recursive: boolean,
    scope: S,
  } & (S extends "team" ? {
    scope: "team",
    teamId?: string,
  } : {
    scope: "project",
  })
): Promise<S extends "team" ? TeamPermissionsCrud["Admin"]["Read"][] : ProjectPermissionsCrud["Admin"]["Read"][]> {
  const permissionDefs = await listPermissionDefinitions({
    scope: options.scope,
    tenancy: options.tenancy,
  });
  const permissionsMap = new Map(permissionDefs.map(p => [p.id, p]));
  const results = options.scope === "team" ?
    await tx.teamMemberDirectPermission.findMany({
      where: {
        tenancyId: options.tenancy.id,
        projectUserId: options.userId,
        teamId: (options as any).teamId
      },
    }) :
    await tx.projectUserDirectPermission.findMany({
      where: {
        tenancyId: options.tenancy.id,
        projectUserId: options.userId,
      },
    });

  const finalResults: { id: string, team_id?: string, user_id: string }[] = [];
  const groupedBy = groupBy(results, (result) => JSON.stringify([result.projectUserId, ...(options.scope === "team" ? [(result as any).teamId] : [])]));
  for (const [compositeKey, groupedResults] of groupedBy) {
    const [userId, teamId] = JSON.parse(compositeKey) as [string, string | undefined];
    const idsToProcess = groupedResults.map(p => p.permissionId);

    const result = new Map<string, typeof permissionDefs[number]>();
    while (idsToProcess.length > 0) {
      const currentId = idsToProcess.pop()!;
      const current = permissionsMap.get(currentId);
      if (!current) throw new StackAssertionError(`Couldn't find permission in DB`, { currentId, result, idsToProcess });
      if (result.has(current.id)) continue;
      result.set(current.id, current);
      if (options.recursive) {
        idsToProcess.push(...current.contained_permission_ids);
      }
    }

    finalResults.push(...[...result.values()].map(p => ({
      id: p.id,
      team_id: teamId,
      user_id: userId,
    })));
  }

  return finalResults
    .sort((a, b) => (options.scope === 'team' ? stringCompare((a as any).team_id, (b as any).team_id) : 0) || stringCompare(a.user_id, b.user_id) || stringCompare(a.id, b.id))
    .filter(p => options.permissionId ? p.id === options.permissionId : true) as any;
}

export async function grantTeamPermission(
  tx: PrismaTransaction,
  options: {
    tenancy: Tenancy,
    teamId: string,
    userId: string,
    permissionId: string,
  }
) {
  await tx.teamMemberDirectPermission.upsert({
    where: {
      tenancyId_projectUserId_teamId_permissionId: {
        tenancyId: options.tenancy.id,
        projectUserId: options.userId,
        teamId: options.teamId,
        permissionId: options.permissionId,
      },
    },
    create: {
      tenancyId: options.tenancy.id,
      projectUserId: options.userId,
      teamId: options.teamId,
      permissionId: options.permissionId,
    },
    update: {},
  });

  return {
    id: options.permissionId,
    user_id: options.userId,
    team_id: options.teamId,
  };
}

export async function revokeTeamPermission(
  tx: PrismaTransaction,
  options: {
    tenancy: Tenancy,
    teamId: string,
    userId: string,
    permissionId: string,
  }
) {
  await tx.teamMemberDirectPermission.delete({
    where: {
      tenancyId_projectUserId_teamId_permissionId: {
        tenancyId: options.tenancy.id,
        projectUserId: options.userId,
        teamId: options.teamId,
        permissionId: options.permissionId,
      },
    },
  });
}

export async function listPermissionDefinitions(
  options: {
    scope: "team" | "project",
    tenancy: Tenancy,
  }
): Promise<(TeamPermissionDefinitionsCrud["Admin"]["Read"])[]> {
  const renderedConfig = await rawQuery(getRenderedOrganizationConfigQuery({
    projectId: options.tenancy.project.id,
    branchId: options.tenancy.branchId,
    organizationId: options.tenancy.organization?.id || null,
  }));

  const permissions = typedEntries(renderedConfig.rbac.permissions).filter(([_, p]) => p.scope === options.scope);

  return [
    ...permissions.map(([id, p]) => ({
      id,
      description: getDescription(id, p.description),
      contained_permission_ids: typedEntries(p.containedPermissionIds || {}).map(([id]) => id).sort(stringCompare),
    })),
    ...(typedEntries(teamSystemPermissionMap).map(([id, description]) => ({
      id,
      description,
      contained_permission_ids: [],
    }))),
  ].sort((a, b) => stringCompare(a.id, b.id));
}

export async function createPermissionDefinition(
  tx: PrismaTransaction,
  options: {
    scope: "team" | "project",
    tenancy: Tenancy,
    data: {
      id: string,
      description?: string,
      contained_permission_ids?: string[],
    },
  }
) {
  const dbOverride = await tx.environmentConfigOverride.findUnique({
    where: {
      projectId_branchId: {
        projectId: options.tenancy.project.id,
        branchId: options.tenancy.branchId,
      }
    }
  });

  if (!dbOverride) {
    throw new StackAssertionError(`Couldn't find config override`, { tenancy: options.tenancy });
  }

  const oldConfig = await rawQuery(getRenderedOrganizationConfigQuery({
    projectId: options.tenancy.project.id,
    branchId: options.tenancy.branchId,
    organizationId: options.tenancy.organization?.id || null,
  }));

  const existingPermission = oldConfig.rbac.permissions[options.data.id] as OrganizationRenderedConfig['rbac']['permissions'][string] | undefined;
  const allIds = Object.keys(oldConfig.rbac.permissions)
    .filter(id => oldConfig.rbac.permissions[id].scope === options.scope)
    .concat(Object.keys(options.scope === "team" ? teamSystemPermissionMap : {}));

  if (existingPermission) {
    throw new KnownErrors.PermissionIdAlreadyExists(options.data.id);
  }

  if (allIds.some(id => !allIds.includes(id))) {
    throw new KnownErrors.ContainedPermissionNotFound(allIds.find(id => !allIds.includes(id))!);
  }

  await tx.environmentConfigOverride.update({
    where: {
      projectId_branchId: {
        projectId: options.tenancy.project.id,
        branchId: options.tenancy.branchId,
      }
    },
    data: {
      config: override(
        oldConfig,
        {
          "rbac.permissions": {
            ...oldConfig.rbac.permissions,
            [options.data.id]: {
              description: getDescription(options.data.id, options.data.description),
              scope: options.scope,
              containedPermissionIds: typedFromEntries((options.data.contained_permission_ids ?? []).map(id => [id, true]))
            },
          },
        },
      )
    }
  });

  return {
    id: options.data.id,
    description: getDescription(options.data.id, options.data.description),
    contained_permission_ids: options.data.contained_permission_ids?.sort(stringCompare) || [],
  };
}

export async function updatePermissionDefinition(
  tx: PrismaTransaction,
  options: {
    scope: "team" | "project",
    tenancy: Tenancy,
    oldId: string,
    data: {
      id: string,
      description?: string,
      contained_permission_ids?: string[],
    },
  }
) {
  const dbOverride = await tx.environmentConfigOverride.findUnique({
    where: {
      projectId_branchId: {
        projectId: options.tenancy.project.id,
        branchId: options.tenancy.branchId,
      }
    }
  });

  if (!dbOverride) {
    throw new StackAssertionError(`Couldn't find config override`, { tenancy: options.tenancy });
  }

  const oldConfig = await rawQuery(getRenderedOrganizationConfigQuery({
    projectId: options.tenancy.project.id,
    branchId: options.tenancy.branchId,
    organizationId: options.tenancy.organization?.id || null,
  }));

  const existingPermission = oldConfig.rbac.permissions[options.oldId] as OrganizationRenderedConfig['rbac']['permissions'][string] | undefined;

  if (!existingPermission) {
    throw new KnownErrors.PermissionNotFound(options.oldId);
  }

  // check if the target new id already exists
  if (options.data.id !== options.oldId && oldConfig.rbac.permissions[options.data.id] as any !== undefined) {
    throw new KnownErrors.PermissionIdAlreadyExists(options.data.id);
  }

  await tx.environmentConfigOverride.update({
    where: {
      projectId_branchId: {
        projectId: options.tenancy.project.id,
        branchId: options.tenancy.branchId,
      }
    },
    data: {
      config: override(
        oldConfig,
        {
          "rbac.permissions": {
            ...typedFromEntries(
              typedEntries(oldConfig.rbac.permissions)
                .filter(([id]) => id !== options.oldId)
                .map(([id, p]) => [id, {
                  ...p,
                  containedPermissionIds: typedFromEntries(typedEntries(p.containedPermissionIds || {}).map(([id]) => {
                    if (id === options.oldId) {
                      return [options.data.id, true];
                    } else {
                      return [id, true];
                    }
                  }))
                }])
            ),
            [options.data.id]: {
              description: getDescription(options.data.id, options.data.description),
              scope: options.scope,
              containedPermissionIds: typedFromEntries((options.data.contained_permission_ids ?? []).map(id => [id, true]))
            }
          }
        },
      )
    }
  });

  // update permissions for all users/teams
  switch (options.scope) {
    case "team": {
      await tx.teamMemberDirectPermission.updateMany({
        where: {
          tenancyId: options.tenancy.id,
          permissionId: options.oldId,
        },
        data: {
          permissionId: options.data.id,
        },
      });
      break;
    }
    case "project": {
      await tx.projectUserDirectPermission.updateMany({
        where: {
          tenancyId: options.tenancy.id,
          permissionId: options.oldId,
        },
        data: {
          permissionId: options.data.id,
        },
      });
      break;
    }
  }

  return {
    id: options.data.id,
    description: getDescription(options.data.id, options.data.description),
    contained_permission_ids: options.data.contained_permission_ids?.sort(stringCompare) || [],
  };
}

export async function deletePermissionDefinition(
  tx: PrismaTransaction,
  options: {
    tenancy: Tenancy,
    permissionId: string,
  }
) {
  const dbOverride = await tx.environmentConfigOverride.findUnique({
    where: {
      projectId_branchId: {
        projectId: options.tenancy.project.id,
        branchId: options.tenancy.branchId,
      }
    }
  });

  if (!dbOverride) {
    throw new StackAssertionError(`Couldn't find config override`, { tenancy: options.tenancy });
  }

  const configOverride = dbOverride.config as unknown as EnvironmentConfigOverride;
  const configKey = `rbac.permissions.${options.permissionId}`;

  if (!configOverride[configKey]) {
    throw new KnownErrors.PermissionNotFound(options.permissionId);
  }

  // Remove the permission definition from the config
  delete configOverride[configKey];

  await tx.environmentConfigOverride.update({
    where: {
      projectId_branchId: {
        projectId: options.tenancy.project.id,
        branchId: options.tenancy.branchId,
      }
    },
    data: {
      config: configOverride,
    }
  });

}

export async function grantProjectPermission(
  tx: PrismaTransaction,
  options: {
    tenancy: Tenancy,
    userId: string,
    permissionId: string,
  }
) {
  await tx.projectUserDirectPermission.upsert({
    where: {
      tenancyId_projectUserId_permissionId: {
        tenancyId: options.tenancy.id,
        projectUserId: options.userId,
        permissionId: options.permissionId,
      },
    },
    create: {
      permissionId: options.permissionId,
      projectUserId: options.userId,
      tenancyId: options.tenancy.id,
    },
    update: {},
  });

  return {
    id: options.permissionId,
    user_id: options.userId,
  };
}

export async function revokeProjectPermission(
  tx: PrismaTransaction,
  options: {
    tenancy: Tenancy,
    userId: string,
    permissionId: string,
  }
) {
  await tx.projectUserDirectPermission.delete({
    where: {
      tenancyId_projectUserId_permissionId: {
        tenancyId: options.tenancy.id,
        projectUserId: options.userId,
        permissionId: options.permissionId,
      },
    },
  });
}

/**
 * Grants default project permissions to a user
 * This function should be called when a new user is created
 */
export async function grantDefaultProjectPermissions(
  tx: PrismaTransaction,
  options: {
    tenancy: Tenancy,
    userId: string,
  }
) {
  const config = await rawQuery(getRenderedOrganizationConfigQuery({
    projectId: options.tenancy.project.id,
    branchId: options.tenancy.branchId,
    organizationId: options.tenancy.organization?.id || null,
  }));

  for (const permissionId of Object.keys(config.rbac.defaultPermissions.signUp)) {
    await grantProjectPermission(tx, {
      tenancy: options.tenancy,
      userId: options.userId,
      permissionId: permissionId,
    });
  }

  return {
    grantedPermissionIds: Object.keys(config.rbac.defaultPermissions.signUp),
  };
}

/**
 * Grants default team permissions to a user
 * This function should be called when a new user is created
 */
export async function grantDefaultTeamPermissions(
  tx: PrismaTransaction,
  options: {
    tenancy: Tenancy,
    userId: string,
    teamId: string,
    type: "creator" | "member",
  }
) {
  const config = await rawQuery(getRenderedOrganizationConfigQuery({
    projectId: options.tenancy.project.id,
    branchId: options.tenancy.branchId,
    organizationId: options.tenancy.organization?.id || null,
  }));

  const defaultPermissions = config.rbac.defaultPermissions[options.type === "creator" ? "teamCreator" : "teamMember"];

  for (const permissionId of Object.keys(defaultPermissions)) {
    await grantTeamPermission(tx, {
      tenancy: options.tenancy,
      teamId: options.teamId,
      userId: options.userId,
      permissionId: permissionId,
    });
  }

  return {
    grantedPermissionIds: Object.keys(defaultPermissions),
  };
}
