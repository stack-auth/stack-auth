import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";

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
  async handler({ auth: { tenancy }, body: { expires_in_millis } }) {
    const pollingCode = generateSecureRandomString();
    const loginCode = generateSecureRandomString();
    const expiresAt = new Date(Date.now() + expires_in_millis);

    // Create a new CLI auth attempt
    const prisma = getPrismaClientForTenancy(tenancy);
    const cliAuth = await prisma.cliAuthAttempt.create({
      data: {
        tenancyId: tenancy.id,
        pollingCode,
        loginCode,
        expiresAt,
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
