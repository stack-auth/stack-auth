import { traceSpan } from '@/utils/telemetry';
import { getOptionalRequestAbortSignal } from '@/lib/runtime/request-context';
import { runAsynchronouslyAndWaitUntil } from '@/utils/background-tasks';
import { getEnvVariable, getNodeEnvironment } from '@hexclave/shared/dist/utils/env';
import { HexclaveAssertionError, captureError } from '@hexclave/shared/dist/utils/errors';
import { Result } from '@hexclave/shared/dist/utils/results';
import { Sandbox } from '@vercel/sandbox';
import { Freestyle as FreestyleClient } from 'freestyle';
import type { Vm } from 'freestyle';
import { createHash, randomUUID } from 'node:crypto';

export type ExecuteJavascriptOptions = {
  /** Cancels provider setup, command execution, and fallback attempts. */
  signal?: AbortSignal,
  nodeModules?: Record<string, string>,
  /**
   * Maximum time the caller allows the execution provider to remain alive.
   * Vercel Sandbox enforces this as a whole-sandbox lifetime, so callers
   * running long-lived code must set it explicitly.
   */
  executionTimeoutMs?: number,
  /**
   * Skip the random cross-engine sanity comparison for this invocation.
   * REQUIRED for side-effectful code (e.g. workflow step execution): the
   * sanity test runs the code on BOTH engines, which would double-fire its
   * side effects.
   */
  disableSanityTest?: boolean,
  /**
   * Substitute attached to error reports instead of the raw code. Set this
   * when the code embeds secrets/credentials (e.g. the workflow invocation
   * prelude) so they can never leak into Sentry.
   */
  logSafeCode?: string,
};

export type ExecuteResult =
  | { status: "ok", data: unknown }
  | { status: "error", error: { message: string, stack?: string, cause?: unknown } };

type JsEngine = {
  name: string,
  execute: (code: string, options: ExecuteJavascriptOptions) => Promise<ExecuteResult>,
};

/**
 * Local development and E2E run against docker/dependencies/freestyle-mock, which speaks the
 * serverless-execute contract Freestyle used to expose. Freestyle has since retired that product —
 * its API is VMs now — so the mock is reached with a direct request rather than through the SDK,
 * which no longer has a namespace for it.
 */
const FREESTYLE_MOCK_API_KEY = "mock_stack_freestyle_key";

/** Where run directories live in the guest. One subdirectory per distinct node_modules set. */
const FREESTYLE_EXEC_ROOT = "/opt/hexclave-exec";

/**
 * Base image for the execution VM. Freestyle's Ubuntu images ship Node.js on PATH, so nothing has to
 * be installed before the first run.
 */
const FREESTYLE_DEFAULT_SNAPSHOT = "freestyle/ubuntu";

async function executeOnFreestyleMock(
  code: string,
  options: ExecuteJavascriptOptions,
  baseUrl: string,
): Promise<ExecuteResult> {
  const response = await fetch(`${baseUrl}/execute/v3/script`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      script: code,
      config: { nodeModules: options.nodeModules ?? {}, timeout: options.executionTimeoutMs },
    }),
    signal: options.signal,
  });
  if (!response.ok) {
    throw new HexclaveAssertionError("Freestyle mock returned a non-OK response", {
      status: response.status,
      innerCode: options.logSafeCode ?? code,
    });
  }
  const body = await response.json() as { result?: unknown };
  if (body.result === undefined) {
    throw new HexclaveAssertionError("Freestyle mock returned no result", { innerCode: options.logSafeCode ?? code });
  }
  return body.result as ExecuteResult;
}

/**
 * Names the directory a module set installs into. Runs that need the same packages share a directory
 * and therefore share one `npm install`; runs that need different packages can never see each
 * other's node_modules.
 */
