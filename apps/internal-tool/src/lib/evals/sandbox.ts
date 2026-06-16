// Freestyle VM helpers for eval runs. Each eval run gets one disposable VM
// with a long idle timeout, a shared workspace, and PTY-backed streaming for
// long agent steps.

import type { HarnessV1NetworkSandboxSession, HarnessV1SandboxProvider } from "@ai-sdk/harness";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { Freestyle } from "freestyle";
import { getFreestyleApiKey } from "./config";
import { ResumableLogDemuxer } from "./log-stream";

export const SANDBOX_CWD = "/freestyle/sandbox";
export const WORKSPACE_DIR = `${SANDBOX_CWD}/workspace`;
export const EVAL_DIR = `${SANDBOX_CWD}/.eval`;

export const DEFAULT_RUN_TIMEOUT_MINUTES = 45;
export const MAX_RUN_TIMEOUT_MINUTES = 300;

type CreatedVm = Awaited<ReturnType<Freestyle["vms"]["create"]>>;
export type EvalSandbox = CreatedVm["vm"] & { sandboxId: string };

export type RunningCommand = {
  kill: () => Promise<void> | void,
};

function getFreestyleClient(): Freestyle {
  return new Freestyle({ apiKey: getFreestyleApiKey() });
}

function withSandboxId(vm: CreatedVm["vm"], vmId: string): EvalSandbox {
  return Object.assign(vm, { sandboxId: vmId });
}

export async function createEvalSandbox(options: { timeoutMinutes: number }): Promise<EvalSandbox> {
  const timeoutMinutes = Math.min(Math.max(options.timeoutMinutes, 5), MAX_RUN_TIMEOUT_MINUTES);
  const { vm, vmId } = await getFreestyleClient().vms.create({
    name: "hexclave-eval",
    idleTimeoutSeconds: timeoutMinutes * 60,
  });
  return withSandboxId(vm, vmId);
}

export async function getEvalSandbox(sandboxId: string): Promise<EvalSandbox> {
  const { vm } = await getFreestyleClient().vms.get({ vmId: sandboxId });
  return withSandboxId(vm, sandboxId);
}

export function createFreestyleHarnessSandboxProvider(sandbox: EvalSandbox): HarnessV1SandboxProvider {
  return new FreestyleHarnessSandboxProvider(sandbox);
}

type RestrictedHarnessSession = ReturnType<HarnessV1NetworkSandboxSession["restricted"]>;

class FreestyleHarnessSandboxProvider implements HarnessV1SandboxProvider {
  readonly specificationVersion = "harness-sandbox-v1";
  readonly providerId = "freestyle-sandbox";

  private readonly portDomains = new Map<number, string>();

  constructor(private readonly sandbox: EvalSandbox) {}

  createSession = async (options?: {
    sessionId?: string,
    abortSignal?: AbortSignal,
    identity?: string,
    onFirstCreate?: (session: RestrictedHarnessSession, opts: { abortSignal?: AbortSignal }) => Promise<void>,
  }): Promise<HarnessV1NetworkSandboxSession> => {
    const session = this.createNetworkSession();
    if (options?.onFirstCreate) {
      await options.onFirstCreate(session.restricted(), { abortSignal: options.abortSignal });
    }
    return session;
  };

  private createNetworkSession(): HarnessV1NetworkSandboxSession {
    const restricted = new FreestyleRestrictedSandboxSession(this.sandbox);
    return Object.assign(restricted, {
      id: this.sandbox.sandboxId,
      defaultWorkingDirectory: SANDBOX_CWD,
      ports: [41245],
      getPortUrl: async ({ port, protocol }: { port: number, protocol?: "http" | "https" | "ws" }) => {
        const domain = await this.ensurePreviewDomain(port);
        const urlProtocol = protocol === "ws" ? "wss" : "https";
        return `${urlProtocol}://${domain}`;
      },
      stop: async () => {
        // The eval run owns the Freestyle VM lifecycle; individual harness
        // sessions should only let their adapter tear down bridge processes.
      },
      destroy: async () => {
        await this.deletePreviewDomains();
      },
      restricted: () => restricted,
    });
  }

