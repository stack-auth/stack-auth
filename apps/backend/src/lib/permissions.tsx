import { isPrismaUniqueConstraintViolation } from "@/prisma-client";
import { TeamSystemPermission as DBTeamSystemPermission, Prisma } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { ProjectPermissionsCrud } from "@stackframe/stack-shared/dist/interface/crud/project-permissions";
import { TeamPermissionDefinitionsCrud, TeamPermissionsCrud } from "@stackframe/stack-shared/dist/interface/crud/team-permissions";
import { groupBy } from "@stackframe/stack-shared/dist/utils/arrays";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { stringCompare, typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { Tenancy } from "./tenancies";
import { PrismaTransaction } from "./types";

export const fullPermissionInclude = {
  parentEdges: {
    include: {
      parentPermission: true,
    },
  },
} as const satisfies Prisma.PermissionInclude;

export function isTeamSystemPermission(permission: string): permission is `$${Lowercase<DBTeamSystemPermission>}` {
  return permission.startsWith('$') && permission.slice(1).toUpperCase() in DBTeamSystemPermission;
}

export function teamSystemPermissionStringToDBType(permission: `$${Lowercase<DBTeamSystemPermission>}`): DBTeamSystemPermission {
  return typedToUppercase(permission.slice(1)) as DBTeamSystemPermission;
}

export function teamDBTypeToSystemPermissionString(permission: DBTeamSystemPermission): `$${Lowercase<DBTeamSystemPermission>}` {
  return '$' + typedToLowercase(permission) as `$${Lowercase<DBTeamSystemPermission>}`;
}

export type TeamSystemPermission = ReturnType<typeof teamDBTypeToSystemPermissionString>;

const descriptionMap: Record<DBTeamSystemPermission, string> = {
  "UPDATE_TEAM": "Update the team information",
  "DELETE_TEAM": "Delete the team",
  "READ_MEMBERS": "Read and list the other members of the team",
  "REMOVE_MEMBERS": "Remove other members from the team",
  "INVITE_MEMBERS": "Invite other users to the team",
  "MANAGE_API_KEYS": "Create and manage API keys for the team",
};

type ExtendedTeamPermissionDefinition = TeamPermissionDefinitionsCrud["Admin"]["Read"] & {
  __database_id: string,
  __is_default_team_member_permission?: boolean,
  __is_default_team_creator_permission?: boolean,
  __is_default_project_permission?: boolean,
};

export function teamPermissionDefinitionJsonFromDbType(db: Prisma.PermissionGetPayload<{ include: typeof fullPermissionInclude }>): ExtendedTeamPermissionDefinition {
  return teamPermissionDefinitionJsonFromRawDbType(db);
}
/**
 * Can either take a Prisma permission object or a raw SQL `to_jsonb` result.
 */
export function teamPermissionDefinitionJsonFromRawDbType(db: any | Prisma.PermissionGetPayload<{ include: typeof fullPermissionInclude }>): ExtendedTeamPermissionDefinition {
  if (!db.projectConfigId && !db.teamId) throw new StackAssertionError(`Permission DB object should have either projectConfigId or teamId`, { db });
  if (db.projectConfigId && db.teamId) throw new StackAssertionError(`Permission DB object should have either projectConfigId or teamId, not both`, { db });
  if (db.scope === "PROJECT" && db.teamId) throw new StackAssertionError(`Permission DB object should not have teamId when scope is PROJECT`, { db });

  return {
    __database_id: db.dbId,
    __is_default_team_member_permission: db.isDefaultTeamMemberPermission,
    __is_default_team_creator_permission: db.isDefaultTeamCreatorPermission,
    __is_default_project_permission: db.isDefaultProjectPermission,
    id: db.queryableId,
    description: db.description || undefined,
    contained_permission_ids: db.parentEdges?.map((edge: any) => {
      if (edge.parentPermission) {
        return edge.parentPermission.queryableId;
      } else if (edge.parentTeamSystemPermission) {
        return '$' + typedToLowercase(edge.parentTeamSystemPermission);
      } else {
        throw new StackAssertionError(`Permission edge should have either parentPermission or parentSystemPermission`, { edge });
      }
    }).sort() ?? [],
  } as const;
}

export function teamPermissionDefinitionJsonFromTeamSystemDbType(db: DBTeamSystemPermission, projectConfig: {
  teamCreateDefaultSystemPermissions: string[] | null,
  teamMemberDefaultSystemPermissions: string[] | null,
  projectDefaultPermissions?: string[] | null,
}): ExtendedTeamPermissionDefinition {
  if ((["teamMemberDefaultSystemPermissions", "teamCreateDefaultSystemPermissions"] as const).some(key => projectConfig[key] !== null && !Array.isArray(projectConfig[key]))) {
    throw new StackAssertionError(`Project config should have (nullable) array values for teamMemberDefaultSystemPermissions and teamCreateDefaultSystemPermissions`, { projectConfig });
  }

  return {
    __database_id: '$' + typedToLowercase(db),
    __is_default_team_member_permission: projectConfig.teamMemberDefaultSystemPermissions?.includes(db) ?? false,
    __is_default_team_creator_permission: projectConfig.teamCreateDefaultSystemPermissions?.includes(db) ?? false,
    __is_default_project_permission: projectConfig.projectDefaultPermissions?.includes(db) ?? false,
    id: '$' + typedToLowercase(db),
    description: descriptionMap[db],
    contained_permission_ids: [] as string[],
  } as const;
}

async function getParentDbIds(
  tx: PrismaTransaction,
  options: {
    tenancy: Tenancy,
    scope: "TEAM" | "PROJECT",
    containedPermissionIds?: string[],
  }
) {
  let parentDbIds = [];
  const potentialParentPermissions = await listPermissionDefinitions(tx, options.scope, options.tenancy);
  for (const parentPermissionId of options.containedPermissionIds || []) {
    const parentPermission = potentialParentPermissions.find(p => p.id === parentPermissionId);
    if (!parentPermission) {
      throw new KnownErrors.ContainedPermissionNotFound(parentPermissionId);
    }
    parentDbIds.push(parentPermission.__database_id);
  }

  return parentDbIds;
}


export async function listUserTeamPermissions(
  tx: PrismaTransaction,
  options: {
    tenancy: Tenancy,
    teamId?: string,
    userId?: string,
    permissionId?: string,
    recursive: boolean,
  }
): Promise<TeamPermissionsCrud["Admin"]["Read"][]> {
  const permissionDefs = await listPermissionDefinitions(tx, "TEAM", options.tenancy);
  const permissionsMap = new Map(permissionDefs.map(p => [p.id, p]));
  const results = await tx.teamMemberDirectPermission.findMany({
    where: {
      tenancyId: options.tenancy.id,
      projectUserId: options.userId,
      teamId: options.teamId,
    },
    include: {
      permission: true,
    }
  });

  const finalResults: { id: string, team_id: string, user_id: string }[] = [];
  for (const [compositeKey, userTeamResults] of groupBy(results, (result) => JSON.stringify([result.projectUserId, result.teamId]))) {
    const [userId, teamId] = JSON.parse(compositeKey) as [string, string];
    const idsToProcess = [...userTeamResults.map(p =>
      p.permission?.queryableId ||
      (p.systemPermission ? teamDBTypeToSystemPermissionString(p.systemPermission) : null) ||
      throwErr(new StackAssertionError(`Permission should have either queryableId or systemPermission`, { p }))
    )];

    const result = new Map<string, ReturnType<typeof teamPermissionDefinitionJsonFromDbType>>();
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
    .sort((a, b) => stringCompare(a.team_id, b.team_id) || stringCompare(a.user_id, b.user_id) || stringCompare(a.id, b.id))
    .filter(p => options.permissionId ? p.id === options.permissionId : true);
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
  if (isTeamSystemPermission(options.permissionId)) {
    await tx.teamMemberDirectPermission.upsert({
      where: {
        tenancyId_projectUserId_teamId_systemPermission: {
          tenancyId: options.tenancy.id,
          projectUserId: options.userId,
          teamId: options.teamId,
          systemPermission: teamSystemPermissionStringToDBType(options.permissionId),
        },
      },
      create: {
        systemPermission: teamSystemPermissionStringToDBType(options.permissionId),
        teamMember: {
          connect: {
            tenancyId_projectUserId_teamId: {
              tenancyId: options.tenancy.id,
              projectUserId: options.userId,
              teamId: options.teamId,
            },
          },
        },
      },
      update: {},
    });
  } else {
    const teamSpecificPermission = await tx.permission.findUnique({
      where: {
        tenancyId_teamId_queryableId: {
          tenancyId: options.tenancy.id,
          teamId: options.teamId,
          queryableId: options.permissionId,
        },
      }
    });
    const anyTeamPermission = await tx.permission.findUnique({
      where: {
        projectConfigId_queryableId: {
          projectConfigId: options.tenancy.config.id,
          queryableId: options.permissionId,
        },
      }
    });

    const permission = teamSpecificPermission || anyTeamPermission;
    if (!permission) throw new KnownErrors.PermissionNotFound(options.permissionId);

    await tx.teamMemberDirectPermission.upsert({
      where: {
        tenancyId_projectUserId_teamId_permissionDbId: {
          tenancyId: options.tenancy.id,
          projectUserId: options.userId,
          teamId: options.teamId,
          permissionDbId: permission.dbId,
        },
      },
      create: {
        permission: {
          connect: {
            dbId: permission.dbId,
          },
        },
        teamMember: {
          connect: {
            tenancyId_projectUserId_teamId: {
              tenancyId: options.tenancy.id,
              projectUserId: options.userId,
              teamId: options.teamId,
            },
          },
        },
      },
      update: {},
    });
  }

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
  if (isTeamSystemPermission(options.permissionId)) {
    await tx.teamMemberDirectPermission.delete({
      where: {
        tenancyId_projectUserId_teamId_systemPermission: {
          tenancyId: options.tenancy.id,
          projectUserId: options.userId,
          teamId: options.teamId,
          systemPermission: teamSystemPermissionStringToDBType(options.permissionId),
        },
      },
    });

    return;
  } else {
    const teamSpecificPermission = await tx.permission.findUnique({
      where: {
        tenancyId_teamId_queryableId: {
          tenancyId: options.tenancy.id,
          teamId: options.teamId,
          queryableId: options.permissionId,
        },
      }
    });
    const anyTeamPermission = await tx.permission.findUnique({
      where: {
        projectConfigId_queryableId: {
          projectConfigId: options.tenancy.config.id,
          queryableId: options.permissionId,
        },
      }
    });

    const permission = teamSpecificPermission || anyTeamPermission;
    if (!permission) throw new KnownErrors.PermissionNotFound(options.permissionId);

    await tx.teamMemberDirectPermission.delete({
      where: {
        tenancyId_projectUserId_teamId_permissionDbId: {
          tenancyId: options.tenancy.id,
          projectUserId: options.userId,
          teamId: options.teamId,
          permissionDbId: permission.dbId,
        }
      },
    });
  }
}


export async function listPermissionDefinitions(
  tx: PrismaTransaction,
  scope: "TEAM" | "PROJECT",
  tenancy: Tenancy
): Promise<(TeamPermissionDefinitionsCrud["Admin"]["Read"] & { __database_id: string })[]> {
  const projectConfig = await tx.projectConfig.findUnique({
    where: {
      id: tenancy.config.id,
    },
    include: {
      permissions: {
        where: {
          scope,
        },
        include: fullPermissionInclude,
      },
    },
  });
  if (!projectConfig) throw new StackAssertionError(`Couldn't find tenancy config`, { tenancy });
  const res = projectConfig.permissions;
  const nonSystemPermissions = res.map(db => teamPermissionDefinitionJsonFromDbType(db));

  const systemPermissions = [
    ...(scope === "TEAM" ?
      Object.values(DBTeamSystemPermission).map(db => teamPermissionDefinitionJsonFromTeamSystemDbType(db, projectConfig)) :
      []),
  ];

  return [...nonSystemPermissions, ...systemPermissions].sort((a, b) => stringCompare(a.id, b.id));
}

export async function createPermissionDefinition(
  tx: PrismaTransaction,
  options: {
    scope: "TEAM" | "PROJECT",
    tenancy: Tenancy,
    data: {
      id: string,
      description?: string,
      contained_permission_ids?: string[],
    },
  }
) {
  const parentDbIds = await getParentDbIds(tx, {
    tenancy: options.tenancy,
    scope: options.scope,
    containedPermissionIds: options.data.contained_permission_ids
  });
  const dbPermission = await tx.permission.create({
    data: {
      scope: options.scope,
      queryableId: options.data.id,
      description: options.data.description,
      projectConfigId: options.tenancy.config.id,
      parentEdges: {
        create: parentDbIds.map(parentDbId => {
          if (isTeamSystemPermission(parentDbId)) {
            return {
              parentTeamSystemPermission: teamSystemPermissionStringToDBType(parentDbId),
            };
          } else {
            return {
              parentPermission: {
                connect: {
                  dbId: parentDbId,
                },
              },
            };
          }
        })
      },
    },
    include: fullPermissionInclude,
  });
  return teamPermissionDefinitionJsonFromDbType(dbPermission);
}

export async function updatePermissionDefinitions(
  tx: PrismaTransaction,
  options: {
    scope: "TEAM" | "PROJECT",
    tenancy: Tenancy,
    permissionId: string,
    data: {
      id?: string,
      description?: string,
      contained_permission_ids?: string[],
    },
  }
) {
  const parentDbIds = await getParentDbIds(tx, {
    tenancy: options.tenancy,
    scope: options.scope,
    containedPermissionIds: options.data.contained_permission_ids
  });

  let edgeUpdateData = {};
  if (options.data.contained_permission_ids) {
    edgeUpdateData = {
      parentEdges: {
        deleteMany: {},
        create: parentDbIds.map(parentDbId => {
          if (isTeamSystemPermission(parentDbId)) {
            return {
              parentTeamSystemPermission: teamSystemPermissionStringToDBType(parentDbId),
            };
          } else {
            return {
              parentPermission: {
                connect: {
                  dbId: parentDbId,
                },
              },
            };
          }
        }),
      },
    };
  }

  const db = await tx.permission.update({
    where: {
      projectConfigId_queryableId: {
        projectConfigId: options.tenancy.config.id,
        queryableId: options.permissionId,
      },
    },
    data: {
      queryableId: options.data.id,
      description: options.data.description,
      ...edgeUpdateData,
    },
    include: fullPermissionInclude,
  });
  return teamPermissionDefinitionJsonFromDbType(db);
}

export async function deletePermissionDefinition(
  tx: PrismaTransaction,
  options: {
    tenancy: Tenancy,
    permissionId: string,
  }
) {
  const deleted = await tx.permission.deleteMany({
    where: {
      projectConfigId: options.tenancy.config.id,
      queryableId: options.permissionId,
    },
  });
  if (deleted.count < 1) throw new KnownErrors.PermissionNotFound(options.permissionId);
}

// User permission functions

export async function listProjectPermissions(
  tx: PrismaTransaction,
  options: {
    tenancy: Tenancy,
    userId?: string,
    permissionId?: string,
    recursive: boolean,
  }
): Promise<ProjectPermissionsCrud["Admin"]["Read"][]> {
  const permissionDefs = await listPermissionDefinitions(tx, "PROJECT", options.tenancy);
  const permissionsMap = new Map(permissionDefs.map(p => [p.id, p]));
  const results = await tx.projectUserDirectPermission.findMany({
    where: {
      tenancyId: options.tenancy.id,
      projectUserId: options.userId,
    },
    include: {
      permission: true,
    }
  });

  const finalResults: { id: string, user_id: string }[] = [];
  for (const [userId, userResults] of groupBy(results, (result) => result.projectUserId)) {
    const idsToProcess = [...userResults.map(p =>
      p.permission?.queryableId ||
      throwErr(new StackAssertionError(`Permission should have queryableId`, { p }))
    )];

    const result = new Map<string, ReturnType<typeof teamPermissionDefinitionJsonFromDbType>>();
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
      user_id: userId,
    })));
  }

  return finalResults
    .sort((a, b) => stringCompare(a.user_id, b.user_id) || stringCompare(a.id, b.id))
    .filter(p => options.permissionId ? p.id === options.permissionId : true);
}

