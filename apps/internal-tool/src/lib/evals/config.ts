// Server-side configuration for the eval suite. Env var names intentionally
// match apps/backend so values can be copied between .env files.

// The repo's .env template ships every secret as the literal "REPLACE_ME"
// sentinel. Treat it as unset (matching the resolveEnv helpers in the
// SpacetimeDB hooks) so consumers throw a clear "not configured" error up front
// instead of forwarding "REPLACE_ME" to an external API and getting a cryptic
// 403 mid-run.
const PLACEHOLDER = "REPLACE_ME";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === PLACEHOLDER) return undefined;
  return trimmed;
}

// Must match the token injected into the SpacetimeDB module at publish time
// (scripts/spacetime-token.mjs defaults to "change-me" in dev).
export function getLogToken(): string {
  return readEnv("STACK_MCP_LOG_TOKEN") ?? "change-me";
}

export function getOpenRouterApiKey(): string {
  const key = readEnv("STACK_OPENROUTER_API_KEY");
  if (!key || key === "FORWARD_TO_PRODUCTION") {
    throw new Error(
      "STACK_OPENROUTER_API_KEY must be set to a real OpenRouter API key (sk-or-...) in apps/internal-tool to run evals. " +
      "The FORWARD_TO_PRODUCTION sentinel used by the backend proxy is not usable here because sandboxes call OpenRouter directly."
    );
  }
  return key;
}

export function getFreestyleApiKey(): string {
  const apiKey = readEnv("HEXCLAVE_FREESTYLE_API_KEY");
  if (!apiKey) {
    throw new Error(
      "Freestyle VMs are not configured. Set HEXCLAVE_FREESTYLE_API_KEY in apps/internal-tool to run evals."
    );
  }
  return apiKey;
}

export function getSpacetimeHost(): string {
  const prefix = readEnv("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX") ?? "81";
  return readEnv("NEXT_PUBLIC_SPACETIMEDB_HOST") ?? `ws://localhost:${prefix}39`;
}

export function getSpacetimeDbName(): string {
  return readEnv("NEXT_PUBLIC_SPACETIMEDB_DB_NAME") ?? "stack-auth-llm";
}

// Light auth gate for the eval API routes: open in development, token-gated
// in production deployments of the internal tool.
export function checkEvalAccess(request: Request): { ok: true } | { ok: false, reason: string } {
  if (process.env.NODE_ENV === "development") return { ok: true };
  const expected = readEnv("STACK_EVAL_ADMIN_TOKEN");
  if (!expected) {
    return { ok: false, reason: "Eval API is disabled outside development unless STACK_EVAL_ADMIN_TOKEN is set" };
  }
  const provided = request.headers.get("x-eval-admin-token");
  if (provided !== expected) {
    return { ok: false, reason: "Invalid or missing x-eval-admin-token header" };
  }
  return { ok: true };
}