  private async ensurePreviewDomain(port: number): Promise<string> {
    const existing = this.portDomains.get(port);
    if (existing) return existing;
    const domain = `hexclave-eval-${this.sandbox.sandboxId.slice(0, 10)}-${port}-${randomUUID().slice(0, 8)}.style.dev`;
    await getFreestyleClient().domains.mappings.create({
      domain,
      vmId: this.sandbox.sandboxId,
      vmPort: port,
    });
    this.portDomains.set(port, domain);
    return domain;
  }

  private async deletePreviewDomains(): Promise<void> {
    const freestyle = getFreestyleClient();
    for (const domain of this.portDomains.values()) {
      try {
        await freestyle.domains.mappings.delete({ domain });
      } catch {
        // The sandbox is disposable; stale preview mappings are best-effort cleanup.
      }
    }
    this.portDomains.clear();
  }
}

// Freestyle VMs run every command as root (uid 0). The harness drives Claude
// Code with permissionMode "allow-all" -> `--dangerously-skip-permissions`,
// which Claude Code refuses under root ("cannot be used with root/sudo
// privileges for security reasons") and exits 1 before doing any work. Setting
// IS_SANDBOX=1 is Claude Code's documented escape hatch for sandboxed roots: it
// permits skip-permissions as root. The harness spawns its bridge through this
// session, and the bridge spawns claude with `{ ...process.env }`, so injecting
// it here propagates all the way down to the claude process.
const SANDBOX_SESSION_ENV: Record<string, string> = { IS_SANDBOX: "1" };

// The setup step symlinks node/npm/pnpm/pnpx/turbo into /usr/local/bin (the nvm
// bin dir is not on PATH). Commands the harness drives — most importantly the
// claude-code harness bootstrap's `pnpm install` — run through `sandbox.exec`
// as a fresh `bash -lc`, whose login-profile PATH does not always include
// /usr/local/bin, so they fail with "pnpm: command not found" (exit 127).
// Prepending /usr/local/bin AFTER the profile has loaded guarantees every tool
// the setup step installed is reachable, regardless of the base image's profile.
const SANDBOX_PATH_PREFIX = `/usr/local/bin`;
function withSandboxPath(command: string): string {
  return `export PATH="${SANDBOX_PATH_PREFIX}:$PATH"; ${command}`;
}

class FreestyleRestrictedSandboxSession {
  constructor(private readonly sandbox: EvalSandbox) {}

  get description(): string {
    return `Freestyle VM sandbox ${this.sandbox.sandboxId}; cwd defaults to ${SANDBOX_CWD}.`;
  }

  async run(params: {
    command: string,
    workingDirectory?: string,
    env?: Record<string, string>,
    abortSignal?: AbortSignal,
  }): Promise<{ exitCode: number, stdout: string, stderr: string }> {
    params.abortSignal?.throwIfAborted();
    const result = await this.sandbox.exec({
      command: buildShellCommand({
        cmd: "bash",
        args: ["-lc", withSandboxPath(params.command)],
        cwd: params.workingDirectory,
        env: { ...SANDBOX_SESSION_ENV, ...params.env },
      }),
      timeoutMs: 120_000,
    });
    params.abortSignal?.throwIfAborted();
    return {
      exitCode: result.statusCode ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  async spawn(params: {
    command: string,
    workingDirectory?: string,
    env?: Record<string, string>,
    abortSignal?: AbortSignal,
  }): Promise<{
    stdout: ReadableStream<Uint8Array>,
    stderr: ReadableStream<Uint8Array>,
    wait: () => Promise<{ exitCode: number }>,
    kill: () => Promise<void>,
  }> {
    params.abortSignal?.throwIfAborted();
    let stdoutController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let stderrController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let exitCode = null as number | null;
    let exited = false;

    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        stdoutController = controller;
      },
    });
    const stderr = new ReadableStream<Uint8Array>({
      start(controller) {
        stderrController = controller;
      },
    });

