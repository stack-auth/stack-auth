import { listUserTeamPermissions } from "@/lib/permissions";
import { prismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { ProjectApiKey } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { TeamApiKeysCrud, UserApiKeysCrud, teamApiKeysCreateInputSchema, teamApiKeysCreateOutputSchema, teamApiKeysCrud, userApiKeysCreateInputSchema, userApiKeysCreateOutputSchema, userApiKeysCrud } from "@stackframe/stack-shared/dist/interface/crud/project-api-keys";
import { adaptSchema, clientOrHigherAuthTypeSchema, serverOrHigherAuthTypeSchema, userIdOrMeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { encodeBase32, getBase32CharacterFromIndex } from "@stackframe/stack-shared/dist/utils/bytes";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { sha512 } from "@stackframe/stack-shared/dist/utils/hashes";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import * as yup from "yup";


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

  if (auth.type === "client") {
    if (!auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    if ((options.userId === undefined) === (options.teamId === undefined)) {
      throw new StatusError(StatusError.BadRequest, "Exactly one of the userId or teamId query parameters must be provided, never none or both");
    }

    // Check if client is trying to manage API keys for other users
    if (options.userId !== undefined && auth.user.id !== options.userId) {
      throw new StatusError(StatusError.Forbidden, "Client can only manage their own api keys");

    }

    // Check team API key permissions
    if (options.teamId !== undefined) {
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


function _prismaToCrudBase(prisma: ProjectApiKey): Omit<UserApiKeysCrud["Admin"]["Read"], "user_id" | "type" | "value"> {
  return {
    id: prisma.id,
    description: prisma.description,
    is_public: prisma.isPublic,
    created_at_millis: prisma.createdAt.getTime(),
    expires_at_millis: prisma.expiresAt?.getTime(),
    manually_revoked_at_millis: prisma.manuallyRevokedAt?.getTime(),
  };
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
        hidden: true,
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
        const { userId, teamId } = await parseTypeAndParams({ type, params: body });
        await ensureUserCanManageApiKeys(auth, {
          userId,
          teamId,
        });

        const isPublic = body.is_public ?? false;
        const apiKeyId = generateUuid();

        // to make it easier to scan, we want our API key to have a very specific format
        // for example, for GitHub secret scanning: https://docs.github.com/en/code-security/secret-scanning/secret-scanning-partnership-program/secret-scanning-partner-program
        const userPrefix = body.prefix ?? (isPublic ? "pk" : "sk");
        if (!userPrefix.match(/^[a-zA-Z0-9_]+$/)) {
          throw new StackAssertionError("userPrefix must contain only alphanumeric characters and underscores. This is so we can register the API key with security scanners. This should've been checked in the creation schema");
        }
        const isCloudVersion = new URL(url).hostname === "api.stack-auth.com";  // we only want to enable secret scanning on the cloud version
        const scannerFlag = (isCloudVersion ? 0 : 1) + (isPublic ? 2 : 0) + (/* version */ 0);
        const firstSecretPart = `${userPrefix}_${generateSecureRandomString()}${apiKeyId.replace(/-/g, "")}${type}${getBase32CharacterFromIndex(scannerFlag).toLowerCase()}574ck4u7h`;
        const checksum = await sha512(firstSecretPart + "stack-auth-api-key-checksum-pepper");
        const secretApiKey = `${firstSecretPart}${encodeBase32(checksum).slice(0, 6).toLowerCase()}`;

        const apiKey = await prismaClient.projectApiKey.create({
          data: {
            id: apiKeyId,
            projectId: auth.project.id,
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
      request: yupObject({
        auth: yupObject({
          type: serverOrHigherAuthTypeSchema,
          project: adaptSchema.defined(),
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
        const apiKey = await prismaClient.projectApiKey.findUnique({
          where: {
            projectId: auth.project.id,
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
          const { userId, teamId } = await parseTypeAndParams({ type, params: query });
          await ensureUserCanManageApiKeys(auth, {
            userId,
            teamId,
          });

          const apiKeys = await prismaClient.projectApiKey.findMany({
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
              type: apiKey.projectUserId ? "user" : "team",
              team_id: apiKey.teamId || undefined as never,
              user_id: apiKey.projectUserId || undefined as never,
              description: apiKey.description,
              is_public: apiKey.isPublic,
              value: {
                last_four: apiKey.secretApiKey.slice(-4),
              },
              created_at_millis: apiKey.createdAt.getTime(),
              expires_at_millis: apiKey.expiresAt?.getTime(),
              manually_revoked_at_millis: apiKey.manuallyRevokedAt?.getTime(),
            })),
            is_paginated: false,
          };
        },

        onRead: async ({ auth, query, params }) => {

          switch (auth.type) {
            case "client": {
              // Client: need to have user_id or team_id in the query, check if authorized to manage these, add query params db where clause
              const { userId, teamId } = await parseTypeAndParams({ type, params: query });
              await ensureUserCanManageApiKeys(auth, {
                userId,
                teamId,
              });

              const apiKey = await prismaClient.projectApiKey.findUnique({
                where: {
                  tenancyId_id: {
                    tenancyId: auth.tenancy.id,
                    id: params.api_key_id,
                  },
                  projectUserId: userId,
                  teamId: teamId,
                },
              });

              if (!apiKey) {
                throw new KnownErrors.ApiKeyNotFound();
              }

              return await prismaToCrud(apiKey, type, false);
            }

            case "server":
            case "admin": {
              // Server: no need to have user_id or team_id in the query, get key by id directly
              const apiKey = await prismaClient.projectApiKey.findUnique({
                where: {
                  tenancyId_id: {
                    tenancyId: auth.tenancy.id,
                    id: params.api_key_id,
                  },
                },
              });

              if (!apiKey) {
                throw new KnownErrors.ApiKeyNotFound();
              }
              const { userId, teamId } = await parseTypeAndParams({ type, params: {
                user_id: apiKey.projectUserId ?? undefined,
                team_id: apiKey.teamId ?? undefined,
              } });
              await ensureUserCanManageApiKeys(auth, {
                userId,
                teamId,
              });
              return await prismaToCrud(apiKey, type, false);
            }
            default: {
              // This should never happen
              throw new StackAssertionError("Invalid auth type", { auth });
            }
          }
        },

        onUpdate: async ({ auth, data, params, query }) => {
          const { userId, teamId } = await parseTypeAndParams({ type, params: query });
          await ensureUserCanManageApiKeys(auth, {
            userId,
            teamId,
          });

          // Find the existing API key
          const existingApiKey = await prismaClient.projectApiKey.findUnique({
            where: {
              tenancyId_id: {
                tenancyId: auth.tenancy.id,
                id: params.api_key_id,
              },
              projectUserId: userId,
              teamId: teamId,
            },
          });

          if (!existingApiKey) {
            throw new KnownErrors.ApiKeyNotFound();
          }

          // Update the API key
          const updatedApiKey = await prismaClient.projectApiKey.update({
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
