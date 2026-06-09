// Vercel Sandbox helpers for eval runs. Mirrors the engine configuration in
// apps/backend/src/lib/js-execution.tsx (same credentials/env vars), with
// streaming command execution added for long-running agent steps.

import { Command, Sandbox } from "@vercel/sandbox";
import { getSandboxCredentials } from "./config";

export const SANDBOX_CWD = "/vercel/sandbox";
export const WORKSPACE_DIR = `${SANDBOX_CWD}/workspace`;
export const EVAL_DIR = `${SANDBOX_CWD}/.eval`;

export const DEFAULT_RUN_TIMEOUT_MINUTES = 45;
// Vercel Sandbox hard cap is 5 hours.
export const MAX_RUN_TIMEOUT_MINUTES = 300;

export async function createEvalSandbox(options: { timeoutMinutes: number }): Promise<Sandbox> {
  const credentials = getSandboxCredentials();
  const timeoutMinutes = Math.min(Math.max(options.timeoutMinutes, 5), MAX_RUN_TIMEOUT_MINUTES);
  return await Sandbox.create({
    resources: { vcpus: 4 },
    timeout: timeoutMinutes * 60 * 1000,
    runtime: "node24",
    teamId: credentials.teamId,
    projectId: credentials.projectId,
    token: credentials.token,
  });
}

export async function getEvalSandbox(sandboxId: string): Promise<Sandbox> {
  const credentials = getSandboxCredentials();
  return await Sandbox.get({
    sandboxId,
    teamId: credentials.teamId,
    projectId: credentials.projectId,
    token: credentials.token,
  });
}

export type StreamedCommandParams = {
  cmd: string,
  args?: string[],
  cwd?: string,
  env?: Record<string, string>,
  signal?: AbortSignal,
  onStdoutLine?: (line: string) => void,
  onStderrLine?: (line: string) => void,
  // Invoked once the command has started; lets callers keep a handle for kill().
  onCommand?: (command: Command) => void,
};

// Runs a command detached and streams its output line-by-line.
export async function runStreamedCommand(sandbox: Sandbox, params: StreamedCommandParams): Promise<{ exitCode: number }> {
  const command = await sandbox.runCommand({
    cmd: params.cmd,
    args: params.args,
    cwd: params.cwd,
    env: params.env,
    detached: true,
    signal: params.signal,
  });
  params.onCommand?.(command);

  let stdoutBuffer = "";
  let stderrBuffer = "";
  try {
    for await (const log of command.logs({ signal: params.signal })) {
      if (log.stream === "stdout") {
        stdoutBuffer += log.data;
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim() !== "") params.onStdoutLine?.(line);
        }
      } else {
        stderrBuffer += log.data;
        const lines = stderrBuffer.split("\n");
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim() !== "") params.onStderrLine?.(line);
        }
      }
    }
  } catch (error) {
    // Log streaming aborts when the run is cancelled; the wait() below (or the
    // caller's abort handling) decides the final outcome.
    if (!params.signal?.aborted) throw error;
  }
  if (stdoutBuffer.trim() !== "") params.onStdoutLine?.(stdoutBuffer);
  if (stderrBuffer.trim() !== "") params.onStderrLine?.(stderrBuffer);

  const finished = await command.wait({ signal: params.signal });
  return { exitCode: finished.exitCode };
}

const DEFAULT_CAPTURE_LIMIT = 200_000;

export type CapturedCommandResult = {
  exitCode: number,
  stdout: string,
  stderr: string,
  truncated: boolean,
};

// Runs a shell command and captures (size-capped) output; used by the control
// chat agent's exec tool and the run-detail exec console.
export async function runCapturedCommand(
  sandbox: Sandbox,
  shellCommand: string,
  options?: { cwd?: string, env?: Record<string, string>, maxOutputChars?: number, signal?: AbortSignal },
): Promise<CapturedCommandResult> {
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", shellCommand],
    cwd: options?.cwd ?? WORKSPACE_DIR,
    env: options?.env,
    signal: options?.signal,
  });
  const limit = options?.maxOutputChars ?? DEFAULT_CAPTURE_LIMIT;
  const stdout = await result.stdout({ signal: options?.signal });
  const stderr = await result.stderr({ signal: options?.signal });
  const truncated = stdout.length > limit || stderr.length > limit;
  return {
    exitCode: result.exitCode,
    stdout: stdout.slice(0, limit),
    stderr: stderr.slice(0, limit),
    truncated,
  };
}

export async function writeSandboxFile(sandbox: Sandbox, path: string, content: string): Promise<void> {
  await sandbox.writeFiles([{ path, content: Buffer.from(content, "utf-8") }]);
}

export async function readSandboxFile(sandbox: Sandbox, path: string, maxChars: number = 2_000_000): Promise<string | null> {
  const buffer = await sandbox.readFileToBuffer({ path });
  if (buffer === null) return null;
  const text = buffer.toString("utf-8");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
