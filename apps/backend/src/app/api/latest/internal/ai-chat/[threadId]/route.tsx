import { getChatAdapter } from "@/lib/ai-chat/adapter-registry";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { createOpenAI } from "@ai-sdk/openai";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
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

// Mock mode sentinel value - when API key is not configured, we return mock responses
const MOCK_API_KEY_SENTINEL = "mock-openrouter-api-key";
const apiKey = getEnvVariable("STACK_OPENROUTER_API_KEY", MOCK_API_KEY_SENTINEL);
const isMockMode = apiKey === MOCK_API_KEY_SENTINEL;

// Only create OpenAI client if not in mock mode
const openai = isMockMode ? null : createOpenAI({
  apiKey,
  baseURL: "https://openrouter.ai/api/v1",
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
      context_type: yupString().oneOf(["email-theme", "email-template", "email-draft", "custom-dashboard"]).defined(),
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
    // Mock mode: return a simple text response without calling AI
    if (isMockMode) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          content: [{
            type: "text",
            text: "This is a mock AI response. Configure a real API key to enable AI features.",
          }],
        },
      };
    }

    const adapter = getChatAdapter(body.context_type, tenancy, params.threadId);
    // Model is configurable via env var; no default to surface missing config errors
    const modelName = getEnvVariable("STACK_AI_MODEL");

    if (!openai) {
      // This shouldn't happen since we check isMockMode above, but guard anyway
      throw new Error("OpenAI client not initialized - STACK_OPENROUTER_API_KEY may be missing");
    }

    // Validate messages structure before passing to AI
    const validatedMessages = body.messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    })) as any; // Cast needed: content is a mixed type from yup schema that doesn't map to AI SDK's strict typing

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

    try {
      const result = await generateText({
        model: openai(modelName),
        system: adapter.systemPrompt,
        messages: validatedMessages,
        tools: adapter.tools,
        abortSignal: controller.signal,
      });

      const contentBlocks: InferType<typeof contentSchema> = [];
      result.steps.forEach((step) => {
        if (step.text) {
          contentBlocks.push({
            type: "text",
            text: step.text,
          });
        }
        step.toolCalls.forEach(toolCall => {
          contentBlocks.push({
            type: "tool-call",
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            args: toolCall.args,
            argsText: JSON.stringify(toolCall.args),
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
