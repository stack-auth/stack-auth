import type { Prisma } from "@/generated/prisma/client";
import { getClickhouseAdminClient, isClickhouseConfigured } from "@/lib/clickhouse";
import { DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

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

const createClickhouseRow = (event: {
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
  const userId = typeof dataRecord.userId === "string" && dataRecord.userId ? dataRecord.userId : null;

  // Translate $session-activity to $token-refresh
  return {
    event_type: '$token-refresh',
    event_at: event.eventEndedAt,
    data: clickhouseEventData,
    project_id: projectId,
    branch_id: branchId,
    user_id: userId,
    team_id: null,
  };
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
      migrated_events: yupNumber().defined(),
      inserted_rows: yupNumber().defined(),
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
      // Only migrate $session-activity events (translated to $token-refresh in ClickHouse)
      systemEventTypeIds: {
        has: '$session-activity',
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
      if (!isClickhouseConfigured()) {
        throw new StatusError(StatusError.ServiceUnavailable, "ClickHouse is not configured");
      }
      const clickhouseClient = getClickhouseAdminClient();
      const rowsToInsert = events.map(createClickhouseRow);
      migratedEvents = events.length;

      await clickhouseClient.insert({
        table: "analytics_internal.events",
        values: rowsToInsert,
        format: "JSONEachRow",
        clickhouse_settings: {
          date_time_input_format: "best_effort",
          async_insert: 1,
        },
      });
      insertedRows = rowsToInsert.length;
    }

    const lastEvent = events.at(-1);
    const nextCursor: Cursor | null = lastEvent ? {
      created_at_millis: lastEvent.createdAt.getTime(),
      id: lastEvent.id,
    } : null;

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        migrated_events: migratedEvents,
        inserted_rows: insertedRows,
        next_cursor: nextCursor,
      },
    };
  },
});
