import { teamMembershipsCrudHandlers } from "@/app/api/latest/team-memberships/crud";
import { getItemQuantityForCustomer } from "@/lib/payments";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { globalPrismaClient } from "@/prisma-client";
import { VerificationCodeType } from "@/generated/prisma/client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, userIdOrMeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Accept a team invitation by ID",
    description: "Accepts a team invitation for the specified user. The user must have a verified email matching the invitation's recipient email. This marks the invitation as used and adds the user to the team.",
    tags: ["Teams"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
      user: adaptSchema.optional(),
    }).defined(),
    params: yupObject({
      id: yupString().uuid().defined(),
    }).defined(),
    query: yupObject({
      user_id: userIdOrMeSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({}).defined(),
  }),
  async handler({ auth, params, query }) {
    const userId = query.user_id;

    if (auth.type === 'client') {
      if (!auth.user) {
        throw new KnownErrors.CannotGetOwnUserWithoutUser();
      }
      if (userId !== auth.user.id) {
        throw new KnownErrors.CannotGetOwnUserWithoutUser();
      }

      if (auth.user.restricted_reason) {
        throw new KnownErrors.TeamInvitationRestrictedUserNotAllowed(auth.user.restricted_reason);
      }
    }

    // Look up the invitation (verification code) by ID
    const code = await globalPrismaClient.verificationCode.findUnique({
      where: {
        projectId_branchId_id: {
          projectId: auth.tenancy.project.id,
          branchId: auth.tenancy.branchId,
          id: params.id,
        },
        type: VerificationCodeType.TEAM_INVITATION,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!code) {
      throw new KnownErrors.VerificationCodeNotFound();
    }

    const invitationData = code.data as { team_id: string };
    const invitationMethod = code.method as { email: string };

    // Verify that the target user has a verified email matching the invitation's recipient
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const matchingChannel = await prisma.contactChannel.findFirst({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserId: userId,
        type: 'EMAIL',
        isVerified: true,
        value: invitationMethod.email,
      },
    });

    if (!matchingChannel) {
      throw new KnownErrors.VerificationCodeNotFound();
    }

    // Atomically mark the invitation as used before creating the membership.
    // This uses globalPrismaClient (not a tenancy transaction), so it must happen
    // outside retryTransaction to avoid being re-executed on retry after already committing.
    const updated = await globalPrismaClient.verificationCode.updateMany({
      where: {
        projectId: auth.tenancy.project.id,
        branchId: auth.tenancy.branchId,
        id: params.id,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      throw new KnownErrors.VerificationCodeNotFound();
    }

    await retryTransaction(prisma, async (tx) => {
      if (auth.tenancy.project.id === "internal") {
        const currentMemberCount = await tx.teamMember.count({
          where: {
            tenancyId: auth.tenancy.id,
            teamId: invitationData.team_id,
          },
        });
        const maxDashboardAdmins = await getItemQuantityForCustomer({
          prisma: tx,
          tenancy: auth.tenancy,
          customerId: invitationData.team_id,
          itemId: "dashboard_admins",
          customerType: "team",
        });
        if (currentMemberCount + 1 > maxDashboardAdmins) {
          throw new KnownErrors.ItemQuantityInsufficientAmount("dashboard_admins", invitationData.team_id, -1);
        }
      }

      const oldMembership = await tx.teamMember.findUnique({
        where: {
          tenancyId_projectUserId_teamId: {
            tenancyId: auth.tenancy.id,
            projectUserId: userId,
            teamId: invitationData.team_id,
          },
        },
      });

      if (!oldMembership) {
        await teamMembershipsCrudHandlers.adminCreate({
          tenancy: auth.tenancy,
          team_id: invitationData.team_id,
          user_id: userId,
          data: {},
        });
      }
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {},
    };
  },
});
