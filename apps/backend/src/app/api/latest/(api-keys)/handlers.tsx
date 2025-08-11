import { listPermissions } from "@/lib/permissions";
import { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { ProjectApiKey } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { TeamApiKeysCrud, UserApiKeysCrud, teamApiKeysCreateInputSchema, teamApiKeysCreateOutputSchema, teamApiKeysCrud, userApiKeysCreateInputSchema, userApiKeysCreateOutputSchema, userApiKeysCrud } from "@stackframe/stack-shared/dist/interface/crud/project-api-keys";
import { adaptSchema, clientOrHigherAuthTypeSchema, serverOrHigherAuthTypeSchema, userIdOrMeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { createProjectApiKey } from "@stackframe/stack-shared/dist/utils/api-keys";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";

import * as yup from "yup";


async function throwIfFeatureDisabled(tenancy: Tenancy, type: "team" | "user") {
  if (type === "team") {
    if (!tenancy.config.apiKeys.enabled.team) {
      throw new StatusError(StatusError.BadRequest, "Team API keys are not enabled for this project.");
    }
  } else {
    if (!tenancy.config.apiKeys.enabled.user) {
      throw new StatusError(StatusError.BadRequest, "User API keys are not enabled for this project.");
    }
  }
}

async function ensureUserCanManageApiKeys(
  auth: Pick<SmartRequestAuth, "user" | "type" | "tenancy">,
  options: {
    userId?: string,
    teamId?: string,
  },
) {
  if (options.userId !== undefined && options.teamId !== undefined) {
    throw new StatusError(StatusError.BadRequest, "Cannot provide both userId and teamId");
  }

  const prisma = await getPrismaClientForTenancy(auth.tenancy);

  if (auth.type === "client") {
    if (!auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    if ((options.userId === undefined) === (options.teamId === undefined)) {
      throw new StatusError(StatusError.BadRequest, "Exactly one of the userId or teamId query parameters must be provided");
    }
    // Check if client is trying to manage API keys for other users
    if (options.userId !== undefined && auth.user.id !== options.userId) {
      throw new StatusError(StatusError.Forbidden, "Client can only manage their own api keys");

    }

    // Check team API key permissions
    if (options.teamId !== undefined) {
      const userId = auth.user.id;
      const hasManageApiKeysPermission = await retryTransaction(prisma, async (tx) => {
        const permissions = await listPermissions(tx, {
          scope: 'team',
          tenancy: auth.tenancy,
          teamId: options.teamId,
          userId,
          permissionId: '$manage_api_keys',
          recursive: true,
        });
        return permissions.length > 0;
      });

      if (!hasManageApiKeysPermission) {
        // We return 404 here to not leak the existence of the team
        throw new KnownErrors.ApiKeyNotFound();
      }
    }
    return true;
  }
}

async function parseTypeAndParams(options: { type: "user" | "team", params: { user_id?: string, team_id?: string } }) {
  let userId: string | undefined;
  let teamId: string | undefined;

  if (options.type === "user") {
    if (!("user_id" in options.params)) {
      throw new KnownErrors.SchemaError("user_id is required for user API keys");
    }
    userId = options.params.user_id;
  } else {
    if (!("team_id" in options.params)) {
      throw new KnownErrors.SchemaError("team_id is required for team API keys");
    }
    teamId = options.params.team_id;
  }

  return { userId, teamId };
}


async function prismaToCrud<Type extends "user" | "team">(prisma: ProjectApiKey, type: Type, isFirstView: true): Promise<
  | yup.InferType<typeof userApiKeysCreateOutputSchema>
  | yup.InferType<typeof teamApiKeysCreateOutputSchema>
>;
async function prismaToCrud<Type extends "user" | "team">(prisma: ProjectApiKey, type: Type, isFirstView: false): Promise<
  | UserApiKeysCrud["Admin"]["Read"]
  | TeamApiKeysCrud["Admin"]["Read"]
>;
async function prismaToCrud<Type extends "user" | "team">(prisma: ProjectApiKey, type: Type, isFirstView: boolean):
  Promise<
    | yup.InferType<typeof userApiKeysCreateOutputSchema>
    | yup.InferType<typeof teamApiKeysCreateOutputSchema>
    | UserApiKeysCrud["Admin"]["Read"]
    | TeamApiKeysCrud["Admin"]["Read"]
  > {
  if ((prisma.projectUserId == null) === (prisma.teamId == null)) {
    throw new StackAssertionError("Exactly one of projectUserId or teamId must be set", { prisma });
  }

  if (type === "user" && prisma.projectUserId == null) {
    throw new StackAssertionError("projectUserId must be set for user API keys", { prisma });
  }
  if (type === "team" && prisma.teamId == null) {
    throw new StackAssertionError("teamId must be set for team API keys", { prisma });
  }

  return {
    id: prisma.id,
    description: prisma.description,
    is_public: prisma.isPublic,
    created_at_millis: prisma.createdAt.getTime(),
    expires_at_millis: prisma.expiresAt?.getTime(),
    manually_revoked_at_millis: prisma.manuallyRevokedAt?.getTime(), ...(isFirstView ? {
      value: prisma.secretApiKey,
    } : {
      value: {
        last_four: prisma.secretApiKey.slice(-4),
      },
    }),
    ...(type === "user" ? {
      user_id: prisma.projectUserId!,
      type: "user",
    } : {
      team_id: prisma.teamId!,
      type: "team",
    }),
  };
}

function createApiKeyHandlers<Type extends "user" | "team">(type: Type) {
  return {
    create: createSmartRouteHandler({
      metadata: {
        hidden: false,
        description: "Create a new API key for a user or team",
        summary: "Create API key",
        tags: ["API Keys"],
      },
      request: yupObject({
        auth: yupObject({
          type: clientOrHigherAuthTypeSchema,
          tenancy: adaptSchema.defined(),
          user: adaptSchema.optional(),
          project: adaptSchema.defined(),
        }).defined(),
        url: yupString().defined(),
        body: type === 'user' ? userApiKeysCreateInputSchema.defined() : teamApiKeysCreateInputSchema.defined(),
        method: yupString().oneOf(["POST"]).defined(),
      }),
      response: yupObject({
        statusCode: yupNumber().oneOf([200]).defined(),
        bodyType: yupString().oneOf(["json"]).defined(),
        body: type === 'user' ? userApiKeysCreateOutputSchema.defined() : teamApiKeysCreateOutputSchema.defined(),
      }),
      handler: async ({ url, auth, body }) => {
        await throwIfFeatureDisabled(auth.tenancy, type);
        const { userId, teamId } = await parseTypeAndParams({ type, params: body });
        await ensureUserCanManageApiKeys(auth, {
          userId,
          teamId,
        });
        // to make it easier to scan, we want our API key to have a very specific format
        // for example, for GitHub secret scanning: https://docs.github.com/en/code-security/secret-scanning/secret-scanning-partnership-program/secret-scanning-partner-program
        /*
        const userPrefix = body.prefix ?? (isPublic ? "pk" : "sk");
        if (!userPrefix.match(/^[a-zA-Z0-9_]+$/)) {
          throw new StackAssertionError("userPrefix must contain only alphanumeric characters and underscores. This is so we can register the API key with security scanners. This should've been checked in the creation schema");
        }
        */
        const isCloudVersion = new URL(url).hostname === "api.stack-auth.com";  // we only want to enable secret scanning on the cloud version
        const isPublic = body.is_public ?? false;
        const apiKeyId = generateUuid();

        const secretApiKey = createProjectApiKey({
          id: apiKeyId,
          isPublic,
          isCloudVersion,
          type,
        });

        const prisma = await getPrismaClientForTenancy(auth.tenancy);

        const apiKey = await prisma.projectApiKey.create({
          data: {
            id: apiKeyId,
            description: body.description,
            secretApiKey,
            isPublic,
            expiresAt: body.expires_at_millis ? new Date(body.expires_at_millis) : undefined,
            createdAt: new Date(),
            projectUserId: userId,
            teamId: teamId,
            tenancyId: auth.tenancy.id,
          },
        });


        return {
          statusCode: 200,
          bodyType: "json",
          body: await prismaToCrud(apiKey, type, true),
        };
      },
    }),
    check: createSmartRouteHandler({
      metadata: {
        hidden: false,
        description: `Validate a ${type} API key`,
        summary: `Check ${type} API key validity`,
        tags: ["API Keys"],
      },
      request: yupObject({
        auth: yupObject({
          type: serverOrHigherAuthTypeSchema,
          project: adaptSchema.defined(),
          tenancy: adaptSchema.defined(),
        }).defined(),
        body: yupObject({
          api_key: yupString().defined(),
        }).defined(),
      }),
      response: yupObject({
        statusCode: yupNumber().oneOf([200]).defined(),
        bodyType: yupString().oneOf(["json"]).defined(),
        body: (type === 'user' ? userApiKeysCrud : teamApiKeysCrud).server.readSchema.defined(),
      }),
      handler: async ({ auth, body }) => {
        await throwIfFeatureDisabled(auth.tenancy, type);
        const prisma = await getPrismaClientForTenancy(auth.tenancy);

        const apiKey = await prisma.projectApiKey.findUnique({
          where: {
            tenancyId: auth.tenancy.id,
            secretApiKey: body.api_key,
          },
        });

        if (!apiKey) {
          throw new KnownErrors.ApiKeyNotFound();
        }

        if (apiKey.projectUserId && type === "team") {
          throw new KnownErrors.WrongApiKeyType("team", "user");
        }

        if (apiKey.teamId && type === "user") {
          throw new KnownErrors.WrongApiKeyType("user", "team");
        }

        if (apiKey.manuallyRevokedAt) {
          throw new KnownErrors.ApiKeyRevoked();
        }

        if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
          throw new KnownErrors.ApiKeyExpired();
        }

        return {
          statusCode: 200,
          bodyType: "json",
          body: await prismaToCrud<Type>(apiKey, type, false),
        };
      },
    }),
    crud: createLazyProxy(() => (createCrudHandlers(
      type === 'user' ? userApiKeysCrud : teamApiKeysCrud,
      {
        paramsSchema: yupObject({
          api_key_id: yupString().uuid().defined(),
        }),
        querySchema: type === 'user' ? yupObject({
          user_id: userIdOrMeSchema.optional().meta({ openapiField: { onlyShowInOperations: ['List'] } }),
        }) : yupObject({
          team_id: yupString().uuid().defined().meta({ openapiField: { onlyShowInOperations: ['List'] } }),
        }),

        onList: async ({ auth, query }) => {
          await throwIfFeatureDisabled(auth.tenancy, type);
          const { userId, teamId } = await parseTypeAndParams({ type, params: query });
          await ensureUserCanManageApiKeys(auth, {
            userId,
            teamId,
          });

          const prisma = await getPrismaClientForTenancy(auth.tenancy);
          const apiKeys = await prisma.projectApiKey.findMany({
            where: {
              tenancyId: auth.tenancy.id,
              projectUserId: userId,
              teamId: teamId,
            },
            orderBy: {
              createdAt: 'desc',
            },
          });

          return {
            items: await Promise.all(apiKeys.map(apiKey => prismaToCrud(apiKey, type, false))),
            is_paginated: false,
          };
        },

        onRead: async ({ auth, query, params }) => {
          await throwIfFeatureDisabled(auth.tenancy, type);

          const prisma = await getPrismaClientForTenancy(auth.tenancy);

          const apiKey = await prisma.projectApiKey.findUnique({
            where: {
              tenancyId_id: {
                tenancyId: auth.tenancy.id,
                id: params.api_key_id,
              }
            },
          });

          if (!apiKey) {
            throw new KnownErrors.ApiKeyNotFound();
          }
          await ensureUserCanManageApiKeys(auth, {
            userId: apiKey.projectUserId ?? undefined,
            teamId: apiKey.teamId ?? undefined,
          });

          return await prismaToCrud(apiKey, type, false);
        },

        onUpdate: async ({ auth, data, params, query }) => {
          await throwIfFeatureDisabled(auth.tenancy, type);

          const prisma = await getPrismaClientForTenancy(auth.tenancy);

          const existingApiKey = await prisma.projectApiKey.findUnique({
            where: {
              tenancyId_id: {
                tenancyId: auth.tenancy.id,
                id: params.api_key_id,
              }
            },
          });

          if (!existingApiKey) {
            throw new KnownErrors.ApiKeyNotFound();
          }

          await ensureUserCanManageApiKeys(auth, {
            userId: existingApiKey.projectUserId ?? undefined,
            teamId: existingApiKey.teamId ?? undefined,
          });

          // Update the API key
          const updatedApiKey = await prisma.projectApiKey.update({
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
          return await prismaToCrud(updatedApiKey, type, false);
        },
      },
    )))
  };
}

export const {
  crud: userApiKeyCrudHandlers,
  create: userApiKeyCreateHandler,
  check: userApiKeyCheckHandler,
} = createApiKeyHandlers("user");
export const {
  crud: teamApiKeyCrudHandlers,
  create: teamApiKeyCreateHandler,
  check: teamApiKeyCheckHandler,
} = createApiKeyHandlers("team");
