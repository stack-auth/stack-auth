import { traceSpan } from '@/utils/telemetry';
import { getOptionalRequestAbortSignal } from '@/lib/runtime/request-context';
import { runAsynchronouslyAndWaitUntil } from '@/utils/background-tasks';
import { getEnvVariable, getNodeEnvironment } from '@hexclave/shared/dist/utils/env';
import { HexclaveAssertionError, captureError } from '@hexclave/shared/dist/utils/errors';
import { Result } from '@hexclave/shared/dist/utils/results';
import { Sandbox } from '@vercel/sandbox';
import { Freestyle as FreestyleClient } from 'freestyle';
import http from 'node:http';
import https from 'node:https';

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
 * A minimal fetch replacement for the Freestyle client, built on node:http.
 *
 * Node's built-in fetch (undici) aborts any request whose response HEADERS
 * take longer than 300 seconds to arrive (UND_ERR_HEADERS_TIMEOUT), and that
 * limit is not configurable through the standard fetch API. Freestyle's
 * execute endpoint holds the request open until the run finishes, and some
 * runs legitimately take longer than that (executionTimeoutMs can exceed
 * 300s — e.g. workflow invocations that long-poll inside the sandbox), so
 * undici's limit would misreport a still-running execution as a provider
 * failure. node:http applies no response timeout, leaving the caller's
 * executionTimeoutMs/AbortSignal as the only time limits.
 *
 * Only supports what the Freestyle client actually does — fetch(url, init)
 * with an optional string body — and fails loudly on anything else.
 */
async function fetchWithoutResponseTimeout(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (input instanceof Request) {
    throw new HexclaveAssertionError("fetchWithoutResponseTimeout does not support Request inputs; pass (url, init) instead");
  }
  const url = new URL(input);
  const requestFn = url.protocol === "https:" ? https.request : http.request;
  const body = init?.body;
  if (body != null && typeof body !== "string") {
    throw new HexclaveAssertionError("fetchWithoutResponseTimeout only supports string request bodies", { bodyType: typeof body });
  }
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value;
  });
  return await new Promise<Response>((resolve, reject) => {
    const req = requestFn(url, { method: init?.method ?? "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const responseHeaders = new Headers();
        for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
          responseHeaders.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        }
        const bodyBytes = new Uint8Array(Buffer.concat(chunks));
        resolve(new Response(
          // Response() rejects non-empty bodies for status codes that forbid them
          bodyBytes.length === 0 ? null : bodyBytes,
          { status: res.statusCode, statusText: res.statusMessage, headers: responseHeaders },
        ));
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    const signal = init?.signal;
    if (signal != null) {
      const onAbort = () => req.destroy(new Error("Request aborted by the caller's AbortSignal"));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    req.end(body ?? undefined);
  });
}

function createFreestyleEngine(): JsEngine {
  return {
    name: 'freestyle',
    execute: async (code: string, options: ExecuteJavascriptOptions): Promise<ExecuteResult> => {
      const apiKey = getEnvVariable("STACK_FREESTYLE_API_KEY");
      let baseUrl = getEnvVariable("STACK_FREESTYLE_API_ENDPOINT", "") || undefined;

      if (apiKey === "mock_stack_freestyle_key") {
        if (!["development", "test"].includes(getNodeEnvironment())) {
          throw new HexclaveAssertionError("Mock Freestyle key used in production; please set the STACK_FREESTYLE_API_KEY environment variable.");
        }
        if (!baseUrl) {
          const prefix = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81");
          baseUrl = `http://localhost:${prefix}22`;
        }
      }

      const freestyle = new FreestyleClient({
        apiKey,
        baseUrl,
        fetch: fetchWithoutResponseTimeout,
      });

      const response = await awaitWithAbortSignal(freestyle.serverless.runs.create({
        code,
        nodeModules: options.nodeModules ?? {},
        timeout: options.executionTimeoutMs,
      }), options.signal);

      if (response.result === undefined) {
        throw new HexclaveAssertionError("Freestyle execution returned undefined result", { response, innerCode: options.logSafeCode ?? code, innerOptions: options });
      }

      return response.result as ExecuteResult;
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
