// OpenRouter helpers: model catalog (for the run launcher / chat agent) and
// the env shared by sandboxed Claude Code processes so all inference goes
// through OpenRouter.

import { getOpenRouterApiKey } from "./config";

export type OpenRouterModel = {
  id: string,
  name: string,
  description: string,
  contextLength: number | null,
  pricing: { prompt: string, completion: string } | null,
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
        ? { prompt: pricing.prompt, completion: pricing.completion }
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

// Environment for a `claude` CLI process (inside a sandbox or locally for the
// control agent) so the Anthropic-compatible API surface is served by
// OpenRouter and any OpenRouter model slug can be used.
export function claudeCodeOpenRouterEnv(model: string): Record<string, string> {
  const apiKey = getOpenRouterApiKey();
  return {
    ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_SMALL_FAST_MODEL: model,
    CLAUDE_CODE_SUBAGENT_MODEL: model,
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}