export function freestyleModulesKey(nodeModules: Record<string, string>): string {
  const canonical = Object.entries(nodeModules)
    .map(([name, version]) => `${name}@${version}`)
    .sort()
    .join(",");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * Returns a handle to the shared execution VM, creating it only if it does not already exist.
 *
 * The VM is addressed by slug and reused across invocations. Freestyle pauses it after its idle
 * timeout and resuming restores its memory, so a warm invocation pays about a tenth of a second
 * rather than a boot — which is what makes per-email rendering viable at all.
 */
async function acquireFreestyleVm(freestyle: FreestyleClient, signal: AbortSignal | undefined): Promise<Vm> {
  const slug = getEnvVariable("HEXCLAVE_FREESTYLE_VM_SLUG", "hexclave-js-exec");
  const snapshotId = getEnvVariable("HEXCLAVE_FREESTYLE_VM_SNAPSHOT", FREESTYLE_DEFAULT_SNAPSHOT);

  const startIfNeeded = async (state: string, vm: Vm) => {
    if (state !== "running") {
      await awaitWithAbortSignal(vm.start(), signal);
    }
    return vm;
  };

  try {
    const existing = await awaitWithAbortSignal(freestyle.vms.get(slug), signal);
    return await startIfNeeded(existing.state, freestyle.vms.ref(existing.id));
  } catch (error) {
    signal?.throwIfAborted();
    // Fall through to create. A miss here is the ordinary first-run case, not an error worth reporting.
  }

  try {
    const created = await awaitWithAbortSignal(freestyle.vms.create({
      // A VM reaches nothing it is not allowed to; the guest needs the public internet to npm install.
      firewall: { rules: [{ action: "allow", source: {}, destination: { public: true } }] },
      slug,
      snapshotId,
    }), signal);
    return created.vm;
  } catch (error) {
    signal?.throwIfAborted();
    // Two concurrent cold invocations both miss the lookup above and both try to create the slug;
    // the loser gets a conflict. The winner's VM is the right one to use, so look it up again rather
    // than failing a render over a harmless race.
    const existing = await awaitWithAbortSignal(freestyle.vms.get(slug), signal);
    return await startIfNeeded(existing.state, freestyle.vms.ref(existing.id));
  }
}

async function executeOnFreestyleVm(
  code: string,
  options: ExecuteJavascriptOptions,
  freestyle: FreestyleClient,
): Promise<ExecuteResult> {
  const signal = options.signal;
  const vm = await acquireFreestyleVm(freestyle, signal);

  const nodeModules = options.nodeModules ?? {};
  const workDir = `${FREESTYLE_EXEC_ROOT}/${freestyleModulesKey(nodeModules)}`;
  // Unique per invocation so concurrent renders sharing this directory cannot overwrite each other.
  const runId = randomUUID();
  const codePath = `${workDir}/code-${runId}.mjs`;
  const runnerPath = `${workDir}/runner-${runId}.mjs`;
  const resultPath = `${workDir}/result-${runId}.json`;

  const exec = async (command: string) => await awaitWithAbortSignal(
    vm.exec({ command, timeoutMs: options.executionTimeoutMs }),
    signal,
  );

  try {
    await exec(`mkdir -p ${workDir}`);

    if (Object.keys(nodeModules).length > 0) {
      const packages = Object.entries(nodeModules).map(([name, version]) => `${name}@${version}`).join(" ");
      // Idempotent: the first run in this directory installs, later ones are a no-op resolve.
      const install = await exec(`cd ${workDir} && npm install --no-save --no-audit --no-fund ${packages}`);
      if (install.statusCode !== 0) {
        throw new HexclaveAssertionError("Failed to install packages in the Freestyle VM", {
          exitCode: install.statusCode,
          stderr: install.stderr,
          innerCode: options.logSafeCode ?? code,
        });
      }
    }

    await awaitWithAbortSignal(vm.fs.writeTextFile(codePath, code), signal);
    await awaitWithAbortSignal(vm.fs.writeTextFile(runnerPath, [
      `import { writeFileSync } from 'fs';`,
      `import fn from ${JSON.stringify(codePath)};`,
      `const result = await fn();`,
      `writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result));`,
    ].join("\n")), signal);

    const run = await exec(`cd ${workDir} && node ${runnerPath}`);
    if (run.statusCode !== 0) {
      // statusCode is null when the guest killed the command for exceeding its timeout.
      throw new HexclaveAssertionError("Freestyle VM runner exited with a non-zero code", {
        exitCode: run.statusCode,
        stderr: run.stderr,
        innerCode: options.logSafeCode ?? code,
        innerOptions: options,
      });
    }

    const resultJson = await awaitWithAbortSignal(vm.fs.readTextFile(resultPath), signal);
    try {
      return JSON.parse(resultJson) as ExecuteResult;
    } catch (error) {
      throw new HexclaveAssertionError("Failed to parse the result written by the Freestyle VM runner", {
        resultJson,
        cause: error,
        innerCode: options.logSafeCode ?? code,
      });
    }
  } finally {
    // The VM is long-lived, so leaving per-run files behind would grow its disk without bound.
    // Cleanup failure must not replace the execution result or the error that led us here.
    runAsynchronouslyAndWaitUntil((async () => {
      try {
        await vm.exec({ command: `rm -f ${codePath} ${runnerPath} ${resultPath}` });
      } catch (error) {
        captureError("js-execution-freestyle-cleanup-failed", new HexclaveAssertionError(
          "Failed to remove Freestyle VM run files",
          { cause: error, runId },
        ));
      }
    })());
  }
}

function createFreestyleEngine(): JsEngine {
  return {
    name: 'freestyle',
    execute: async (code: string, options: ExecuteJavascriptOptions): Promise<ExecuteResult> => {
      const apiKey = getEnvVariable("STACK_FREESTYLE_API_KEY");
      const baseUrl = getEnvVariable("STACK_FREESTYLE_API_ENDPOINT", "") || undefined;

      if (apiKey === FREESTYLE_MOCK_API_KEY) {
        if (!["development", "test"].includes(getNodeEnvironment())) {
          throw new HexclaveAssertionError("Mock Freestyle key used in production; please set the STACK_FREESTYLE_API_KEY environment variable.");
        }
        const prefix = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81");
        return await executeOnFreestyleMock(code, options, baseUrl ?? `http://localhost:${prefix}22`);
      }

      // baseUrl is left to the SDK's own default when unset, which tracks Freestyle's current API host.
      const freestyle = new FreestyleClient({ apiKey, ...(baseUrl != null ? { baseUrl } : {}) });
      return await executeOnFreestyleVm(code, options, freestyle);
    },
  };
}

function createVercelSandboxEngine(): JsEngine {
  return {
    name: 'vercel-sandbox',
    execute: async (code: string, options: ExecuteJavascriptOptions): Promise<ExecuteResult> => {
      const teamId = getEnvVariable("STACK_VERCEL_SANDBOX_TEAM_ID");
      const projectId = getEnvVariable("STACK_VERCEL_SANDBOX_PROJECT_ID");
      const token = getEnvVariable("STACK_VERCEL_SANDBOX_TOKEN");

      const sandbox = await Sandbox.create({
        resources: { vcpus: 2 },
        timeout: options.executionTimeoutMs ?? 30_000,
        runtime: 'node24' as const,
        teamId: teamId || undefined,
        projectId: projectId || undefined,
        token: token || undefined,
        signal: options.signal,
      });

      try {
        if (options.nodeModules && Object.keys(options.nodeModules).length > 0) {
          const packages = Object.entries(options.nodeModules)
            .map(([name, version]) => `${name}@${version}`);

          const installResult = await sandbox.runCommand('npm', ['install', '--no-save', ...packages], {
            signal: options.signal,
          });

          if (installResult.exitCode !== 0) {
            throw new HexclaveAssertionError("Failed to install packages in Vercel Sandbox", { exitCode: installResult.exitCode, innerCode: options.logSafeCode ?? code, innerOptions: options });
          }
        }

        const resultPath = '/vercel/sandbox/result.json';

        const runnerScript = `
          import { writeFileSync } from 'fs';
          import fn from './code.mjs';
          const result = await fn();
          writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result));
        `;

        await sandbox.writeFiles([
          { path: '/vercel/sandbox/code.mjs', content: Buffer.from(code, 'utf-8') },
          { path: '/vercel/sandbox/runner.mjs', content: Buffer.from(runnerScript, 'utf-8') },
        ], { signal: options.signal });

        const runResult = await sandbox.runCommand('node', ['/vercel/sandbox/runner.mjs'], {
          signal: options.signal,
        });

        if (runResult.exitCode !== 0) {
          throw new HexclaveAssertionError("Vercel Sandbox runner exited with non-zero code", { innerCode: options.logSafeCode ?? code, innerOptions: options, exitCode: runResult.exitCode });
        }

        const resultBuffer = await sandbox.readFileToBuffer({ path: resultPath }, { signal: options.signal });
        if (resultBuffer === null) {
          throw new HexclaveAssertionError("Result file not found in Vercel Sandbox", { resultPath, innerCode: options.logSafeCode ?? code, innerOptions: options });
        }
        const resultJson = resultBuffer.toString();

        try {
          return JSON.parse(resultJson);
        } catch (e: any) {
          throw new HexclaveAssertionError("Failed to parse result from Vercel Sandbox", { resultJson, cause: e, innerCode: options.logSafeCode ?? code, innerOptions: options });
        }
      } finally {
        const cleanupPromise = stopVercelSandboxAfterExecution(sandbox);
        if (options.signal?.aborted === true) {
          // Once the caller has timed out, cleanup must not add another five
          // seconds to its latency. Keep the teardown owned by the invocation
          // so Vercel or standalone shutdown still gives it time to finish.
          runAsynchronouslyAndWaitUntil(cleanupPromise);
        } else {
          await cleanupPromise;
        }
      }
    },
  };
}

async function stopVercelSandboxAfterExecution(sandbox: Sandbox): Promise<void> {
  try {
    // The operation signal may already be aborted, but stopping the
    // already-created sandbox is exactly the cleanup that still needs to run.
    await sandbox.stop({ signal: AbortSignal.timeout(5000) });
  } catch (error) {
    // Teardown failure is observable, but must not replace the execution
    // result or the original provider error that led us into `finally`.
    captureError("js-execution-vercel-sandbox-cleanup-failed", new HexclaveAssertionError(
      "Failed to stop Vercel Sandbox after JavaScript execution",
      { cause: error },
    ));
  }
}

const engineMap = new Map<string, JsEngine>([
  ['freestyle', createFreestyleEngine()],
  ['vercel-sandbox', createVercelSandboxEngine()],
]);

/**
 * Executes the given code with the given options. Returns the result of the code execution
 * if it is JSON-serializable. Has undefined behavior if it is not JSON-serializable or if
 * the code throws an error.
 */
export async function executeJavascript(code: string, options: ExecuteJavascriptOptions = {}): Promise<ExecuteResult> {
  const resolvedOptions: ExecuteJavascriptOptions = {
    ...options,
    signal: options.signal ?? getOptionalRequestAbortSignal(),
  };
  return await traceSpan({
    description: 'js-execution.executeJavascript',
    attributes: {
      'js-execution.code.length': code.length.toString(),
      'js-execution.nodeModules.count': resolvedOptions.nodeModules ? Object.keys(resolvedOptions.nodeModules).length.toString() : '0',
    }
  }, async () => {
    resolvedOptions.signal?.throwIfAborted();

    if (getEnvVariable("STACK_VERCEL_SANDBOX_TOKEN") != "vercel_sandbox_disabled_for_local_development") {
      const shouldSanityTest = !resolvedOptions.disableSanityTest && Math.random() < 0.05;
      if (shouldSanityTest) {
        runAsynchronouslyAndWaitUntil(runSanityTestWithoutExpectedCancellation(code, resolvedOptions));
      }

      return await runWithFallback(code, resolvedOptions);
    } else {
      if (getNodeEnvironment().includes("prod")) {
        throw new HexclaveAssertionError("STACK_VERCEL_SANDBOX_TOKEN is set to the disabled sentinel value in production. Please configure a real Vercel Sandbox token.");
      }

      return await runWithoutFallback(code, resolvedOptions);
    }
  });
}

async function runSanityTestWithoutExpectedCancellation(code: string, options: ExecuteJavascriptOptions): Promise<void> {
  try {
    await runSanityTest(code, options);
  } catch (error) {
    // Client disconnects are expected cancellation, not failed canary executions.
    // Only suppress the exact reason thrown by this signal; unrelated failures
    // still reach runAsynchronouslyAndWaitUntil's error reporting.
    if (options.signal?.aborted !== true || error !== options.signal.reason) {
      throw error;
    }
  }
}

/**
 * Compare two execution results for sanity test equality.
 * For error results, we only compare status and message (not stack traces,
 * which differ between execution environments).
 */
function areResultsEqual(a: ExecuteResult, b: ExecuteResult): boolean {
  if (a.status !== b.status) return false;

  if (a.status === 'ok' && b.status === 'ok') {
    return JSON.stringify(a.data) === JSON.stringify(b.data);
  }

  if (a.status === 'error' && b.status === 'error') {
    return a.error.message === b.error.message;
  }

  return false;
}

async function runSanityTest(code: string, options: ExecuteJavascriptOptions) {
  const results: Array<{ engine: string, result: unknown }> = [];
  const failures: Array<{ engine: string, error: unknown }> = [];

  for (const [name, engine] of engineMap) {
    options.signal?.throwIfAborted();
    try {
      const result = await engine.execute(code, options);
      results.push({ engine: name, result });
    } catch (error) {
      options.signal?.throwIfAborted();
      failures.push({ engine: name, error });
    }
  }

  if (failures.length > 0) {
    captureError("js-execution-sanity-test-failures", new HexclaveAssertionError(
      `JS execution sanity test: ${failures.length} engine(s) failed`,
      { failures, successfulEngines: results.map(r => r.engine), innerCode: options.logSafeCode ?? code, innerOptions: options }
    ));
  }

  if (results.length < 2) {
    return;
  }

  const referenceResult = results[0].result as ExecuteResult;
  const allEqual = results.every(r => areResultsEqual(r.result as ExecuteResult, referenceResult));
  if (!allEqual) {
    captureError("js-execution-sanity-test-mismatch", new HexclaveAssertionError(
      "JS execution sanity test: engines returned different results",
      { results, innerCode: options.logSafeCode ?? code, innerOptions: options }
    ));
  }
}

async function runWithFallback(code: string, options: ExecuteJavascriptOptions): Promise<ExecuteResult> {
  const freestyleEngine = engineMap.get("freestyle")!;
  const vercelSandboxEngine = engineMap.get("vercel-sandbox")!;

  const maxAttempts = 2;
  const retryResult = await Result.retry(
      async () => {
        options.signal?.throwIfAborted();
        try {
          const result = await freestyleEngine.execute(code, options);
          return Result.ok(result);
        } catch (error) {
          options.signal?.throwIfAborted();
          return Result.error(error);
        }
      },
      maxAttempts,
      { exponentialDelayBase: 500 }
    );

  if (retryResult.status === 'ok') {
    return retryResult.data;
  }

  options.signal?.throwIfAborted();

  captureError(`js-execution-freestyle-failed`, new HexclaveAssertionError(
    `JS execution freestyle engine failed, falling back to vercel sandbox engine`,
    { cause: retryResult.error, innerCode: options.logSafeCode ?? code, innerOptions: options }
  ));

  try {
    const result = await vercelSandboxEngine.execute(code, options);
    return result;
  } catch (error){
      options.signal?.throwIfAborted();
      captureError(`js-execution-vercel-sandbox-failed`, new HexclaveAssertionError(
        `JS execution vercel sandbox engine failed after fallback from freestyle engine`,
        { cause: error, innerCode: options.logSafeCode ?? code, innerOptions: options }
      ));
      throw new HexclaveAssertionError("Vercel Sandbox service unavailable", { cause: error, innerCode: options.logSafeCode ?? code, innerOptions: options });
  }
}

async function runWithoutFallback(code: string, options: ExecuteJavascriptOptions): Promise<ExecuteResult> {
  const freestyleEngine = engineMap.get("freestyle")!;
  try {
    const result = await freestyleEngine.execute(code, options);
    return result;
  } catch (error) {
    options.signal?.throwIfAborted();
    throw new HexclaveAssertionError("Freestyle rendering service unavailable when running without fallback", { cause: error, innerCode: options.logSafeCode ?? code, innerOptions: options });
  }
}

async function awaitWithAbortSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal == null) {
    return await promise;
  }
  signal.throwIfAborted();
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

