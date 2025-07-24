import { getChatAdapter } from "@/lib/ai-chat/adapter-registry";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { createOpenAI } from "@ai-sdk/openai";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { ToolResult, generateText } from "ai";
import { InferType } from "yup";

const textContentSchema = yupObject({
  type: yupString().oneOf(["text"]).defined(),
  text: yupString().defined(),
});

const toolCallContentSchema = yupObject({
  type: yupString().oneOf(["tool-call"]).defined(),
  toolName: yupString().defined(),
  toolCallId: yupString().defined(),
  args: yupMixed().defined(),
  argsText: yupString().defined(),
  result: yupMixed().defined(),
});

const contentSchema = yupArray(yupUnion(textContentSchema, toolCallContentSchema)).defined();
const openai = createOpenAI({ apiKey: getEnvVariable("STACK_OPENAI_API_KEY", "MISSING_OPENAI_API_KEY") });

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema,
    }),
    params: yupObject({
      threadId: yupString().defined(),
    }),
    body: yupObject({
      context_type: yupString().oneOf(["email-theme", "email-template"]).defined(),
      messages: yupArray(yupObject({
        role: yupString().oneOf(["user", "assistant", "tool"]).defined(),
        content: yupMixed().defined(),
      })).defined().min(1),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      content: contentSchema,
    }).defined(),
  }),
  async handler({ body, params, auth: { tenancy } }) {
    const adapter = getChatAdapter(body.context_type, tenancy, params.threadId);
    const result = await generateText({
      model: openai("gpt-4o"),
      system: adapter.systemPrompt,
      messages: body.messages as any,
      tools: adapter.tools,
    });

    const contentBlocks: InferType<typeof contentSchema> = [];
    result.steps.forEach((step) => {
      if (step.text) {
        contentBlocks.push({
          type: "text",
          text: step.text,
        });
      }
      step.toolResults.forEach((toolResult: ToolResult<string, any, any>) => {
        contentBlocks.push({
          type: "tool-call",
          toolName: toolResult.toolName,
          toolCallId: toolResult.toolCallId,
          args: toolResult.args,
          argsText: JSON.stringify(toolResult.args),
          result: toolResult.result,
        });
      });
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { content: contentBlocks },
    };
  },
});

export const PATCH = createSmartRouteHandler({
  metadata: {
    summary: "Save a chat message",
    description: "Save a chat message",
    tags: ["AI Chat"],
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      threadId: yupString().defined(),
    }),
    body: yupObject({
      message: yupMixed().defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({}).defined(),
  }),
  async handler({ body, params, auth: { tenancy } }) {
    await globalPrismaClient.threadMessage.create({
      data: {
        tenancyId: tenancy.id,
        threadId: params.threadId,
        content: body.message
      },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {},
    };
  },
});

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      threadId: yupString().defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      messages: yupArray(yupMixed().defined()),
    }),
  }),
  async handler({ params, auth: { tenancy } }) {
    const dbMessages = await globalPrismaClient.threadMessage.findMany({
      where: { tenancyId: tenancy.id, threadId: params.threadId },
      orderBy: { createdAt: "asc" },
    });
    const messages = dbMessages.map((message) => message.content) as object[];

    return {
      statusCode: 200,
      bodyType: "json",
      body: { messages },
    };
  },
});
