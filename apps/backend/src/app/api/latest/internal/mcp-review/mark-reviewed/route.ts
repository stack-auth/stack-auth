import { callReducerStrict } from "@/lib/ai/spacetimedb-client";
import { assertIsAiChatReviewer } from "@/lib/ai/qa/reviewer-auth";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";

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
    const user = auth.user;

    const token = getEnvVariable("STACK_MCP_LOG_TOKEN");
    await callReducerStrict("mark_human_reviewed", [
      token,
      body.correlationId,
      user.display_name ?? user.primary_email ?? user.id,
    ]);

    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: { success: true },
    };
  },
});
