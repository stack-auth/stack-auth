import { traceSpan } from '@/utils/telemetry';
import { getEnvVariable, getNodeEnvironment } from '@stackframe/stack-shared/dist/utils/env';
import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import { Result } from '@stackframe/stack-shared/dist/utils/results';
import { FreestyleSandboxes } from 'freestyle-sandboxes';

export class Freestyle {
  private freestyle: FreestyleSandboxes;

  constructor(options: { apiKey?: string } = {}) {
    const apiKey = options.apiKey || getEnvVariable("STACK_FREESTYLE_API_KEY");
    let baseUrl = undefined;
    if (apiKey === "mock_stack_freestyle_key") {
      if (!["development", "test"].includes(getNodeEnvironment())) {
        throw new StackAssertionError("Mock Freestyle key used in production; please set the STACK_FREESTYLE_API_KEY environment variable.");
      }
      baseUrl = "http://localhost:8122";
    }
    this.freestyle = new FreestyleSandboxes({
      apiKey,
      baseUrl,
    });
  }

  async executeScript(script: string, options?: Parameters<FreestyleSandboxes['executeScript']>[1]) {
    return await traceSpan({
      description: 'freestyle.executeScript',
      attributes: {
        'freestyle.operation': 'executeScript',
        'freestyle.script.length': script.length.toString(),
        'freestyle.nodeModules.count': options?.nodeModules ? Object.keys(options.nodeModules).length.toString() : '0',
      }
    }, async () => {
      try {
        return Result.ok(await this.freestyle.executeScript(script, options));
      } catch (e: unknown) {
        const wrap1 = e && typeof e === "object" && "error" in e ? e.error : e;
        const wrap2 = wrap1 && typeof wrap1 === "object" && "error" in wrap1 ? wrap1.error : wrap1;
        const wrap3 = wrap2 && typeof wrap2 === "string" ? JSON.parse(wrap2) : wrap2;
        const wrap4 = wrap3 && typeof wrap3 === "object" && "error" in wrap3 ? wrap3.error : wrap3;
        return Result.error(wrap4);
      }
    });
  }
}
