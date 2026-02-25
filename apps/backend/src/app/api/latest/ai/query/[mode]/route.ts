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
import { ModelMessage, generateText, stepCountIs, streamText } from "ai";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    params: yupObject({
      mode: yupString().oneOf(["stream", "generate"]).defined(),
    }),
    body: requestBodySchema,
  }),
  response: yupMixed<SmartResponse>().defined(),
  async handler({ params, body }, fullReq) {
    const { mode } = params;

    if (!validateToolNames(body.tools)) {
      throw new StatusError(StatusError.BadRequest, `Invalid tool names in request.`);
    }

    const apiKey = getEnvVariable("STACK_OPENROUTER_API_KEY", "");

    if (apiKey === "") {
      throw new StatusError(
        StatusError.InternalServerError,
        "OpenRouter API key is not configured. Please set STACK_OPENROUTER_API_KEY environment variable."
      );
    }

    if (apiKey === "FORWARD_TO_PRODUCTION") {
      const prodResponse = await forwardToProduction(fullReq.headers, mode, body);
      return {
        statusCode: prodResponse.status,
        bodyType: "response" as const,
        body: prodResponse,
      };
    }

    const isAuthenticated = fullReq.auth != null;
    const quality = body.quality as ModelQuality;
    const speed = body.speed as ModelSpeed;
    const systemPromptId = body.systemPrompt as SystemPromptId;
    const toolNames = body.tools as ToolName[];

    const model = selectModel(quality, speed, isAuthenticated);
    const systemPrompt = getFullSystemPrompt(systemPromptId);
    const tools = await getTools(toolNames, { auth: fullReq.auth });
    const toolsArg = Object.keys(tools).length > 0 ? tools : undefined;
    const messages = body.messages as ModelMessage[];
    const isDocsOrSearch = systemPromptId === "docs-ask-ai" || systemPromptId === "command-center-ask-ai";
    const stepLimit = toolsArg == null ? 1 : isDocsOrSearch ? 50 : 5;

    if (mode === "stream") {
      const result = streamText({
        model,
        system: systemPrompt,
        messages,
        tools: toolsArg,
        stopWhen: stepCountIs(stepLimit),
      });
      return {
        statusCode: 200,
        bodyType: "response" as const,
        body: result.toUIMessageStreamResponse(),
      };
    } else {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120_000);
      const result = await generateText({
        model,
        system: systemPrompt,
        messages,
        tools: toolsArg,
        stopWhen: stepCountIs(stepLimit),
      }).finally(() => clearTimeout(timeoutId));

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

        const toolResultsByCallId = new Map(
          step.toolResults.map((r) => [r.toolCallId, r])
        );

        step.toolCalls.forEach((toolCall) => {
          const toolResult = toolResultsByCallId.get(toolCall.toolCallId);
          contentBlocks.push({
            type: "tool-call",
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            args: toolCall.input,
            argsText: JSON.stringify(toolCall.input),
            result: (toolResult?.output ?? null) as Json,
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
