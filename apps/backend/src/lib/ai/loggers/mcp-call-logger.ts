import type { McpCallMetadata, McpLogEntry, MessageLike } from "@/lib/ai/types";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { Json } from "@hexclave/shared/dist/utils/json";
import { type StepResult, type ToolSet } from "ai";
import { callInternalTool } from "../internal-tool-client";

export async function logMcpCall(entry: McpLogEntry): Promise<void> {
  await callInternalTool("/api/backend/log-mcp-call", { body: entry });
}

function buildInnerToolCallsJson(steps: ReadonlyArray<StepResult<ToolSet>>): string {
  try {
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
  } catch (e) {
    captureError("mcp-call-serialize", e);
    return JSON.stringify([{
      type: "tool-call",
      toolName: "_serializationFailed",
      toolCallId: "_serializationFailed",
      args: { stepCount: steps.length },
      argsText: JSON.stringify({ stepCount: steps.length }),
      result: null,
    }]);
  }
}

function safeStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : "";
  } catch {
    return JSON.stringify({ _serializationFailed: true });
  }
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
  // Set on the failure path so an MCP-backed question that errored still lands
  // in the MCP Review workflow (with its error) instead of vanishing.
  errorMessage?: string,
}): void {
  const { mcpCallMetadata, conversationIdForLog, correlationId, messages, steps, text, startedAt, modelId, errorMessage } = args;
  if (mcpCallMetadata == null || conversationIdForLog == null) return;
  const lastUserMessage = messages.findLast(m => m.role === "user");
  const question = typeof lastUserMessage?.content === "string"
    ? lastUserMessage.content
    : safeStringify(lastUserMessage?.content ?? "");
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
    durationMs: Math.round(performance.now() - startedAt),
    modelId,
    errorMessage,
  });
  runAsynchronouslyAndWaitUntil(logPromise);
  // An errored call has no meaningful response to review — log it, but don't
  // spend an LLM QA run on it.
  if (errorMessage != null) return;
  // The automated LLM QA review runs in the internal tool and updates the
  // freshly logged row, so it must only fire after the log write lands.
  runAsynchronouslyAndWaitUntil((async () => {
    try {
      await logPromise;
    } catch (err) {
      captureError("qa-reviewer-log-wait", err);
      return;
    }
    await callInternalTool("/api/backend/review-mcp-call", {
      body: {
        correlationId,
        question,
        reason: mcpCallMetadata.reason,
        response: text,
      },
    });
  })());
}
