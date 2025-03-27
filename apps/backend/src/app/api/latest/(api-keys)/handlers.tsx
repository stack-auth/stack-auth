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
import { StackAssertionError, StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { sha512 } from "@stackframe/stack-shared/dist/utils/hashes";
import { filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";

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
  const userId = options.type === "user" ? ("user_id" in options.params ? options.params.user_id : throwErr("no user_id found on handler of type user?")) : undefined;
  const teamId = options.type === "team" ? ("team_id" in options.params ? options.params.team_id : throwErr("no team_id found on handler of type team?")) : undefined;
  return { userId, teamId };
}


async function prismaToCrud(prisma: ProjectApiKey, isFirstView: boolean): Promise<(UserApiKeysCrud["Admin"]["Read"] | TeamApiKeysCrud["Admin"]["Read"]) & { value: string }> {
  if ((prisma.projectUserId == null) === (prisma.teamId == null)) {
    throw new StackAssertionError("Exactly one of projectUserId or teamId must be set", { prisma });
  }

  return filterUndefined({
    id: prisma.id,
    user_id: prisma.projectUserId ?? undefined as never,
    team_id: prisma.teamId ?? undefined as never,
    description: prisma.description,
    is_public: prisma.isPublic,
    created_at_millis: prisma.createdAt.getTime(),
    expires_at_millis: prisma.expiresAt?.getTime(),
    manually_revoked_at_millis: prisma.manuallyRevokedAt?.getTime(),
    value: isFirstView ? prisma.secretApiKey : {
      last_four: prisma.secretApiKey.slice(-4),
    } as any,
  });
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
          body: await prismaToCrud(apiKey, true),
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

        return {
          statusCode: 200,
          bodyType: "json",
          body: await prismaToCrud(apiKey, false),
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
          user_id: userIdOrMeSchema.defined().meta({ openapiField: { onlyShowInOperations: ['List'] } }),
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

          return await prismaToCrud(apiKey, false);
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
          return await prismaToCrud(updatedApiKey, false);
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
