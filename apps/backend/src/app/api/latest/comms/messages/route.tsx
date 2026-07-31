import { listMessages } from "@/lib/comms/messages";
import { parseCommsMessageCursor } from "@/lib/comms/pagination";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { commsMessageSchema } from "@hexclave/shared/dist/interface/comms";
import {
  adaptSchema,
  serverOrHigherAuthTypeSchema,
  yupArray,
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { commsMessagesCrudHandlers } from "./crud";

export const POST = commsMessagesCrudHandlers.createHandler;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List messages",
    description: "Lists all communications messages in the current tenancy using an opaque cursor.",
    tags: ["Comms"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    query: yupObject({
      cursor: yupString().optional(),
      limit: yupString().optional(),
    }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(commsMessageSchema).defined(),
      is_paginated: yupBoolean().oneOf([true]).defined(),
      pagination: yupObject({
        next_cursor: yupString().nullable().defined(),
      }).defined(),
    }).defined(),
  }),
  handler: async ({ auth, query }) => {
    const limit = query.limit == null ? 50 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new StatusError(StatusError.BadRequest, "limit must be an integer between 1 and 200");
    }
    const cursor = parseCommsMessageCursor(query.cursor);
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const result = await retryTransaction(prisma, async (tx) => {
      return await listMessages(tx, {
        tenancyId: auth.tenancy.id,
        limit,
        cursorOccurredAtMillis: cursor.occurredAtMillis,
        cursorId: cursor.messageId,
      });
    });
    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        items: result.messages,
        is_paginated: true as const,
        pagination: {
          next_cursor: result.nextCursor == null
            ? null
            : `${result.nextCursor.occurred_at_millis}:${result.nextCursor.id}`,
        },
      },
    };
  },
});
