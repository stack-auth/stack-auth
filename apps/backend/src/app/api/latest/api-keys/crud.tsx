import { listUserTeamPermissions } from "@/lib/permissions";
import { prismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { KnownErrors } from "@stackframe/stack-shared";
import { projectApiKeysCrud, ProjectApiKeysCrud } from "@stackframe/stack-shared/dist/interface/crud/project-api-keys";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";


function getGroupType(params: {
  project_user_id?: string,
  tenancy_id?: string,
  team_id?: string,
}): "USER" | "TENANCY" | "TEAM" {
  const definedCount = [
    params.project_user_id,
    params.tenancy_id,
    params.team_id
  ].filter(x => x !== undefined).length;

  if (definedCount !== 1) {
    throw new KnownErrors.InvalidGroup(
      params,
    );
  }

  if (params.project_user_id) {
    return 'USER';
  }

  if (params.team_id) {
    return 'TEAM';
  }

  if (params.tenancy_id) {
    return 'TENANCY';
  }

  // this should never happen
  throw new KnownErrors.InvalidGroup(params);
}

/**
 * Validates client security for API key operations
 * @param auth Authentication information
 * @param options Options containing user, team, and tenancy information
 */
async function validateClientSecurity(
  auth: SmartRequestAuth,
  options: {
    project_user_id?: string,
    team_id?: string,
    tenancy_id?: string,
    operation: 'create' | 'delete' | 'list' | 'update',
  }
) {
  if (auth.type !== "client") {
    return; // Only apply these checks for client access type
  }

  // Check if client is trying to manage API keys for other users
  if (options.project_user_id && auth.user?.id !== options.project_user_id) {
    throw new StatusError(StatusError.Forbidden, "Client can only manage their own api keys");
  }

  // Check team API key permissions
  if (options.team_id) {
    if (!auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }

    const userId = auth.user.id;
    const hasManageApiKeysPermission = await prismaClient.$transaction(async (tx) => {
      const permissions = await listUserTeamPermissions(tx, {
        tenancy: auth.tenancy,
        teamId: options.team_id,
        userId,
        permissionId: '$manage_api_keys',
        recursive: true,
      });
      return permissions.length > 0;
    });

    if (!hasManageApiKeysPermission) {
      throw new KnownErrors.TeamPermissionRequired(options.team_id, userId, '$manage_api_keys');
    }
  }

  // Clients cannot manage tenancy API keys
  if (options.tenancy_id) {
    throw new KnownErrors.InsufficientAccessType(auth.type, ['admin']);
  }
}


export const projectApiKeyCrudHandlers = createLazyProxy(() => createCrudHandlers(projectApiKeysCrud, {
  paramsSchema: yupObject({
    api_key_id: yupString().uuid().defined(),
  }),
  querySchema: yupObject({
    project_user_id: userIdOrMeSchema.optional().meta({ openapiField: { onlyShowInOperations: ['List'] } }),
    team_id: yupString().uuid().optional().meta({ openapiField: { onlyShowInOperations: ['List'] } }),
    tenancy_id: yupString().uuid().optional().meta({ openapiField: { onlyShowInOperations: ['List'] } }),
  }),

  // CREATE
  onCreate: async ({ auth, data }) => {


    // TODO figure out if this is right
    if (data.project_user_id === 'me') {
      data.project_user_id = auth.user?.id;
    }


    const groupType = getGroupType(data);

    if (groupType === 'TENANCY') {
      throw new KnownErrors.UnsupportedError("Creating API keys for a tenancy is not supported right now");
    }


    // Security checks
    await validateClientSecurity(auth, {
      project_user_id: data.project_user_id,
      team_id: data.team_id,
      tenancy_id: data.tenancy_id,
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
        projectUserId: data.project_user_id,
        teamId: data.team_id,
        tenancyId: auth.tenancy.id,
        groupType,
      },
    });


    // Return the newly created API key information
    return {
      id: apiKey.id,
      description: apiKey.description ?? undefined,
      secret_api_key: apiKey.secretApiKey,
      created_at_millis: apiKey.createdAt.getTime(),
      expires_at_millis: apiKey.expiresAt?.getTime(),
      group_type: apiKey.groupType,
    };
  },


  // LIST
  onList: async ({ auth, query }) => {


    const groupType = getGroupType(query);

    // Security checks
    await validateClientSecurity(auth, {
      project_user_id: query.project_user_id,
      team_id: query.team_id,
      tenancy_id: query.tenancy_id,
      operation: 'list'
    });

    const apiKeys = await prismaClient.projectAPIKey.findMany({
      where: {
        projectId: auth.project.id,
        projectUserId: query.project_user_id,
        teamId: query.team_id,
        tenancyId: query.tenancy_id,
        groupType,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Return a list of API keys with obfuscated key values
    return {
      items: apiKeys.map(apiKey => ({
        id: apiKey.id,
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
    data: ProjectApiKeysCrud["Client"]["Update"],
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
      project_user_id: existingApiKey.projectUserId || undefined,
      team_id: existingApiKey.teamId || undefined,
      tenancy_id: existingApiKey.tenancyId || undefined,
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
      project_user_id: existingApiKey.projectUserId || undefined,
      team_id: existingApiKey.teamId || undefined,
      tenancy_id: existingApiKey.tenancyId || undefined,
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
