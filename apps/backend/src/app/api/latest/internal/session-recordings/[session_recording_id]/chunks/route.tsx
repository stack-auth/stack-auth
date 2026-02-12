import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { Prisma } from "@/generated/prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      session_recording_id: yupString().defined(),
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
        batch_id: yupString().defined(),
        tab_id: yupString().nullable().defined(),
        browser_session_id: yupString().nullable().defined(),
        event_count: yupNumber().defined(),
        byte_length: yupNumber().defined(),
        first_event_at_millis: yupNumber().defined(),
        last_event_at_millis: yupNumber().defined(),
        created_at_millis: yupNumber().defined(),
      }).defined()).defined(),
      pagination: yupObject({
        next_cursor: yupString().nullable().defined(),
      }).defined(),
    }).defined(),
  }),
  async handler({ auth, params, query }) {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const sessionRecordingId = params.session_recording_id;
    const exists = await prisma.sessionRecording.findUnique({
      where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: sessionRecordingId } },
      select: { id: true },
    });
    if (!exists) {
      throw new KnownErrors.ItemNotFound(sessionRecordingId);
    }

    const rawLimit = query.limit ?? String(DEFAULT_LIMIT);
    const parsedLimit = Number.parseInt(rawLimit, 10);
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_LIMIT));

    const cursorId = query.cursor;
    let cursorPivot: { firstEventAt: Date } | null = null;
    if (cursorId) {
      cursorPivot = await prisma.sessionRecordingChunk.findFirst({
        where: {
          tenancyId: auth.tenancy.id,
          sessionRecordingId,
          id: cursorId,
        },
        select: { firstEventAt: true },
      });
      if (!cursorPivot) {
        throw new KnownErrors.ItemNotFound(cursorId);
      }
    }

    const cursorWhere: Prisma.SessionRecordingChunkWhereInput = cursorId && cursorPivot ? {
      OR: [
        { firstEventAt: { gt: cursorPivot.firstEventAt } },
        { AND: [{ firstEventAt: { equals: cursorPivot.firstEventAt } }, { id: { gt: cursorId } }] },
      ],
    } : {};

    const chunks = await prisma.sessionRecordingChunk.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        sessionRecordingId,
        ...cursorWhere,
      },
      orderBy: [{ firstEventAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: {
        id: true,
        batchId: true,
        tabId: true,
        browserSessionId: true,
        eventCount: true,
        byteLength: true,
        firstEventAt: true,
        lastEventAt: true,
        createdAt: true,
      },
    });

    const hasMore = chunks.length > limit;
    const page = hasMore ? chunks.slice(0, limit) : chunks;
    const nextCursor = hasMore ? page[page.length - 1]!.id : null;

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        items: page.map((c) => ({
          id: c.id,
          batch_id: c.batchId,
          tab_id: c.tabId,
          browser_session_id: c.browserSessionId,
          event_count: c.eventCount,
          byte_length: c.byteLength,
          first_event_at_millis: c.firstEventAt.getTime(),
          last_event_at_millis: c.lastEventAt.getTime(),
          created_at_millis: c.createdAt.getTime(),
        })),
        pagination: { next_cursor: nextCursor },
      },
    };
  },
});
