import { callReducerStrict } from "@/lib/ai/mcp-logger";
import { assertIsAiChatReviewer } from "@/lib/ai/reviewer-auth";
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
    await callReducerStrict("add_manual_qa", [
      token,
      body.question,
      body.answer,
      body.publish,
      user.display_name ?? user.primary_email ?? user.id,
    ]);

    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: { success: true },
    };
  },
});
