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

    const listImpersonations = auth.type === 'admin';

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
        isImpersonation: listImpersonations ? undefined : false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });


    // Get the latest event for each session
    const events = await prismaClient.$queryRaw<Array<{ sessionId: string, lastActiveAt: Date, geo: GeoInfo | null, isEndUserIpInfoGuessTrusted: boolean }>>`
      WITH latest_events AS (
        SELECT data->>'sessionId' as "sessionId", 
               MAX("eventStartedAt") as "lastActiveAt"
        FROM "Event" 
        WHERE data->>'sessionId' = ANY(${Prisma.sql`ARRAY[${Prisma.join(refreshTokenObjs.map(s => s.id))}]`})
        AND "systemEventTypeIds" @> '{"$session-activity"}'
        GROUP BY data->>'sessionId'
      )
      SELECT e.data->>'sessionId' as "sessionId", 
             le."lastActiveAt", 
             row_to_json(geo.*) as "geo",
             e.data->>'isEndUserIpInfoGuessTrusted' as "isEndUserIpInfoGuessTrusted"
      FROM "Event" e
      JOIN latest_events le ON e.data->>'sessionId' = le."sessionId" AND e."eventStartedAt" = le."lastActiveAt"
      LEFT JOIN "EventIpInfo" geo ON geo.id = e."endUserIpInfoGuessId"
      WHERE e."systemEventTypeIds" @> '{"$session-activity"}'
    `;

    const sessionsWithLastActiveAt = refreshTokenObjs.map(s => {
      const event = events.find(e => e.sessionId === s.id);
      return {
        ...s,
        last_active_at: event?.lastActiveAt.getTime(),
        last_active_at_end_user_ip_info: event?.geo,
      };
    });

    const result = {
      items: sessionsWithLastActiveAt.map(s => ({
        id: s.id,
        user_id: s.projectUserId,
        created_at: s.createdAt.getTime(),
        last_used_at: s.last_active_at,
        is_impersonation: s.isImpersonation,
        last_used_at_end_user_ip_info: s.last_active_at_end_user_ip_info ?? undefined,
        is_current_session: s.id === auth.refreshTokenId,
      })),
      is_paginated: false,
    };

    return result;
  },
  onDelete: async ({ auth, params }: { auth: SmartRequestAuth, params: { id: string }, query: { user_id?: string } }) => {

    const session = await prismaClient.projectUserRefreshToken.findFirst({
      where: {
        tenancyId: auth.tenancy.id,
        id: params.id,
      },
    });

    if (!session || (auth.type === 'client' && auth.user?.id !== session.projectUserId)) {
      throw new StatusError(StatusError.NotFound, 'Session not found.');
    }


    if (auth.refreshTokenId === session.id) {
      throw new KnownErrors.CannotDeleteCurrentSession();
    }

    await prismaClient.projectUserRefreshToken.deleteMany({
      where: {
        tenancyId: auth.tenancy.id,
        id: params.id,
      },
    });
  },
}));