    const session = await this.sandbox.pty.open({
      cols: 120,
      rows: 40,
      exec: "/bin/bash",
      reconnect: { maxAttempts: 10, baseDelayMs: 500, maxDelayMs: 8000 },
      onData: bytes => {
        stdoutController?.enqueue(bytes);
      },
      onExit: code => {
        exitCode = code;
        exited = true;
        stdoutController?.close();
        stderrController?.close();
      },
      onError: error => {
        stdoutController?.error(error);
        stderrController?.error(error);
      },
    });

    const abort = () => {
      try {
        session.signal("SIGKILL");
      } catch {
        // The PTY may already have exited.
      }
    };
    params.abortSignal?.addEventListener("abort", abort, { once: true });
    session.write(`stty -echo 2>/dev/null || true\n`);
    session.write(`${buildShellCommand({
      cmd: "bash",
      args: ["-lc", withSandboxPath(params.command)],
      cwd: params.workingDirectory,
      env: { ...SANDBOX_SESSION_ENV, ...params.env },
    })}\nexit\n`);

    return {
      stdout,
      stderr,
      wait: async () => {
        try {
          while (!exited && !params.abortSignal?.aborted) {
            await delay(250);
          }
          params.abortSignal?.throwIfAborted();
          return { exitCode: exitCode ?? 1 };
        } finally {
          params.abortSignal?.removeEventListener("abort", abort);
          try {
            session.detach();
          } catch {
            // Already closed.
          }
        }
      },
      kill: async () => {
        abort();
      },
    };
  }

  async readFile(params: { path: string, abortSignal?: AbortSignal }): Promise<ReadableStream<Uint8Array> | null> {
    const content = await this.readBinaryFile(params);
    if (!content) return null;
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(content);
        controller.close();
      },
    });
  }

  async readBinaryFile(params: { path: string, abortSignal?: AbortSignal }): Promise<Uint8Array | null> {
    params.abortSignal?.throwIfAborted();
    if (!(await this.sandbox.fs.exists(params.path))) return null;
    return await this.sandbox.fs.readFile(params.path);
  }

  async readTextFile(params: { path: string, encoding?: string, startLine?: number, endLine?: number, abortSignal?: AbortSignal }): Promise<string | null> {
    params.abortSignal?.throwIfAborted();
    if (!(await this.sandbox.fs.exists(params.path))) return null;
    const text = await this.sandbox.fs.readTextFile(params.path);
    if (params.startLine === undefined && params.endLine === undefined) return text;
    const start = Math.max((params.startLine ?? 1) - 1, 0);
    return text.split("\n").slice(start, params.endLine).join("\n");
  }

  async writeFile(params: { path: string, content: ReadableStream<Uint8Array>, abortSignal?: AbortSignal }): Promise<void> {
    params.abortSignal?.throwIfAborted();
    await this.writeBinaryFile({ path: params.path, content: await collectStream(params.content), abortSignal: params.abortSignal });
  }

  async writeBinaryFile(params: { path: string, content: Uint8Array, abortSignal?: AbortSignal }): Promise<void> {
    params.abortSignal?.throwIfAborted();
    await this.sandbox.fs.writeFile(params.path, Buffer.from(params.content));
  }

  async writeTextFile(params: { path: string, content: string, encoding?: string, abortSignal?: AbortSignal }): Promise<void> {
    params.abortSignal?.throwIfAborted();
    const encoding = params.encoding;
    await this.sandbox.fs.writeFile(params.path, Buffer.from(params.content, encoding && Buffer.isEncoding(encoding) ? encoding : "utf-8"));
  }
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
  onCommand?: (command: RunningCommand) => void,
};

const DEFAULT_CAPTURE_LIMIT = 200_000;
const PTY_OPEN_TIMEOUT_MS = 30_000;