export async function grantProjectPermission(
  tx: PrismaTransaction,
  options: {
    tenancy: Tenancy,
    userId: string,
    permissionId: string,
  }
) {
  const permission = await tx.permission.findUnique({
    where: {
      projectConfigId_queryableId: {
        projectConfigId: options.tenancy.config.id,
        queryableId: options.permissionId,
      },
    }
  });

  if (!permission) throw new KnownErrors.PermissionNotFound(options.permissionId);

  await tx.projectUserDirectPermission.upsert({
    where: {
      tenancyId_projectUserId_permissionDbId: {
        tenancyId: options.tenancy.id,
        projectUserId: options.userId,
        permissionDbId: permission.dbId,
      },
    },
    create: {
      permission: {
        connect: {
          dbId: permission.dbId,
        },
      },
      projectUser: {
        connect: {
          tenancyId_projectUserId: {
            tenancyId: options.tenancy.id,
            projectUserId: options.userId,
          },
        },
      },
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
  const permission = await tx.permission.findUnique({
    where: {
      projectConfigId_queryableId: {
        projectConfigId: options.tenancy.config.id,
        queryableId: options.permissionId,
      },
    }
  });

  if (!permission) throw new KnownErrors.PermissionNotFound(options.permissionId);

  await tx.projectUserDirectPermission.delete({
    where: {
      tenancyId_projectUserId_permissionDbId: {
        tenancyId: options.tenancy.id,
        projectUserId: options.userId,
        permissionDbId: permission.dbId,
      }
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
  const defaultPermissions = await tx.permission.findMany({
    where: {
      projectConfigId: options.tenancy.config.id,
      isDefaultProjectPermission: true,
    }
  });

  for (const permission of defaultPermissions) {
    await tx.projectUserDirectPermission.create({
      data: {
        permission: {
          connect: {
            dbId: permission.dbId,
          },
        },
        projectUser: {
          connect: {
            tenancyId_projectUserId: {
              tenancyId: options.tenancy.id,
              projectUserId: options.userId,
            },
          },
        },
      },
    });
  }

  return defaultPermissions.length > 0;
}

export function isErrorForNonUniquePermission(error: unknown): boolean  {
  return isPrismaUniqueConstraintViolation(error, "Permission", ["tenancyId", "queryableId"]) ||
    isPrismaUniqueConstraintViolation(error, "Permission", ["projectConfigId", "queryableId"]) ||
    isPrismaUniqueConstraintViolation(error, "Permission", ["tenancyId", "teamId", "queryableId"]);
}
