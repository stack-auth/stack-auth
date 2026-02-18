import { VerificationCodeType } from "@/generated/prisma/client";
import { ensureTeamExists, ensureTeamMembershipExists, ensureUserTeamPermissionExists } from "@/lib/request-checks";
import { getPrismaClientForTenancy, globalPrismaClient, retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { teamInvitationCrud } from "@stackframe/stack-shared/dist/interface/crud/team-invitation";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { teamsCrudHandlers } from "../teams/crud";
import { teamInvitationCodeHandler } from "./accept/verification-code-handler";

export const teamInvitationsCrudHandlers = createLazyProxy(() => createCrudHandlers(teamInvitationCrud, {
  querySchema: yupObject({
    team_id: yupString().uuid().optional().meta({ openapiField: { onlyShowInOperations: ['List', 'Delete'], description: 'The team ID to list invitations for. Required unless user_id is provided.' } }),
    user_id: userIdOrMeSchema.optional().meta({ openapiField: { onlyShowInOperations: ['List'], description: 'List invitations sent to this user\'s verified emails. Must be "me" for client access. Cannot be combined with team_id.' } }),
  }),
  paramsSchema: yupObject({
    id: yupString().uuid().defined(),
  }),
  onList: async ({ auth, query }) => {
    if (query.team_id != null && query.user_id != null) {
      throw new StatusError(StatusError.BadRequest, "Cannot specify both team_id and user_id");
    }
    if (query.team_id == null && query.user_id == null) {
      throw new StatusError(StatusError.BadRequest, "Must specify either team_id or user_id");
    }

    if (query.user_id != null) {
      // List invitations sent to the user's verified emails
      if (auth.type === 'client') {
        const currentUserId = auth.user?.id ?? throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
        if (query.user_id !== currentUserId) {
          throw new KnownErrors.CannotGetOwnUserWithoutUser();
        }
      }

      const targetUserId = query.user_id;

      const prisma = await getPrismaClientForTenancy(auth.tenancy);
      const verifiedEmails = await prisma.contactChannel.findMany({
        where: {
          tenancyId: auth.tenancy.id,
          projectUserId: targetUserId,
          type: 'EMAIL',
          isVerified: true,
        },
        select: { value: true },
      });

      if (verifiedEmails.length === 0) {
        return { items: [], is_paginated: false };
      }

      const codes = await globalPrismaClient.verificationCode.findMany({
        where: {
          projectId: auth.tenancy.project.id,
          branchId: auth.tenancy.branchId,
          type: VerificationCodeType.TEAM_INVITATION,
          usedAt: null,
          expiresAt: { gt: new Date() },
          OR: verifiedEmails.map(({ value }) => ({
            method: { path: ['email'], equals: value },
          })),
        },
      });

      const teamIds = [...new Set(codes.map(code => {
        const data = code.data as { team_id: string };
        return data.team_id;
      }))];

      const teamsMap = new Map<string, string>();
      for (const teamId of teamIds) {
        try {
          const team = await teamsCrudHandlers.adminRead({
            tenancy: auth.tenancy,
            team_id: teamId,
            allowedErrorTypes: [KnownErrors.TeamNotFound],
          });
          teamsMap.set(teamId, team.display_name);
        } catch (e) {
          if (KnownErrors.TeamNotFound.isInstance(e)) {
            // Team may have been deleted since the invitation was created; skip these invitations
            continue;
          }
          throw e;
        }
      }

      return {
        items: codes
          .filter(code => {
            const data = code.data as { team_id: string };
            return teamsMap.has(data.team_id);
          })
          .map(code => {
            const data = code.data as { team_id: string };
            const method = code.method as { email: string };
            return {
              id: code.id,
              team_id: data.team_id,
              team_display_name: teamsMap.get(data.team_id) ?? throwErr("team_display_name should be available after filtering; this should never happen"),
              expires_at_millis: code.expiresAt.getTime(),
              recipient_email: method.email,
            };
          }),
        is_paginated: false,
      };
    }

    // List invitations for a specific team (existing behavior)
    const teamId = query.team_id ?? throwErr("team_id is required when user_id is not provided; this should never happen because of the earlier validation");
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    return await retryTransaction(prisma, async (tx) => {
      if (auth.type === 'client') {
        const currentUserId = auth.user?.id ?? throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());

        await ensureTeamMembershipExists(tx, { tenancyId: auth.tenancy.id, teamId, userId: currentUserId });

        for (const permissionId of ['$read_members', '$invite_members']) {
          await ensureUserTeamPermissionExists(tx, {
            tenancy: auth.tenancy,
            teamId,
            userId: currentUserId,
            permissionId,
            errorType: 'required',
            recursive: true,
          });
        }
      } else {
        await ensureTeamExists(tx, { tenancyId: auth.tenancy.id, teamId });
      }

      const allCodes = await teamInvitationCodeHandler.listCodes({
        tenancy: auth.tenancy,
        dataFilter: {
          path: ['team_id'],
          equals: teamId,
        },
      });

      const team = await teamsCrudHandlers.adminRead({
        tenancy: auth.tenancy,
        team_id: teamId,
      });
      const teamDisplayName = team.display_name;

      return {
        items: allCodes.map(code => ({
          id: code.id,
          team_id: code.data.team_id,
          team_display_name: teamDisplayName,
          expires_at_millis: code.expiresAt.getTime(),
          recipient_email: code.method.email,
        })),
        is_paginated: false,
      };
    });
  },
  onDelete: async ({ auth, query, params }) => {
    const teamId = query.team_id ?? throwErr(new StatusError(StatusError.BadRequest, "team_id is required for deleting a team invitation"));
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    await retryTransaction(prisma, async (tx) => {
      if (auth.type === 'client') {
        const currentUserId = auth.user?.id ?? throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());

        await ensureTeamMembershipExists(tx, { tenancyId: auth.tenancy.id, teamId, userId: currentUserId });

        await ensureUserTeamPermissionExists(tx, {
          tenancy: auth.tenancy,
          teamId,
          userId: currentUserId,
          permissionId: "$remove_members",
          errorType: 'required',
          recursive: true,
        });
      } else {
        await ensureTeamExists(tx, { tenancyId: auth.tenancy.id, teamId });
      }
    });

    await teamInvitationCodeHandler.revokeCode({
      tenancy: auth.tenancy,
      id: params.id,
    });
  },
}));
