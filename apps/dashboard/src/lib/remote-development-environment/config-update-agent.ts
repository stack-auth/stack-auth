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

function stripClaudeCodeEnv(): Record<string, string> {
  const env = { ...process.env };
  // Removing CLAUDECODE prevents the SDK from detecting a nested agent. The
  // ANTHROPIC_API_KEY must be non-empty or users without Claude Code installed
  // hit a login error (it is ignored by the proxy).
  delete env.CLAUDECODE;
  return env as Record<string, string>;
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
  for await (const message of query({
    prompt: options.prompt,
    options: {
      // Bash is intentionally omitted: applying a config delta only needs file
      // inspection and editing, and withholding shell access reduces the blast
      // radius of running an agent against the user's project.
      allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
      permissionMode: "dontAsk",
      cwd: options.cwd,
      env: {
        ...stripClaudeCodeEnv(),
        ANTHROPIC_BASE_URL: ANTHROPIC_PROXY_BASE_URL,
        ANTHROPIC_API_KEY: "stack-auth-proxy",
      },
      stderr: (data: string) => { console.warn(`${LOG_PREFIX} [agent] ${data}`); },
    },
  })) {
    if (message.type === "result" && (message.is_error || message.subtype !== "success")) {
      throw new Error(`Config update agent failed (${message.subtype}). It was unable to apply the config changes to the file.`);
    }
  }
}
