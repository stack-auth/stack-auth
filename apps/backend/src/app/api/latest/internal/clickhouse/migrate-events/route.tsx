import { createClickhouseClient } from "@/lib/clickhouse";
import { DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import type { Prisma } from "@prisma/client";

type Cursor = {
  created_at_millis: number,
  id: string,
};

const parseMillisOrThrow = (value: number | undefined, field: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StatusError(400, `Invalid ${field}`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new StatusError(400, `Invalid ${field}`);
  }
  return parsed;
};

const createClickhouseRows = (event: {
  id: string,
  systemEventTypeIds: string[],
  data: any,
  eventEndedAt: Date,
  eventStartedAt: Date,
  isWide: boolean,
}) => {
  const dataRecord = typeof event.data === "object" && event.data !== null ? event.data as Record<string, unknown> : {};
  const clickhouseEventData = {
    ...dataRecord,
    is_wide: event.isWide,
    event_started_at: event.eventStartedAt,
    event_ended_at: event.eventEndedAt,
  };
  const projectId = typeof dataRecord.projectId === "string" ? dataRecord.projectId : "";
  const branchId = DEFAULT_BRANCH_ID;
  const userId = typeof dataRecord.userId === "string" ? dataRecord.userId : "";
  const teamId = typeof dataRecord.teamId === "string" ? dataRecord.teamId : "";

  const eventTypes = [...new Set(event.systemEventTypeIds)];

  return eventTypes.map(eventType => ({
    event_type: eventType,
    event_at: event.eventEndedAt,
    data: clickhouseEventData,
    project_id: projectId,
    branch_id: branchId,
    user_id: userId,
    team_id: teamId,
  }));
};

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Migrate analytics events from Postgres to ClickHouse",
    description: "Internal-only endpoint to backfill existing events into ClickHouse.",
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      project: yupObject({
        id: yupString().oneOf(["internal"]).defined(),
      }).defined(),
      user: yupObject({
        id: yupString().defined(),
      }).optional(),
    }).defined(),
    body: yupObject({
      min_created_at_millis: yupNumber().integer().defined(),
      max_created_at_millis: yupNumber().integer().defined(),
      cursor: yupObject({
        created_at_millis: yupNumber().integer().defined(),
        id: yupString().uuid().defined(),
      }).optional(),
      limit: yupNumber().integer().min(1).default(1000),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      total_events: yupNumber().defined(),
      processed_events: yupNumber().defined(),
      remaining_events: yupNumber().defined(),
      migrated_events: yupNumber().defined(),
      skipped_existing_events: yupNumber().defined(),
      inserted_rows: yupNumber().defined(),
      progress: yupNumber().min(0).max(1).defined(),
      next_cursor: yupObject({
        created_at_millis: yupNumber().integer().defined(),
        id: yupString().defined(),
      }).nullable().defined(),
    }).defined(),
  }),
  async handler({ body }) {
    const minCreatedAt = parseMillisOrThrow(body.min_created_at_millis, "min_created_at_millis");
    const maxCreatedAt = parseMillisOrThrow(body.max_created_at_millis, "max_created_at_millis");
    if (minCreatedAt >= maxCreatedAt) {
      throw new StatusError(400, "min_created_at_millis must be before max_created_at_millis");
    }
    const cursorCreatedAt = body.cursor ? parseMillisOrThrow(body.cursor.created_at_millis, "cursor.created_at_millis") : undefined;
    const cursorId = body.cursor?.id;
    const limit = body.limit;

    const baseWhere: Prisma.EventWhereInput = {
      createdAt: {
        gte: minCreatedAt,
        lt: maxCreatedAt,
      },
    };

    const cursorFilter: Prisma.EventWhereInput | undefined = (cursorCreatedAt && cursorId) ? {
      OR: [
        { createdAt: { gt: cursorCreatedAt } },
        { createdAt: cursorCreatedAt, id: { gt: cursorId } },
      ],
    } : undefined;

    const where: Prisma.EventWhereInput = cursorFilter
      ? { AND: [baseWhere, cursorFilter] }
      : baseWhere;

    const totalEvents = await globalPrismaClient.event.count({ where: baseWhere });

    const events = await globalPrismaClient.event.findMany({
      where,
      orderBy: [
        { createdAt: "asc" },
        { id: "asc" },
      ],
      take: limit,
    });

    let insertedRows = 0;
    let migratedEvents = 0;

    if (events.length) {
      const clickhouseClient = createClickhouseClient("admin");
      try {
        const rowsByEvent = events.map(createClickhouseRows);
        const rowsToInsert = rowsByEvent.flat();
        migratedEvents = rowsByEvent.reduce((acc, rows) => acc + (rows.length ? 1 : 0), 0);

        if (rowsToInsert.length) {
          await clickhouseClient.insert({
            table: "events",
            values: rowsToInsert,
            format: "JSONEachRow",
            clickhouse_settings: {
              date_time_input_format: "best_effort",
              async_insert: 1,
            },
          });
          insertedRows = rowsToInsert.length;
        }
      } finally {
        await clickhouseClient.close();
      }
    }

    const lastEvent = events.at(-1);
    const nextCursor: Cursor | null = lastEvent ? {
      created_at_millis: lastEvent.createdAt.getTime(),
      id: lastEvent.id,
    } : null;
    const progressCursor: Cursor | null = nextCursor ?? (cursorCreatedAt && body.cursor ? {
      created_at_millis: body.cursor.created_at_millis,
      id: body.cursor.id,
    } : null);

    const progressCursorCreatedAt = progressCursor ? new Date(progressCursor.created_at_millis) : null;
    const remainingWhere = progressCursor ? {
      AND: [
        baseWhere,
        {
          OR: [
            { createdAt: { gt: progressCursorCreatedAt! } },
            { createdAt: progressCursorCreatedAt!, id: { gt: progressCursor.id } },
          ],
        },
      ],
    } : baseWhere;

    const remainingEvents = await globalPrismaClient.event.count({ where: remainingWhere });
    const processedEvents = totalEvents - remainingEvents;
    const progress = totalEvents === 0 ? 1 : processedEvents / totalEvents;

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        total_events: totalEvents,
        processed_events: processedEvents,
        remaining_events: remainingEvents,
        migrated_events: migratedEvents,
        skipped_existing_events: 0,
        inserted_rows: insertedRows,
        progress,
        next_cursor: nextCursor,
      },
    };
  },
});
