import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

// Helper function to create response
const createResponse = (status: 'waiting' | 'success' | 'expired' | 'used', refreshToken?: string) => ({
  statusCode: status === 'success' ? 201 : 200,
  bodyType: "json" as const,
  body: {
    status,
    ...(refreshToken && { refresh_token: refreshToken }),
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Poll CLI authentication status",
    description: "Check the status of a CLI authentication session using the polling code",
    tags: ["CLI Authentication"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      polling_code: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200, 201]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().oneOf(["waiting", "success", "expired", "used"]).defined(),
      refresh_token: yupString().optional(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, body: { polling_code } }) {
    const prisma = getPrismaClientForTenancy(tenancy);

    // Find the CLI auth attempt
    const cliAuth = await prisma.cliAuthAttempt.findFirst({
      where: {
        tenancyId: tenancy.id,
        pollingCode: polling_code,
      },
    });

    if (!cliAuth) {
      throw new KnownErrors.InvalidPollingCodeError();
    }

    if (cliAuth.expiresAt < new Date()) {
      return createResponse('expired');
    }

    if (cliAuth.usedAt) {
      return createResponse('used');
    }

    if (!cliAuth.refreshToken) {
      return createResponse('waiting');
    }

    // Mark as used
    await prisma.cliAuthAttempt.update({
      where: {
        tenancyId_id: {
          tenancyId: tenancy.id,
          id: cliAuth.id,
        },
      },
      data: {
        usedAt: new Date(),
      },
    });

    return createResponse('success', cliAuth.refreshToken);
  },
});
