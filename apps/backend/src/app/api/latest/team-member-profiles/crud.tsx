import { ensureTeamExists, ensureTeamMembershipExists, ensureUserExists, ensureUserTeamPermissionExists } from "@/lib/request-checks";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { uploadAndGetUrl } from "@/s3";
import { Prisma } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { teamMemberProfilesCrud } from "@stackframe/stack-shared/dist/interface/crud/team-member-profiles";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { getUserLastActiveAtMillis, getUsersLastActiveAtMillis, userFullInclude, userPrismaToCrud } from "../users/crud";

const fullInclude = { projectUser: { include: userFullInclude } };

// Helper function to fetch permissions for team members
async function fetchTeamMemberPermissions(tx: any, tenancyId: string, teamId: string, projectUserIds: string[]) {
  const permissions = await tx.teamMemberDirectPermission.findMany({
    where: {
      tenancyId,
      teamId,
      projectUserId: { in: projectUserIds },
    },
    select: { projectUserId: true, permissionId: true },
  });

  // Group permissions by projectUserId
  const permissionMap = new Map<string, string[]>();
  for (const perm of permissions) {
    if (!permissionMap.has(perm.projectUserId)) {
      permissionMap.set(perm.projectUserId, []);
    }
    permissionMap.get(perm.projectUserId)!.push(perm.permissionId);
  }

  return permissionMap;
}

function prismaToCrud(prisma: Prisma.TeamMemberGetPayload<{ include: typeof fullInclude }>, lastActiveAtMillis: number, permissionIds: string[]) {
  return {
    team_id: prisma.teamId,
    user_id: prisma.projectUserId,
    display_name: prisma.displayName ?? prisma.projectUser.displayName,
    profile_image_url: prisma.profileImageUrl ?? prisma.projectUser.profileImageUrl,
    permission_ids: permissionIds,
    user: userPrismaToCrud(prisma.projectUser, lastActiveAtMillis),
  };
}

export const teamMemberProfilesCrudHandlers = createLazyProxy(() => createCrudHandlers(teamMemberProfilesCrud, {
  querySchema: yupObject({
    user_id: userIdOrMeSchema.optional().meta({ openapiField: { onlyShowInOperations: ['List'] } }),
    team_id: yupString().uuid().optional().meta({ openapiField: { onlyShowInOperations: ['List'] } }),
  }),
  paramsSchema: yupObject({
    team_id: yupString().uuid().defined(),
    user_id: userIdOrMeSchema.defined(),
  }),
  onList: async ({ auth, query }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    return await retryTransaction(prisma, async (tx) => {
      if (auth.type === 'client') {
        // Client can only:
        // - list users in their own team if they have the $read_members permission
        // - list their own profile

        const currentUserId = auth.user?.id ?? throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());

        if (!query.team_id) {
          throw new StatusError(StatusError.BadRequest, 'team_id is required for access type client');
        }

        await ensureTeamMembershipExists(tx, { tenancyId: auth.tenancy.id, teamId: query.team_id, userId: currentUserId });

        if (query.user_id !== currentUserId) {
          await ensureUserTeamPermissionExists(tx, {
            tenancy: auth.tenancy,
            teamId: query.team_id,
            userId: currentUserId,
            permissionId: '$read_members',
            errorType: 'required',
            recursive: true,
          });
        }
      } else {
        if (query.team_id) {
          await ensureTeamExists(tx, { tenancyId: auth.tenancy.id, teamId: query.team_id });
        }
        if (query.user_id) {
          await ensureUserExists(tx, { tenancyId: auth.tenancy.id, userId: query.user_id });
        }
      }

      const db = await tx.teamMember.findMany({
        where: {
          tenancyId: auth.tenancy.id,
          teamId: query.team_id,
          projectUserId: query.user_id,
        },
        orderBy: {
          createdAt: 'asc',
        },
        include: fullInclude,
      });

      // Fetch all permissions in a single query to avoid N+1 pattern
      const permissionMap = await fetchTeamMemberPermissions(
        tx,
        auth.tenancy.id,
        query.team_id!,
        db.map(member => member.projectUserId)
      );

      const lastActiveAtMillis = await getUsersLastActiveAtMillis(auth.project.id, auth.branchId, db.map(user => user.projectUserId), db.map(user => user.createdAt));

      return {
        items: db.map((user, index) => prismaToCrud(
          user,
          lastActiveAtMillis[index],
          permissionMap.get(user.projectUserId) || []
        )),
        is_paginated: false,
      };
    });
  },
  onRead: async ({ auth, params }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    return await retryTransaction(prisma, async (tx) => {
      if (auth.type === 'client') {
        const currentUserId = auth.user?.id ?? throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
        if (params.user_id !== currentUserId) {
          await ensureUserTeamPermissionExists(tx, {
            tenancy: auth.tenancy,
            teamId: params.team_id,
            userId: currentUserId,
            permissionId: '$read_members',
            errorType: 'required',
            recursive: true,
          });
        }
      }

      await ensureTeamMembershipExists(tx, { tenancyId: auth.tenancy.id, teamId: params.team_id, userId: params.user_id });

      const db = await tx.teamMember.findUnique({
        where: {
          tenancyId_projectUserId_teamId: {
            tenancyId: auth.tenancy.id,
            projectUserId: params.user_id,
            teamId: params.team_id,
          },
        },
        include: fullInclude,
      });

      if (!db) {
        // This should never happen because of the check above
        throw new KnownErrors.TeamMembershipNotFound(params.team_id, params.user_id);
      }

      // Use helper function to fetch permissions
      const permissionMap = await fetchTeamMemberPermissions(
        tx,
        auth.tenancy.id,
        db.teamId,
        [db.projectUserId]
      );

      return prismaToCrud(
        db,
        await getUserLastActiveAtMillis(auth.project.id, auth.branchId, db.projectUserId) ?? db.projectUser.createdAt.getTime(),
        permissionMap.get(db.projectUserId) || []
      );
    });
  },
  onUpdate: async ({ auth, data, params }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    return await retryTransaction(prisma, async (tx) => {
      if (auth.type === 'client') {
        const currentUserId = auth.user?.id ?? throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
        if (params.user_id !== currentUserId) {
          throw new StatusError(StatusError.Forbidden, 'Cannot update another user\'s profile');
        }
      }

      await ensureTeamMembershipExists(tx, {
        tenancyId: auth.tenancy.id,
        teamId: params.team_id,
        userId: params.user_id,
      });

      const db = await tx.teamMember.update({
        where: {
          tenancyId_projectUserId_teamId: {
            tenancyId: auth.tenancy.id,
            projectUserId: params.user_id,
            teamId: params.team_id,
          },
        },
        data: {
          displayName: data.display_name,
          profileImageUrl: await uploadAndGetUrl(data.profile_image_url, "team-member-profile-images")
        },
        include: fullInclude,
      });

      const perms = await tx.teamMemberDirectPermission.findMany({
        where: {
          tenancyId: auth.tenancy.id,
          projectUserId: db.projectUserId,
          teamId: db.teamId,
        },
        select: { permissionId: true },
      });

      return prismaToCrud(db, await getUserLastActiveAtMillis(auth.project.id, auth.branchId, db.projectUser.projectUserId) ?? db.projectUser.createdAt.getTime(), perms.map(p => p.permissionId));
    });
  },
}));
