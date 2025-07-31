import { StackAssertionError, captureError, errorToNiceString } from '@stackframe/stack-shared/dist/utils/errors';
import { traceSpan } from '@stackframe/stack-shared/dist/utils/telemetry';
import { FreestyleSandboxes } from 'freestyle-sandboxes';

export class Freestyle {
  private freestyle: FreestyleSandboxes;

  constructor(options: { apiKey: string }) {
    this.freestyle = new FreestyleSandboxes(options);
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
        return await this.freestyle.executeScript(script, options);
      } catch (error) {
        captureError("freestyle.executeScript", error);
        throw new StackAssertionError("Error executing script with Freestyle! " + errorToNiceString(error), { cause: error });
      }
    });
  }
}
