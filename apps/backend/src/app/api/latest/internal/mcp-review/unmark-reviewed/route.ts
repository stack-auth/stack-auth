import { callReducerStrict } from "@/lib/ai/mcp-logger";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

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
    const user = auth.user;
    const metadata = user.client_read_only_metadata;
    if (!(metadata && typeof metadata === "object" && "isAiChatReviewer" in metadata && metadata.isAiChatReviewer === true)) {
      throw new StatusError(StatusError.Forbidden, "You are not approved to perform MCP review operations.");
    }

    const token = getEnvVariable("STACK_MCP_LOG_TOKEN");
    await callReducerStrict("unmark_human_reviewed", [
      token,
      body.correlationId,
    ]);

    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: { success: true },
    };
  },
});
