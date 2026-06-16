// OpenRouter helpers: model catalog for launchers and usage repricing.

import { getOpenRouterApiKey } from "./config";

export type OpenRouterModel = {
  id: string,
  name: string,
  description: string,
  contextLength: number | null,
  pricing: { prompt: string, completion: string, inputCacheRead: string | null, inputCacheWrite: string | null } | null,
  created: number | null,
};

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_TTL_MS = 10 * 60 * 1000;

let modelsCache: { fetchedAt: number, models: OpenRouterModel[] } | null = null;

export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  if (modelsCache && Date.now() - modelsCache.fetchedAt < CACHE_TTL_MS) {
    return modelsCache.models;
  }
  const response = await fetch(MODELS_URL, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`OpenRouter model list request failed: ${response.status} ${response.statusText}`);
  }
  const body = await response.json() as { data?: unknown[] };
  const models: OpenRouterModel[] = (body.data ?? []).map(raw => {
    const m = raw as Record<string, unknown>;
    const pricing = m.pricing as Record<string, unknown> | undefined;
    return {
      id: String(m.id ?? ""),
      name: String(m.name ?? m.id ?? ""),
      description: typeof m.description === "string" ? m.description : "",
      contextLength: typeof m.context_length === "number" ? m.context_length : null,
      pricing: pricing && typeof pricing.prompt === "string" && typeof pricing.completion === "string"
        ? {
          prompt: pricing.prompt,
          completion: pricing.completion,
          inputCacheRead: typeof pricing.input_cache_read === "string" ? pricing.input_cache_read : null,
          inputCacheWrite: typeof pricing.input_cache_write === "string" ? pricing.input_cache_write : null,
        }
        : null,
      created: typeof m.created === "number" ? m.created : null,
    };
  }).filter(m => m.id !== "");
  modelsCache = { fetchedAt: Date.now(), models };
  return models;
}

export async function searchOpenRouterModels(search: string, limit: number = 50): Promise<OpenRouterModel[]> {
  const models = await fetchOpenRouterModels();
  const q = search.trim().toLowerCase();
  const filtered = q === "" ? models : models.filter(m =>
    m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
  );
  return filtered.slice(0, limit);
}

export type StepTokenUsage = {
  inputTokens?: bigint | number,
  outputTokens?: bigint | number,
  cacheReadTokens?: bigint | number,
  cacheCreationTokens?: bigint | number,
};

/**
 * Price a step the way OpenRouter actually bills it: token counts times the
 * model's listed per-token rates (cache reads/writes have their own rates).
 * Claude Code's self-reported `total_cost_usd` can't be trusted here — it
 * prices against its built-in Anthropic table, which knows nothing about
 * OpenRouter slugs or OpenRouter billing. Returns a fixed-precision string
 * (matching the stored costUsd format), or undefined when usage or pricing is
 * unavailable so callers can fall back instead of storing a bogus number.
 */
export async function computeOpenRouterCostUsd(modelId: string, usage: StepTokenUsage): Promise<string | undefined> {
  const input = Number(usage.inputTokens ?? 0);
  const output = Number(usage.outputTokens ?? 0);
  const cacheRead = Number(usage.cacheReadTokens ?? 0);
  const cacheCreation = Number(usage.cacheCreationTokens ?? 0);
  if (input + output + cacheRead + cacheCreation === 0) return undefined;
  let pricing: OpenRouterModel["pricing"];
  try {
    pricing = (await fetchOpenRouterModels()).find(m => m.id === modelId)?.pricing ?? null;
  } catch {
    return undefined;
  }
  if (!pricing) return undefined;
  // Models without listed cache rates don't support caching (those token
  // counts stay 0), so falling back to the prompt rate never miscounts.
  const cost = input * Number.parseFloat(pricing.prompt)
    + output * Number.parseFloat(pricing.completion)
    + cacheRead * Number.parseFloat(pricing.inputCacheRead ?? pricing.prompt)
    + cacheCreation * Number.parseFloat(pricing.inputCacheWrite ?? pricing.prompt);
  return Number.isFinite(cost) ? cost.toFixed(6) : undefined;
}

// Pre-flight check that the OpenRouter key is actually accepted. Claude Code
// retries 401s forever, so without this a dead/expired key just produces an
// endless "api_retry" worklog until the sandbox times out. Calling this before
// a run starts turns that into an immediate, actionable error.
export async function assertOpenRouterKeyValid(): Promise<void> {
  const apiKey = getOpenRouterApiKey();
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}`, accept: "application/json" },
    });
  } catch (cause) {
    throw new Error(`Could not reach OpenRouter to validate the API key: ${String(cause)}`);
  }
  if (response.status === 401) {
    throw new Error(
      "OpenRouter rejected STACK_OPENROUTER_API_KEY (401). The key is invalid, revoked, or from a " +
      "different account. Set a valid key (https://openrouter.ai/keys, with credits) in apps/internal-tool/.env.local."
    );
  }
  if (!response.ok) {
    throw new Error(`OpenRouter key validation failed: ${response.status} ${response.statusText}`);
  }
}

export function openRouterAnthropicAuth(model: string): { authToken: string, baseUrl: string, model: string } {
  const apiKey = getOpenRouterApiKey();
  return {
    authToken: apiKey,
    baseUrl: "https://openrouter.ai/api",
    model,
  };
}
