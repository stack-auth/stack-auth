import "server-only";

import path from "path";
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

/**
 * True for the error produced when an `AbortController` aborts an awaited
 * operation. The SDK surfaces this as either a real `AbortError` or a
 * `DOMException` whose `name` is `"AbortError"`.
 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

// The file-mutating tools we allow the agent to use, each of which takes the
// target file in a `file_path` field. We watch these so callers can snapshot a
// file for rollback *before* the agent overwrites it.
const FILE_MUTATING_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

function hasStringFilePath(input: unknown): input is { file_path: string } {
  return typeof input === "object" && input !== null && "file_path" in input && typeof input.file_path === "string";
}

/**
 * Returns the absolute path a file-mutating tool call is about to write, or
 * `null` if the tool doesn't write a file. Relative paths are resolved against
 * the agent's `cwd` to match where the tool will actually write.
 */
function getToolWriteTargetPath(toolName: string, toolInput: unknown, cwd: string): string | null {
  if (!FILE_MUTATING_TOOLS.has(toolName) || !hasStringFilePath(toolInput)) {
    return null;
  }
  return path.isAbsolute(toolInput.file_path) ? toolInput.file_path : path.resolve(cwd, toolInput.file_path);
}

/**
 * True if `target` resolves to a location inside `dir` (or is `dir` itself). Used
 * to keep the agent's writes confined to the config directory: the SDK's `cwd`
 * only controls how relative paths resolve, it is not a sandbox, so the boundary
 * has to be checked explicitly.
 */
function isPathInsideDir(dir: string, target: string): boolean {
  const relative = path.relative(path.resolve(dir), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

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
  // Called with the absolute path of each file the agent is about to write or
  // edit, *before* the change happens, so the caller can capture the original
  // content for rollback even when the file isn't statically referenced by the
  // config (a new file, or an existing-but-unimported file).
  onFileWillChange?: (filePath: string) => void,
}): Promise<void> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), AGENT_TIMEOUT_MS);
  // Marks whether we observed a terminal "result" message from the SDK. The
  // stream can otherwise end without one (e.g. the process dies), which we must
  // treat as a failure rather than silently succeeding.
  let sawResult = false;
  // Absolute paths the agent tried to write *outside* its working directory.
  // These are denied as they happen (see the PreToolUse hook) and then surfaced
  // as a hard failure after the run, so an attempt to escape the config
  // directory fails loudly instead of silently applying a partial update.
  const deniedOutOfBoundsWrites = new Set<string>();
  try {
    for await (const message of query({
      prompt: options.prompt,
      options: {
        // Don't inherit user/project/local Claude settings or MCP configs — this
        // runs server-side so it must be fully isolated from the host environment.
        settingSources: [],
        strictMcpConfig: true,
        hooks: {
          PreToolUse: [{
            hooks: [async (input) => {
              if (input.hook_event_name !== "PreToolUse") return { continue: true };
              const target = getToolWriteTargetPath(input.tool_name, input.tool_input, options.cwd);
              if (target == null) return { continue: true };
              // Confine the agent's writes to the config directory. `cwd` only
              // sets where relative paths resolve; it is not a sandbox, so with
              // Write/Edit enabled the agent could otherwise overwrite arbitrary
              // files (an absolute path, or a `../` escape resolved from an
              // import). Deny any write that lands outside `cwd` and record it so
              // the whole run fails afterwards.
              if (!isPathInsideDir(options.cwd, target)) {
                deniedOutOfBoundsWrites.add(target);
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason: `Refusing to modify ${target}: config updates may only change files inside the config directory.`,
                  },
                };
              }
              // Capture the original content for rollback before the write lands.
              options.onFileWillChange?.(target);
              return { continue: true };
            }],
          }],
        },
        // Bash is intentionally omitted: applying a config delta only needs file
        // inspection and editing, and withholding shell access reduces the blast
        // radius of running an agent against the user's project.
        allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
        permissionMode: "dontAsk",
        cwd: options.cwd,
        abortController,
        env: {
          ...stripClaudeCodeEnv(),
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
          ANTHROPIC_BASE_URL: ANTHROPIC_PROXY_BASE_URL,
          ANTHROPIC_API_KEY: "stack-auth-proxy",
        },
        stderr: (data: string) => { console.warn(`${LOG_PREFIX} [agent] ${data}`); },
      },
    })) {
      // Only the terminal `result` message signals completion; a successful one
      // carries a `result` field, so any other `result`-type subtype is a
      // failure. Gating both branches on `type === "result"` avoids treating an
      // intermediate message that happens to carry a `result` property as done.
      if (message.type === "result") {
        if ("result" in message) {
          sawResult = true;
        } else {
          throw new Error(`Config update agent failed (${message.subtype}). It was unable to apply the config changes to the file.`);
        }
      }
    }
  } catch (error) {
    // Only translate to a timeout error when the failure is the abort we
    // triggered; otherwise a real agent error that races with the timeout would
    // be masked by the generic "timed out" message.
    if (abortController.signal.aborted && isAbortError(error)) {
      throw new Error(`Config update agent timed out after ${AGENT_TIMEOUT_MS}ms. It was unable to apply the config changes to the file.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (deniedOutOfBoundsWrites.size > 0) {
    throw new Error(`Config update agent tried to modify ${deniedOutOfBoundsWrites.size} file(s) outside the config directory, which is not allowed: ${[...deniedOutOfBoundsWrites].join(", ")}. The config was not updated.`);
  }
  if (!sawResult) {
    throw new Error("Config update agent ended without reporting a result. It was unable to apply the config changes to the file.");
  }
}
