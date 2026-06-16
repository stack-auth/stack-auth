// The eval control agent: a Claude Code harness session with host-executed AI
// SDK tools exposing workflow/run management, worklog access, and direct exec
// inside live Freestyle VMs. Inference is routed through OpenRouter.

import { HarnessAgent, type HarnessAgentSession } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import type { ToolSet } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { computeOpenRouterCostUsd, openRouterAnthropicAuth, searchOpenRouterModels } from "./openrouter";
import { createEvalSandbox, createFreestyleHarnessSandboxProvider, type EvalSandbox } from "./sandbox";
import { StreamUsageAccumulator } from "./usage";
import {
  cancelEvalRun,
  execInRun,
  isRunActiveInProcess,
  readRunFile,
  resumeEvalRun,
  startEvalBatch,
  startEvalRun,
} from "./orchestrator";
import {
  deleteEvalRun,
  deleteEvalWorkflow,
  getRun,
  getWorkflow,
  listArtifacts,
  listRuns,
  listStepRuns,
  listWorkflows,
  listWorklog,
  upsertEvalWorkflow,
} from "./stdb";
import { DEFAULT_MODEL, ensureDefaultWorkflow } from "./default-workflow";
import { describeError, parseSteps } from "./types";

// SpacetimeDB rows contain bigints and timestamp wrappers; make them JSON-able.
function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === "bigint") return v.toString();
    if (v && typeof v === "object" && "__timestamp_micros_since_unix_epoch__" in (v as Record<string, unknown>)) {
      const micros = (v as Record<string, unknown>).__timestamp_micros_since_unix_epoch__;
      return new Date(Number(micros) / 1000).toISOString();
    }
    return v;
  }, 2);
}

function textResult(text: string): string {
  return text;
}

function evalTool<TSchema extends z.ZodType>(description: string, inputSchema: TSchema, execute: (args: z.infer<TSchema>) => Promise<string>) {
  return { description, inputSchema, execute };
}

const stepSchema = z.object({
  name: z.string(),
  prompt: z.string(),
  outputKey: z.string().optional(),
  model: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
});

