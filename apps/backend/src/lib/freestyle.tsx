import { traceSpan } from '@/utils/telemetry';
import { getEnvVariable, getNodeEnvironment } from '@stackframe/stack-shared/dist/utils/env';
import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import { parseJson } from '@stackframe/stack-shared/dist/utils/json';
import { Result } from '@stackframe/stack-shared/dist/utils/results';
import { Freestyle as FreestyleClient } from 'freestyle-sandboxes';

// Extract options type from the SDK's serverless.runs.create method, excluding 'code'
// Make 'config' optional since we provide a default empty config
type ServerlessRunsCreateParams = Parameters<FreestyleClient['serverless']['runs']['create']>[0];
export type ExecuteScriptOptions = Partial<Omit<ServerlessRunsCreateParams, 'code'>>;

export class Freestyle {
  private freestyle: FreestyleClient;

  constructor(options: { apiKey?: string } = {}) {
    const apiKey = options.apiKey || getEnvVariable("STACK_FREESTYLE_API_KEY");
    let baseUrl = getEnvVariable("STACK_FREESTYLE_API_ENDPOINT", "") || undefined;
    if (apiKey === "mock_stack_freestyle_key") {
      if (!["development", "test"].includes(getNodeEnvironment())) {
        throw new StackAssertionError("Mock Freestyle key used in production; please set the STACK_FREESTYLE_API_KEY environment variable.");
      }
      const prefix = getEnvVariable("NEXT_PUBLIC_STACK_PORT_PREFIX", "81");
      baseUrl = `http://localhost:${prefix}22`;
    }
    this.freestyle = new FreestyleClient({
      apiKey,
      baseUrl,
    });
  }

  async executeScript(script: string, options?: ExecuteScriptOptions) {
    return await traceSpan({
      description: 'freestyle.executeScript',
      attributes: {
        'freestyle.operation': 'executeScript',
        'freestyle.script.length': script.length.toString(),
        'freestyle.nodeModules.count': options?.config?.nodeModules ? Object.keys(options.config.nodeModules).length.toString() : '0',
      }
    }, async () => {
      try {
        const response = await this.freestyle.serverless.runs.create({
          ...options,
          code: script,
          config: options?.config ?? {},
        });
        return Result.ok(response);
      } catch (e: unknown) {
        // Freestyle's errors are sometimes nested in JSON.parse(e.error.error).error
        const message = e instanceof Error ? e.message : String(e);
        return Result.error(message);
      }
    });
  }
}
