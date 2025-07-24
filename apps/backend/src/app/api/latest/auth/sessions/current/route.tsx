import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { Prisma } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const DELETE = createSmartRouteHandler({
  metadata: {
    summary: "Sign out of the current session",
    description: "Sign out of the current session and invalidate the refresh token",
    tags: ["Sessions"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
      refreshTokenId: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),


  async handler({ auth: { tenancy, refreshTokenId } }) {
    if (!refreshTokenId) {
      // Only here for transition period, remove this once all access tokens are updated
      // TODO next-release
      throw new KnownErrors.AccessTokenExpired(new Date());
    }

    try {
      const prisma = await getPrismaClientForTenancy(tenancy);
      const result = await globalPrismaClient.projectUserRefreshToken.deleteMany({
        where: {
          tenancyId: tenancy.id,
          id: refreshTokenId,
        },
      });
      // If no records were deleted, throw the same error as before
      if (result.count === 0) {
        throw new KnownErrors.RefreshTokenNotFoundOrExpired();
      }
    } catch (e) {
      // TODO make this less hacky, use a transaction to delete-if-exists instead of try-catch
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        throw new KnownErrors.RefreshTokenNotFoundOrExpired();
      } else {
        throw e;
      }
    }

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
