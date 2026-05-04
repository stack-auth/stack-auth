import { callReducer, opt } from "@/lib/ai/spacetimedb-client";
import type { OpenRouterUsageAccounting } from "@openrouter/ai-sdk-provider";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import type { LanguageModelUsage } from "ai";

export type UsageFields = {
  inputTokens?: number,
  outputTokens?: number,
  cachedInputTokens?: number,
  cacheCreationTokens?: number,
  costUsd?: number,
  generationId?: string,
};

type ProviderMetadata = { openrouter?: { usage?: OpenRouterUsageAccounting } };


export function extractCostFromUsage(usage: LanguageModelUsage): {
  costUsd?: number,
} {
  const raw = usage.raw as RawUsage | undefined;
  if (raw == null) return {};
  return { costUsd: raw.cost };
}

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
  prompt_tokens_details?: { cached_tokens?: number, cache_write_tokens?: number },
  cost?: number,
};

type SseEvent = {
  id?: string,
  usage?: RawUsage,
  message?: { usage?: RawUsage },
  delta?: { usage?: RawUsage },
};

const emptyUsage = (): UsageFields => ({});
const isUsageEmpty = (u: UsageFields): boolean =>
  u.inputTokens == null && u.outputTokens == null && u.cachedInputTokens == null
  && u.cacheCreationTokens == null && u.costUsd == null
  && u.generationId == null;

function readUsageBlock(usage: RawUsage, into: UsageFields): void {
  // Anthropic splits prompt tokens across three buckets; sum for parity with OpenAI's `prompt_tokens`.
  if (usage.input_tokens != null) {
    into.inputTokens = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  } else {
    into.inputTokens = usage.prompt_tokens ?? into.inputTokens;
  }
  into.outputTokens = usage.output_tokens ?? usage.completion_tokens ?? into.outputTokens;
  into.cachedInputTokens = usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? into.cachedInputTokens;
  into.cacheCreationTokens = usage.cache_creation_input_tokens ?? usage.prompt_tokens_details?.cache_write_tokens ?? into.cacheCreationTokens;
  if (usage.cost != null) into.costUsd = usage.cost;
}

function mergeUsageFromEvent(event: unknown, into: UsageFields): void {
  if (event == null || typeof event !== "object") return;
  const e = event as SseEvent;
  if (e.usage) readUsageBlock(e.usage, into);
  if (e.message?.usage) readUsageBlock(e.message.usage, into);
  if (e.delta?.usage) readUsageBlock(e.delta.usage, into);
  if (typeof e.id === "string" && e.id.length > 0 && into.generationId == null) {
    into.generationId = e.id;
  }
}

export function extractOpenRouterUsage(obj: unknown): UsageFields | undefined {
  const acc = emptyUsage();
  mergeUsageFromEvent(obj, acc);
  return isUsageEmpty(acc) ? undefined : acc;
}

export async function scanSseForUsage(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<UsageFields | undefined> {
  const reader = stream.getReader();
  let onAbort: (() => void) | undefined;
  try {
    const decoder = new TextDecoder();
    const acc = emptyUsage();
    let buffer = "";
    onAbort = () => {
      reader.cancel().catch(() => {});
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const EVENT_TERMINATOR = /\r\n\r\n|\r\r|\n\n/;
    const LINE_SPLITTER = /\r\n|\r|\n/;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = EVENT_TERMINATOR.exec(buffer)) !== null) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        for (const line of block.split(LINE_SPLITTER)) {
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === "[DONE]") continue;
          try {
            mergeUsageFromEvent(JSON.parse(dataStr), acc);
          } catch (err) {
            captureError("ai-proxy-sse-parse", err);
          }
        }
      }
    }
    return isUsageEmpty(acc) ? undefined : acc;
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

const GENERATION_RETRY_DELAYS_MS = [1500, 4000];
const GENERATION_PER_REQUEST_TIMEOUT_MS = 5000;

type GenerationRecord = {
  id: string,
  total_cost?: number,
  cache_discount?: number,
  upstream_inference_cost?: number,
};

async function fetchGenerationOnce(
  generationId: string,
  apiKey: string,
): Promise<GenerationRecord | null | "not_ready"> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GENERATION_PER_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (res.status === 404) return "not_ready";
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter /generation returned ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json() as { data?: GenerationRecord };
    return json.data ?? null;
  } finally {
    clearTimeout(timer);
  }
}

export async function refineGenerationCost(opts: {
  generationId: string,
  correlationId: string,
}): Promise<void> {
  const apiKey = getEnvVariable("STACK_OPENROUTER_API_KEY", "");
  if (!apiKey || apiKey === "FORWARD_TO_PRODUCTION") return;
  const logToken = getEnvVariable("STACK_MCP_LOG_TOKEN", "");
  if (!logToken) return;

  for (let attempt = 0; attempt < GENERATION_RETRY_DELAYS_MS.length; attempt++) {
    await new Promise(r => setTimeout(r, GENERATION_RETRY_DELAYS_MS[attempt]));
    try {
      const result = await fetchGenerationOnce(opts.generationId, apiKey);
      if (result === "not_ready") continue;
      if (result == null) return;
      await callReducer("update_ai_query_cost", [
        logToken,
        opts.correlationId,
        opt(result.total_cost),
        opt(result.cache_discount),
      ]);
      return;
    } catch (err) {
      if (attempt === GENERATION_RETRY_DELAYS_MS.length - 1) {
        captureError("openrouter-generation-refine", err);
      }
    }
  }
}
