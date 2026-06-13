import { logAiQuery, type AiQueryLogEntry } from "@/lib/ai/loggers/ai-query-logger";
import { refineGenerationCost, type UsageFields } from "@/lib/ai/openrouter-usage";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { captureError } from "@hexclave/shared/dist/utils/errors";

export type ProxyLogFields = {
  correlationId: string,
  parsed: { model: string } & Record<string, unknown>,
  apiKey: string,
  durationMs: bigint,
  responseStatus: number,
  usage?: UsageFields,
};

export function buildProxyLogRow(fields: ProxyLogFields): AiQueryLogEntry {
  const { parsed, apiKey, durationMs, responseStatus, usage, correlationId } = fields;
  const tools = Array.isArray(parsed.tools) ? parsed.tools : [];
  const toolNames = tools
    .map((t) => {
      if (t == null || typeof t !== "object") return null;
      const obj = t as { name?: unknown, function?: { name?: unknown } };
      if (typeof obj.function?.name === "string") return obj.function.name;
      if (typeof obj.name === "string") return obj.name;
      return null;
    })
    .filter((n): n is string => typeof n === "string");
  const rawMessages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const messages = typeof parsed.system === "string" && parsed.system.length > 0
    ? [{ role: "system", content: parsed.system }, ...rawMessages]
    : rawMessages;
  return {
    correlationId,
    mode: parsed.stream === true ? "stream" : "generate",
    systemPromptId: apiKey === "stack-auth-proxy" ? "stack-cli" : apiKey,
    quality: "unknown",
    speed: "unknown",
    modelId: parsed.model,
    isAuthenticated: false,
    projectId: undefined,
    userId: undefined,
    requestedToolsJson: JSON.stringify(toolNames),
    messagesJson: JSON.stringify(messages),
    stepsJson: "[]",
    finalText: "",
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    cachedInputTokens: usage?.cachedInputTokens,
    cacheCreationTokens: usage?.cacheCreationTokens,
    costUsd: usage?.costUsd,
    cacheDiscountUsd: undefined,
    openrouterGenerationId: usage?.generationId,
    stepCount: 0,
    durationMs,
    errorMessage: responseStatus >= 400 ? `upstream ${responseStatus}` : undefined,
    conversationId: undefined,
  };
}

export function scheduleProxyLog(row: AiQueryLogEntry): void {
  try {
    const safe = (async () => {
      try {
        await logAiQuery(row);
      } catch (e) {
        captureError("ai-proxy-log-async", e);
      }
    })();
    runAsynchronouslyAndWaitUntil(safe);
    if (row.openrouterGenerationId != null) {
      runAsynchronouslyAndWaitUntil(refineGenerationCost({
        generationId: row.openrouterGenerationId,
        correlationId: row.correlationId,
      }));
    }
  } catch (e) {
    captureError("ai-proxy-log-sync", e);
  }
}
