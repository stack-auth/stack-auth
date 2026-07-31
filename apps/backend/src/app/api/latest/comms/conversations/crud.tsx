import {
  createConversation,
  getConversation,
  listConversations,
  updateConversation,
} from "@/lib/comms/conversations";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { commsConversationsCrud } from "@hexclave/shared/dist/interface/crud/comms-conversations";
import { yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { createLazyProxy } from "@hexclave/shared/dist/utils/proxies";

export const commsConversationsCrudHandlers = createLazyProxy(() => createCrudHandlers(commsConversationsCrud, {
  paramsSchema: yupObject({
    conversation_id: yupString().uuid().defined().meta({
      openapiField: {
        description: "The conversation ID",
        exampleValue: "b3d396b8-c574-4c80-97b3-50031675ceb2",
        onlyShowInOperations: ["Read", "Update"],
      },
    }),
  }),
  querySchema: yupObject({
    cursor: yupString().optional().meta({
      openapiField: {
        onlyShowInOperations: ["List"],
        description: "Opaque cursor for conversation pagination.",
      },
    }),
    limit: yupString().optional().meta({
      openapiField: {
        onlyShowInOperations: ["List"],
        description: "Maximum number of conversations to return. Defaults to 50.",
      },
    }),
    include_merged: yupString().oneOf(["true", "false"]).optional().meta({
      openapiField: {
        onlyShowInOperations: ["List"],
        description: "When true, includes merged conversations. Defaults to false.",
      },
    }),
  }),
  onCreate: async ({ auth, data }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    return await retryTransaction(prisma, async (tx) => {
      return await createConversation(tx, {
        tenancyId: auth.tenancy.id,
        title: data.title ?? null,
      });
    });
  },
  onRead: async ({ auth, params }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const conversation = await retryTransaction(prisma, async (tx) => {
      return await getConversation(tx, {
        tenancyId: auth.tenancy.id,
        conversationId: params.conversation_id,
      });
    });
    if (conversation == null) {
      throw new StatusError(StatusError.NotFound, "Conversation not found");
    }
    return conversation;
  },
  onUpdate: async ({ auth, params, data }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    return await retryTransaction(prisma, async (tx) => {
      return await updateConversation(tx, {
        tenancyId: auth.tenancy.id,
        conversationId: params.conversation_id,
        title: data.title,
      });
    });
  },
  onList: async ({ auth, query }) => {
    const limit = query.limit != null ? Number(query.limit) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new StatusError(StatusError.BadRequest, "limit must be an integer between 1 and 200");
    }
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const result = await retryTransaction(prisma, async (tx) => {
      return await listConversations(tx, {
        tenancyId: auth.tenancy.id,
        cursor: query.cursor,
        limit,
        includeMerged: query.include_merged === "true",
      });
    });
    return {
      items: result.conversations,
      is_paginated: true,
      pagination: {
        next_cursor: result.nextCursor,
      },
    };
  },
}));
