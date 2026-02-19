import { getChatAdapter } from "@/lib/ai-chat/adapter-registry";
import { selectModel } from "@/lib/ai/models";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { generateText } from "ai";
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

const messageSchema = yupObject({
  role: yupString().oneOf(["user", "assistant", "tool"]).defined(),
  content: yupMixed().defined(),
});

// AI request timeout in milliseconds (2 minutes)
const AI_REQUEST_TIMEOUT_MS = 120_000;

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
      context_type: yupString().oneOf(["email-theme", "email-template", "email-draft"]).defined(),
      messages: yupArray(messageSchema).defined().min(1),
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
    const apiKey = getEnvVariable("STACK_OPENROUTER_API_KEY", "");
    if (apiKey === "" || apiKey === "FORWARD_TO_PRODUCTION") {
      throw new StatusError(
        StatusError.InternalServerError,
        "OpenRouter API key is not configured. Please set STACK_OPENROUTER_API_KEY."
      );
    }

    const adapter = getChatAdapter(body.context_type, tenancy, params.threadId);

    // Email generation benefits from a smarter, slower model; this route always has
    // admin auth so isAuthenticated is always true
    const model = selectModel("smart", "slow", true);

    // content is typed as yup mixed — cast needed since it does not map to the AI
    // SDK strict ModelMessage content typing, but the adapter guarantees a valid shape
    const validatedMessages = body.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })) as any;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

    try {
      const result = await generateText({
        model,
        system: adapter.systemPrompt,
        messages: validatedMessages,
        tools: adapter.tools,
        abortSignal: controller.signal,
      });

      const contentBlocks: InferType<typeof contentSchema> = [];
      result.steps.forEach((step) => {
        if (step.text) {
          contentBlocks.push({ type: "text", text: step.text });
        }
        step.toolCalls.forEach((toolCall) => {
          contentBlocks.push({
            type: "tool-call",
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            args: toolCall.input,
            argsText: JSON.stringify(toolCall.input),
            result: "success",
          });
        });
      });

      return {
        statusCode: 200,
        bodyType: "json",
        body: { content: contentBlocks },
      };
    } finally {
      clearTimeout(timeoutId);
    }
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
