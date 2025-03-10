import { prismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { Prisma } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

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
    }).defined(),
    headers: yupObject({
      "x-stack-refresh-token": yupTuple([yupString().defined()]).defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  async handler({ auth: { tenancy }, headers: { "x-stack-refresh-token": refreshTokenHeaders } }) {
    if (!refreshTokenHeaders[0]) {
      throw new StackAssertionError("Signing out without the refresh token is currently not supported. TODO: implement");
    }
    const refreshToken = refreshTokenHeaders[0];

    try {
      await prismaClient.projectUserRefreshToken.deleteMany({
        where: {
          tenancyId: tenancy.id,
          refreshToken,
        },
      });
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
