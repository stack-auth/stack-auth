import { prismaClient } from "@/prisma-client";
import { createPrismaCrudHandlers } from "@/route-handlers/prisma-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { internalApiKeysCrud } from "@stackframe/stack-shared/dist/interface/crud/internal-api-keys";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const internalApiKeyCrudHandlers = createLazyProxy(() => createPrismaCrudHandlers(internalApiKeysCrud, "apiKeySet", {
  paramsSchema: yupObject({
    api_key_id: yupString().uuid().defined(),
  }),
  baseFields: async () => ({}),
  where: async ({ auth }) => {
    return {
      projectId: auth.project.id,
    };
  },
  whereUnique: async ({ params, auth }) => {
    return {
      projectId_id: {
        projectId: auth.project.id,
        id: params.api_key_id,
      },
    };
  },
  include: async () => ({}),
  notFoundToCrud: () => {
    throw new KnownErrors.ApiKeyNotFound();
  },
  orderBy: async () => {
    return {
      createdAt: 'desc',
    };
  },
  crudToPrisma: async (crud, { auth, type, params }) => {
    let old;
    if (type === 'create') {
      old = await prismaClient.apiKeySet.findUnique({
        where: {
          projectId_id: {
            projectId: auth.project.id,
            id: params.api_key_id ?? throwErr('params.apiKeyId is required for update')
          },
        },
      });
    }

    return {
      description: crud.description,
      manuallyRevokedAt: old?.manuallyRevokedAt ? undefined : (crud.revoked ? new Date() : undefined),
    };
  },
  prismaToCrud: async (prisma) => {
    return {
      id: prisma.id,
      description: prisma.description,
      publishable_client_key: prisma.publishableClientKey ? {
        last_four: prisma.publishableClientKey.slice(-4),
      } : undefined,
      secret_server_key: prisma.secretServerKey ? {
        last_four: prisma.secretServerKey.slice(-4),
      } : undefined,
      super_secret_admin_key: prisma.superSecretAdminKey ? {
        last_four: prisma.superSecretAdminKey.slice(-4),
      } : undefined,
      created_at_millis: prisma.createdAt.getTime(),
      expires_at_millis: prisma.expiresAt.getTime(),
      manually_revoked_at_millis: prisma.manuallyRevokedAt?.getTime(),
    };
  },
}));
