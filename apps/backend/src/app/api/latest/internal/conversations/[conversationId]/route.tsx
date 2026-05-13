import {
  appendConversationMessage,
  getConversationDetail,
  getManagedProjectTenancy,
  updateConversationAttributes,
  updateConversationStatus,
} from "@/lib/conversations";
import {
  conversationDetailResponseSchema,
  conversationPriorityValues,
  conversationStatusValues,
} from "@/lib/conversation-types";
import {
  conversationIdRouteParamsSchema,
  internalDashboardAuthSchema,
} from "@/lib/conversations-api";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  projectIdSchema,
  yupArray,
  yupNumber,
  yupObject,
  yupString,
  yupUnion,
} from "@stackframe/stack-shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get conversation detail",
    description: "Get conversation detail for a managed project",
  },
  request: yupObject({
    auth: internalDashboardAuthSchema,
    params: conversationIdRouteParamsSchema,
    query: yupObject({
      projectId: projectIdSchema.defined(),
    }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: conversationDetailResponseSchema.defined(),
  }),
  handler: async ({ auth, params, query }) => {
    const tenancy = await getManagedProjectTenancy(query.projectId, auth.user);
    const detail = await getConversationDetail({
      tenancyId: tenancy.id,
      conversationId: params.conversationId,
      includeInternalNotes: true,
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: detail,
    };
  },
});

export const PATCH = createSmartRouteHandler({
  metadata: {
    summary: "Update conversation",
    description: "Append a message or update conversation attributes on a managed project conversation",
  },
  request: yupObject({
    auth: internalDashboardAuthSchema,
    params: conversationIdRouteParamsSchema,
    body: yupUnion(
      yupObject({
        projectId: projectIdSchema.defined(),
        type: yupString().oneOf(["internal-note"]).defined(),
        body: yupString().trim().min(1).defined(),
      }).defined(),
      yupObject({
        projectId: projectIdSchema.defined(),
        type: yupString().oneOf(["reply"]).defined(),
        body: yupString().trim().min(1).defined(),
      }).defined(),
      yupObject({
        projectId: projectIdSchema.defined(),
        type: yupString().oneOf(["status"]).defined(),
        status: yupString().oneOf(conversationStatusValues).defined(),
      }).defined(),
      yupObject({
        projectId: projectIdSchema.defined(),
        type: yupString().oneOf(["metadata"]).defined(),
        assignedToUserId: yupString().nullable().optional(),
        assignedToDisplayName: yupString().nullable().optional(),
        priority: yupString().oneOf(conversationPriorityValues).optional(),
        tags: yupArray(yupString().defined()).optional(),
      }).defined(),
    ).defined(),
    method: yupString().oneOf(["PATCH"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: conversationDetailResponseSchema.defined(),
  }),
  handler: async ({ auth, params, body }) => {
    const tenancy = await getManagedProjectTenancy(body.projectId, auth.user);

    if (body.type === "reply") {
      await appendConversationMessage({
        tenancyId: tenancy.id,
        conversationId: params.conversationId,
        messageType: "message",
        body: body.body,
        channelType: "chat",
        adapterKey: "support-chat",
        sender: {
          type: "agent",
          id: auth.user.id,
          displayName: auth.user.display_name ?? null,
          primaryEmail: auth.user.primary_email ?? null,
        },
      });
    } else if (body.type === "internal-note") {
      await appendConversationMessage({
        tenancyId: tenancy.id,
        conversationId: params.conversationId,
        messageType: "internal-note",
        body: body.body,
        sender: {
          type: "agent",
          id: auth.user.id,
          displayName: auth.user.display_name ?? null,
          primaryEmail: auth.user.primary_email ?? null,
        },
      });
    } else if (body.type === "status") {
      await updateConversationStatus({
        tenancyId: tenancy.id,
        conversationId: params.conversationId,
        status: body.status,
        sender: {
          type: "agent",
          id: auth.user.id,
          displayName: auth.user.display_name ?? null,
          primaryEmail: auth.user.primary_email ?? null,
        },
      });
    } else {
      await updateConversationAttributes({
        tenancyId: tenancy.id,
        conversationId: params.conversationId,
        assignedToUserId: body.assignedToUserId,
        assignedToDisplayName: body.assignedToDisplayName,
        priority: body.priority,
        tags: body.tags,
      });
    }

    const detail = await getConversationDetail({
      tenancyId: tenancy.id,
      conversationId: params.conversationId,
      includeInternalNotes: true,
    });

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: detail,
    };
  },
});
