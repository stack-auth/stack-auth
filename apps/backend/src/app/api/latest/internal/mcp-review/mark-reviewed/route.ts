import { getConnection } from "@/lib/ai/mcp-logger";
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
      reviewedBy: yupString().defined(),
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
  handler: async ({ body }, fullReq) => {
    const metadata = fullReq.auth?.user?.client_read_only_metadata;
    if (!(metadata && typeof metadata === "object" && "approved" in metadata && metadata.approved === true)) {
      throw new StatusError(StatusError.Forbidden, "You are not approved to perform MCP review operations.");
    }

    const conn = await getConnection();
    if (!conn) {
      throw new StatusError(503, "SpacetimeDB unavailable");
    }

    const token = getEnvVariable("STACK_MCP_LOG_TOKEN", "change-me");
    await conn.reducers.markHumanReviewed({
      token,
      correlationId: body.correlationId,
      reviewedBy: body.reviewedBy,
    });

    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: { success: true },
    };
  },
});
