import { callReducerStrict } from "@/lib/ai/spacetimedb-client";
import { assertIsAiChatReviewer } from "@/lib/ai/qa/reviewer-auth";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adaptSchema,
      user: adaptSchema.defined(),
      project: adaptSchema,
    }).defined(),
    body: yupObject({
      qaId: yupString().defined(),
      question: yupString().defined(),
      answer: yupString().defined(),
      publish: yupBoolean().defined(),
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
    const user = auth.user;
    assertIsAiChatReviewer(user);

    const token = getEnvVariable("STACK_MCP_LOG_TOKEN");
    const editor = user.display_name ?? user.primary_email ?? user.id;
    const qaId = BigInt(body.qaId);
    await callReducerStrict("update_qa_entry", [token, qaId, body.question, body.answer, editor]);
    await callReducerStrict("set_qa_published", [token, qaId, body.publish]);

    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: { success: true },
    };
  },
});
