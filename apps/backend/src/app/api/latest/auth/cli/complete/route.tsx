import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Complete CLI authentication",
    description: "Set the refresh token for a CLI authentication session using the login code",
    tags: ["CLI Authentication"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      login_code: yupString().defined(),
      refresh_token: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  async handler({ auth: { tenancy }, body: { login_code, refresh_token } }) {
    const prisma = await getPrismaClientForTenancy(tenancy);

    // Find the CLI auth attempt
    const cliAuth = await prisma.cliAuthAttempt.findUnique({
      where: {
        loginCode: login_code,
        refreshToken: null,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (!cliAuth) {
      throw new StatusError(400, "Invalid login code or the code has expired");
    }

    if (cliAuth.tenancyId !== tenancy.id) {
      throw new StatusError(400, "Project ID mismatch; please ensure that you are using the correct app url.");
    }

    // Update with refresh token
    await prisma.cliAuthAttempt.update({
      where: {
        tenancyId_id: {
          tenancyId: tenancy.id,
          id: cliAuth.id,
        },
      },
      data: {
        refreshToken: refresh_token,
      },
    });

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
