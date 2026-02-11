import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

/**
 * Preview which users would be affected by onboarding config changes.
 *
 * This endpoint simulates the effect of changing onboarding settings and returns
 * users who would transition from "normal" (onboarded) to "restricted" state.
 */
export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Preview users affected by onboarding config changes",
    description: "Returns users who would become restricted if the specified onboarding config changes were applied.",
    tags: ["Onboarding"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      // The proposed new onboarding config
      onboarding: yupObject({
        require_email_verification: yupBoolean().optional(),
      }).defined(),
    }).defined(),
    query: yupObject({
      limit: yupString().optional().default("10"),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      affected_users: yupArray(yupObject({
        id: yupString().defined(),
        display_name: yupString().nullable().defined(),
        primary_email: yupString().nullable().defined(),
        restricted_reason: yupObject({
          type: yupString().oneOf(["anonymous", "email_not_verified"]).defined(),
        }).defined(),
      }).defined()).defined(),
      total_affected_count: yupNumber().defined(),
    }).defined(),
  }),
  async handler({ auth, body, query }) {
    const currentConfig = auth!.tenancy.config;
    const proposedConfig = body as { onboarding: { require_email_verification?: boolean } };

    const limit = parseInt(query.limit, 10);
    const tenancy = auth!.tenancy;

    // Email verification requirement
    const wasEmailVerificationRequired = currentConfig.onboarding.requireEmailVerification || false;
    const willEmailVerificationBeRequired = proposedConfig.onboarding.require_email_verification !== undefined
      ? proposedConfig.onboarding.require_email_verification
      : wasEmailVerificationRequired;

    // Find users who would become restricted based on newly enabled conditions
    const affectedUsers: Array<{
      id: string,
      display_name: string | null,
      primary_email: string | null,
      restricted_reason: { type: "anonymous" | "email_not_verified" },
    }> = [];
    let totalAffectedCount = 0;

    // For email verification: find non-anonymous users with unverified emails
    // who are currently considered "normal" but would become "restricted"
    if (willEmailVerificationBeRequired && !wasEmailVerificationRequired) {
      const prisma = await getPrismaClientForTenancy(tenancy);

      // Count total affected users
      totalAffectedCount = await prisma.projectUser.count({
        where: {
          tenancyId: tenancy.id,
          isAnonymous: false,
          // User must NOT have a verified primary email to be affected
          NOT: {
            contactChannels: {
              some: {
                type: 'EMAIL',
                isPrimary: 'TRUE',
                isVerified: true,
              },
            },
          },
        },
      });

      // Get limited list of affected users
      const users = await prisma.projectUser.findMany({
        where: {
          tenancyId: tenancy.id,
          isAnonymous: false,
          // User must NOT have a verified primary email to be affected
          NOT: {
            contactChannels: {
              some: {
                type: 'EMAIL',
                isPrimary: 'TRUE',
                isVerified: true,
              },
            },
          },
        },
        include: {
          contactChannels: {
            where: {
              type: 'EMAIL',
              isPrimary: 'TRUE',
            },
          },
        },
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      });

      for (const user of users) {
        const primaryEmailChannel = user.contactChannels.find(c => c.isPrimary === 'TRUE');
        affectedUsers.push({
          id: user.projectUserId,
          display_name: user.displayName,
          primary_email: primaryEmailChannel?.value ?? null,
          restricted_reason: { type: "email_not_verified" },
        });
      }
    }

    // EXTENSIBILITY: Add more condition checks here in the future
    // e.g., phone verification, manual approval, etc.

    // Return limited results with total count
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        affected_users: affectedUsers,
        total_affected_count: totalAffectedCount,
      },
    };
  },
});

