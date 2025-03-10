import { prismaClient } from "../../../../../prisma-client";
import { createCrudHandlers } from "../../../../../route-handlers/crud-handler";
import { sessionsCrud } from "@stackframe/stack-shared/dist/interface/crud/sessions";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { KnownErrors } from "@stackframe/stack-shared";

function sessionToCrud(session: any) {
  return {
    id: session.id,
    user_id: session.projectUserId,
    created_at: session.createdAt.getTime(),
    expires_at: session.expiresAt?.getTime() ?? null,
    is_impersonation: session.isImpersonation,
  };
}

export const sessionsCrudHandlers = createLazyProxy(() => createCrudHandlers(sessionsCrud, {
  paramsSchema: yupObject({
    id: yupString().uuid().defined(),
  }),
  querySchema: yupObject({
    user_id: userIdOrMeSchema.optional(),
  }),
  onList: async ({ auth, query }) => {
    if (auth.type === 'client') {
      const currentUserId = auth.user?.id || throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
      if (query.user_id && currentUserId !== query.user_id) {
        throw new StatusError(StatusError.Forbidden, 'Client can only list sessions for their own user.');
      }
    }

    const sessions = await prismaClient.projectUserRefreshToken.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserId: query.user_id || (auth.type === 'client' ? auth.user?.id : undefined),
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      items: sessions.map(sessionToCrud),
      is_paginated: false,
    };
  },
  onDelete: async ({ auth, params }) => {
    // Using refreshToken as the identifier since the Prisma client hasn't been regenerated yet
    const session = await prismaClient.projectUserRefreshToken.findFirst({
      where: {
        tenancyId: auth.tenancy.id,
        refreshToken: params.id, // Using id as refreshToken temporarily
      },
    });

    if (!session) {
      throw new StatusError(StatusError.NotFound, 'Session not found.');
    }

    if (auth.type === 'client' && auth.user?.id !== session.projectUserId) {
      throw new StatusError(StatusError.Forbidden, 'Client can only delete their own sessions.');
    }

    // Using refreshToken as the identifier since the Prisma client hasn't been regenerated yet
    await prismaClient.projectUserRefreshToken.deleteMany({
      where: {
        tenancyId: auth.tenancy.id,
        refreshToken: params.id, // Using id as refreshToken temporarily
      },
    });
  },
}));
