import { ensureTeamExists, ensureTeamMembershipExists, ensureUserExists, ensureUserTeamPermissionExists } from "@/lib/request-checks";
import { sendTeamCreatedWebhook, sendTeamDeletedWebhook, sendTeamUpdatedWebhook } from "@/lib/webhooks";
import { prismaClient, retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/vercel";
import { Prisma } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { teamsCrud } from "@stackframe/stack-shared/dist/interface/crud/teams";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { validateBase64Image } from "@stackframe/stack-shared/dist/utils/base64";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { addUserToTeam } from "../team-memberships/crud";


export function teamPrismaToCrud(prisma: Prisma.TeamGetPayload<{}>) {
  return {
    id: prisma.teamId,
    display_name: prisma.displayName,
    profile_image_url: prisma.profileImageUrl,
    created_at_millis: prisma.createdAt.getTime(),
    client_metadata: prisma.clientMetadata,
    client_read_only_metadata: prisma.clientReadOnlyMetadata,
    server_metadata: prisma.serverMetadata,
  };
}

export const teamsCrudHandlers = createLazyProxy(() => createCrudHandlers(teamsCrud, {
  querySchema: yupObject({
    user_id: userIdOrMeSchema.optional().meta({ openapiField: { onlyShowInOperations: ['List'], description: 'Filter for the teams that the user is a member of. Can be either `me` or an ID. Must be `me` in the client API', exampleValue: 'me' } }),
    /** @deprecated use creator_user_id in the body instead */
    add_current_user: yupString().oneOf(["true", "false"]).optional().meta({ openapiField: { onlyShowInOperations: ['Create'], hidden: true } }),
  }),
  paramsSchema: yupObject({
    team_id: yupString().uuid().defined(),
  }),
  onCreate: async ({ query, auth, data }) => {
    let addUserId = data.creator_user_id;

    if (data.creator_user_id && query.add_current_user) {
      throw new StatusError(StatusError.BadRequest, "Cannot use both creator_user_id and add_current_user. add_current_user is deprecated, please only use creator_user_id in the body.");
    }

    if (auth.type === 'client') {
      if (!auth.user) {
        throw new KnownErrors.UserAuthenticationRequired;
      }

      if (!auth.tenancy.config.client_team_creation_enabled) {
        throw new StatusError(StatusError.Forbidden, 'Client team creation is disabled for this project');
      }

      if (data.profile_image_url && !validateBase64Image(data.profile_image_url)) {
        throw new StatusError(400, "Invalid profile image URL");
      }

      if (!data.creator_user_id) {
        addUserId = auth.user.id;
      } else if (data.creator_user_id !== auth.user.id) {
        throw new StatusError(StatusError.Forbidden, "You cannot create a team as a user that is not yourself. Make sure you set the creator_user_id to 'me'.");
      }
    }

    if (query.add_current_user === 'true') {
      if (!auth.user) {
        throw new StatusError(StatusError.Unauthorized, "You must be logged in to create a team with the current user as a member.");
      }
      addUserId = auth.user.id;
    }

    const db = await retryTransaction(async (tx) => {
      const db = await tx.team.create({
        data: {
          displayName: data.display_name,
          mirroredProjectId: auth.project.id,
          mirroredBranchId: auth.branchId,
          tenancyId: auth.tenancy.id,
          profileImageUrl: data.profile_image_url,
          clientMetadata: data.client_metadata === null ? Prisma.JsonNull : data.client_metadata,
          clientReadOnlyMetadata: data.client_read_only_metadata === null ? Prisma.JsonNull : data.client_read_only_metadata,
          serverMetadata: data.server_metadata === null ? Prisma.JsonNull : data.server_metadata,
        },
      });

      if (addUserId) {
        await ensureUserExists(tx, { tenancyId: auth.tenancy.id, userId: addUserId });
        await addUserToTeam(tx, {
          tenancy: auth.tenancy,
          teamId: db.teamId,
          userId: addUserId,
          type: 'creator',
        });
      }

      return db;
    });

    const result = teamPrismaToCrud(db);

    runAsynchronouslyAndWaitUntil(sendTeamCreatedWebhook({
      projectId: auth.project.id,
      data: result,
    }));

    return result;
  },
  onRead: async ({ params, auth }) => {
    if (auth.type === 'client') {
      await ensureTeamMembershipExists(prismaClient, {
        tenancyId: auth.tenancy.id,
        teamId: params.team_id,
        userId: auth.user?.id ?? throwErr(new KnownErrors.UserAuthenticationRequired),
      });
    }

    const db = await prismaClient.team.findUnique({
      where: {
        tenancyId_teamId: {
          tenancyId: auth.tenancy.id,
          teamId: params.team_id,
        },
      },
    });

    if (!db) {
      throw new KnownErrors.TeamNotFound(params.team_id);
    }

    return teamPrismaToCrud(db);
  },
  onUpdate: async ({ params, auth, data }) => {
    const db = await retryTransaction(async (tx) => {
      if (auth.type === 'client' && data.profile_image_url && !validateBase64Image(data.profile_image_url)) {
        throw new StatusError(400, "Invalid profile image URL");
      }

      if (auth.type === 'client') {
        await ensureUserTeamPermissionExists(tx, {
          tenancy: auth.tenancy,
          teamId: params.team_id,
          userId: auth.user?.id ?? throwErr(new KnownErrors.UserAuthenticationRequired),
          permissionId: "$update_team",
          errorType: 'required',
          recursive: true,
        });
      }

      await ensureTeamExists(tx, { tenancyId: auth.tenancy.id, teamId: params.team_id });

      return await tx.team.update({
        where: {
          tenancyId_teamId: {
            tenancyId: auth.tenancy.id,
            teamId: params.team_id,
          },
        },
        data: {
          displayName: data.display_name,
          profileImageUrl: data.profile_image_url,
          clientMetadata: data.client_metadata === null ? Prisma.JsonNull : data.client_metadata,
          clientReadOnlyMetadata: data.client_read_only_metadata === null ? Prisma.JsonNull : data.client_read_only_metadata,
          serverMetadata: data.server_metadata === null ? Prisma.JsonNull : data.server_metadata,
        },
      });
    });

    const result = teamPrismaToCrud(db);

    runAsynchronouslyAndWaitUntil(sendTeamUpdatedWebhook({
      projectId: auth.project.id,
      data: result,
    }));

    return result;
  },
  onDelete: async ({ params, auth }) => {
    await retryTransaction(async (tx) => {
      if (auth.type === 'client') {
        await ensureUserTeamPermissionExists(tx, {
          tenancy: auth.tenancy,
          teamId: params.team_id,
          userId: auth.user?.id ?? throwErr(new KnownErrors.UserAuthenticationRequired),
          permissionId: "$delete_team",
          errorType: 'required',
          recursive: true,
        });
      }
      await ensureTeamExists(tx, { tenancyId: auth.tenancy.id, teamId: params.team_id });

      await tx.team.delete({
        where: {
          tenancyId_teamId: {
            tenancyId: auth.tenancy.id,
            teamId: params.team_id,
          },
        },
      });
    });

    runAsynchronouslyAndWaitUntil(sendTeamDeletedWebhook({
      projectId: auth.project.id,
      data: {
        id: params.team_id,
      },
    }));
  },
  onList: async ({ query, auth }) => {
    if (auth.type === 'client') {
      const currentUserId = auth.user?.id || throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());

      if (query.user_id !== currentUserId) {
        throw new StatusError(StatusError.Forbidden, 'Client can only list teams for their own user. user_id must be either "me" or the ID of the current user');
      }
    }

    const db = await prismaClient.team.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        ...query.user_id ? {
          teamMembers: {
            some: {
              projectUserId: query.user_id,
            },
          },
        } : {},
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return {
      items: db.map(teamPrismaToCrud),
      is_paginated: false,
    };
  }
}));
