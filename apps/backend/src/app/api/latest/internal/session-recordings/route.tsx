import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { BooleanTrue, Prisma } from "@/generated/prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    query: yupObject({
      cursor: yupString().optional(),
      limit: yupString().optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(yupObject({
        id: yupString().defined(),
        project_user: yupObject({
          id: yupString().defined(),
          display_name: yupString().nullable().defined(),
          primary_email: yupString().nullable().defined(),
        }).defined(),
        started_at_millis: yupNumber().defined(),
        last_event_at_millis: yupNumber().defined(),
        chunk_count: yupNumber().defined(),
        event_count: yupNumber().defined(),
      }).defined()).defined(),
      pagination: yupObject({
        next_cursor: yupString().nullable().defined(),
      }).defined(),
    }).defined(),
  }),
  async handler({ auth, query }) {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const rawLimit = query.limit ?? String(DEFAULT_LIMIT);
    const parsedLimit = Number.parseInt(rawLimit, 10);
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_LIMIT));

    const cursorId = query.cursor;
    let cursorPivot: { lastEventAt: Date } | null = null;
    if (cursorId) {
      cursorPivot = await prisma.sessionRecording.findUnique({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: cursorId } },
        select: { lastEventAt: true },
      });
      if (!cursorPivot) {
        throw new KnownErrors.ItemNotFound(cursorId);
      }
    }

    const where: Prisma.SessionRecordingWhereInput = cursorId && cursorPivot ? {
      OR: [
        { lastEventAt: { lt: cursorPivot.lastEventAt } },
        { AND: [{ lastEventAt: { equals: cursorPivot.lastEventAt } }, { id: { lt: cursorId } }] },
      ],
    } : {};

    const sessions = await prisma.sessionRecording.findMany({
      where: { tenancyId: auth.tenancy.id, ...where },
      orderBy: [{ lastEventAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        projectUserId: true,
        startedAt: true,
        lastEventAt: true,
      },
    });

    const hasMore = sessions.length > limit;
    const page = hasMore ? sessions.slice(0, limit) : sessions;
    const nextCursor = hasMore ? page[page.length - 1]!.id : null;

    const sessionIds = page.map(s => s.id);
    const userIds = [...new Set(page.map(s => s.projectUserId))];

    const [chunkAggs, users] = await Promise.all([
      sessionIds.length ? prisma.sessionRecordingChunk.groupBy({
        by: ["sessionRecordingId"],
        where: { tenancyId: auth.tenancy.id, sessionRecordingId: { in: sessionIds } },
        _count: { _all: true },
        _sum: { eventCount: true },
      }) : Promise.resolve([] as Array<{ sessionRecordingId: string, _count: { _all: number }, _sum: { eventCount: number | null } }>),
      userIds.length ? prisma.projectUser.findMany({
        where: { tenancyId: auth.tenancy.id, projectUserId: { in: userIds } },
        select: {
          projectUserId: true,
          displayName: true,
          contactChannels: {
            where: { type: "EMAIL", isPrimary: BooleanTrue.TRUE },
            select: { value: true },
            take: 1,
          },
        },
      }) : Promise.resolve([] as Array<{ projectUserId: string, displayName: string | null, contactChannels: Array<{ value: string }> }>),
    ]);

    const aggBySessionId = new Map<string, { chunkCount: number, eventCount: number }>();
    for (const a of chunkAggs) {
      aggBySessionId.set(a.sessionRecordingId, {
        chunkCount: a._count._all,
        eventCount: a._sum.eventCount ?? 0,
      });
    }

    const userById = new Map<string, { displayName: string | null, primaryEmail: string | null }>();
    for (const u of users) {
      userById.set(u.projectUserId, {
        displayName: u.displayName,
        primaryEmail: u.contactChannels[0]?.value ?? null,
      });
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        items: page.map((s) => {
          const user = userById.get(s.projectUserId);
          const agg = aggBySessionId.get(s.id) ?? { chunkCount: 0, eventCount: 0 };
          return {
            id: s.id,
            project_user: {
              id: s.projectUserId,
              display_name: user?.displayName ?? null,
              primary_email: user?.primaryEmail ?? null,
            },
            started_at_millis: s.startedAt.getTime(),
            last_event_at_millis: s.lastEventAt.getTime(),
            chunk_count: agg.chunkCount,
            event_count: agg.eventCount,
          };
        }),
        pagination: { next_cursor: nextCursor },
      },
    };
  },
});
