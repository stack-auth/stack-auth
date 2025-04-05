import { prismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { internalApiKeysCreateInputSchema, internalApiKeysCreateOutputSchema } from "@stackframe/stack-shared/dist/interface/crud/internal-api-keys";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { internalApiKeyCrudHandlers } from "./crud";

export const GET = internalApiKeyCrudHandlers.listHandler;

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      project: adaptSchema.defined(),
    }).defined(),
    body: internalApiKeysCreateInputSchema.defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: internalApiKeysCreateOutputSchema.defined(),
  }),
  handler: async ({ auth, body }) => {
    const set = await prismaClient.apiKeySet.create({
      data: {
        id: generateUuid(),
        projectId: auth.project.id,
        description: body.description,
        expiresAt: new Date(body.expires_at_millis),
        publishableClientKey: body.has_publishable_client_key ? `pck_${generateSecureRandomString()}` : undefined,
        secretServerKey: body.has_secret_server_key ? `ssk_${generateSecureRandomString()}` : undefined,
        superSecretAdminKey: body.has_super_secret_admin_key ? `sak_${generateSecureRandomString()}` : undefined,
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        id: set.id,
        description: set.description,
        publishable_client_key: set.publishableClientKey || undefined,
        secret_server_key: set.secretServerKey || undefined,
        super_secret_admin_key: set.superSecretAdminKey || undefined,
        created_at_millis: set.createdAt.getTime(),
        expires_at_millis: set.expiresAt.getTime(),
        manually_revoked_at_millis: set.manuallyRevokedAt?.getTime(),
      }
    } as const;
  },
});
