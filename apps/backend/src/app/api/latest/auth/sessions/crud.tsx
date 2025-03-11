import { prismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { Prisma } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { sessionsCrud } from "@stackframe/stack-shared/dist/interface/crud/sessions";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { GeoInfo } from "@stackframe/stack-shared/dist/utils/geo";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const sessionsCrudHandlers = createLazyProxy(() => createCrudHandlers(sessionsCrud, {
  paramsSchema: yupObject({
    id: yupString().uuid().defined(),
  }).defined(),
  querySchema: yupObject({
    user_id: userIdOrMeSchema.defined(),
  }).defined(),
  onList: async ({ auth, query }) => {

    const list_impersonations = auth.type === 'admin';

    if (auth.type === 'client') {
      const currentUserId = auth.user?.id || throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
      if (currentUserId !== query.user_id) {
        throw new StatusError(StatusError.Forbidden, 'Client can only list sessions for their own user.');
      }
    }

    const refreshTokenObjs = await prismaClient.projectUserRefreshToken.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserId: query.user_id,
        isImpersonation: list_impersonations ? undefined : false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });


    // Get the latest event for each session
    const events = await prismaClient.$queryRaw<Array<{ sessionId: string, lastActiveAt: Date, endUserIpInfoGuess: string, isEndUserIpInfoGuessTrusted: boolean }>>`
      SELECT data->>'sessionId' as "sessionId", 
             MAX("eventStartedAt") as "lastActiveAt", 
             data->>'endUserIpInfoGuess' as "endUserIpInfoGuess", 
             data->>'isEndUserIpInfoGuessTrusted' as "isEndUserIpInfoGuessTrusted"
      FROM "Event" 
      WHERE data->>'sessionId' = ANY(${Prisma.sql`ARRAY[${Prisma.join(refreshTokenObjs.map(s => s.id))}]`})
      AND "systemEventTypeIds" @> '{"$session-activity"}'
      GROUP BY data->>'sessionId', data->>'endUserIpInfoGuess', data->>'isEndUserIpInfoGuessTrusted'
    `;


    const sessionsWithLastActiveAt = refreshTokenObjs.map(s => {
      const event = events.find(e => e.sessionId === s.id);
      return {
        ...s,
        last_active_at: event?.lastActiveAt.getTime(),
        last_active_at_end_user_ip_info: (event?.endUserIpInfoGuess ? (JSON.parse(event.endUserIpInfoGuess) as GeoInfo)  : undefined),
      };
    });


    return {
      items: sessionsWithLastActiveAt.map(s => ({
        id: s.id,
        user_id: s.projectUserId,
        created_at: s.createdAt.getTime(),
        last_used_at: s.last_active_at,
        is_impersonation: s.isImpersonation,
        last_used_at_end_user_ip_info: s.last_active_at_end_user_ip_info,
        is_current_session: s.id === auth.refreshTokenId,
      })),
      is_paginated: false,
    };
  },
  onDelete: async ({ auth, params }: { auth: SmartRequestAuth, params: { id: string }, query: { user_id?: string } }) => {

    const session = await prismaClient.projectUserRefreshToken.findFirst({
      where: {
        tenancyId: auth.tenancy.id,
        id: params.id,
      },
    });

    if (!session) {
      throw new StatusError(StatusError.NotFound, 'Session not found.');
    }

    if (auth.type === 'client' && auth.user?.id !== session.projectUserId) {
      throw new StatusError(StatusError.Forbidden, 'Client can only delete their own sessions.');
    }

    if (auth.refreshTokenId === session.id) {
      throw new KnownErrors.CannotDeleteCurrentSession();
    }

    // Using refreshToken as the identifier since the Prisma client hasn't been regenerated yet
    await prismaClient.projectUserRefreshToken.deleteMany({
      where: {
        tenancyId: auth.tenancy.id,
        id: params.id,
      },
    });
  },
}));
