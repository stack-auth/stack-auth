import { traceSpan } from '@/utils/telemetry';
import { runAsynchronouslyAndWaitUntil } from '@/utils/vercel';
import { getEnvVariable, getNodeEnvironment } from '@stackframe/stack-shared/dist/utils/env';
import { StackAssertionError, captureError } from '@stackframe/stack-shared/dist/utils/errors';
import { Result } from '@stackframe/stack-shared/dist/utils/results';
import { Sandbox } from '@vercel/sandbox';
import { Freestyle as FreestyleClient } from 'freestyle-sandboxes';

export type ExecuteJavascriptOptions = {
  nodeModules?: Record<string, string>,
};

export type ExecuteResult =
  | { status: "ok", data: unknown }
  | { status: "error", error: { message: string, stack?: string, cause?: unknown } };

type JsEngine = {
  name: string,
  execute: (code: string, options: ExecuteJavascriptOptions) => Promise<ExecuteResult>,
};

function createFreestyleEngine(): JsEngine {
  return {
    name: 'freestyle',
    execute: async (code: string, options: ExecuteJavascriptOptions): Promise<ExecuteResult> => {
      const apiKey = getEnvVariable("STACK_FREESTYLE_API_KEY");
      let baseUrl = getEnvVariable("STACK_FREESTYLE_API_ENDPOINT", "") || undefined;

      if (apiKey === "mock_stack_freestyle_key") {
        if (!["development", "test"].includes(getNodeEnvironment())) {
          throw new StackAssertionError("Mock Freestyle key used in production; please set the STACK_FREESTYLE_API_KEY environment variable.");
        }
        const prefix = getEnvVariable("NEXT_PUBLIC_STACK_PORT_PREFIX", "81");
        baseUrl = `http://localhost:${prefix}22`;
      }

      const freestyle = new FreestyleClient({
        apiKey,
        baseUrl,
      });

      const response = await freestyle.serverless.runs.create({
        code,
        nodeModules: options.nodeModules ?? {},
      });

      if (response.result === undefined) {
        throw new StackAssertionError("Freestyle execution returned undefined result", { response, innerCode: code, innerOptions: options });
      }

      return response.result as ExecuteResult;
    },
  };
}