import.meta.vitest?.describe("freestyle VM execution", () => {
  const { vi, test, beforeEach, expect } = import.meta.vitest!;

  beforeEach(() => {
    return () => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    };
  });

  test("keys a module set independently of declaration order", () => {
    // Runs needing the same packages must land in the same guest directory, or each one pays a
    // fresh npm install and the cache never warms.
    const a = freestyleModulesKey({ react: "19.1.1", "react-dom": "19.1.1" });
    const b = freestyleModulesKey({ "react-dom": "19.1.1", react: "19.1.1" });
    expect(a).toBe(b);
  });

  test("separates differing module sets and versions", () => {
    // Sharing a directory across different versions would let one run resolve another's node_modules.
    const base = freestyleModulesKey({ react: "19.1.1" });
    expect(freestyleModulesKey({ react: "19.1.2" })).not.toBe(base);
    expect(freestyleModulesKey({ react: "19.1.1", arktype: "2.1.20" })).not.toBe(base);
    expect(freestyleModulesKey({})).not.toBe(base);
  });

  test("routes the mock key to the local mock's execute contract", async () => {
    // Local development and E2E run against docker/dependencies/freestyle-mock, which still speaks
    // the retired serverless contract. Breaking this path breaks every local email render.
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("HEXCLAVE_FREESTYLE_API_KEY", "mock_stack_freestyle_key");
    vi.stubEnv("STACK_FREESTYLE_API_KEY", "mock_stack_freestyle_key");
    vi.stubEnv("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81");

    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ result: { status: "ok", data: { rendered: true } } }),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const engine = createFreestyleEngine();
    const result = await engine.execute("export default async () => ({ status: 'ok' });", {
      nodeModules: { react: "19.1.1" },
      executionTimeoutMs: 30_000,
    });

    expect(result).toEqual({ status: "ok", data: { rendered: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8122/execute/v3/script");
    const body = JSON.parse(init.body as string);
    expect(body.script).toContain("export default");
    expect(body.config).toEqual({ nodeModules: { react: "19.1.1" }, timeout: 30_000 });
  });

  test("refuses the mock key outside development and test", async () => {
    // The mock executes code locally with no isolation, so reaching it from production would be a
    // sandbox escape rather than a misconfiguration.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HEXCLAVE_FREESTYLE_API_KEY", "mock_stack_freestyle_key");
    vi.stubEnv("STACK_FREESTYLE_API_KEY", "mock_stack_freestyle_key");
    const engine = createFreestyleEngine();
    await expect(engine.execute("export default async () => ({});", {})).rejects.toThrow(/Mock Freestyle key used in production/);
  });
});