const evalTools = {
  list_workflows: evalTool("List all eval workflows (id, name, description, default model, step names).", z.object({}), async () => {
    await ensureDefaultWorkflow();
    const workflows = await listWorkflows();
    return textResult(safeJson(workflows.map(w => ({
      workflowId: w.workflowId,
      name: w.name,
      description: w.description,
      defaultModel: w.defaultModel,
      steps: parseSteps(w.stepsJson).map(s => s.name),
    }))));
  }),

  get_workflow: evalTool("Get a workflow's full definition, including every step's prompt.", z.object({
    workflowId: z.string(),
  }), async args => {
    const workflow = await getWorkflow(args.workflowId);
    if (!workflow) return textResult(`Workflow not found: ${args.workflowId}`);
    return textResult(safeJson({ ...workflow, steps: parseSteps(workflow.stepsJson) }));
  }),

  create_workflow: evalTool("Create a new eval workflow. Steps execute in order; each step is an AI SDK harness agent in the run's shared Freestyle VM. Step prompts may reference {variables} produced by earlier steps' outputKey.", z.object({
    name: z.string(),
    description: z.string().default(""),
    steps: z.array(stepSchema).min(1),
    defaultModel: z.string().default(DEFAULT_MODEL),
  }), async args => {
    const workflowId = randomUUID();
    await upsertEvalWorkflow({
      workflowId,
      name: args.name,
      description: args.description,
      stepsJson: JSON.stringify(args.steps, null, 2),
      defaultModel: args.defaultModel,
    });
    return textResult(`Created workflow ${workflowId} (${args.name})`);
  }),

  update_workflow: evalTool("Update an existing workflow. Omitted fields keep their current value.", z.object({
    workflowId: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    steps: z.array(stepSchema).min(1).optional(),
    defaultModel: z.string().optional(),
  }), async args => {
    const existing = await getWorkflow(args.workflowId);
    if (!existing) return textResult(`Workflow not found: ${args.workflowId}`);
    await upsertEvalWorkflow({
      workflowId: args.workflowId,
      name: args.name ?? existing.name,
      description: args.description ?? existing.description,
      stepsJson: args.steps ? JSON.stringify(args.steps, null, 2) : existing.stepsJson,
      defaultModel: args.defaultModel ?? existing.defaultModel,
    });
    return textResult(`Updated workflow ${args.workflowId}`);
  }),

  delete_workflow: evalTool("Delete a workflow (runs and their logs are kept).", z.object({
    workflowId: z.string(),
  }), async args => {
    await deleteEvalWorkflow(args.workflowId);
    return textResult(`Deleted workflow ${args.workflowId}`);
  }),

  list_runs: evalTool("List eval runs, newest first.", z.object({
    limit: z.number().int().min(1).max(200).default(30),
  }), async args => {
    const runs = await listRuns();
    return textResult(safeJson(runs.slice(0, args.limit).map(r => ({
      runId: r.runId,
      label: r.label,
      workflowName: r.workflowName,
      model: r.model,
      status: r.status,
      currentStepIndex: r.currentStepIndex,
      totalSteps: r.totalSteps,
      sandboxId: r.sandboxId,
      error: r.error,
      createdAt: r.createdAt,
      liveInThisProcess: isRunActiveInProcess(r.runId),
    }))));
  }),

  get_run: evalTool("Get a run with its per-step status, results, costs and artifact list.", z.object({
    runId: z.string(),
  }), async args => {
    const run = await getRun(args.runId);
    if (!run) return textResult(`Run not found: ${args.runId}`);
    const stepRuns = await listStepRuns(args.runId);
    const artifacts = await listArtifacts(args.runId);
    return textResult(safeJson({
      run,
      steps: stepRuns.map(s => ({
        stepRunId: s.stepRunId,
        stepIndex: s.stepIndex,
        stepName: s.stepName,
        model: s.model,
        status: s.status,
        numMessages: s.numMessages,
        costUsd: s.costUsd,
        error: s.error,
        resultText: s.resultText.slice(0, 2000),
      })),
      artifacts: artifacts.map(a => ({ path: a.path, contentType: a.contentType, sizeChars: a.content.length })),
    }));
  }),

  start_run: evalTool("Start a single eval run of a workflow. Returns the runId; progress can be polled with get_run / read_worklog.", z.object({
    workflowId: z.string(),
    model: z.string().optional().describe("OpenRouter model slug, e.g. anthropic/claude-sonnet-4.6; defaults to the workflow's default model"),
    label: z.string().optional(),
    timeoutMinutes: z.number().int().min(5).max(300).optional(),
    variables: z.record(z.string(), z.string()).optional().describe("Extra {placeholder} variables for step prompts"),
  }), async args => {
    const runId = await startEvalRun(args);
    return textResult(`Started run ${runId}`);
  }),

  batch_run: evalTool("Start a batch of runs across one or more models (optionally several runs per model).", z.object({
    workflowId: z.string(),
    models: z.array(z.string()).min(1),
    runsPerModel: z.number().int().min(1).max(10).default(1),
    timeoutMinutes: z.number().int().min(5).max(300).optional(),
    labelPrefix: z.string().optional(),
  }), async args => {
    const runIds = await startEvalBatch(args);
    return textResult(`Started ${runIds.length} runs:\n${runIds.join("\n")}`);
  }),

  cancel_run: evalTool("Cancel an in-flight run (kills the current agent step; the Freestyle VM stays alive until idle timeout so it can be inspected or resumed).", z.object({
    runId: z.string(),
  }), async args => {
    await cancelEvalRun(args.runId);
    return textResult(`Cancellation requested for run ${args.runId}`);
  }),

  resume_run: evalTool("Resume a failed or cancelled run from its failed/stopped step. Use mode 'continue' to continue from prior partial output/error context, or 'restart-step' to rerun that step's original prompt in the same VM.", z.object({
    runId: z.string(),
    mode: z.enum(["continue", "restart-step"]).default("continue"),
  }), async args => {
    await resumeEvalRun(args.runId, args.mode);
    return textResult(`Resumed run ${args.runId} with mode ${args.mode}`);
  }),

  delete_run: evalTool("Permanently delete a run and all of its step runs, worklogs and artifacts.", z.object({
    runId: z.string(),
  }), async args => {
    const run = await getRun(args.runId);
    if (run && ["queued", "booting", "running"].includes(run.status)) {
      await cancelEvalRun(args.runId);
    }
    await deleteEvalRun(args.runId);
    return textResult(`Deleted run ${args.runId}`);
  }),

  read_worklog: evalTool("Read the message trace of a step run. stepRunId format is '<runId>-step-<index>' (index 0 is sandbox setup). Entries are AI SDK harness stream parts plus setup stdout/stderr.", z.object({
    stepRunId: z.string(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(200).default(50),
    kinds: z.array(z.string()).optional().describe("Filter by entry kind: text-delta, tool-call, tool-result, finish, stdout, stderr, meta"),
  }), async args => {
    const all = await listWorklog(args.stepRunId);
    const kinds = args.kinds;
    const filtered = kinds && kinds.length > 0 ? all.filter(e => kinds.includes(e.kind)) : all;
    const page = filtered.slice(args.offset, args.offset + args.limit);
    const header = `${filtered.length} entries total (showing ${args.offset}..${args.offset + page.length})`;
    const body = page.map(e => `[${e.seq}] (${e.kind}) ${e.content.slice(0, 3000)}`).join("\n");
    return textResult(`${header}\n${body}`);
  }),

  exec_in_run: evalTool("Execute a shell command inside a run's Freestyle VM (cwd: /freestyle/sandbox/workspace). Works while the VM is alive during the run and after failure until the VM idles out.", z.object({
    runId: z.string(),
    command: z.string(),
  }), async args => {
    const result = await execInRun(args.runId, args.command);
    return textResult(`exit code: ${result.exitCode}${result.truncated ? " (output truncated)" : ""}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
  }),

  read_run_file: evalTool("Read a file from a run's Freestyle VM. Relative paths resolve against /freestyle/sandbox/workspace.", z.object({
    runId: z.string(),
    path: z.string(),
  }), async args => {
    const content = await readRunFile(args.runId, args.path);
    if (content === null) return textResult(`File not found: ${args.path}`);
    return textResult(content.slice(0, 100_000));
  }),

  get_artifact: evalTool("Read a stored artifact (e.g. the HTML report) collected from a finished run.", z.object({
    runId: z.string(),
    path: z.string().describe("Artifact path as listed by get_run"),
  }), async args => {
    const artifacts = await listArtifacts(args.runId);
    const artifact = artifacts.find(a => a.path === args.path);
    if (!artifact) return textResult(`Artifact not found: ${args.path}`);
    return textResult(artifact.content.slice(0, 200_000));
  }),

  list_models: evalTool("Search the live OpenRouter model catalog.", z.object({
    search: z.string().default(""),
    limit: z.number().int().min(1).max(100).default(30),
  }), async args => {
    const models = await searchOpenRouterModels(args.search, args.limit);
    return textResult(safeJson(models.map(m => ({ id: m.id, name: m.name, contextLength: m.contextLength, pricing: m.pricing }))));
  }),
} satisfies ToolSet;

const SYSTEM_PROMPT = `You are the Hexclave eval-suite control agent inside an internal tool. You manage eval workflows (ordered queues of steps, each step an AI SDK harness agent that runs in a shared Freestyle VM per run) and their runs.

Capabilities via your tools: create/modify/delete workflows, start single or batch runs (any OpenRouter model), cancel, resume, retry, or delete runs, analyze runs by reading worklogs (AI SDK harness stream parts plus setup logs) and artifacts (e.g. the generated HTML report), exec shell commands directly inside a run's Freestyle VM, and read files from Freestyle VMs.

Guidelines:
- Be action-oriented: when asked to do something, do it with tools and report what happened, including ids (runId, workflowId) the user may need.
- When analyzing a run, prefer reading result/text/tool entries of worklogs first, then drill into stderr as needed; worklogs can be long, so page through them.
- exec_in_run only works while the run's Freestyle VM is alive (running, failed/cancelled-but-not-idled-out). Completed runs stop their VMs.
- For failed or cancelled runs, use resume_run: mode "continue" keeps prior attempt context, while "restart-step" reruns the failed/stopped step in the same VM.
- For batch comparisons across models, start the batch, then use list_runs/get_run to track progress when asked.
- Destructive actions (delete_run, delete_workflow): confirm with the user first unless they explicitly asked for the deletion.`;

export type ChatStreamEvent =
  | { type: "session", sessionId: string }
  | { type: "assistant_text", text: string }
  | { type: "tool_use", name: string, input: unknown }
  | { type: "tool_result", content: string }
  | { type: "result", result: string, costUsd: number | null }
  | { type: "error", message: string };

export type ChatTurnOptions = {
  message: string,
  sessionId?: string,
  model?: string,
};

type ActiveChatSession = {
  model: string,
  sandbox: EvalSandbox,
  session: HarnessAgentSession,
  agent: ReturnType<typeof createControlAgent>,
};

const globalStore = globalThis as unknown as { __hexclaveEvalChatSessions?: Map<string, ActiveChatSession> };
function chatSessions(): Map<string, ActiveChatSession> {
  globalStore.__hexclaveEvalChatSessions = globalStore.__hexclaveEvalChatSessions ?? new Map();
  return globalStore.__hexclaveEvalChatSessions;
}

function createControlAgent(model: string, sandbox: EvalSandbox) {
  const auth = openRouterAnthropicAuth(model);
  return new HarnessAgent({
    harness: createClaudeCode({
      model: auth.model,
      auth: {
        anthropic: {
          authToken: auth.authToken,
          baseUrl: auth.baseUrl,
        },
      },
    }),
    sandbox: createFreestyleHarnessSandboxProvider(sandbox),
    instructions: SYSTEM_PROMPT,
    permissionMode: "allow-all",
    tools: evalTools,
  });
}

async function createChatSession(model: string): Promise<ActiveChatSession> {
  const sandbox = await createEvalSandbox({ timeoutMinutes: 45 });
  const agent = createControlAgent(model, sandbox);
  const session = await agent.createSession();
  const active = { model, sandbox, session, agent };
  chatSessions().set(session.sessionId, active);
  return active;
}

async function getChatSession(options: ChatTurnOptions): Promise<ActiveChatSession> {
  const model = options.model ?? DEFAULT_MODEL;
  const existing = options.sessionId ? chatSessions().get(options.sessionId) : undefined;
  if (existing && existing.model === model) return existing;
  return await createChatSession(model);
}

function resultContent(output: unknown): string {
  return typeof output === "string" ? output : safeJson(output);
}

export async function* runChatTurn(options: ChatTurnOptions): AsyncGenerator<ChatStreamEvent> {
  await ensureDefaultWorkflow();
  const model = options.model ?? DEFAULT_MODEL;
  const usage = new StreamUsageAccumulator();

  try {
    const active = await getChatSession(options);
    yield { type: "session", sessionId: active.session.sessionId };

    const result = await active.agent.stream({
      session: active.session,
      prompt: options.message,
    });

    let resultText = "";
    for await (const part of result.stream) {
      if (part.type === "text-delta") {
        resultText += part.text;
        yield { type: "assistant_text", text: part.text };
      } else if (part.type === "tool-call") {
        yield { type: "tool_use", name: part.toolName, input: part.input };
      } else if (part.type === "tool-result") {
        yield { type: "tool_result", content: resultContent(part.output).slice(0, 2000) };
      } else if (part.type === "tool-error") {
        yield { type: "tool_result", content: resultContent(part.error).slice(0, 2000) };
      }
    }

    usage.addAiSdkUsage(await result.usage);
    const repriced = await computeOpenRouterCostUsd(model, usage.totals());
    yield {
      type: "result",
      result: resultText || await result.text,
      costUsd: repriced !== undefined ? Number.parseFloat(repriced) : null,
    };
  } catch (error) {
    yield { type: "error", message: describeError(error) };
  }
}
