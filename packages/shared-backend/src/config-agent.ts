import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "path";

const DEFAULT_PROXY_URL = "https://api.hexclave.com/api/v1/integrations/ai-proxy";
const ANTHROPIC_PROXY_BASE_URL: string = process.env.STACK_CLAUDE_PROXY_URL ?? DEFAULT_PROXY_URL;

export type ClaudeAgentToolName = "Read" | "Write" | "Edit" | "MultiEdit" | "NotebookEdit" | "Bash" | "Glob" | "Grep";

type ClaudeAgentHookResult = { continue: true } | {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: string,
  },
};

export type ClaudeAgentPreToolUseInput = {
  hook_event_name: "PreToolUse",
  tool_name: string,
  tool_input: unknown,
};

export type RunClaudeAgentOptions = {
  prompt: string,
  cwd: string,
  allowedTools: ClaudeAgentToolName[],
  timeoutMs?: number,
  strictIsolation?: boolean,
  stderr?: (data: string) => void,
  onMessage?: (message: unknown) => void,
  onPreToolUse?: (input: ClaudeAgentPreToolUseInput) => Promise<ClaudeAgentHookResult> | ClaudeAgentHookResult,
};

export type RunClaudeAgentResult = {
  resultText: string,
};

export class ClaudeAgentTimeoutError extends Error {
  constructor(timeoutMs?: number) {
    super(`Claude agent timed out${timeoutMs == null ? "" : ` after ${timeoutMs}ms`}.`);
    this.name = "ClaudeAgentTimeoutError";
  }
}

export class ClaudeAgentFailureError extends Error {
  constructor(subtype: string) {
    super(`Claude agent failed (${subtype}).`);
    this.name = "ClaudeAgentFailureError";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function stripClaudeCodeEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  // CLAUDECODE must be unset for nested agents; ANTHROPIC_API_KEY must be non-empty (proxy ignores it).
  delete env.CLAUDECODE;
  return env;
}

export async function runHeadlessClaudeAgent(options: RunClaudeAgentOptions): Promise<RunClaudeAgentResult> {
  const abortController = new AbortController();
  const timeout = options.timeoutMs == null ? null : setTimeout(() => abortController.abort(), options.timeoutMs);
  let sawResult = false;
  let resultText = "";
  const onPreToolUse = options.onPreToolUse;
  try {
    for await (const message of query({
      prompt: options.prompt,
      options: {
        model: "nvidia/nemotron-3-super-120b-a12b:nitro",
        ...(options.strictIsolation === true ? {
          settingSources: [],
          strictMcpConfig: true,
        } : {}),
        ...(onPreToolUse == null ? {} : {
          hooks: {
            PreToolUse: [{
              hooks: [async (input) => {
                if (input.hook_event_name !== "PreToolUse") {
                  return { continue: true };
                }
                return await onPreToolUse(input);
              }],
            }],
          },
        }),
        allowedTools: options.allowedTools,
        permissionMode: "dontAsk",
        cwd: options.cwd,
        abortController,
        env: {
          ...stripClaudeCodeEnv(),
          ...(options.strictIsolation === true ? { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } : {}),
          ANTHROPIC_BASE_URL: ANTHROPIC_PROXY_BASE_URL,
          ANTHROPIC_API_KEY: "stack-auth-proxy",
        },
        stderr: options.stderr,
      },
    })) {
      options.onMessage?.(message);
      if (message.type === "result") {
        if ("result" in message) {
          sawResult = true;
          resultText = message.result;
        } else {
          throw new ClaudeAgentFailureError(message.subtype);
        }
      }
    }
  } catch (error) {
    if (abortController.signal.aborted && isAbortError(error)) {
      throw new ClaudeAgentTimeoutError(options.timeoutMs ?? undefined);
    }
    throw error;
  } finally {
    if (timeout != null) {
      clearTimeout(timeout);
    }
  }
  if (!sawResult) {
    throw new Error("Claude agent ended without reporting a result.");
  }
  return { resultText };
}

// Only the tools actually in the agent's allowedTools list; MultiEdit and
// NotebookEdit are intentionally excluded from the agent's tool set.
const FILE_MUTATING_TOOLS = new Set(["Write", "Edit"]);

function hasStringFilePath(input: unknown): input is { file_path: string } {
  return typeof input === "object" && input !== null && "file_path" in input && typeof input.file_path === "string";
}

export function getToolWriteTargetPath(toolName: string, toolInput: unknown, cwd: string): string | null {
  if (!FILE_MUTATING_TOOLS.has(toolName) || !hasStringFilePath(toolInput)) {
    return null;
  }
  return path.isAbsolute(toolInput.file_path) ? toolInput.file_path : path.resolve(cwd, toolInput.file_path);
}

export function isPathInsideDir(dir: string, target: string): boolean {
  const relative = path.relative(path.resolve(dir), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
