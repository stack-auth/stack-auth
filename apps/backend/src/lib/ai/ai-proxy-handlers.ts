import { logAiQuery } from "@/lib/ai/ai-query-logger";
import { ALLOWED_MODEL_IDS } from "@/lib/ai/models";
import { extractOpenRouterUsage, scanSseForUsage, type UsageFields } from "@/lib/ai/openrouter-usage";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { captureError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export const OPENROUTER_DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

export type SanitizedBody = {
  parsed: Record<string, unknown>,
  bytes: Uint8Array,
};

export function sanitizeBody(raw: ArrayBuffer): SanitizedBody {
  const text = new TextDecoder().decode(raw);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StatusError(400, "Request body must be valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new StatusError(400, "Request body must be a JSON object");
  }

  if (!parsed.model || !ALLOWED_MODEL_IDS.has(parsed.model)) {
    parsed.model = OPENROUTER_DEFAULT_MODEL;
  }

  if (parsed.metadata?.user_id && parsed.metadata.user_id.length > 128) {
    parsed.metadata.user_id = parsed.metadata.user_id.slice(0, 128);
  }

  return { parsed: parsed as Record<string, unknown>, bytes: new TextEncoder().encode(JSON.stringify(parsed)) };
}

function buildMessagesWithSystem(parsed: Record<string, unknown>): unknown[] {
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const system = parsed.system;
  if (typeof system === "string" && system.length > 0) {
    return [{ role: "system", content: system }, ...messages];
  }
  return messages;
}

type ProxyLogFields = {
  correlationId: string,
  parsed: Record<string, unknown>,
  apiKey: string,
  durationMs: bigint,
  responseStatus: number,
  usage?: UsageFields,
};

function buildProxyLogRow(fields: ProxyLogFields) {
  const { parsed, apiKey, durationMs, responseStatus, usage, correlationId } = fields;
  const tools = Array.isArray(parsed.tools) ? parsed.tools : [];
  const toolNames = tools
    .map(t => (t && typeof t === "object" && "name" in t) ? (t as { name: unknown }).name : null)
    .filter((n): n is string => typeof n === "string");
  return {
    correlationId,
    mode: parsed.stream === true ? "stream" : "generate",
    systemPromptId: apiKey === "stack-auth-proxy" ? "stack-cli" : apiKey,
    quality: "unknown",
    speed: "unknown",
    modelId: String(parsed.model ?? OPENROUTER_DEFAULT_MODEL),
    isAuthenticated: false,
    projectId: undefined,
    userId: undefined,
    requestedToolsJson: JSON.stringify(toolNames),
    messagesJson: JSON.stringify(buildMessagesWithSystem(parsed)),
    stepsJson: "[]",
    finalText: "",
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    cachedInputTokens: usage?.cachedInputTokens,
    costUsd: usage?.costUsd,
    stepCount: 0,
    durationMs,
    errorMessage: responseStatus >= 400 ? `upstream ${responseStatus}` : undefined,
    mcpCorrelationId: undefined,
    conversationId: undefined,
  };
}

function scheduleLog(row: ReturnType<typeof buildProxyLogRow>) {
  try {
    const safe = logAiQuery(row).catch(e => captureError("ai-proxy-log-async", e));
    runAsynchronouslyAndWaitUntil(safe);
  } catch (e) {
    captureError("ai-proxy-log-sync", e);
  }
}

export async function observeAndLog(args: {
  response: Response,
  sanitizedBody: SanitizedBody,
  callerApiKey: string,
  correlationId: string,
  startedAt: number,
  responseHeaders: Record<string, string>,
}): Promise<Response> {
  const { response, sanitizedBody, callerApiKey, correlationId, startedAt, responseHeaders } = args;
  const isStreaming = sanitizedBody.parsed.stream === true;

  if (isStreaming && response.body) {
    const [clientStream, observerStream] = response.body.tee();
    runAsynchronouslyAndWaitUntil((async () => {
      const usage = await scanSseForUsage(observerStream).catch(() => undefined);
      scheduleLog(buildProxyLogRow({
        correlationId,
        parsed: sanitizedBody.parsed,
        apiKey: callerApiKey,
        durationMs: BigInt(Date.now() - startedAt),
        responseStatus: response.status,
        usage,
      }));
    })());
    return new Response(clientStream, { status: response.status, headers: responseHeaders });
  }

  const bodyBytes = await response.arrayBuffer();
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    parsedBody = undefined;
  }
  scheduleLog(buildProxyLogRow({
    correlationId,
    parsed: sanitizedBody.parsed,
    apiKey: callerApiKey,
    durationMs: BigInt(Date.now() - startedAt),
    responseStatus: response.status,
    usage: extractOpenRouterUsage(parsedBody),
  }));
  return new Response(bodyBytes, { status: response.status, headers: responseHeaders });
}
