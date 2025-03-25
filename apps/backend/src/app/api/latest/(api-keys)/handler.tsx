import { listUserTeamPermissions } from "@/lib/permissions";
import { prismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { KnownErrors } from "@stackframe/stack-shared";
import { UserApiKeysCrud, teamApiKeysCrud, userApiKeysCrud } from "@stackframe/stack-shared/dist/interface/crud/project-api-keys";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";


async function validateClientSecurity(
  auth: SmartRequestAuth,
  options: {
    userId?: string,
    teamId?: string,
    operation: 'create' | 'delete' | 'list' | 'update',
  }
) {
  if (auth.type !== "client") {
    return; // Only apply these checks for client access type
  }

  // Check if client is trying to manage API keys for other users
  if (options.userId && auth.user?.id !== options.userId) {
    throw new StatusError(StatusError.Forbidden, "Client can only manage their own api keys");
  }

  // Check team API key permissions
  if (options.teamId) {
    if (!auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }

    const userId = auth.user.id;
    const hasManageApiKeysPermission = await prismaClient.$transaction(async (tx) => {
      const permissions = await listUserTeamPermissions(tx, {
        tenancy: auth.tenancy,
        teamId: options.teamId,
        userId,
        permissionId: '$manage_api_keys',
        recursive: true,
      });
      return permissions.length > 0;
    });

    if (!hasManageApiKeysPermission) {
      throw new KnownErrors.TeamPermissionRequired(options.teamId, userId, '$manage_api_keys');
    }
  }
}


export const createApiKeyHandlers = (type: 'USER' | 'TEAM') =>
createLazyProxy(() => createCrudHandlers(type === 'USER' ? userApiKeysCrud : teamApiKeysCrud, {
  paramsSchema: yupObject({
    api_key_id: yupString().uuid().defined(),
  }),
  querySchema: type === 'USER' ? yupObject({
    user_id: userIdOrMeSchema.optional().meta({ openapiField: { onlyShowInOperations: ['List'] } }),
  }) : yupObject({
    team_id: yupString().uuid().optional().meta({ openapiField: { onlyShowInOperations: ['List'] } }),
  }),

  // CREATE
  onCreate: async ({ auth, data  }) => {

    const userId = "user_id" in data ? (
      data.user_id === "me" ? auth.user?.id : data.user_id
    ): undefined;
    const teamId = "team_id" in data ? data.team_id : undefined;

    console.log("userId", data);

    // Security checks
    await validateClientSecurity(auth, {
      userId,
      teamId,
      operation: 'create'
    });

    const apiKeyId = generateUuid();
    // Generate API keys based on flags
    const secretApiKey = generateSecureRandomString();


    // Create the API key set in the database
    const apiKey = await prismaClient.projectAPIKey.create({
      data: {
        id: apiKeyId,
        projectId: auth.project.id,
        description: data.description,
        secretApiKey,
        expiresAt: data.expires_at_millis ? new Date(data.expires_at_millis) : undefined,
        createdAt: new Date(),
        projectUserId: userId,
        teamId: teamId,
        tenancyId: auth.tenancy.id,
      },
    });


    // Return the newly created API key information
    return {
      id: apiKey.id,
      user_id: apiKey.projectUserId || undefined,
      team_id: apiKey.teamId || undefined,
      description: apiKey.description ?? undefined,
      secret_api_key: apiKey.secretApiKey,
      created_at_millis: apiKey.createdAt.getTime(),
      expires_at_millis: apiKey.expiresAt?.getTime(),
    };
  },


  // LIST
  onList: async ({ auth, query }) => {

    const userId = "user_id" in query ? query.user_id : undefined;
    const teamId = "team_id" in query ? query.team_id : undefined;

    // Security checks
    await validateClientSecurity(auth, {
      userId,
      teamId,
      operation: 'list'
    });

    const apiKeys = await prismaClient.projectAPIKey.findMany({
      where: {
        projectId: auth.project.id,
        projectUserId: userId,
        teamId: teamId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Return a list of API keys with obfuscated key values
    return {
      items: apiKeys.map(apiKey => ({
        id: apiKey.id,
        team_id: apiKey.teamId || undefined,
        user_id: apiKey.projectUserId || undefined,
        description: apiKey.description ?? undefined,
        secret_api_key: {
          last_four: apiKey.secretApiKey.slice(-4),
        },
        created_at_millis: apiKey.createdAt.getTime(),
        expires_at_millis: apiKey.expiresAt?.getTime(),
        manually_revoked_at_millis: apiKey.manuallyRevokedAt?.getTime(),
      })),
      is_paginated: false,
    };
  },

  // UPDATE
  onUpdate: async ({ auth, data, params }: {
    auth: SmartRequestAuth,
    data: UserApiKeysCrud["Client"]["Update"],
    params: { api_key_id: string },
  }) => {
    // Find the existing API key
    const existingApiKey = await prismaClient.projectAPIKey.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: auth.tenancy.id,
          id: params.api_key_id,
        },
      },
    });

    if (!existingApiKey) {
      throw new KnownErrors.ApiKeyNotFound();
    }

    // Security checks
    await validateClientSecurity(auth, {
      userId: existingApiKey.projectUserId || undefined,
      teamId: existingApiKey.teamId || undefined,
      operation: 'update'
    });

    // Update the API key
    const updatedApiKey = await prismaClient.projectAPIKey.update({
      where: {
        tenancyId_id: {
          tenancyId: auth.tenancy.id,
          id: params.api_key_id,
        },
      },
      data: {
        description: data.description !== undefined ? data.description : undefined,
        manuallyRevokedAt: existingApiKey.manuallyRevokedAt ? undefined : (data.revoked ? new Date() : undefined),
      },
    });

    // Return the updated API key with obfuscated key values
    return {
      id: updatedApiKey.id,
      user_id: updatedApiKey.projectUserId || undefined,
      team_id: updatedApiKey.teamId || undefined,
      description: updatedApiKey.description ?? undefined,
      secret_api_key: {
        last_four: updatedApiKey.secretApiKey.slice(-4),
      },
      created_at_millis: updatedApiKey.createdAt.getTime(),
      expires_at_millis: updatedApiKey.expiresAt?.getTime(),
      manually_revoked_at_millis: updatedApiKey.manuallyRevokedAt?.getTime(),
    };
  },

  // DELETE
  onDelete: async ({ auth, params }: {
    auth: SmartRequestAuth,
    params: { api_key_id: string },
  }) => {
    // Check if the API key exists
    const existingApiKey = await prismaClient.projectAPIKey.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: auth.tenancy.id,
          id: params.api_key_id,
        },
      },
    });

    if (!existingApiKey) {
      throw new KnownErrors.ApiKeyNotFound();
    }

    // Security checks
    await validateClientSecurity(auth, {
      userId: existingApiKey.projectUserId || undefined,
      teamId: existingApiKey.teamId || undefined,
      operation: 'delete'
    });

    // Delete the API key
    await prismaClient.projectAPIKey.delete({
      where: {
        tenancyId_id: {
          tenancyId: auth.tenancy.id,
          id: params.api_key_id,
        },
      },
    });

    // No return value for delete operation
  },
}));
