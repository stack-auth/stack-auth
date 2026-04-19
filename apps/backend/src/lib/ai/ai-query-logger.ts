import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { callReducer, opt } from "./mcp-logger";

export type AiQueryLogEntry = {
  correlationId: string,
  mode: string,
  systemPromptId: string,
  quality: string,
  speed: string,
  modelId: string,
  isAuthenticated: boolean,
  projectId: string | undefined,
  userId: string | undefined,
  requestedToolsJson: string,
  messagesJson: string,
  stepsJson: string,
  finalText: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  cachedInputTokens: number | undefined,
  costUsd: number | undefined,
  stepCount: number,
  durationMs: bigint,
  errorMessage: string | undefined,
  mcpCorrelationId: string | undefined,
  conversationId: string | undefined,
};

export async function logAiQuery(entry: AiQueryLogEntry): Promise<void> {
  const logToken = getEnvVariable("STACK_MCP_LOG_TOKEN", "");
  if (!logToken) return;
  await callReducer("log_ai_query", [
    logToken,
    entry.correlationId,
    entry.mode,
    entry.systemPromptId,
    entry.quality,
    entry.speed,
    entry.modelId,
    entry.isAuthenticated,
    opt(entry.projectId),
    opt(entry.userId),
    entry.requestedToolsJson,
    entry.messagesJson,
    entry.stepsJson,
    entry.finalText,
    opt(entry.inputTokens),
    opt(entry.outputTokens),
    opt(entry.cachedInputTokens),
    opt(entry.costUsd),
    entry.stepCount,
    entry.durationMs,
    opt(entry.errorMessage),
    opt(entry.mcpCorrelationId),
    opt(entry.conversationId),
  ]);
}
