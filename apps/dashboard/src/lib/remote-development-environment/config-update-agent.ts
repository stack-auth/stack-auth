import "server-only";

import { query } from "@anthropic-ai/claude-agent-sdk";

/**
 * Headless agent runner used to apply config updates in place (see
 * `updateConfigObject`). Mirrors the CLI's `runClaudeAgent`
 * (`packages/stack-cli/src/lib/claude-agent.ts`) but without the interactive
 * spinner UI, since this runs inside the local dashboard server rather than a
 * terminal.
 *
 * Requests are routed through the Hexclave AI proxy, so no Anthropic API key is
 * required on the user's machine. The proxy URL can be overridden with
 * `STACK_CLAUDE_PROXY_URL` (the same env var the CLI reads, so both share one
 * configuration point).
 */
const DEFAULT_PROXY_URL = "https://api.hexclave.com/api/v1/integrations/ai-proxy";
const ANTHROPIC_PROXY_BASE_URL: string = process.env.STACK_CLAUDE_PROXY_URL ?? DEFAULT_PROXY_URL;

const LOG_PREFIX = "[Stack RDE]";

// Upper bound on how long the agent may run before we abort it, so a stuck or
// runaway agent can't hang the dashboard's config-update request forever.
// Overridable for slow environments via STACK_CONFIG_UPDATE_AGENT_TIMEOUT_MS.
const DEFAULT_AGENT_TIMEOUT_MS = 120_000;
const AGENT_TIMEOUT_MS: number = (() => {
  const raw = process.env.STACK_CONFIG_UPDATE_AGENT_TIMEOUT_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_AGENT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid STACK_CONFIG_UPDATE_AGENT_TIMEOUT_MS: ${JSON.stringify(raw)}. Expected a positive number of milliseconds.`);
  }
  return parsed;
})();

function stripClaudeCodeEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  // Removing CLAUDECODE prevents the SDK from detecting a nested agent. The
  // ANTHROPIC_API_KEY must be non-empty or users without Claude Code installed
  // hit a login error (it is ignored by the proxy).
  delete env.CLAUDECODE;
  return env;
}

/**
 * Runs the coding agent with the given prompt in `cwd` and resolves once it
 * finishes. Throws if the agent reports an error result or the SDK stream
 * itself fails — callers must additionally validate the resulting files, since
 * a "success" result does not guarantee the edits are semantically correct.
 */
export async function runConfigUpdateAgent(options: {
  prompt: string,
  cwd: string,
}): Promise<void> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), AGENT_TIMEOUT_MS);
  // Marks whether we observed a terminal "result" message from the SDK. The
  // stream can otherwise end without one (e.g. the process dies), which we must
  // treat as a failure rather than silently succeeding.
  let sawResult = false;
  try {
    for await (const message of query({
      prompt: options.prompt,
      options: {
        // Bash is intentionally omitted: applying a config delta only needs file
        // inspection and editing, and withholding shell access reduces the blast
        // radius of running an agent against the user's project.
        allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
        permissionMode: "dontAsk",
        cwd: options.cwd,
        abortController,
        env: {
          ...stripClaudeCodeEnv(),
          ANTHROPIC_BASE_URL: ANTHROPIC_PROXY_BASE_URL,
          ANTHROPIC_API_KEY: "stack-auth-proxy",
        },
        stderr: (data: string) => { console.warn(`${LOG_PREFIX} [agent] ${data}`); },
      },
    })) {
      // Detect the terminal message via `"result" in message` to match the CLI
      // (`runClaudeAgent`); only a successful result carries a `result` field,
      // so any other terminal subtype is reported as a failure.
      if ("result" in message) {
        sawResult = true;
      } else if (message.type === "result") {
        throw new Error(`Config update agent failed (${message.subtype}). It was unable to apply the config changes to the file.`);
      }
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error(`Config update agent timed out after ${AGENT_TIMEOUT_MS}ms. It was unable to apply the config changes to the file.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!sawResult) {
    throw new Error("Config update agent ended without reporting a result. It was unable to apply the config changes to the file.");
  }
}
