import { ensureTeamExists, ensureTeamMembershipExists, ensureUserExists, ensureUserTeamPermissionExists } from "@/lib/request-checks";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { Prisma } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { teamMemberProfilesCrud } from "@stackframe/stack-shared/dist/interface/crud/team-member-profiles";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { getUserLastActiveAtMillis, getUsersLastActiveAtMillis, userFullInclude, userPrismaToCrud } from "../users/crud";

const fullInclude = { projectUser: { include: userFullInclude } };

function prismaToCrud(prisma: Prisma.TeamMemberGetPayload<{ include: typeof fullInclude }>, lastActiveAtMillis: number) {
  return {
    team_id: prisma.teamId,
    user_id: prisma.projectUserId,
    display_name: prisma.displayName ?? prisma.projectUser.displayName,
    profile_image_url: prisma.profileImageUrl ?? prisma.projectUser.profileImageUrl,
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
    return await retryTransaction(getPrismaClientForTenancy(auth.tenancy), async (tx) => {
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

      const lastActiveAtMillis = await getUsersLastActiveAtMillis(auth.project.id, auth.branchId, db.map(user => user.projectUserId), db.map(user => user.createdAt));

      return {
        items: db.map((user, index) => prismaToCrud(user, lastActiveAtMillis[index])),
        is_paginated: false,
      };
    });
  },
  onRead: async ({ auth, params }) => {
    return await retryTransaction(getPrismaClientForTenancy(auth.tenancy), async (tx) => {
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

      return prismaToCrud(db, await getUserLastActiveAtMillis(auth.project.id, auth.branchId, db.projectUser.projectUserId) ?? db.projectUser.createdAt.getTime());
    });
  },
  onUpdate: async ({ auth, data, params }) => {
    return await retryTransaction(getPrismaClientForTenancy(auth.tenancy), async (tx) => {
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
          profileImageUrl: data.profile_image_url,
        },
        include: fullInclude,
      });

      return prismaToCrud(db, await getUserLastActiveAtMillis(auth.project.id, auth.branchId, db.projectUser.projectUserId) ?? db.projectUser.createdAt.getTime());
    });
  },
}));
