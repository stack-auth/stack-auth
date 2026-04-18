import type { OpenRouterUsageAccounting } from "@openrouter/ai-sdk-provider";

export type UsageFields = {
  inputTokens?: number,
  outputTokens?: number,
  cachedInputTokens?: number,
  costUsd?: number,
};

type ProviderMetadata = { openrouter?: { usage?: OpenRouterUsageAccounting } };

export function extractOpenRouterCost(meta: unknown): number | undefined {
  return (meta as ProviderMetadata | null | undefined)?.openrouter?.usage?.cost;
}

export function extractCachedTokens(meta: unknown): number | undefined {
  return (meta as ProviderMetadata | null | undefined)?.openrouter?.usage?.promptTokensDetails?.cachedTokens;
}

type RawUsage = {
  input_tokens?: number,
  output_tokens?: number,
  cache_read_input_tokens?: number,
  cache_creation_input_tokens?: number,
  prompt_tokens?: number,
  completion_tokens?: number,
  prompt_tokens_details?: { cached_tokens?: number },
  cost?: number,
};

type SseEvent = {
  usage?: RawUsage,
  message?: { usage?: RawUsage },
  delta?: { usage?: RawUsage },
};

const emptyUsage = (): UsageFields => ({});
const isUsageEmpty = (u: UsageFields): boolean =>
  u.inputTokens == null && u.outputTokens == null && u.cachedInputTokens == null && u.costUsd == null;

function readUsageBlock(usage: RawUsage, into: UsageFields): void {
  // Anthropic splits prompt tokens across three buckets; sum for parity with OpenAI's `prompt_tokens`.
  if (usage.input_tokens != null) {
    into.inputTokens = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  } else {
    into.inputTokens = usage.prompt_tokens ?? into.inputTokens;
  }
  into.outputTokens = usage.output_tokens ?? usage.completion_tokens ?? into.outputTokens;
  into.cachedInputTokens = usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? into.cachedInputTokens;
  into.costUsd = usage.cost ?? into.costUsd;
}

function mergeUsageFromEvent(event: unknown, into: UsageFields): void {
  if (event == null || typeof event !== "object") return;
  const e = event as SseEvent;
  if (e.usage) readUsageBlock(e.usage, into);
  if (e.message?.usage) readUsageBlock(e.message.usage, into);
  if (e.delta?.usage) readUsageBlock(e.delta.usage, into);
}

export function extractOpenRouterUsage(obj: unknown): UsageFields | undefined {
  const acc = emptyUsage();
  mergeUsageFromEvent(obj, acc);
  return isUsageEmpty(acc) ? undefined : acc;
}

export async function scanSseForUsage(stream: ReadableStream<Uint8Array>): Promise<UsageFields | undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const acc = emptyUsage();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === "[DONE]") continue;
          try {
            mergeUsageFromEvent(JSON.parse(dataStr), acc);
          } catch { /* malformed event — skip */ }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return isUsageEmpty(acc) ? undefined : acc;
}
