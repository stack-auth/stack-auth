import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getOwnedConversation } from "../../utils";

export const PUT = createSmartRouteHandler({
  metadata: {
    summary: "Replace conversation messages",
    description: "Replace all messages in a conversation",
  },
  request: yupObject({
    auth: yupObject({
      type: adaptSchema,
      user: adaptSchema.defined(),
      project: yupObject({
        id: yupString().oneOf(["internal"]).defined(),
      }).defined(),
    }).defined(),
    params: yupObject({
      conversationId: yupString().defined(),
    }),
    body: yupObject({
      messages: yupArray(
        yupObject({
          role: yupString().oneOf(["user", "assistant"]).defined(),
          content: yupMixed().defined(),
        })
      ).defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({}).defined(),
  }),
  handler: async ({ auth, params, body }) => {
    await getOwnedConversation(params.conversationId, auth.user.id);

    await globalPrismaClient.$executeRaw`
      WITH input AS (
        SELECT
          (ord - 1)::int AS position,
          (elem->>'role')::text AS role,
          elem->'content' AS content
        FROM jsonb_array_elements(${JSON.stringify(body.messages)}::jsonb)
          WITH ORDINALITY AS t(elem, ord)
      ),
      deleted AS (
        DELETE FROM "AiMessage" WHERE "conversationId" = ${params.conversationId}::uuid
      ),
      inserted AS (
        INSERT INTO "AiMessage" ("id", "conversationId", "position", "role", "content")
        SELECT gen_random_uuid(), ${params.conversationId}::uuid, position, role, content
        FROM input
      )
      UPDATE "AiConversation"
      SET "updatedAt" = NOW()
      WHERE "id" = ${params.conversationId}::uuid
    `;

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {},
    };
  },
});
