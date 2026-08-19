import { computeRestrictedStatus } from "@/app/api/latest/users/crud";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { captureError, HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      users: yupArray(yupObject({
        id: yupString().defined(),
        primary_email: yupString().nullable().defined(),
        display_name: yupString().nullable().defined(),
        restricted_reason: yupString().defined(),
        signed_up_at: yupString().defined(),
      }).defined()).defined(),
      capped: yupBoolean().defined(),
      limit: yupNumber().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const tenancy = req.auth.tenancy;
    const limit = 5000;
    let users;
    try {
      const prisma = await getPrismaClientForTenancy(tenancy);
      users = await prisma.projectUser.findMany({
        where: {
          tenancyId: tenancy.id,
          // Anonymous visitors are not accounts that an administrator can
          // review or remediate, and high anonymous traffic would otherwise
          // crowd restricted registered users out of this capped result.
          isAnonymous: false,
          OR: [
            ...(tenancy.config.onboarding.requireEmailVerification ? [{
              NOT: {
                contactChannels: {
                  some: {
                    type: "EMAIL" as const,
                    isPrimary: "TRUE" as const,
                    isVerified: true,
                  },
                },
              },
            }] : []),
            { restrictedByAdmin: true },
          ],
        },
        include: {
          contactChannels: {
            where: {
              type: "EMAIL" as const,
              isPrimary: "TRUE" as const,
            },
          },
        },
        orderBy: { signedUpAt: "desc" },
        take: limit + 1,
      });
    } catch (error) {
      captureError("compliance-restricted-users-query", new HexclaveAssertionError(
        "Failed to load restricted users.",
        { cause: error },
      ));
      throw new StatusError(StatusError.ServiceUnavailable, "Restricted users are temporarily unavailable.");
    }
    const capped = users.length > limit;
    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        users: users.slice(0, limit).map((user) => {
          const primaryEmail = user.contactChannels.find((channel) => channel.isPrimary);
          const restrictedStatus = computeRestrictedStatus(
            user.isAnonymous,
            primaryEmail?.isVerified ?? false,
            tenancy.config,
            user.restrictedByAdmin,
          );
          if (!restrictedStatus.isRestricted) {
            throw new HexclaveAssertionError("Restricted-user query returned an unrestricted user.");
          }
          return {
            id: user.projectUserId,
            primary_email: primaryEmail?.value ?? null,
            display_name: user.displayName,
            restricted_reason: restrictedStatus.restrictedReason.type,
            signed_up_at: user.signedUpAt.toISOString(),
          };
        }),
        capped,
        limit,
      },
    };
  },
});
