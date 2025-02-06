import { prismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    url: yupString().defined(),
    auth: yupObject({
      tenancy: yupObject({
        id: yupString().oneOf(["internal"]).defined(),
      }).defined(),
      type: serverOrHigherAuthTypeSchema.defined(),
    }).defined(),
    body: yupObject({
      interaction_uid: yupString().defined(),
      project_id: yupString().defined(),
      neon_project_name: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      authorization_code: yupString().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    // Create an admin API key for the tenancy
    const set = await prismaClient.apiKeySet.create({
      data: {
        tenancyId: req.body.project_id,
        description: `Auto-generated for Neon${req.body.neon_project_name ? ` (${req.body.neon_project_name})` : ""}`,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 100),
        superSecretAdminKey: `sak_${generateSecureRandomString()}`,
      },
    });

    // Create authorization code
    const authorizationCode = generateSecureRandomString();
    await prismaClient.projectWrapperCodes.create({
      data: {
        idpId: "stack-preconfigured-idp:integrations/neon",
        interactionUid: req.body.interaction_uid,
        authorizationCode,
        cdfcResult: {
          access_token: set.superSecretAdminKey,
          token_type: "api_key",
          project_id: req.body.project_id,
        },
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        authorization_code: authorizationCode,
      },
    };
  },
});
