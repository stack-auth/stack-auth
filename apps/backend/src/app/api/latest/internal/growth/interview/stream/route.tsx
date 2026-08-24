import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { streamGrowthInterviewTurn } from "@/lib/growth/interview";
import { SmartResponse } from "@/route-handlers/smart-response";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * One hybrid-interview turn: optionally persists a structured answer (answer-first, before any Eve
 * call), then proxies the conversational turn to the Eve interview agent and responds with an AI SDK
 * UI message chunk stream (the same wire format as /api/latest/ai/query/stream), which the dashboard
 * consumes through its useChat transport. This endpoint is intentionally NOT modeled in the frozen
 * growth-api.ts zod fetchers — the AI SDK transport owns the response framing (see the comment
 * there); this route owns the REQUEST shape instead.
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
      // Omitted on the opening turn (nothing answered yet, the agent introduces the interview).
      answer: yupObject({
        order_index: yupNumber().integer().min(0).defined(),
        option_ids: yupArray(yupString().defined()).optional(),
        free_text: yupString().max(2_000).optional(),
        skipped: yupBoolean().optional(),
      }).optional(),
    }).defined(),
  }),
  response: yupMixed<SmartResponse>().defined(),
  handler: async ({ auth, body }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const response = await streamGrowthInterviewTurn(auth.tenancy, {
      answer: body.answer == null ? undefined : {
        orderIndex: body.answer.order_index,
        optionIds: body.answer.option_ids,
        freeText: body.answer.free_text,
        skipped: body.answer.skipped,
      },
    });
    return {
      statusCode: 200,
      bodyType: "response" as const,
      body: response,
    };
  },
});
