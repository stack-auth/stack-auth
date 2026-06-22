import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List registered client certificates",
    description: "List the mTLS client certificates registered on the current user's account.",
    tags: ["mTLS"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
      user: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      certificates: yupArray(yupObject({
        id: yupString().defined(),
        fingerprint: yupString().defined(),
        subject: yupString().defined(),
        issuer: yupString().defined(),
        display_name: yupString().nullable().defined(),
        valid_from: yupString().defined(),
        valid_to: yupString().defined(),
        created_at: yupString().defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy, user } }) {
    if (!tenancy.config.auth.mtls.allowSignIn) {
      throw new KnownErrors.MtlsAuthenticationNotEnabled();
    }

    const prisma = await getPrismaClientForTenancy(tenancy);
    const certificates = await prisma.mtlsAuthMethod.findMany({
      where: {
        tenancyId: tenancy.id,
        projectUserId: user.id,
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        certificates: certificates.map((c) => ({
          id: c.authMethodId,
          fingerprint: c.fingerprint,
          subject: c.subject,
          issuer: c.issuer,
          display_name: c.displayName,
          valid_from: c.validFrom.toISOString(),
          valid_to: c.validTo.toISOString(),
          created_at: c.createdAt.toISOString(),
        })),
      },
    };
  },
});
