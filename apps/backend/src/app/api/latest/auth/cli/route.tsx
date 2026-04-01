import { globalPrismaClient, getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: 'Initiate CLI authentication',
    description: 'Create a new CLI authentication session and return polling and login codes',
    tags: ['CLI Authentication'],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      expires_in_millis: yupNumber().max(1000 * 60 * 60 * 24).default(1000 * 60 * 120), // Default: 2 hours, max: 24 hours
      anon_refresh_token: yupString().optional(),
    }).default({}),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(['json']).defined(),
    body: yupObject({
      polling_code: yupString().defined(),
      login_code: yupString().defined(),
      expires_at: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, body: { expires_in_millis, anon_refresh_token } }) {
    let anonRefreshToken: string | null = null;

    if (anon_refresh_token) {
      const refreshTokenObj = await globalPrismaClient.projectUserRefreshToken.findUnique({
        where: {
          refreshToken: anon_refresh_token,
        },
      });

      if (!refreshTokenObj) {
        throw new StatusError(400, "Invalid anon refresh token");
      }

      if (refreshTokenObj.tenancyId !== tenancy.id) {
        throw new StatusError(400, "Anon refresh token does not belong to this project");
      }

      if (refreshTokenObj.expiresAt && refreshTokenObj.expiresAt < new Date()) {
        throw new StatusError(400, "The provided anon refresh token has expired");
      }

      const user = await globalPrismaClient.projectUser.findUnique({
        where: {
          tenancyId_projectUserId: {
            tenancyId: tenancy.id,
            projectUserId: refreshTokenObj.projectUserId,
          },
        },
      });

      if (!user) {
        throw new StatusError(400, "User not found for provided refresh token");
      }

      if (!user.isAnonymous) {
        throw new StatusError(400, "The provided refresh token does not belong to an anonymous user");
      }

      anonRefreshToken = anon_refresh_token;
    }

    const pollingCode = generateSecureRandomString();
    const loginCode = generateSecureRandomString();
    const expiresAt = new Date(Date.now() + expires_in_millis);

    const prisma = await getPrismaClientForTenancy(tenancy);
    const cliAuth = await prisma.cliAuthAttempt.create({
      data: {
        tenancyId: tenancy.id,
        pollingCode,
        loginCode,
        expiresAt,
        anonRefreshToken,
      },
    });

    return {
      statusCode: 200,
      bodyType: 'json',
      body: {
        polling_code: cliAuth.pollingCode,
        login_code: cliAuth.loginCode,
        expires_at: cliAuth.expiresAt.toISOString(),
      },
    };
  },
});
