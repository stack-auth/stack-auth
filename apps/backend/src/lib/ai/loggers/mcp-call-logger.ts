import { reviewMcpCall } from "@/lib/ai/qa/qa-reviewer";
import type { McpCallMetadata, MessageLike } from "@/lib/ai/types";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { Json } from "@stackframe/stack-shared/dist/utils/json";
import { type StepResult, type ToolSet } from "ai";
import { callReducer, opt } from "../spacetimedb-client";

export type McpLogEntry = {
  correlationId: string,
  toolName: string,
  reason: string,
  userPrompt: string,
  conversationId: string | undefined,
  question: string,
  response: string,
  stepCount: number,
  innerToolCallsJson: string,
  durationMs: bigint,
  modelId: string,
  errorMessage: string | undefined,
};

export async function logMcpCall(entry: McpLogEntry): Promise<void> {
  const logToken = getEnvVariable("STACK_MCP_LOG_TOKEN", "");
  await callReducer("log_mcp_call", [
    logToken,
    entry.correlationId,
    opt(entry.conversationId),
    entry.toolName,
    entry.reason,
    entry.userPrompt,
    entry.question,
    entry.response,
    entry.stepCount,
    entry.innerToolCallsJson,
    entry.durationMs,
    entry.modelId,
    opt(entry.errorMessage),
  ]);
}

function buildInnerToolCallsJson(steps: ReadonlyArray<StepResult<ToolSet>>): string {
  const items: Json[] = [];
  for (const step of steps) {
    const resultsByCallId = new Map(step.toolResults.map(r => [r.toolCallId, r]));
    for (const tc of step.toolCalls) {
      items.push({
        type: "tool-call",
        toolName: tc.toolName,
        toolCallId: tc.toolCallId,
        args: tc.input as Json,
        argsText: JSON.stringify(tc.input),
        result: (resultsByCallId.get(tc.toolCallId)?.output ?? null) as Json,
      });
    }
  }
  return JSON.stringify(items);
}

export function logIfMcpToolCall(args: {
  mcpCallMetadata: McpCallMetadata | undefined,
  conversationIdForLog: string | undefined,
  correlationId: string,
  messages: ReadonlyArray<MessageLike>,
  steps: ReadonlyArray<StepResult<ToolSet>>,
  text: string,
  startedAt: number,
  modelId: string,
}): void {
  const { mcpCallMetadata, conversationIdForLog, correlationId, messages, steps, text, startedAt, modelId } = args;
  if (mcpCallMetadata == null || conversationIdForLog == null) return;
  const lastUserMessage = messages.findLast(m => m.role === "user");
  const question = typeof lastUserMessage?.content === "string"
    ? lastUserMessage.content
    : JSON.stringify(lastUserMessage?.content ?? "");
  const innerToolCallsJson = buildInnerToolCallsJson(steps);
  const logPromise = logMcpCall({
    correlationId,
    toolName: mcpCallMetadata.toolName,
    reason: mcpCallMetadata.reason,
    userPrompt: mcpCallMetadata.userPrompt,
    conversationId: conversationIdForLog,
    question,
    response: text,
    stepCount: steps.length,
    innerToolCallsJson,
    durationMs: BigInt(Math.round(performance.now() - startedAt)),
    modelId,
    errorMessage: undefined,
  });
  runAsynchronouslyAndWaitUntil(logPromise);
  runAsynchronouslyAndWaitUntil(reviewMcpCall({
    logPromise,
    correlationId,
    question,
    reason: mcpCallMetadata.reason,
    response: text,
  }));
}
