import { generateAccessToken } from "@/lib/tokens";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Refresh access token",
    description: "Get a new access token using a refresh token",
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
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      access_token: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, headers: { "x-stack-refresh-token": refreshTokenHeaders } }, fullReq) {
    const refreshToken = refreshTokenHeaders[0];

    const prisma = await getPrismaClientForTenancy(tenancy);
    const sessionObj = await globalPrismaClient.projectUserRefreshToken.findFirst({
      where: {
        tenancyId: tenancy.id,
        refreshToken,
      },
    });

    if (!sessionObj || (sessionObj.expiresAt && sessionObj.expiresAt < new Date())) {
      throw new KnownErrors.RefreshTokenNotFoundOrExpired();
    }

    const accessToken = await generateAccessToken({
      tenancy,
      userId: sessionObj.projectUserId,
      refreshTokenId: sessionObj.id,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        access_token: accessToken,
      },
    };
  },
});
