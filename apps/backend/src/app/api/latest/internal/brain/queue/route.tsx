import {
  isBrainEnabled,
  listBrainQueueItems,
  retryFailedBrainQueueItems,
} from "@/lib/brain";
import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { BRAIN_QUEUE_ITEM_STATUSES } from "@hexclave/shared/dist/interface/brain";
import {
  adaptSchema,
  adminAuthTypeSchema,
  yupArray,
  yupMixed,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List Brain Queue items",
    description: "Paginated inspection of the Brain Queue for the current tenancy.",
    tags: ["Brain"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    query: yupObject({
      limit: yupString().optional(),
      cursor: yupString().optional(),
      status: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  async handler({ auth, query }) {
    if (!isBrainEnabled(auth.tenancy)) {
      throw new StatusError(StatusError.Forbidden, "Brain is not enabled for this project. Install the Brain app to use it.");
    }

    const limit = query.limit != null ? Number(query.limit) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      throw new StatusError(StatusError.BadRequest, "Invalid limit");
    }

    let statuses = undefined as undefined | Array<typeof BRAIN_QUEUE_ITEM_STATUSES[number]>;
    if (query.status != null && query.status.length > 0) {
      const parts = query.status.split(",").map((part) => part.trim());
      for (const part of parts) {
        if (!(BRAIN_QUEUE_ITEM_STATUSES as readonly string[]).includes(part)) {
          throw new StatusError(StatusError.BadRequest, `Invalid status: ${part}`);
        }
      }
      statuses = parts as Array<typeof BRAIN_QUEUE_ITEM_STATUSES[number]>;
    }

    let cursor: { createdAt: Date, id: string } | null = null;
    if (query.cursor != null && query.cursor.length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(query.cursor);
      } catch {
        throw new StatusError(StatusError.BadRequest, "Invalid cursor");
      }
      if (
        parsed == null
        || typeof parsed !== "object"
        || typeof (parsed as { created_at?: unknown }).created_at !== "string"
        || typeof (parsed as { id?: unknown }).id !== "string"
      ) {
        throw new StatusError(StatusError.BadRequest, "Invalid cursor");
      }
      cursor = {
        createdAt: new Date((parsed as { created_at: string }).created_at),
        id: (parsed as { id: string }).id,
      };
    }

    const page = await listBrainQueueItems({
      tenancyId: auth.tenancy.id,
      statuses,
      limit,
      cursor,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        items: page.items.map((item) => ({
          id: item.id,
          type: item.type,
          schema_version: item.schemaVersion,
          payload: item.payload,
          occurred_at: item.occurredAt.toISOString(),
          subject_type: item.subjectType,
          subject_id: item.subjectId,
          status: item.status,
          attempts: item.attempts,
          last_error: item.lastError,
          available_at: item.availableAt.toISOString(),
          created_at: item.createdAt.toISOString(),
        })),
        next_cursor: page.nextCursor == null ? null : {
          created_at: page.nextCursor.createdAt,
          id: page.nextCursor.id,
        },
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Retry failed Brain Queue items",
    description: "Re-queues failed items and wakes the Brain.",
    tags: ["Brain"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      ids: yupArray(yupString().uuid().defined()).min(1).max(100).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      retried: yupNumber().defined(),
    }).defined(),
  }),
  async handler({ auth, body }) {
    if (!isBrainEnabled(auth.tenancy)) {
      throw new StatusError(StatusError.Forbidden, "Brain is not enabled for this project. Install the Brain app to use it.");
    }

    const retried = await retryTransaction(globalPrismaClient, async (tx) => {
      return await retryFailedBrainQueueItems(tx, {
        tenancyId: auth.tenancy.id,
        ids: body.ids,
      });
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { retried },
    };
  },
});
