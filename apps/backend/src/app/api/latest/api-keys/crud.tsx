import { prismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { KnownErrors } from "@stackframe/stack-shared";
import { projectApiKeysCrud, ProjectApiKeysCrud } from "@stackframe/stack-shared/dist/interface/crud/project-api-keys";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";


function validateExactlyOneGroupIdentifier(params: {
  project_user_id?: string,
  tenancy_id?: string,
  team_id?: string,
}): void {
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


    validateExactlyOneGroupIdentifier(data);


    // Security checks
    if (auth.type === "client") {
      if (data.project_user_id && auth.user?.id !== data.project_user_id) {
        throw new StackAssertionError("Client cannot create API keys for other users");
      }

      if (data.team_id) {
        // TODO check if the auth.user.id has permission "manageApiKeys" on the team
      }

      if (data.tenancy_id) {
        // TODO throw an error because client cannot create API keys for a tenancy
      }
    }

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
        tenancyId: data.tenancy_id,
      },
    });


    // Return the newly created API key information
    return {
      id: apiKey.id,
      description: apiKey.description ?? undefined,
      secret_api_key: apiKey.secretApiKey,
      created_at_millis: apiKey.createdAt.getTime(),
      expires_at_millis: apiKey.expiresAt?.getTime(),
    };
  },


  // LIST
  onList: async ({ auth, query }) => {


    validateExactlyOneGroupIdentifier(query);

    // Security checks
    if (auth.type === "client") {
      if (query.project_user_id && auth.user?.id !== query.project_user_id) {
        throw new StackAssertionError("Client cannot create API keys for other users");
      }

      if (query.team_id) {
        // TODO check if the auth.user.id has permission "manageApiKeys" on the team
      }

      if (query.tenancy_id) {
        // TODO throw an error because client cannot create API keys for a tenancy
      }
    }

    const apiKeys = await prismaClient.projectAPIKey.findMany({
      where: {
        projectId: auth.project.id,
        projectUserId: query.project_user_id,
        teamId: query.team_id,
        tenancyId: query.tenancy_id,
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
        projectId_id: {
          projectId: auth.project.id,
          id: params.api_key_id,
        },
      },
    });

    if (!existingApiKey) {
      throw new KnownErrors.ApiKeyNotFound();
    }

    // Security checks
    if (auth.type === "client") {
      if (existingApiKey.projectUserId && auth.user?.id !== existingApiKey.projectUserId) {
        throw new StackAssertionError("Client cannot create API keys for other users");
      }

      if (existingApiKey.teamId) {
        // TODO check if the auth.user.id has permission "manageApiKeys" on the team
      }

      if (existingApiKey.tenancyId) {
        // TODO throw an error because client cannot create API keys for a tenancy
      }
    }

    // Update the API key
    const updatedApiKey = await prismaClient.projectAPIKey.update({
      where: {
        projectId_id: {
          projectId: auth.project.id,
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
        projectId_id: {
          projectId: auth.project.id,
          id: params.api_key_id,
        },
      },
    });

    if (!existingApiKey) {
      throw new KnownErrors.ApiKeyNotFound();
    }

    // Security checks
    if (auth.type === "client") {
      if (existingApiKey.projectUserId && auth.user?.id !== existingApiKey.projectUserId) {
        throw new StackAssertionError("Client cannot create API keys for other users");
      }

      if (existingApiKey.teamId) {
        // TODO check if the auth.user.id has permission "manageApiKeys" on the team
      }

      if (existingApiKey.tenancyId) {
        // TODO throw an error because client cannot create API keys for a tenancy
      }
    }

    // Delete the API key
    await prismaClient.projectAPIKey.delete({
      where: {
        projectId_id: {
          projectId: auth.project.id,
          id: params.api_key_id,
        },
      },
    });

    // No return value for delete operation
  },
}));
