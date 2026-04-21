import { logAiQuery } from "@/lib/ai/ai-query-logger";
import { logMcpCall } from "@/lib/ai/mcp-logger";
import { selectModel } from "@/lib/ai/models";
import { extractCachedTokens, extractOpenRouterCost } from "@/lib/ai/openrouter-usage";
import { reviewMcpCall } from "@/lib/ai/qa-reviewer";
import { listManagedProjectIds } from "@/lib/projects";
import type { SmartRequestAuth } from "@/route-handlers/smart-request";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { captureError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { Json } from "@stackframe/stack-shared/dist/utils/json";
import { generateText, ModelMessage, stepCountIs, streamText, type LanguageModelUsage, type StepResult, type ToolSet } from "ai";

export const USER_FACING_ERROR_MESSAGE = "The AI service is temporarily unavailable. Please try again later.";

export const OPENROUTER_PROVIDER_OPTIONS = {
  usage: { include: true },
  extraBody: { stream_options: { include_usage: true } },
} as const;

export type ContentBlock =
  | { type: "text", text: string }
  | {
      type: "tool-call",
      toolName: string,
      toolCallId: string,
      args: Json,
      argsText: string,
      result: Json,
    };

export type McpCallMetadata = {
  toolName: string,
  reason: string,
  userPrompt: string,
  conversationId?: string | null,
};

type MessageLike = { role: string, content: unknown };

export type CommonLogFields = {
  correlationId: string,
  mode: "stream" | "generate",
  systemPromptId: string,
  quality: string,
  speed: string,
  modelId: string,
  isAuthenticated: boolean,
  projectId: string | undefined,
  userId: string | undefined,
  requestedToolsJson: string,
  messagesJson: string,
  mcpCorrelationId: string | undefined,
  conversationId: string | undefined,
};

export type ModeContext = {
  model: ReturnType<typeof selectModel>,
  cachedMessages: ModelMessage[],
  toolsArg: ToolSet | undefined,
  stepLimit: number,
  common: CommonLogFields,
  startedAt: number,
};

function logSuccess(args: {
  common: CommonLogFields,
  startedAt: number,
  steps: ReadonlyArray<StepResult<ToolSet>>,
  text: string,
  usage: LanguageModelUsage,
  providerMetadata: unknown,
}): void {
  const { common, startedAt, steps, text, usage, providerMetadata } = args;
  runAsynchronouslyAndWaitUntil(logAiQuery({
    ...common,
    stepsJson: JSON.stringify(steps.map((step, i) => ({
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
    }))),
    finalText: text,
    inputTokens: usage.inputTokens ?? undefined,
    outputTokens: usage.outputTokens ?? undefined,
    cachedInputTokens: extractCachedTokens(providerMetadata),
    costUsd: extractOpenRouterCost(providerMetadata),
    stepCount: steps.length,
    durationMs: BigInt(Math.round(performance.now() - startedAt)),
    errorMessage: undefined,
  }));
}

function logFailure(args: {
  common: CommonLogFields,
  startedAt: number,
  err: unknown,
}): void {
  const { common, startedAt, err } = args;
  captureError("ai-query-upstream", err);
  runAsynchronouslyAndWaitUntil(logAiQuery({
    ...common,
    stepsJson: "[]",
    finalText: "",
    inputTokens: undefined,
    outputTokens: undefined,
    cachedInputTokens: undefined,
    costUsd: undefined,
    stepCount: 0,
    durationMs: BigInt(Math.round(performance.now() - startedAt)),
    errorMessage: err instanceof Error ? err.message : String(err),
  }));
}

export async function assertProjectAccess(projectId: string, auth: SmartRequestAuth | null): Promise<void> {
  if (auth == null || auth.project.id !== "internal" || auth.user == null) {
    throw new StatusError(StatusError.Forbidden, "You do not have access to this project");
  }
  const managedProjectIds = await listManagedProjectIds(auth.user);
  if (!managedProjectIds.includes(projectId)) {
    throw new StatusError(StatusError.Forbidden, "You do not have access to this project");
  }
}

export function handleStreamMode(ctx: ModeContext) {
  const { model, cachedMessages, toolsArg, stepLimit, common, startedAt } = ctx;
  const result = streamText({
    model,
    messages: cachedMessages,
    tools: toolsArg,
    stopWhen: stepCountIs(stepLimit),
    providerOptions: { openrouter: OPENROUTER_PROVIDER_OPTIONS },
    onFinish: ({ text, steps, usage, providerMetadata }) => {
      logSuccess({ common, startedAt, steps, text, usage, providerMetadata });
    },
    onError: ({ error }) => logFailure({ common, startedAt, err: error }),
  });
  return {
    statusCode: 200,
    bodyType: "response" as const,
    body: result.toUIMessageStreamResponse({
      onError: (err) => {
        captureError("ai-query-stream-writer", err);
        return USER_FACING_ERROR_MESSAGE;
      },
    }),
  };
}

export async function handleGenerateMode(ctx: ModeContext & {
  messages: ReadonlyArray<MessageLike>,
  mcpCallMetadata: McpCallMetadata | undefined,
  correlationId: string,
  conversationIdForLog: string | undefined,
}) {
  const { model, cachedMessages, toolsArg, stepLimit, common, startedAt, messages, mcpCallMetadata, correlationId, conversationIdForLog } = ctx;
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
      providerOptions: { openrouter: OPENROUTER_PROVIDER_OPTIONS },
    }).finally(() => clearTimeout(timeoutId));
  } catch (err) {
    logFailure({ common, startedAt, err });
    throw new StatusError(StatusError.BadGateway, USER_FACING_ERROR_MESSAGE);
  }

  const contentBlocks: ContentBlock[] = [];
  for (const step of result.steps) {
    if (step.text) {
      contentBlocks.push({ type: "text", text: step.text });
    }
    const resultsByCallId = new Map(step.toolResults.map(r => [r.toolCallId, r]));
    for (const toolCall of step.toolCalls) {
      const toolResult = resultsByCallId.get(toolCall.toolCallId);
      contentBlocks.push({
        type: "tool-call",
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        args: toolCall.input,
        argsText: JSON.stringify(toolCall.input),
        result: (toolResult?.output ?? null) as Json,
      });
    }
  }

  logSuccess({
    common,
    startedAt,
    steps: result.steps,
    text: result.text,
    usage: result.usage,
    providerMetadata: result.providerMetadata,
  });

  let responseConversationId: string | undefined;
  if (mcpCallMetadata != null && conversationIdForLog != null) {
    responseConversationId = conversationIdForLog;
    const lastUserMessage = messages.findLast(m => m.role === "user");
    const question = typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : JSON.stringify(lastUserMessage?.content ?? "");
    const innerToolCallsJson = JSON.stringify(contentBlocks.filter(b => b.type === "tool-call"));
    const logPromise = logMcpCall({
      correlationId,
      toolName: mcpCallMetadata.toolName,
      reason: mcpCallMetadata.reason,
      userPrompt: mcpCallMetadata.userPrompt,
      conversationId: conversationIdForLog,
      question,
      response: result.text,
      stepCount: result.steps.length,
      innerToolCallsJson,
      durationMs: BigInt(Math.round(performance.now() - startedAt)),
      modelId: String(model.modelId),
      errorMessage: undefined,
    });
    runAsynchronouslyAndWaitUntil(logPromise);
    runAsynchronouslyAndWaitUntil(reviewMcpCall({
      logPromise,
      correlationId,
      question,
      reason: mcpCallMetadata.reason,
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
