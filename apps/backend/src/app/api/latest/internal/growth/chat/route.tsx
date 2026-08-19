import { streamGrowthChatTurn } from "@/lib/growth/chat";
import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { requireGrowthWorkspaceReleased } from "@/lib/growth/report-release";
import { SmartResponse } from "@/route-handlers/smart-response";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * One freeform growth chat turn: proxies to the Eve chat agent and responds with an AI SDK UI
 * message chunk stream (same wire format as /internal/growth/interview/stream). Like that route,
 * this endpoint is intentionally NOT modeled in the frozen growth-api.ts zod fetchers — the
 * assistant-ui adapter owns the response framing; this route owns the REQUEST shape instead.
 * See streamGrowthChatTurn for the persistence-order and conversation-id-return contracts.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({
      // Omitted (or null, which some chat adapters send) on the first turn of a new conversation.
      conversation_id: yupString().nullable().optional(),
      // The latest user message as plain text; the backend authors the transcript's UIMessages
      // itself (see buildUserMessage in lib/growth/chat.ts), so the wire never carries raw
      // UIMessage objects the client could spoof.
      message: yupString().min(1).max(20_000).defined(),
    }).defined(),
  }),
  response: yupMixed<SmartResponse>().defined(),
  handler: async ({ auth, body }) => {
    requireGrowthAppEnabled(auth.tenancy);
    await requireGrowthWorkspaceReleased(auth.tenancy);
    const response = await streamGrowthChatTurn(auth.tenancy, {
      conversationId: body.conversation_id ?? undefined,
      message: body.message,
    });
    return {
      statusCode: 200,
      bodyType: "response" as const,
      body: response,
    };
  },
});