// Freestyle's non-PTY exec buffers output until the command exits. For agent
// steps we need live output, so run the command through a PTY and print a
// private exit-code sentinel before closing the shell.
export async function runStreamedCommand(sandbox: EvalSandbox, params: StreamedCommandParams): Promise<{ exitCode: number }> {
  const demuxer = new ResumableLogDemuxer(params.onStdoutLine, params.onStderrLine);
  const exitPrefix = `__HEXCLAVE_EVAL_EXIT_${randomUUID().replaceAll("-", "_")}__=`;
  let exitCode = null as number | null;
  let finished = false as boolean;
  let exitScanBuffer = "";
  demuxer.beginConnection();

  const session = await withTimeout(
    sandbox.pty.open({
      cols: 120,
      rows: 40,
      exec: "/bin/bash",
      reconnect: { maxAttempts: 10, baseDelayMs: 500, maxDelayMs: 8000 },
      onData: bytes => {
        const text = Buffer.from(bytes).toString("utf-8");
        demuxer.push("stdout", text);
        exitScanBuffer = (exitScanBuffer + text).slice(-2000);
        const sentinelIndex = exitScanBuffer.lastIndexOf(exitPrefix);
        if (sentinelIndex !== -1) {
          const codeText = exitScanBuffer.slice(sentinelIndex + exitPrefix.length).match(/\d+/)?.[0];
          if (codeText !== undefined) exitCode = Number.parseInt(codeText, 10);
        }
      },
      onExit: code => {
        if (exitCode === null) exitCode = code;
        finished = true;
      },
    }),
    PTY_OPEN_TIMEOUT_MS,
    "Timed out opening Freestyle PTY session",
  );

  const kill = () => {
    try {
      session.signal("SIGKILL");
    } catch {
      // The session may already have exited.
    }
  };
  params.onCommand?.({ kill });

  const abort = () => kill();
  params.signal?.addEventListener("abort", abort, { once: true });
  try {
    session.write(`stty -echo 2>/dev/null || true\n`);
    session.write(`${buildShellCommand(params)}\nprintf '\\n${exitPrefix}%s\\n' "$?"\nexit\n`);
    while (!finished && !params.signal?.aborted) {
      await delay(250);
    }
    if (params.signal?.aborted) {
      kill();
      throw new Error("Command aborted");
    }
  } finally {
    params.signal?.removeEventListener("abort", abort);
    demuxer.flush();
    try {
      session.detach();
    } catch {
      // Already closed.
    }
  }

  return { exitCode: exitCode ?? 1 };
}

export type CapturedCommandResult = {
  exitCode: number,
  stdout: string,
  stderr: string,
  truncated: boolean,
};

// Runs a shell command and captures (size-capped) output; used by the control
// chat agent's exec tool and the run-detail exec console.
export async function runCapturedCommand(
  sandbox: EvalSandbox,
  shellCommand: string,
  options?: { cwd?: string, env?: Record<string, string>, maxOutputChars?: number, signal?: AbortSignal },
): Promise<CapturedCommandResult> {
  if (options?.signal?.aborted) throw new Error("Command aborted");
  const result = await sandbox.exec({
    command: buildShellCommand({
      cmd: "bash",
      args: ["-lc", withSandboxPath(shellCommand)],
      cwd: options?.cwd ?? WORKSPACE_DIR,
      env: options?.env,
    }),
    timeoutMs: 120_000,
  });
  if (options?.signal?.aborted) throw new Error("Command aborted");
  const limit = options?.maxOutputChars ?? DEFAULT_CAPTURE_LIMIT;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const truncated = stdout.length > limit || stderr.length > limit;
  return {
    exitCode: result.statusCode ?? 1,
    stdout: stdout.slice(0, limit),
    stderr: stderr.slice(0, limit),
    truncated,
  };
}

export async function writeSandboxFile(sandbox: EvalSandbox, path: string, content: string): Promise<void> {
  await sandbox.fs.writeFile(path, Buffer.from(content, "utf-8"));
}

export async function readSandboxFile(sandbox: EvalSandbox, path: string, maxChars: number = 2_000_000): Promise<string | null> {
  const exists = await sandbox.fs.exists(path);
  if (!exists) return null;
  const text = await sandbox.fs.readTextFile(path);
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function buildShellCommand(params: Pick<StreamedCommandParams, "cmd" | "args" | "cwd" | "env">): string {
  const envPrefix = Object.entries(params.env ?? {})
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  const command = [params.cmd, ...(params.args ?? [])].map(shellQuote).join(" ");
  const cd = params.cwd ? `cd ${shellQuote(params.cwd)} && ` : "";
  const env = envPrefix ? `${envPrefix} ` : "";
  return `${cd}${env}${command}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
