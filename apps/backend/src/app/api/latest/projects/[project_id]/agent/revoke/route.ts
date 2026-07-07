import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { decodeAccessToken } from "@/lib/tokens";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import type { SmartResponse } from "@/route-handlers/smart-response";
import { recordExternalDbSyncDeletion } from "@/lib/external-db-sync";
import { yupMixed, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    params: yupObject({
      project_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      token: yupString().defined(),
      token_type_hint: yupString().optional(),
    }).defined(),
  }),
  response: yupMixed<SmartResponse>().defined(),
  async handler({ params, body }) {
    const tenancy = await getSoleTenancyFromProjectBranch(params.project_id, DEFAULT_BRANCH_ID, true);
    if (tenancy == null || tenancy.config.apps.installed["agent-auth"]?.enabled !== true) {
      return { statusCode: 200, bodyType: "success" as const };
    }

    if (body.token_type_hint === "refresh_token") {
      const refreshTokenObj = await globalPrismaClient.projectUserRefreshToken.findFirst({
        where: {
          tenancyId: tenancy.id,
          refreshToken: body.token,
        },
      });

      if (refreshTokenObj != null) {
        await recordExternalDbSyncDeletion(globalPrismaClient, {
          tableName: "ProjectUserRefreshToken",
          tenancyId: tenancy.id,
          refreshTokenId: refreshTokenObj.id,
        });
        await globalPrismaClient.projectUserRefreshToken.deleteMany({
          where: {
            tenancyId: tenancy.id,
            id: refreshTokenObj.id,
          },
        });
      }

      return { statusCode: 200, bodyType: "success" as const };
    }

    const decoded = await decodeAccessToken(body.token, { allowAnonymous: true, allowRestricted: true });
    if (decoded.status === "error") {
      return { statusCode: 200, bodyType: "success" as const };
    }

    const refreshTokenId = decoded.data.refreshTokenId;
    if (refreshTokenId == null) {
      return { statusCode: 200, bodyType: "success" as const };
    }

    await recordExternalDbSyncDeletion(globalPrismaClient, {
      tableName: "ProjectUserRefreshToken",
      tenancyId: tenancy.id,
      refreshTokenId,
    });
    await globalPrismaClient.projectUserRefreshToken.deleteMany({
      where: {
        tenancyId: tenancy.id,
        id: refreshTokenId,
      },
    });

    return { statusCode: 200, bodyType: "success" as const };
  },
});
