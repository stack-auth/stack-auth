import {
  createConversation,
  getManagedProjectTenancy,
  listConversationSummaries,
} from "@/lib/conversations";
import {
  conversationListResponseSchema,
  conversationPriorityValues,
  conversationSourceValues,
  conversationStatusValues,
  type ConversationSource,
} from "@/lib/conversation-types";
import { internalDashboardAuthSchema, parseConversationListLimit, parseConversationListOffset } from "@/lib/conversations-api";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { projectIdSchema, userIdSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { KnownErrors } from "@hexclave/shared";
import { globalPrismaClient } from "@/prisma-client";

const conversationEntryPointBySource = {
  manual: { channelType: "manual", adapterKey: "support-dashboard" },
  chat: { channelType: "chat", adapterKey: "support-chat" },
  email: { channelType: "email", adapterKey: "support-dashboard" },
  api: { channelType: "api", adapterKey: "support-dashboard" },
} satisfies Record<ConversationSource, { channelType: ConversationSource, adapterKey: string }>;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List conversations",
    description: "List conversations for a managed project",
  },
  request: yupObject({
    auth: internalDashboardAuthSchema,
    query: yupObject({
      projectId: projectIdSchema.defined(),
      query: yupString().optional(),
      status: yupString().oneOf(conversationStatusValues).optional(),
      userId: userIdSchema.optional(),
      limit: yupString().optional(),
      offset: yupString().optional(),
    }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: conversationListResponseSchema.defined(),
  }),
  handler: async ({ auth, query }) => {
    const tenancy = await getManagedProjectTenancy(query.projectId, auth.user);
    const conversations = await listConversationSummaries({
      tenancyId: tenancy.id,
      query: query.query,
      status: query.status,
      userId: query.userId,
      includeInternalNotes: true,
      limit: parseConversationListLimit(query.limit),
      offset: parseConversationListOffset(query.offset),
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: conversations,
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create conversation",
    description: "Create a managed project conversation for a user",
  },
  request: yupObject({
    auth: internalDashboardAuthSchema,
    body: yupObject({
      projectId: projectIdSchema.defined(),
      userId: userIdSchema.defined(),
      subject: yupString().trim().min(1).defined(),
      initialMessage: yupString().trim().min(1).defined(),
      priority: yupString().oneOf(conversationPriorityValues).defined(),
      source: yupString().oneOf(conversationSourceValues).optional(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      conversationId: yupString().uuid().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    const tenancy = await getManagedProjectTenancy(body.projectId, auth.user);
    const existingUser = await globalPrismaClient.projectUser.findFirst({
      where: {
        tenancyId: tenancy.id,
        projectUserId: body.userId,
      },
      select: {
        projectUserId: true,
      },
    });
    if (existingUser == null) {
      throw new KnownErrors.UserIdDoesNotExist(body.userId);
    }

    const source = body.source ?? "manual";
    const entryPoint = conversationEntryPointBySource[source];

    const result = await createConversation({
      tenancyId: tenancy.id,
      userId: body.userId,
      subject: body.subject,
      priority: body.priority,
      source,
      channelType: entryPoint.channelType,
      adapterKey: entryPoint.adapterKey,
      body: body.initialMessage,
      sender: {
        type: "agent",
        id: auth.user.id,
        displayName: auth.user.display_name ?? null,
        primaryEmail: auth.user.primary_email ?? null,
      },
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        conversationId: result.conversationId,
      },
    };
  },
});
