import { Prisma } from "@/generated/prisma/client";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

type AnonRefreshTokenRow = {
  tenancyId: string,
  projectUserId: string,
  expiresAt: Date | null,
  isAnonymous: boolean,
};

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
      const rows = await globalPrismaClient.$queryRaw<AnonRefreshTokenRow[]>(Prisma.sql`
        SELECT
          t."tenancyId",
          t."projectUserId",
          t."expiresAt",
          u."isAnonymous"
        FROM "ProjectUserRefreshToken" t
        LEFT JOIN "ProjectUser" u
          ON u."tenancyId" = t."tenancyId"
          AND u."projectUserId" = t."projectUserId"
        WHERE t."refreshToken" = ${anon_refresh_token}
        LIMIT 1
      `);
      const row = rows[0];

      if (!row) {
        throw new StatusError(400, "Invalid anon refresh token");
      }

      if (row.tenancyId !== tenancy.id) {
        throw new StatusError(400, "Anon refresh token does not belong to this project");
      }

      if (row.expiresAt && row.expiresAt < new Date()) {
        throw new StatusError(400, "The provided anon refresh token has expired");
      }

      if (row.isAnonymous === null || row.isAnonymous === undefined) {
        throw new StatusError(400, "User not found for provided refresh token");
      }

      if (!row.isAnonymous) {
        throw new StatusError(400, "The provided refresh token does not belong to an anonymous user");
      }

      anonRefreshToken = anon_refresh_token;
    }

    const pollingCode = generateSecureRandomString();
    const loginCode = generateSecureRandomString();
    const expiresAt = new Date(Date.now() + expires_in_millis);

    const rows = await globalPrismaClient.$queryRaw<{ pollingCode: string, loginCode: string, expiresAt: Date }[]>(Prisma.sql`
      INSERT INTO "CliAuthAttempt" ("tenancyId", "id", "pollingCode", "loginCode", "expiresAt", "anonRefreshToken", "updatedAt")
      VALUES (
        ${tenancy.id}::UUID,
        gen_random_uuid(),
        ${pollingCode},
        ${loginCode},
        ${expiresAt},
        ${anonRefreshToken},
        NOW()
      )
      RETURNING "pollingCode", "loginCode", "expiresAt"
    `);
    const cliAuth = rows[0]!;

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
