import { clearMcpQaReview, reviewMcpCall } from "@/lib/ai/qa/qa-reviewer";
import { assertIsAiChatReviewer } from "@/lib/ai/qa/reviewer-auth";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adaptSchema,
      user: adaptSchema.defined(),
      project: adaptSchema,
    }).defined(),
    body: yupObject({
      correlationId: yupString().defined(),
      question: yupString().defined(),
      reason: yupString().defined(),
      response: yupString().defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    assertIsAiChatReviewer(auth);

    await clearMcpQaReview(body.correlationId);
    runAsynchronouslyAndWaitUntil(reviewMcpCall({
      logPromise: Promise.resolve(),
      correlationId: body.correlationId,
      question: body.question,
      reason: body.reason,
      response: body.response,
    }));

    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: { success: true },
    };
  },
});
