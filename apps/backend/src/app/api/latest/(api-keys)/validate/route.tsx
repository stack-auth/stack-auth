import { prismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";


// WIP i need to redo this
export const POST = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["client", "server", "admin"]).defined(),
      project: yupObject({
        id: yupString().defined(),
      }).defined(),
      tenancy: yupObject({
        id: yupString().defined(),
      }).defined(),
      branchId: yupString().defined(),
      user: yupObject({
        id: yupString().defined(),
      }).optional(),
      refreshTokenId: yupString().optional(),
    }).defined(),
    body: yupObject({
      api_key: yupString().defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      valid: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async (req, fullReq) => {
    // Check if the API key exists and is valid
    const apiKey = await prismaClient.projectApiKey.findUnique({
      where: {
        secretApiKey: req.body.api_key,
      },
    });

    if (!apiKey) {
      throw new KnownErrors.ApiKeyNotFound();
    }

    // Check if the key belongs to the correct project
    if (apiKey.projectId !== req.auth.project.id) {
      throw new KnownErrors.InvalidApiKey();
    }

    // Check if the key belongs to the correct tenancy
    if (apiKey.tenancyId !== req.auth.tenancy.id) {
      throw new KnownErrors.InvalidApiKey();
    }

    // Check if the key is expired or revoked
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new KnownErrors.ApiKeyExpired(apiKey.expiresAt);
    }

    if (apiKey.manuallyRevokedAt) {
      throw new KnownErrors.ApiKeyRevoked(apiKey.manuallyRevokedAt);
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        valid: true,
      }
    } as const;
  },
});
