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

export type SandboxCredentials = {
  teamId: string | undefined,
  projectId: string | undefined,
  token: string | undefined,
};

export function getSandboxCredentials(): SandboxCredentials {
  const token = readEnv("STACK_VERCEL_SANDBOX_TOKEN");
  if (!token || token === "vercel_sandbox_disabled_for_local_development") {
    throw new Error(
      "Vercel Sandbox is not configured. Set STACK_VERCEL_SANDBOX_TOKEN, STACK_VERCEL_SANDBOX_TEAM_ID and " +
      "STACK_VERCEL_SANDBOX_PROJECT_ID in apps/internal-tool (same values as apps/backend) to run evals."
    );
  }
  const teamId = readEnv("STACK_VERCEL_SANDBOX_TEAM_ID");
  const projectId = readEnv("STACK_VERCEL_SANDBOX_PROJECT_ID");
  // Vercel uses opaque, prefixed identifiers. A project *name* or *slug*
  // (e.g. "internal-tool") is silently accepted by the SDK but the Sandbox API
  // then returns a bare "Status code 404" — surface the real cause here instead.
  if (teamId && !teamId.startsWith("team_")) {
    throw new Error(
      `STACK_VERCEL_SANDBOX_TEAM_ID must be a Vercel team ID (starts with "team_"), got "${teamId}". ` +
      "Find it in Vercel → Team Settings → General."
    );
  }
  if (projectId && !projectId.startsWith("prj_")) {
    throw new Error(
      `STACK_VERCEL_SANDBOX_PROJECT_ID must be a Vercel project ID (starts with "prj_"), got "${projectId}". ` +
      "This is the project's ID — not its name/slug — found in Vercel → Project → Settings → General."
    );
  }
  return { teamId, projectId, token };
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
