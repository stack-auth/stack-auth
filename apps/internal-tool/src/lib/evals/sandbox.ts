// Vercel Sandbox helpers for eval runs. Mirrors the engine configuration in
// apps/backend/src/lib/js-execution.tsx (same credentials/env vars), with
// streaming command execution added for long-running agent steps.

import { setTimeout as delay } from "node:timers/promises";
import { Command, Sandbox } from "@vercel/sandbox";
import { getSandboxCredentials } from "./config";
import { ResumableLogDemuxer, isTransientNetworkError } from "./log-stream";

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

// A still-running command's log stream can drop transiently (e.g. ECONNRESET)
// many times over a long step, so the budget counts *consecutive* failures
// without forward progress; it resets whenever a reconnect delivers new output.
const MAX_LOG_STREAM_RECONNECTS = 8;
const MAX_WAIT_RETRIES = 8;
const RECONNECT_BACKOFF_MS = 1000;
const RECONNECT_BACKOFF_CAP_MS = 5000;

// Runs a command detached and streams its output line-by-line. The log stream
// is reconnected on transient network drops (see log-stream.ts) so a flaky
// socket no longer fails an otherwise-healthy step; the authoritative pass/fail
// always comes from the command's exit code via wait().
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

  const demuxer = new ResumableLogDemuxer(params.onStdoutLine, params.onStderrLine);
  let reconnectAttempts = 0;
  let deliveredAtLastFailure = -1;
  while (true) {
    demuxer.beginConnection();
    try {
      for await (const log of command.logs({ signal: params.signal })) {
        demuxer.push(log.stream, log.data);
      }
      break; // stream completed normally
    } catch (error) {
      // Cancellation: stop streaming; wait()/caller abort handling decides the outcome.
      if (params.signal?.aborted) break;
      if (!isTransientNetworkError(error)) throw error;
      // Reset the reconnect budget whenever we've made progress since the last
      // drop, so occasional blips over a long run don't accumulate to failure.
      const delivered = demuxer.deliveredChars;
      if (delivered > deliveredAtLastFailure) reconnectAttempts = 0;
      deliveredAtLastFailure = delivered;
      if (reconnectAttempts >= MAX_LOG_STREAM_RECONNECTS) throw error;
      reconnectAttempts += 1;
      await delay(Math.min(RECONNECT_BACKOFF_MS * reconnectAttempts, RECONNECT_BACKOFF_CAP_MS));
    }
  }
  demuxer.flush();

  const finished = await waitForExit(command, params.signal);
  return { exitCode: finished.exitCode };
}

// Waiting for the exit code is a long-poll that can also drop transiently;
// retry it (it's idempotent — just reports the command's status).
async function waitForExit(command: Command, signal?: AbortSignal): Promise<{ exitCode: number }> {
  let attempts = 0;
  while (true) {
    try {
      return await command.wait({ signal });
    } catch (error) {
      if (signal?.aborted || !isTransientNetworkError(error) || attempts >= MAX_WAIT_RETRIES) throw error;
      attempts += 1;
      await delay(Math.min(RECONNECT_BACKOFF_MS * attempts, RECONNECT_BACKOFF_CAP_MS));
    }
  }
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
