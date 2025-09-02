import { getPrismaClientForTenancy } from "@/prisma-client";
import { CompiledWorkflow, Prisma } from "@prisma/client";
import { isStringArray } from "@stackframe/stack-shared/dist/utils/arrays";
import { encodeBase64 } from "@stackframe/stack-shared/dist/utils/bytes";
import { hash } from "@stackframe/stack-shared/dist/utils/crypto";
import { StackAssertionError, captureError, errorToNiceString } from "@stackframe/stack-shared/dist/utils/errors";
import { bundleJavaScript } from "@stackframe/stack-shared/dist/utils/esbuild";
import { timeout } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { Freestyle } from "./freestyle";
import { Tenancy } from "./tenancies";

type WorkflowRegisteredTriggerType = "sign-up";

type WorkflowTrigger =
  | {
    type: "sign-up",
    userId: string,
  }
  | {
    type: "compile",
  }
  | {
    type: "callback",
    callbackId: string,
    scheduledAtMillis: number,
    dataJson: string,
    callerTriggerId: string,
    executionId: string,
  };

type WorkflowCompilationStatus =
  | null  // not compiled yet, recently created
  | { type: "compiling", sourceHash: string, startedCompilingAtMillis: number }
  | { type: "compiled", compiled: string, sourceHash: string, compiledAtMillis: number, registeredTriggers: WorkflowRegisteredTriggerType[] }
  | { type: "compile-error", error: string, sourceHash: string };


async function hashWorkflowSource(source: string) {
  return encodeBase64(await hash({
    purpose: "stack-auth-workflow-source",
    value: JSON.stringify(source),
  }));
}

export async function compileWorkflowSource(source: string): Promise<Result<string, string>> {
  const bundleResult = await bundleJavaScript({
    "/source.tsx": source,
    "/entry.js": `
      export default async () => {
        const registeredTriggers = new Map();

        globalThis._registerTrigger = (triggerType, func) => {
          registeredTriggers.set(triggerType, func);
        };
        _registerTrigger("compile", () => ({
          registeredTriggers: [...registeredTriggers.keys()],
        }));

        function makeTriggerRegisterer(str, cb) {
          globalThis[str] = (func, ...args) => _registerTrigger(cb(...args), func); 
        }

        makeTriggerRegisterer("onSignUp", () => "sign-up");

        await import("./source.tsx");

        const triggerData = JSON.parse(process.env.STACK_WORKFLOW_TRIGGER_DATA);
        const trigger = registeredTriggers.get(triggerData.type);
        return {
          triggerOutput: trigger(triggerData.data),
        };
      }
    `,
  }, {
    format: 'esm',
  });
  if (bundleResult.status === "error") {
    return Result.error(bundleResult.error);
  }
  return Result.ok(bundleResult.data);
}

async function compileWorkflow(tenancy: Tenancy, workflowId: string): Promise<Result<{ compiledCode: string, registeredTriggers: WorkflowRegisteredTriggerType[] }, { compileError?: string }>> {
  if (!(workflowId in tenancy.config.workflows.availableWorkflows)) {
    throw new StackAssertionError(`Workflow ${workflowId} not found`);
  }
  const workflow = tenancy.config.workflows.availableWorkflows[workflowId];
  const res = await timeout(async () => {
    const compiledCodeResult = await compileWorkflowSource(workflow.tsSource);
    if (compiledCodeResult.status === "error") {
      return Result.error({ compileError: `Failed to compile workflow: ${compiledCodeResult.error}` });
    }

    const compileTriggerResult = await triggerWorkflowRaw(tenancy, compiledCodeResult.data, {
      type: "compile",
    });
    if (compileTriggerResult.status === "error") {
      return Result.error({ compileError: `Failed to initialize workflow: ${compileTriggerResult.error}` });
    }
    const compileTriggerOutputResult = compileTriggerResult.data;
    if (typeof compileTriggerOutputResult !== "object" || !compileTriggerOutputResult || !("triggerOutput" in compileTriggerOutputResult)) {
      captureError("workflows-compile-trigger-output", new StackAssertionError(`Failed to parse compile trigger output`, { compileTriggerOutputResult }));
      return Result.error({ compileError: `Failed to parse compile trigger output` });
    }
    const registeredTriggers = (compileTriggerOutputResult.triggerOutput as any)?.registeredTriggers;
    if (!isStringArray(registeredTriggers)) {
      captureError("workflows-compile-trigger-output", new StackAssertionError(`Failed to parse compile trigger output, should be array of strings`, { compileTriggerOutputResult }));
      return Result.error({ compileError: `Failed to parse compile trigger output, should be array of strings` });
    }

    return Result.ok({
      compiledCode: compiledCodeResult.data,
      registeredTriggers: registeredTriggers as WorkflowRegisteredTriggerType[],
    });
  }, 10_000);

  if (res.status === "error") {
    return Result.error({ compileError: `Timed out compiling workflow ${workflowId} after ${res.error.ms}ms` });
  }
  return res.data;
}