function createVercelSandboxEngine(): JsEngine {
  return {
    name: 'vercel-sandbox',
    execute: async (code: string, options: ExecuteJavascriptOptions): Promise<ExecuteResult> => {
      const teamId = getEnvVariable("STACK_VERCEL_SANDBOX_TEAM_ID", "");
      const projectId = getEnvVariable("STACK_VERCEL_SANDBOX_PROJECT_ID", "");
      const token = getEnvVariable("STACK_VERCEL_SANDBOX_TOKEN", "");

      const sandbox = await Sandbox.create({
        resources: { vcpus: 2 },
        timeout: 30000,
        runtime: 'node24' as const,
        teamId: teamId || undefined,
        projectId: projectId || undefined,
        token: token || undefined,
      });

      try {
        if (options.nodeModules && Object.keys(options.nodeModules).length > 0) {
          const packages = Object.entries(options.nodeModules)
            .map(([name, version]) => `${name}@${version}`);

          const installResult = await sandbox.runCommand('npm', ['install', '--no-save', ...packages]);

          if (installResult.exitCode !== 0) {
            throw new StackAssertionError("Failed to install packages in Vercel Sandbox", { exitCode: installResult.exitCode, innerCode: code, innerOptions: options });
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
        ]);

        const runResult = await sandbox.runCommand('node', ['/vercel/sandbox/runner.mjs']);

        if (runResult.exitCode !== 0) {
          throw new StackAssertionError("Vercel Sandbox runner exited with non-zero code", { innerCode: code, innerOptions: options, exitCode: runResult.exitCode });
        }

        const resultBuffer = await sandbox.readFileToBuffer({ path: resultPath });
        if (resultBuffer === null) {
          throw new StackAssertionError("Result file not found in Vercel Sandbox", { resultPath, innerCode: code, innerOptions: options });
        }
        const resultJson = resultBuffer.toString();

        try {
          return JSON.parse(resultJson);
        } catch (e: any) {
          throw new StackAssertionError("Failed to parse result from Vercel Sandbox", { resultJson, cause: e, innerCode: code, innerOptions: options });
        }
      } finally {
        await sandbox.stop();
      }
    },
  };
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
  return await traceSpan({
    description: 'js-execution.executeJavascript',
    attributes: {
      'js-execution.code.length': code.length.toString(),
      'js-execution.nodeModules.count': options.nodeModules ? Object.keys(options.nodeModules).length.toString() : '0',
    }
  }, async () => {

    if (getEnvVariable("STACK_VERCEL_SANDBOX_TOKEN","") != "") {
      if (!getNodeEnvironment().includes("prod")) {
        throw new StackAssertionError("STACK_VERCEL_SANDBOX_TOKEN is set in non-production environment. We do not use Vercel Sandbox in non-production environments.");
      }

      const shouldSanityTest = Math.random() < 0.05;
      if (shouldSanityTest) {
        runAsynchronouslyAndWaitUntil(runSanityTest(code, options));
      }

      return await runWithFallback(code, options);
    } else {
      return await runWithoutFallback(code, options);
    }
  });
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
    try {
      const result = await engine.execute(code, options);
      results.push({ engine: name, result });
    } catch (error) {
      failures.push({ engine: name, error });
    }
  }

  if (failures.length > 0) {
    captureError("js-execution-sanity-test-failures", new StackAssertionError(
      `JS execution sanity test: ${failures.length} engine(s) failed`,
      { failures, successfulEngines: results.map(r => r.engine), innerCode: code, innerOptions: options }
    ));
  }

  if (results.length < 2) {
    return;
  }

  const referenceResult = results[0].result as ExecuteResult;
  const allEqual = results.every(r => areResultsEqual(r.result as ExecuteResult, referenceResult));
  if (!allEqual) {
    captureError("js-execution-sanity-test-mismatch", new StackAssertionError(
      "JS execution sanity test: engines returned different results",
      { results, innerCode: code, innerOptions: options }
    ));
  }
}

async function runWithFallback(code: string, options: ExecuteJavascriptOptions): Promise<ExecuteResult> {
  const freestyleEngine = engineMap.get("freestyle")!;
  const vercelSandboxEngine = engineMap.get("vercel-sandbox")!;

  const maxAttempts = 2;
  const retryResult = await Result.retry(
      async () => {
        try {
          const result = await freestyleEngine.execute(code, options);
          return Result.ok(result);
        } catch (error) {
          //if we're here, that means infra error not user error?
          return Result.error(error);
        }
      },
      maxAttempts,
      { exponentialDelayBase: 500 }
    );

  if (retryResult.status === 'ok') {
    return retryResult.data;
  }

  //TODO: Capture error block for freestyle engine infra failure?

  captureError(`js-execution-freestyle-failed`, new StackAssertionError(
    `JS execution freestyle engine failed, falling back to vercel sandbox engine`,
    { error: retryResult.error, innerCode: code, innerOptions: options }
  ));

  try {
    const result = await vercelSandboxEngine.execute(code, options);
    return result;
  } catch (error){
      //if we're here, that means infra error not user error?
      //TODO: Improve error message?
      captureError(`js-execution-vercel-sandbox-failed`, new StackAssertionError(
        `JS execution vercel sandbox engine failed after fallback from freestyle engine`,
        { error: error, innerCode: code, innerOptions: options }
      ));
      //TODO: Improve error message
      throw new StackAssertionError("Infrastructure error", { cause: error, innerCode: code, innerOptions: options });
  }
}

async function runWithoutFallback(code: string, options: ExecuteJavascriptOptions): Promise<ExecuteResult> {
  const freestyleEngine = engineMap.get("freestyle")!;
  try {
    const result = await freestyleEngine.execute(code, options);
    return result;
  } catch (error) {
    //if we're here, that means infra error not user error?
    throw new StackAssertionError("Infrastructure error", { cause: error, innerCode: code, innerOptions: options });
  }
}
