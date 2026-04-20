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
} from "@/lib/conversation-types";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, projectIdSchema, userIdSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { KnownErrors } from "@stackframe/stack-shared";
import { globalPrismaClient } from "@/prisma-client";

const internalDashboardAuthSchema = yupObject({
  type: adaptSchema,
  user: adaptSchema.defined(),
  project: yupObject({
    id: yupString().oneOf(["internal"]).defined(),
  }).defined(),
}).defined();

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
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: { conversations },
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

    const result = await createConversation({
      tenancyId: tenancy.id,
      userId: body.userId,
      subject: body.subject,
      priority: body.priority,
      source: body.source ?? "manual",
      channelType: body.source ?? "manual",
      adapterKey: body.source === "chat" ? "support-chat" : "support-dashboard",
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
