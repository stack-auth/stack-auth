import { getPrismaClientForTenancy, globalPrismaClient, retryTransaction } from "@/prisma-client";
import { traceSpan } from "@/utils/telemetry";
import { allPromisesAndWaitUntilEach, runAsynchronouslyAndWaitUntil } from "@/utils/vercel";
import { CompiledWorkflow, Prisma } from "@prisma/client";
import { isStringArray } from "@stackframe/stack-shared/dist/utils/arrays";
import { encodeBase64 } from "@stackframe/stack-shared/dist/utils/bytes";
import { generateSecureRandomString, hash } from "@stackframe/stack-shared/dist/utils/crypto";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, captureError, errorToNiceString, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { bundleJavaScript, initializeEsbuild } from "@stackframe/stack-shared/dist/utils/esbuild";
import { runAsynchronously, timeout, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { Freestyle } from "./freestyle";
import { Tenancy } from "./tenancies";
import { upstash } from "./upstash";

const externalPackages: Record<string, string> = {};

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
    data: unknown,
    callerTriggerId: string,
    executionId: string,
  };

async function hashWorkflowSource(source: string) {
  return encodeBase64(await hash({
    purpose: "stack-auth-workflow-source",
    value: JSON.stringify(source),
  }));
}

export async function hashWorkflowTriggerToken(token: string) {
  return encodeBase64(await hash({
    purpose: "stack-auth-workflow-trigger-token",
    value: token,
  }));
}

export async function compileWorkflowSource(source: string): Promise<Result<string, string>> {
  const bundleResult = await bundleJavaScript({
    "/source.tsx": source,
    "/entry.js": `
      import { StackServerApp } from 'https://esm.sh/@stackframe/js@2.8.36?target=es2021&standalone';

      globalThis.navigator.onLine = true;

      export default async () => {
        globalThis.stackApp = new StackServerApp({
          tokenStore: null,
          extraRequestHeaders: {
            "x-stack-workflow-token": process.env.STACK_WORKFLOW_TOKEN_SECRET,
          }
        });

        const registeredTriggers = new Map();
        globalThis._registerTrigger = (triggerType, func) => {
          registeredTriggers.set(triggerType, func);
        };
        _registerTrigger("compile", () => ({
          registeredTriggers: [...registeredTriggers.keys()],
        }));

        const registeredCallbacks = new Map();
        globalThis.registerCallback = (callbackId, func) => {
          registeredCallbacks.set(callbackId, func);
        };
        _registerTrigger("callback", ({ callbackId, data }) => {
          const callbackFunc = registeredCallbacks.get(callbackId);
          if (!callbackFunc) {
            throw new Error(\`Callback \${callbackId} not found. Was it maybe deleted from the workflow?\`);
          }
          return callbackFunc(data);
        });
        let scheduledCallback = undefined;
        globalThis.scheduleCallback = ({ callbackId, data, scheduleAt }) => {
          if (scheduledCallback) {
            throw new Error("Only one callback can be scheduled at a time!");
          }
          scheduledCallback = { callbackId, data, scheduleAtMillis: scheduleAt.getTime() };
          return scheduledCallback;
        };

        function makeTriggerRegisterer(str, typeCb, argsCb) {
          globalThis[str] = (...args) => _registerTrigger(typeCb(...args.slice(0, -1)), async (data) => args[args.length - 1](...await argsCb(data))); 
        }

        makeTriggerRegisterer("onSignUp", () => "sign-up", async (data) => [await stackApp.getUser(data.userId, { or: "throw" })]);

        await import("./source.tsx");

        const triggerData = JSON.parse(process.env.STACK_WORKFLOW_TRIGGER_DATA);
        const trigger = registeredTriggers.get(triggerData.type);
        if (!trigger) {
          throw new Error(\`Workflow trigger \${triggerData.type} invoked but not found. Please report this to the developers.\`);
        }
        const triggerOutput = await trigger(triggerData);
        if (scheduledCallback !== undefined) {
          if (triggerOutput !== scheduledCallback) {
            throw new Error("When calling scheduleCallback, you must return its return value in the event handler!");
          }
          return {
            scheduledCallback: triggerOutput,
          };
        } else {
          return {
            triggerOutput,
          };
        }
      }
    `,
  }, {
    format: 'esm',
    keepAsImports: Object.keys(externalPackages),
    allowHttpImports: true,
  });
  if (bundleResult.status === "error") {
    return Result.error(bundleResult.error);
  }
  return Result.ok(bundleResult.data);
}

