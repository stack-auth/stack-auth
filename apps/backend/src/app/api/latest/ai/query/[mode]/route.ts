import { logAiQuery } from "@/lib/ai/ai-query-logger";
import { logMcpCall } from "@/lib/ai/mcp-logger";
import { selectModel } from "@/lib/ai/models";
import { getFullSystemPrompt } from "@/lib/ai/prompts";
import { reviewMcpCall } from "@/lib/ai/qa-reviewer";
import { requestBodySchema } from "@/lib/ai/schema";
import { getTools, validateToolNames } from "@/lib/ai/tools";
import { getVerifiedQaContext } from "@/lib/ai/verified-qa";
import { listManagedProjectIds } from "@/lib/projects";
import { SmartResponse } from "@/route-handlers/smart-response";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { yupMixed, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { captureError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { Json } from "@stackframe/stack-shared/dist/utils/json";
import type { OpenRouterUsageAccounting } from "@openrouter/ai-sdk-provider";
import { generateText, ModelMessage, stepCountIs, streamText, type StepResult, type ToolSet } from "ai";

type ProviderMetadata = { openrouter?: { usage?: OpenRouterUsageAccounting } };

function extractOpenRouterCost(meta: unknown): number | undefined {
  return (meta as ProviderMetadata | null | undefined)?.openrouter?.usage?.cost;
}

function extractCachedTokens(meta: unknown): number | undefined {
  return (meta as ProviderMetadata | null | undefined)?.openrouter?.usage?.promptTokensDetails?.cachedTokens;
}

function buildStepsJson(steps: ReadonlyArray<StepResult<ToolSet>>): string {
  return JSON.stringify(steps.map((step, i) => ({
    step: i,
    text: step.text || undefined,
    toolCalls: step.toolCalls.map(tc => ({
      toolName: tc.toolName,
      toolCallId: tc.toolCallId,
      args: tc.input,
    })),
    toolResults: step.toolResults.map(tr => ({
      toolName: tr.toolName,
      toolCallId: tr.toolCallId,
      result: tr.output,
    })),
  })));
}

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

    const isAuthenticated = fullReq.auth != null;
    const { quality, speed, systemPrompt: systemPromptId, tools: toolNames, messages, projectId } = body;

    if (projectId != null) {
      if (fullReq.auth?.project.id !== "internal") {
        throw new StatusError(StatusError.Forbidden, "You do not have access to this project");
      }
      const user = fullReq.auth.user;
      if (user == null) {
        throw new StatusError(StatusError.Forbidden, "You do not have access to this project");
      }
      const managedProjectIds = await listManagedProjectIds(user);
      if (!managedProjectIds.includes(projectId)) {
        throw new StatusError(StatusError.Forbidden, "You do not have access to this project");
      }
    }

    const model = selectModel(quality, speed, isAuthenticated);
    const isDocsOrSearch = systemPromptId === "docs-ask-ai" || systemPromptId === "command-center-ask-ai";
    let systemPrompt = getFullSystemPrompt(systemPromptId);
    if (isDocsOrSearch) {
      systemPrompt += await getVerifiedQaContext();
    }
    const tools = await getTools(toolNames, { auth: fullReq.auth, targetProjectId: projectId });
    const toolsArg = Object.keys(tools).length > 0 ? tools : undefined;
    const stepLimit = toolsArg == null ? 1 : isDocsOrSearch ? 50 : 5;

    const correlationId = crypto.randomUUID();
    const conversationIdForLog = body.mcpCallMetadata
      ? body.mcpCallMetadata.conversationId ?? crypto.randomUUID()
      : undefined;
    const commonLogFields = {
      correlationId,
      mode,
      systemPromptId,
      quality,
      speed,
      modelId: String(model.modelId),
      isAuthenticated,
      projectId: projectId ?? undefined,
      userId: fullReq.auth?.user?.id,
      requestedToolsJson: JSON.stringify(toolNames),
      messagesJson: JSON.stringify(messages),
      mcpCorrelationId: body.mcpCallMetadata ? correlationId : undefined,
      conversationId: conversationIdForLog,
    };

    const startedAt = Date.now();

    const USER_FACING_ERROR_MESSAGE = "The AI service is temporarily unavailable. Please try again later.";

    function logError(err: unknown) {
      captureError("ai-query-upstream", err);
      runAsynchronouslyAndWaitUntil(logAiQuery({
        ...commonLogFields,
        stepsJson: "[]",
        finalText: "",
        inputTokens: undefined,
        outputTokens: undefined,
        cachedInputTokens: undefined,
        costUsd: undefined,
        stepCount: 0,
        durationMs: BigInt(Date.now() - startedAt),
        errorMessage: err instanceof Error ? err.message : String(err),
      }));
    }

    const isAnthropic = model.modelId.startsWith("anthropic/");
    const systemMessage: ModelMessage = {
      role: "system",
      content: systemPrompt,
      ...(isAnthropic && {
        providerOptions: { openrouter: { cacheControl: { type: "ephemeral" } } },
      }),
    };
    const cachedMessages: ModelMessage[] = [systemMessage, ...(messages as ModelMessage[])];
    const openrouterProviderOptions = {
      usage: { include: true },
      extraBody: {
        stream_options: { include_usage: true },
      },
    } as const;

    if (mode === "stream") {
      const result = streamText({
        model,
        messages: cachedMessages,
        tools: toolsArg,
        stopWhen: stepCountIs(stepLimit),
        providerOptions: {
          openrouter: openrouterProviderOptions,
        },
        onFinish: ({ text, steps, usage, providerMetadata }) => {
          runAsynchronouslyAndWaitUntil(logAiQuery({
            ...commonLogFields,
            stepsJson: buildStepsJson(steps),
            finalText: text,
            inputTokens: usage.inputTokens ?? undefined,
            outputTokens: usage.outputTokens ?? undefined,
            cachedInputTokens: extractCachedTokens(providerMetadata),
            costUsd: extractOpenRouterCost(providerMetadata),
            stepCount: steps.length,
            durationMs: BigInt(Date.now() - startedAt),
            errorMessage: undefined,
          }));
        },
        onError: ({ error }) => logError(error),
      });
      return {
        statusCode: 200,
        bodyType: "response" as const,
        body: result.toUIMessageStreamResponse({
          onError: () => USER_FACING_ERROR_MESSAGE,
        }),
      };
    } else {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120_000);
      let result: Awaited<ReturnType<typeof generateText>>;
      try {
        result = await generateText({
          model,
          messages: cachedMessages,
          tools: toolsArg,
          abortSignal: controller.signal,
          stopWhen: stepCountIs(stepLimit),
          providerOptions: {
            openrouter: openrouterProviderOptions,
          },
        }).finally(() => clearTimeout(timeoutId));
      } catch (err) {
        logError(err);
        throw new StatusError(StatusError.BadGateway, USER_FACING_ERROR_MESSAGE);
      }

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

      runAsynchronouslyAndWaitUntil(logAiQuery({
        ...commonLogFields,
        stepsJson: buildStepsJson(result.steps),
        finalText: result.text,
        inputTokens: result.usage.inputTokens ?? undefined,
        outputTokens: result.usage.outputTokens ?? undefined,
        cachedInputTokens: extractCachedTokens(result.providerMetadata),
        costUsd: extractOpenRouterCost(result.providerMetadata),
        stepCount: result.steps.length,
        durationMs: BigInt(Date.now() - startedAt),
        errorMessage: undefined,
      }));

      let responseConversationId: string | undefined;
      if (body.mcpCallMetadata != null && conversationIdForLog != null) {
        const conversationId = conversationIdForLog;
        responseConversationId = conversationId;
        const firstUserMessage = messages.find(m => m.role === "user");
        const question = typeof firstUserMessage?.content === "string"
          ? firstUserMessage.content
          : JSON.stringify(firstUserMessage?.content ?? "");

        const innerToolCallsJson = JSON.stringify(contentBlocks.filter(b => b.type === "tool-call"));

        const logPromise = logMcpCall({
          correlationId,
          toolName: body.mcpCallMetadata.toolName,
          reason: body.mcpCallMetadata.reason,
          userPrompt: body.mcpCallMetadata.userPrompt,
          conversationId,
          question,
          response: result.text,
          stepCount: result.steps.length,
          innerToolCallsJson,
          durationMs: BigInt(Date.now() - startedAt),
          modelId: String(model.modelId),
          errorMessage: undefined,
        });
        runAsynchronouslyAndWaitUntil(logPromise);

        runAsynchronouslyAndWaitUntil(reviewMcpCall({
          logPromise,
          correlationId,
          question,
          reason: body.mcpCallMetadata.reason,
          response: result.text,
        }));
      }

      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: {
          content: contentBlocks,
          finalText: result.text,
          conversationId: responseConversationId ?? null,
        },
      };
    }
  },
});
