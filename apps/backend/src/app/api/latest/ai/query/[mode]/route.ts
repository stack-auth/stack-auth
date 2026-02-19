import { forwardToProduction } from "@/lib/ai/forward";
import { selectModel, type ModelQuality, type ModelSpeed } from "@/lib/ai/models";
import { getFullSystemPrompt, type SystemPromptId } from "@/lib/ai/prompts";
import { requestBodySchema } from "@/lib/ai/schema";
import { getTools, validateToolNames, type ToolName } from "@/lib/ai/tools";
import { SmartResponse } from "@/route-handlers/smart-response";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { Json } from "@stackframe/stack-shared/dist/utils/json";
import { ModelMessage, generateText, streamText } from "ai";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    params: yupObject({
      mode: yupString().defined(),
    }),
    body: requestBodySchema,
  }),
  response: yupMixed<SmartResponse>().defined(),
  async handler({ params, body }, fullReq) {
    const { mode } = params;

    if (mode !== "stream" && mode !== "generate") {
      throw new StatusError(StatusError.BadRequest, `Invalid mode: ${mode}. Must be "stream" or "generate".`);
    }

    if (!validateToolNames(body.tools)) {
      throw new StatusError(StatusError.BadRequest, `Invalid tool names in request. Valid tools: docs, sql-query, create-email-theme, create-email-template, create-email-draft, create-dashboard`);
    }

    const apiKey = getEnvVariable("STACK_OPENROUTER_API_KEY", "");

    if (apiKey === "") {
      throw new StatusError(
        StatusError.InternalServerError,
        "OpenRouter API key is not configured. Please set STACK_OPENROUTER_API_KEY environment variable."
      );
    }

    if (apiKey === "FORWARD_TO_PRODUCTION") {
      return {
        statusCode: 200,
        bodyType: "response" as const,
        body: await forwardToProduction(fullReq.headers, mode, body),
      };
    }

    const isAuthenticated = fullReq.auth != null;

    const model = selectModel(body.quality as ModelQuality, body.speed as ModelSpeed, isAuthenticated);
    const systemPrompt = getFullSystemPrompt(body.systemPrompt as SystemPromptId);
    const tools = await getTools(body.tools as ToolName[], { auth: fullReq.auth });
    const toolsArg = Object.keys(tools).length > 0 ? tools : undefined;
    const messages = body.messages as ModelMessage[];

    if (mode === "stream") {
      const result = streamText({
        model,
        system: systemPrompt,
        messages,
        tools: toolsArg,
      });
      return {
        statusCode: 200,
        bodyType: "response" as const,
        body: result.toUIMessageStreamResponse(),
      };
    } else {
      const result = await generateText({
        model,
        system: systemPrompt,
        messages,
        tools: toolsArg,
      });

      const contentBlocks: Array<
        | { type: "text", text: string }
        | {
            type: "tool-call",
            toolName: string,
            toolCallId: string,
            args: Json,
            argsText: string,
            result: Json,
          }
      > = [];

      result.steps.forEach((step) => {
        if (step.text) {
          contentBlocks.push({
            type: "text",
            text: step.text,
          });
        }

        step.toolCalls.forEach((toolCall) => {
          contentBlocks.push({
            type: "tool-call",
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            args: toolCall.input,
            argsText: JSON.stringify(toolCall.input),
            result: (toolCall as any).result ?? null,
          });
        });
      });

      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: { content: contentBlocks },
      };
    }
  },
});
