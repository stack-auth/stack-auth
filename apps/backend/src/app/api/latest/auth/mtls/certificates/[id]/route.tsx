import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupBoolean, yupObject, yupNumber, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const DELETE = createSmartRouteHandler({
  metadata: {
    summary: "Revoke a client certificate",
    description: "Revoke (delete) an mTLS client certificate registered on the current user's account.",
    tags: ["mTLS"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
      user: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy, user }, params: { id } }) {
    if (!tenancy.config.auth.mtls.allowSignIn) {
      throw new KnownErrors.MtlsAuthenticationNotEnabled();
    }

    const prisma = await getPrismaClientForTenancy(tenancy);

    await retryTransaction(prisma, async (tx) => {
      const certificate = await tx.mtlsAuthMethod.findUnique({
        where: {
          tenancyId_authMethodId: {
            tenancyId: tenancy.id,
            authMethodId: id,
          },
        },
      });
      if (!certificate || certificate.projectUserId !== user.id) {
        throw new StatusError(StatusError.NotFound, "No such certificate found on your account.");
      }

      // Don't let a user lock themselves out by deleting their only remaining sign-in method.
      const authMethodCount = await tx.authMethod.count({
        where: { tenancyId: tenancy.id, projectUserId: user.id },
      });
      if (authMethodCount <= 1) {
        throw new KnownErrors.MtlsCannotDeleteLastAuthMethod();
      }

      // Deleting the parent AuthMethod cascades to the MtlsAuthMethod row.
      await tx.authMethod.delete({
        where: {
          tenancyId_id: {
            tenancyId: tenancy.id,
            id,
          },
        },
      });
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { success: true },
    };
  },
});