async function compileWorkflow(tenancy: Tenancy, workflowId: string): Promise<Result<{ compiledCode: string, registeredTriggers: string[] }, { compileError?: string }>> {
  return await traceSpan(`compileWorkflow ${workflowId}`, async () => {
    if (!(workflowId in tenancy.config.workflows.availableWorkflows)) {
      throw new StackAssertionError(`Workflow ${workflowId} not found`);
    }
    const workflow = tenancy.config.workflows.availableWorkflows[workflowId];
    const res = await timeout(async () => {
      console.log(`Compiling workflow ${workflowId}...`);
      const compiledCodeResult = await compileWorkflowSource(workflow.tsSource);
      if (compiledCodeResult.status === "error") {
        return Result.error({ compileError: `Failed to compile workflow: ${compiledCodeResult.error}` });
      }

      console.log(`Compiled workflow source for ${workflowId}, running compilation trigger...`, { compiledCodeLength: compiledCodeResult.data.length });

      const compileTriggerResult = await triggerWorkflowRaw(tenancy, compiledCodeResult.data, {
        type: "compile",
      });
      if (compileTriggerResult.status === "error") {
        return Result.error({ compileError: `Failed to initialize workflow: ${compileTriggerResult.error}` });
      }

      console.log(`Compilation trigger completed!`);

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

      console.log(`Workflow ${workflowId} compiled successfully, returning result...`, { registeredTriggers });

      return Result.ok({
        compiledCode: compiledCodeResult.data,
        registeredTriggers: registeredTriggers,
      });
    }, 30_000);

    if (res.status === "error") {
      console.warn(`Timed out compiling workflow ${workflowId} after ${res.error.ms}ms`, { res });
      return Result.error({ compileError: `Timed out compiling workflow ${workflowId} after ${res.error.ms}ms` });
    }
    return res.data;
  });
}

