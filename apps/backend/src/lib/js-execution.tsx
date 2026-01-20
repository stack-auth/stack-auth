import { traceSpan } from '@/utils/telemetry';
import { runAsynchronouslyAndWaitUntil } from '@/utils/vercel';
import { getEnvVariable, getNodeEnvironment } from '@stackframe/stack-shared/dist/utils/env';
import { StackAssertionError, captureError } from '@stackframe/stack-shared/dist/utils/errors';
import { Result } from '@stackframe/stack-shared/dist/utils/results';
import { Sandbox } from '@vercel/sandbox';
import { Freestyle as FreestyleClient } from 'freestyle-sandboxes';

export type ExecuteJavascriptOptions = {
  nodeModules?: Record<string, string>,
  engine?: 'freestyle' | 'vercel-sandbox',
};

type JsEngine = {
  name: string,
  execute: (code: string, options: ExecuteJavascriptOptions) => Promise<unknown>,
};

function createFreestyleEngine(): JsEngine {
  return {
    name: 'freestyle',
    execute: async (code: string, options: ExecuteJavascriptOptions): Promise<unknown> => {
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
        throw new StackAssertionError("Freestyle execution returned undefined result", { response });
      }

      return response.result;
    },
  };
}

function createVercelSandboxEngine(): JsEngine {
  return {
    name: 'vercel-sandbox',
    execute: async (code: string, options: ExecuteJavascriptOptions): Promise<unknown> => {
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
            throw new StackAssertionError("Failed to install packages in Vercel Sandbox", { exitCode: installResult.exitCode });
          }
        }

        const resultPath = '/vercel/sandbox/result.json';

        const runnerScript = `
          import { writeFileSync } from 'fs';
          import fn from './code.mjs';
          const result = await fn();
          writeFileSync('${resultPath}', JSON.stringify(result));
        `;

        await sandbox.writeFiles([
          { path: '/vercel/sandbox/code.mjs', content: Buffer.from(code, 'utf-8') },
          { path: '/vercel/sandbox/runner.mjs', content: Buffer.from(runnerScript, 'utf-8') },
        ]);

        const runResult = await sandbox.runCommand('node', ['/vercel/sandbox/runner.mjs']);

        if (runResult.exitCode !== 0) {
          throw new StackAssertionError("Vercel Sandbox execution failed", { exitCode: runResult.exitCode });
        }

        // Read the result file by catting it to stdout
        let resultJson = '';
        const { Writable } = await import('stream');
        const stdoutStream = new Writable({
          write(chunk, _encoding, callback) {
            resultJson += chunk.toString();
            callback();
          },
        });

        const catResult = await sandbox.runCommand({ cmd: 'cat', args: [resultPath], stdout: stdoutStream });

        if (catResult.exitCode !== 0) {
          throw new StackAssertionError("Failed to read result file from Vercel Sandbox", { exitCode: catResult.exitCode });
        }

        try {
          return JSON.parse(resultJson);
        } catch (e) {
          throw new StackAssertionError("Failed to parse result from Vercel Sandbox", { resultJson, cause: e });
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

const engines: JsEngine[] = Array.from(engineMap.values());

export async function executeJavascript(code: string, options: ExecuteJavascriptOptions = {}): Promise<unknown> {
  return await traceSpan({
    description: 'js-execution.executeJavascript',
    attributes: {
      'js-execution.code.length': code.length.toString(),
      'js-execution.nodeModules.count': options.nodeModules ? Object.keys(options.nodeModules).length.toString() : '0',
      'js-execution.engine': options.engine ?? 'auto',
    }
  }, async () => {
    if (options.engine) {
      const engine = engineMap.get(options.engine);
      if (!engine) {
        throw new StackAssertionError(`Unknown JS execution engine: ${options.engine}`);
      }
      return await engine.execute(code, options);
    }

    const shouldSanityTest = Math.random() < 0.05;

    if (shouldSanityTest) {
      runAsynchronouslyAndWaitUntil(runSanityTest(code, options));
    }

    // Normal execution: try engines in order with retry for first engine
    return await runWithFallback(code, options);
  });
}

async function runSanityTest(code: string, options: ExecuteJavascriptOptions) {
  const results: Array<{ engine: string, result: unknown }> = [];
  const failures: Array<{ engine: string, error: unknown }> = [];

  for (const engine of engines) {
    try {
      const result = await engine.execute(code, options);
      results.push({ engine: engine.name, result });
    } catch (error) {
      failures.push({ engine: engine.name, error });
    }
  }

  if (failures.length > 0) {
    captureError("js-execution-sanity-test-failures", new StackAssertionError(
      `JS execution sanity test: ${failures.length} engine(s) failed`,
      { failures, successfulEngines: results.map(r => r.engine) }
    ));
  }

  if (results.length < 2) {
    return;
  }

  const referenceResult = results[0].result;
  const allEqual = results.every(r => JSON.stringify(r.result) === JSON.stringify(referenceResult));
  if (!allEqual) {
    captureError("js-execution-sanity-test-mismatch", new StackAssertionError(
      "JS execution sanity test: engines returned different results",
      { results }
    ));
  }
}

async function runWithFallback(code: string, options: ExecuteJavascriptOptions): Promise<unknown> {
  const errors: Array<{ engine: string, error: unknown }> = [];

  for (let i = 0; i < engines.length; i++) {
    const engine = engines[i];
    const isFirstEngine = i === 0;

    const maxAttempts = isFirstEngine ? 2 : 1;

    const retryResult = await Result.retry(
      async () => {
        try {
          const result = await engine.execute(code, options);
          return Result.ok(result);
        } catch (error) {
          return Result.error(error);
        }
      },
      maxAttempts,
      { exponentialDelayBase: 500 }
    );

    if (retryResult.status === 'ok') {
      return retryResult.data;
    }

    const engineError = retryResult.error;
    errors.push({ engine: engine.name, error: engineError });

    if (i < engines.length - 1) {
      captureError(`js-execution-${engine.name}-failed`, new StackAssertionError(
        `JS execution engine '${engine.name}' failed, falling back to next engine`,
        { error: engineError, attempts: retryResult.attempts }
      ));
    }
  }

  throw errors[errors.length - 1].error;
}