import.meta.vitest?.test("compileWorkflow", async ({ expect }) => {
  const compileAndGetResult = async (tsSource: string) => {
    const tenancy = {
      id: "test-tenancy",
      project: {
        id: "test-project",
      },
      config: {
        workflows: {
          availableWorkflows: {
            "test-workflow": {
              enabled: true,
              tsSource,
            },
          },
        },
      },
    };

    return await compileWorkflow(tenancy as any, "test-workflow");
  };
  const compileAndGetRegisteredTriggers = async (tsSource: string) => {
    const res = await compileAndGetResult(tsSource);
    if (res.status === "error") throw new StackAssertionError(`Failed to compile workflow: ${errorToNiceString(res.error)}`, { cause: res.error });
    return res.data.registeredTriggers;
  };

  expect(await compileAndGetRegisteredTriggers("console.log('hello, world!');")).toEqual([
    "compile",
  ]);
  expect(await compileAndGetRegisteredTriggers("onSignUp(() => {});")).toEqual([
    "compile",
    "sign-up",
  ]);
  expect(await compileAndGetResult("return return return return;")).toMatchInlineSnapshot(`
    {
      "error": {
        "compileError": "Failed to compile workflow: Build failed with 1 error:
    virtual:/source.tsx:1:7: ERROR: Unexpected "return"",
      },
      "status": "error",
    }
  `);
  expect(await compileAndGetResult("console.log('hello, world!'); throw new Error('test');")).toMatchInlineSnapshot(`
    {
      "error": {
        "compileError": "Failed to initialize workflow: test",
      },
      "status": "error",
    }
  `);
});

async function getCompiledWorkflows(tenancy: Tenancy): Promise<Map<string, CompiledWorkflow>> {
  // TODO: On the DB, for each workflow in the tenancy config, check whether all workflows have a compiled WorkflowCompilationStatus with a matching source hash, if so, return those.
  // If any of the workflows has no WorkflowCompilationStatus, or it's null, set each of those to compiling and call compileWorkflow, then update those rows with the result. Once that's done, repeat.
  // Otherwise, if the status is still compiling, and it was started <20 seconds ago, wait 1 second, and then try again. If it was started >20 seconds ago, assume it failed, so reset the WorkflowCompilationStatus to null and throw a StackAssertionError.
  // The above should happen in a single DB query/serializable transaction to prevent race conditions.
  throw new StackAssertionError("Not implemented");
}

async function triggerWorkflowRaw(tenancy: Tenancy, compiledWorkflowCode: string, trigger: WorkflowTrigger): Promise<Result<unknown, string>> {
  const triggerId = generateUuid();
  const executionId = trigger.type === "callback" ? trigger.executionId : generateUuid();

  const freestyle = new Freestyle();
  const freestyleRes = await freestyle.executeScript(compiledWorkflowCode, {
    envVars: {
      STACK_WORKFLOW_TRIGGER_DATA: JSON.stringify(trigger),
      STACK_PROJECT_ID: tenancy.project.id,
      STACK_PUBLISHABLE_CLIENT_KEY: "insert actual publishable client key here",
      STACK_SECRET_SERVER_KEY: "insert actual secret server key here",
    },
  });
  return Result.map(freestyleRes, (data) => data.result);
}

async function triggerWorkflow(tenancy: Tenancy, compiledWorkflow: CompiledWorkflow, trigger: WorkflowTrigger): Promise<Result<void, string>> {
  if (compiledWorkflow.compiledCode === null) {
    return Result.error(`Workflow ${compiledWorkflow.id} failed to compile: ${compiledWorkflow.compileError}`);
  }
  const res = await triggerWorkflowRaw(tenancy, compiledWorkflow.compiledCode, trigger);
  const prisma = await getPrismaClientForTenancy(tenancy);
  await prisma.workflowTrigger.create({
    data: {
      triggerData: trigger,
      ...(res.status === "ok" ? { output: (res.data ?? Prisma.JsonNull) as any } : { error: res.error }),
      execution: {
        connectOrCreate: {
          where: {
            tenancyId_id: {
              tenancyId: tenancy.id,
              id: compiledWorkflow.id,
            },
          },
          create: {
            tenancyId: tenancy.id,
            compiledWorkflowId: compiledWorkflow.id,
          },
        },
      },
    },
  });
  return Result.ok(undefined);
}

export async function triggerWorkflows(tenancy: Tenancy, trigger: WorkflowTrigger) {
  const compiledWorkflows = await getCompiledWorkflows(tenancy);
  const promises = [...compiledWorkflows].map(async ([workflowId, compiledWorkflow]) => {
    await triggerWorkflow(tenancy, compiledWorkflow, trigger);
  });
  await Promise.all(promises);
}