import.meta.vitest?.test("compileWorkflow", async ({ expect }) => {
  const compileAndGetResult = async (tsSource: string) => {
    const tenancy = {
      id: "01234567-89ab-cdef-0123-456789abcdef",
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
    "callback",
  ]);
  expect(await compileAndGetRegisteredTriggers("onSignUp(() => {}); registerCallback('test', () => {});")).toEqual([
    "compile",
    "callback",
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

async function compileAndGetEnabledWorkflows(tenancy: Tenancy): Promise<Map<string, CompiledWorkflow>> {
  // initialize ESBuild early so it doesn't count towards the 10s compilation timeout later
  await initializeEsbuild();

  const compilationVersion = 1;
  const enabledWorkflows = new Map(await Promise.all(Object.entries(tenancy.config.workflows.availableWorkflows)
    .filter(([_, workflow]) => workflow.enabled)
    .map(async ([workflowId, workflow]) => [workflowId, {
      id: workflowId,
      workflow,
      sourceHash: await hashWorkflowSource(workflow.tsSource),
    }] as const)));

  const getWorkflowsToCompile = async (tx: Prisma.TransactionClient) => {
    const compiledWorkflows = await tx.compiledWorkflow.findMany({
      where: {
        tenancyId: tenancy.id,
        workflowId: { in: [...enabledWorkflows.keys()] },
        compilationVersion,
        sourceHash: { in: [...enabledWorkflows.values()].map(({ sourceHash }) => sourceHash) },
      },
    });

    const found = new Map<string, CompiledWorkflow>();
    const missing = new Set(enabledWorkflows.keys());
    for (const compiledWorkflow of compiledWorkflows) {
      const enabledWorkflow = enabledWorkflows.get(compiledWorkflow.workflowId) ?? throwErr(`Compiled workflow ${compiledWorkflow.workflowId} not found in enabled workflows — this should not happen due to our Prisma filter!`);
      if (enabledWorkflow.sourceHash === compiledWorkflow.sourceHash) {
        found.set(compiledWorkflow.workflowId, compiledWorkflow);
        missing.delete(compiledWorkflow.workflowId);
      }
    }

    const toCompile: string[] = [];
    const waiting: string[] = [];
    for (const workflowId of missing) {
      const enabledWorkflow = enabledWorkflows.get(workflowId) ?? throwErr(`Enabled workflow ${workflowId} not found in enabled workflows — this should not happen due to our Prisma filter!`);
      const currentlyCompiling = await tx.currentlyCompilingWorkflow.findUnique({
        where: {
          tenancyId_workflowId_compilationVersion_sourceHash: {
            tenancyId: tenancy.id,
            workflowId,
            compilationVersion,
            sourceHash: enabledWorkflow.sourceHash,
          },
        },
      });
      if (currentlyCompiling) {
        waiting.push(workflowId);
      } else {
        toCompile.push(workflowId);
      }
    }

    if (toCompile.length > 0) {
      await tx.currentlyCompilingWorkflow.createMany({
        data: toCompile.map((workflowId) => ({
          tenancyId: tenancy.id,
          compilationVersion,
          workflowId,
          sourceHash: enabledWorkflows.get(workflowId)?.sourceHash ?? throwErr(`Enabled workflow ${workflowId} not found in enabled workflows — this should not happen due to our Prisma filter!`),
        })),
      });
    }

    return {
      toCompile,
      waiting,
      workflows: found,
    };
  };

  let retryInfo = [];
  const prisma = await getPrismaClientForTenancy(tenancy);
  for (let retries = 0; retries < 10; retries++) {
    const todo = await retryTransaction(prisma, async (tx) => {
      return await getWorkflowsToCompile(tx);
    }, { level: "serializable" });

    retryInfo.push({
      toCompile: todo.toCompile,
      waiting: todo.waiting,
      done: [...todo.workflows.entries()].map(([workflowId, workflow]) => workflowId),
    });

    if (todo.toCompile.length === 0 && todo.waiting.length === 0) {
      return todo.workflows;
    }

    await allPromisesAndWaitUntilEach(todo.toCompile.map(async (workflowId) => {
      const enabledWorkflow = enabledWorkflows.get(workflowId) ?? throwErr(`Enabled workflow ${workflowId} not found in enabled workflows — this should not happen due to our Prisma filter!`);
      try {
        const compiledWorkflow = await compileWorkflow(tenancy, workflowId);
        await prisma.compiledWorkflow.create({
          data: {
            tenancyId: tenancy.id,
            compilationVersion,
            workflowId,
            sourceHash: enabledWorkflow.sourceHash,
            ...compiledWorkflow.status === "ok" ? {
              compiledCode: compiledWorkflow.data.compiledCode,
              registeredTriggers: compiledWorkflow.data.registeredTriggers,
            } : {
              compileError: compiledWorkflow.error.compileError,
              registeredTriggers: [],
            },
          },
        });
      } finally {
        await prisma.currentlyCompilingWorkflow.delete({
          where: {
            tenancyId_workflowId_compilationVersion_sourceHash: {
              tenancyId: tenancy.id,
              compilationVersion,
              workflowId,
              sourceHash: enabledWorkflow.sourceHash,
            },
          },
        });
      }
    }));

    const { count } = await prisma.currentlyCompilingWorkflow.deleteMany({
      where: {
        tenancyId: tenancy.id,
        startedCompilingAt: { lt: new Date(Date.now() - 40_000) },
      },
    });
    if (count > 0) {
      captureError("workflows-compile-timeout", new StackAssertionError(`Deleted ${count} currently compiling workflows that were compiling for more than 40 seconds; this probably indicates a bug in the workflow compilation code (as they should time out after 30 seconds)`));
    }

    await wait(1000);
  }

  throw new StackAssertionError(`Timed out compiling workflows after retries`, { retryInfo });
}

async function triggerWorkflowRaw(tenancy: Tenancy, compiledWorkflowCode: string, trigger: WorkflowTrigger): Promise<Result<unknown, string>> {
  return await traceSpan({ description: `triggerWorkflowRaw ${trigger.type}` }, async () => {
    const workflowToken = generateSecureRandomString();
    const workflowTriggerToken = await globalPrismaClient.workflowTriggerToken.create({
      data: {
        expiresAt: new Date(Date.now() + 1000 * 35),
        tenancyId: tenancy.id,
        tokenHash: await hashWorkflowTriggerToken(workflowToken),
      },
    });

    const tokenRefreshInterval = setInterval(() => {
      runAsynchronously(async () => {
        await globalPrismaClient.workflowTriggerToken.update({
          where: {
            tenancyId_id: {
              tenancyId: tenancy.id,
              id: workflowTriggerToken.id,
            },
          },
          data: { expiresAt: new Date(Date.now() + 1000 * 35) },
        });
      });
    }, 10_000);

    try {
      const freestyle = new Freestyle();
      const apiUrl = new URL("/", getEnvVariable("NEXT_PUBLIC_STACK_API_URL").replace("http://localhost", "http://host.docker.internal"));
      const freestyleRes = await freestyle.executeScript(compiledWorkflowCode, {
        envVars: {
          STACK_WORKFLOW_TRIGGER_DATA: JSON.stringify(trigger),
          NEXT_PUBLIC_STACK_PROJECT_ID: tenancy.project.id,
          NEXT_PUBLIC_STACK_API_URL: apiUrl.toString(),
          NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: "<placeholder publishable client key; the actual auth happens with the workflow token>",
          STACK_SECRET_SERVER_KEY: "<placeholder secret server key; the actual auth happens with the workflow token>",
          STACK_WORKFLOW_TOKEN_SECRET: workflowToken,
        },
        nodeModules: Object.fromEntries(Object.entries(externalPackages).map(([packageName, version]) => [packageName, version])),
        networkPermissions: [
          {
            action: "allow",
            behavior: "exact",
            query: apiUrl.host,
          },
        ],
      });
      return Result.map(freestyleRes, (data) => data.result);
    } finally {
      clearInterval(tokenRefreshInterval);
    }
  });
}

async function createScheduledTrigger(tenancy: Tenancy, workflowId: string, trigger: WorkflowTrigger, scheduledAt: Date) {
  const executionId = trigger.type === "callback" ? trigger.executionId : generateUuid();

  const prisma = await getPrismaClientForTenancy(tenancy);
  const dbTrigger = await prisma.workflowTrigger.create({
    data: {
      triggerData: trigger as any,
      scheduledAt,
      execution: {
        connectOrCreate: {
          where: {
            tenancyId_id: {
              tenancyId: tenancy.id,
              id: executionId,
            },
          },
          create: {
            tenancyId: tenancy.id,
            workflowId,
          },
        },
      },
    },
  });

  await upstash.publishJSON({
    url: new URL(`/api/v1/internal/trigger/run-scheduled`, getEnvVariable("NEXT_PUBLIC_STACK_API_URL").replace("http://localhost", "http://host.docker.internal")).toString(),
    body: {
      tenancyId: tenancy.id,
    },
    notBefore: Math.floor(scheduledAt.getTime() / 1000),
  });

  return dbTrigger;
}

export async function triggerScheduledWorkflows(tenancy: Tenancy) {
  const prisma = await getPrismaClientForTenancy(tenancy);
  const compiledWorkflows = await compileAndGetEnabledWorkflows(tenancy);

  const toTrigger = await retryTransaction(prisma, async (tx) => {
    const triggers = await tx.workflowTrigger.findMany({
      where: {
        tenancyId: tenancy.id,
        scheduledAt: { lt: new Date(Date.now() + 5_000) },
      },
      include: {
        execution: true,
      },
      orderBy: {
        scheduledAt: "asc",
      },
      // let's take multiple triggers so we can catch up on the backlog, in case some triggers never went through (eg. if the queue was down)
      // however, to prevent deadlocks as we are doing multiple writes in this transaction, we randomize it (so there's
      // a chance that we only take one trigger, which would never deadlock)
      take: Math.floor(1 + Math.random() * 3),
    });
    const toTrigger = [];
    for (const trigger of triggers) {
      const compiledWorkflow = compiledWorkflows.get(trigger.execution.workflowId);
      const updatedTrigger = await tx.workflowTrigger.update({
        where: {
          tenancyId_id: {
            tenancyId: tenancy.id,
            id: trigger.id,
          },
        },
        data: {
          scheduledAt: null,
          compiledWorkflowId: compiledWorkflow?.id ?? null,
          output: Prisma.DbNull,
          error: Prisma.DbNull,
        },
        include: {
          execution: true,
        },
      });

      if (compiledWorkflow) {
        toTrigger.push(updatedTrigger);
      } else {
        // the workflow was deleted; we don't run the trigger, but we still mark it in the DB
      }
    }
    return toTrigger;
  }, { level: "serializable" });

  await allPromisesAndWaitUntilEach(toTrigger.map(async (trigger) => {
    const compiledWorkflow = compiledWorkflows.get(trigger.execution.workflowId) ?? throwErr(`Compiled workflow ${trigger.execution.workflowId} not found in trigger execution; this should not happen because we should've already checked for this in the transaction!`);
    if (compiledWorkflow.compiledCode === null) {
      return Result.error(`Workflow ${compiledWorkflow.id} failed to compile: ${compiledWorkflow.compileError}`);
    }

    const res = await triggerWorkflowRaw(tenancy, compiledWorkflow.compiledCode, trigger.triggerData as WorkflowTrigger);
    if (res.status === "error") {
      // This is probably fine and just a user error, but let's log it regardless
      console.log(`Compiled workflow failed to process trigger: ${res.error}`, { trigger, compiledWorkflowId: compiledWorkflow.id, res });
    } else {
      if (res.data && typeof res.data === "object" && "scheduledCallback" in res.data && res.data.scheduledCallback && typeof res.data.scheduledCallback === "object") {
        const scheduledCallback: any = res.data.scheduledCallback;
        const callbackId = `${scheduledCallback.callbackId}`;
        const scheduleAt = new Date(scheduledCallback.scheduleAtMillis);
        const callbackData = scheduledCallback.data;
        await createScheduledTrigger(
          tenancy,
          compiledWorkflow.id,
          {
            type: "callback",
            callbackId,
            data: callbackData,
            scheduledAtMillis: scheduleAt.getTime(),
            callerTriggerId: trigger.id,
            executionId: trigger.executionId,
          },
          scheduleAt
        );
      }
    }

    const prisma = await getPrismaClientForTenancy(tenancy);
    await prisma.workflowTrigger.update({
      where: {
        tenancyId_id: {
          tenancyId: tenancy.id,
          id: trigger.id,
        },
      },
      data: {
        ...res.status === "ok" ? {
          output: res.data as any,
        } : {
          error: res.error,
        },
      },
    });
    return Result.ok(undefined);
  }));
}

export async function triggerWorkflows(tenancy: Tenancy, trigger: WorkflowTrigger & { type: WorkflowRegisteredTriggerType }) {
  runAsynchronouslyAndWaitUntil(async () => {
    const compiledWorkflows = await compileAndGetEnabledWorkflows(tenancy);
    const promises = [...compiledWorkflows]
      .filter(([_, compiledWorkflow]) => compiledWorkflow.registeredTriggers.includes(trigger.type))
      .map(async ([workflowId, compiledWorkflow]) => {
        await createScheduledTrigger(tenancy, workflowId, trigger, new Date());
      });
    await allPromisesAndWaitUntilEach(promises);
  });
}
