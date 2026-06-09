// The eval control agent: a Claude Code (agent SDK) session with an in-process
// MCP server exposing full workflow/run management, worklog access and direct
// exec inside any live run's sandbox. Inference is routed through OpenRouter.

import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { claudeCodeOpenRouterEnv, searchOpenRouterModels } from "./openrouter";
import {
  cancelEvalRun,
  execInRun,
  isRunActiveInProcess,
  readRunFile,
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
import { parseSteps } from "./types";

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

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

const stepSchema = z.object({
  name: z.string(),
  prompt: z.string(),
  outputKey: z.string().optional(),
  model: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
});

const evalTools = [
  tool("list_workflows", "List all eval workflows (id, name, description, default model, step names).", {}, async () => {
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

  tool("get_workflow", "Get a workflow's full definition, including every step's prompt.", {
    workflowId: z.string(),
  }, async args => {
    const workflow = await getWorkflow(args.workflowId);
    if (!workflow) return textResult(`Workflow not found: ${args.workflowId}`);
    return textResult(safeJson({ ...workflow, steps: parseSteps(workflow.stepsJson) }));
  }),

  tool("create_workflow", "Create a new eval workflow. Steps execute in order; each step is a Claude Code agent in the run's shared sandbox. Step prompts may reference {variables} produced by earlier steps' outputKey.", {
    name: z.string(),
    description: z.string().default(""),
    steps: z.array(stepSchema).min(1),
    defaultModel: z.string().default(DEFAULT_MODEL),
  }, async args => {
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

  tool("update_workflow", "Update an existing workflow. Omitted fields keep their current value.", {
    workflowId: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    steps: z.array(stepSchema).min(1).optional(),
    defaultModel: z.string().optional(),
  }, async args => {
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

  tool("delete_workflow", "Delete a workflow (runs and their logs are kept).", {
    workflowId: z.string(),
  }, async args => {
    await deleteEvalWorkflow(args.workflowId);
    return textResult(`Deleted workflow ${args.workflowId}`);
  }),

  tool("list_runs", "List eval runs, newest first.", {
    limit: z.number().int().min(1).max(200).default(30),
  }, async args => {
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

  tool("get_run", "Get a run with its per-step status, results, costs and artifact list.", {
    runId: z.string(),
  }, async args => {
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

  tool("start_run", "Start a single eval run of a workflow. Returns the runId; progress can be polled with get_run / read_worklog.", {
    workflowId: z.string(),
    model: z.string().optional().describe("OpenRouter model slug, e.g. anthropic/claude-sonnet-4.6; defaults to the workflow's default model"),
    label: z.string().optional(),
    timeoutMinutes: z.number().int().min(5).max(300).optional(),
    variables: z.record(z.string(), z.string()).optional().describe("Extra {placeholder} variables for step prompts"),
  }, async args => {
    const runId = await startEvalRun(args);
    return textResult(`Started run ${runId}`);
  }),

  tool("batch_run", "Start a batch of runs across one or more models (optionally several runs per model).", {
    workflowId: z.string(),
    models: z.array(z.string()).min(1),
    runsPerModel: z.number().int().min(1).max(10).default(1),
    timeoutMinutes: z.number().int().min(5).max(300).optional(),
    labelPrefix: z.string().optional(),
  }, async args => {
    const runIds = await startEvalBatch(args);
    return textResult(`Started ${runIds.length} runs:\n${runIds.join("\n")}`);
  }),

  tool("cancel_run", "Cancel an in-flight run (kills the current agent step and stops the sandbox).", {
    runId: z.string(),
  }, async args => {
    await cancelEvalRun(args.runId);
    return textResult(`Cancellation requested for run ${args.runId}`);
  }),

  tool("delete_run", "Permanently delete a run and all of its step runs, worklogs and artifacts.", {
    runId: z.string(),
  }, async args => {
    const run = await getRun(args.runId);
    if (run && ["queued", "booting", "running"].includes(run.status)) {
      await cancelEvalRun(args.runId);
    }
    await deleteEvalRun(args.runId);
    return textResult(`Deleted run ${args.runId}`);
  }),

  tool("read_worklog", "Read the message trace of a step run. stepRunId format is '<runId>-step-<index>' (index 0 is sandbox setup). Entries are Claude Code stream-json messages plus stderr lines.", {
    stepRunId: z.string(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(200).default(50),
    kinds: z.array(z.string()).optional().describe("Filter by entry kind: system, assistant, user, result, stdout, stderr, meta"),
  }, async args => {
    const all = await listWorklog(args.stepRunId);
    const filtered = args.kinds && args.kinds.length > 0 ? all.filter(e => args.kinds!.includes(e.kind)) : all;
    const page = filtered.slice(args.offset, args.offset + args.limit);
    const header = `${filtered.length} entries total (showing ${args.offset}..${args.offset + page.length})`;
    const body = page.map(e => `[${e.seq}] (${e.kind}) ${e.content.slice(0, 3000)}`).join("\n");
    return textResult(`${header}\n${body}`);
  }),

  tool("exec_in_run", "Execute a shell command inside a run's sandbox (cwd: /vercel/sandbox/workspace). Works while the sandbox is alive — during the run, and after failure until the sandbox times out.", {
    runId: z.string(),
    command: z.string(),
  }, async args => {
    const result = await execInRun(args.runId, args.command);
    return textResult(`exit code: ${result.exitCode}${result.truncated ? " (output truncated)" : ""}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
  }),

  tool("read_run_file", "Read a file from a run's sandbox. Relative paths resolve against /vercel/sandbox/workspace.", {
    runId: z.string(),
    path: z.string(),
  }, async args => {
    const content = await readRunFile(args.runId, args.path);
    if (content === null) return textResult(`File not found: ${args.path}`);
    return textResult(content.slice(0, 100_000));
  }),

  tool("get_artifact", "Read a stored artifact (e.g. the HTML report) collected from a finished run.", {
    runId: z.string(),
    path: z.string().describe("Artifact path as listed by get_run"),
  }, async args => {
    const artifacts = await listArtifacts(args.runId);
    const artifact = artifacts.find(a => a.path === args.path);
    if (!artifact) return textResult(`Artifact not found: ${args.path}`);
    return textResult(artifact.content.slice(0, 200_000));
  }),

  tool("list_models", "Search the live OpenRouter model catalog.", {
    search: z.string().default(""),
    limit: z.number().int().min(1).max(100).default(30),
  }, async args => {
    const models = await searchOpenRouterModels(args.search, args.limit);
    return textResult(safeJson(models.map(m => ({ id: m.id, name: m.name, contextLength: m.contextLength, pricing: m.pricing }))));
  }),
];

const TOOL_NAMES = [
  "list_workflows", "get_workflow", "create_workflow", "update_workflow", "delete_workflow",
  "list_runs", "get_run", "start_run", "batch_run", "cancel_run", "delete_run",
  "read_worklog", "exec_in_run", "read_run_file", "get_artifact", "list_models",
].map(name => `mcp__evals__${name}`);

const SYSTEM_PROMPT = `You are the Hexclave eval-suite control agent inside an internal tool. You manage eval workflows (ordered queues of steps, each step a Claude Code agent that runs in a shared Vercel Sandbox per run) and their runs.

Capabilities via your tools: create/modify/delete workflows, start single or batch runs (any OpenRouter model), cancel or delete runs, analyze runs by reading their worklogs (full Claude Code stream-json traces) and artifacts (e.g. the generated HTML report), exec shell commands directly inside a run's sandbox, and read files from sandboxes.

Guidelines:
- Be action-oriented: when asked to do something, do it with tools and report what happened, including ids (runId, workflowId) the user may need.
- When analyzing a run, prefer reading the result/assistant entries of worklogs first, then drill into tool calls or stderr as needed; worklogs can be long, so page through them.
- exec_in_run only works while the run's sandbox is alive (running, or failed-but-not-timed-out). Completed/cancelled runs have stopped sandboxes.
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

export async function* runChatTurn(options: ChatTurnOptions): AsyncGenerator<ChatStreamEvent> {
  await ensureDefaultWorkflow();
  const model = options.model ?? DEFAULT_MODEL;
  const cwd = join(tmpdir(), "hexclave-eval-chat");
  mkdirSync(cwd, { recursive: true });

  const mcpServer = createSdkMcpServer({ name: "evals", tools: evalTools });

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("ANTHROPIC_") && !key.startsWith("CLAUDE_")) {
      env[key] = value;
    }
  }
  Object.assign(env, claudeCodeOpenRouterEnv(model));

  try {
    for await (const message of query({
      prompt: options.message,
      options: {
        cwd,
        env,
        resume: options.sessionId,
        systemPrompt: SYSTEM_PROMPT,
        mcpServers: { evals: mcpServer },
        allowedTools: TOOL_NAMES,
        disallowedTools: ["Bash", "Write", "Edit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task"],
        permissionMode: "dontAsk",
      },
    })) {
      if (message.type === "system" && "subtype" in message && message.subtype === "init") {
        yield { type: "session", sessionId: (message as { session_id: string }).session_id };
      } else if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text" && block.text.trim() !== "") {
            yield { type: "assistant_text", text: block.text };
          } else if (block.type === "tool_use") {
            yield { type: "tool_use", name: block.name, input: block.input };
          }
        }
      } else if (message.type === "user") {
        const content = (message as { message?: { content?: unknown } }).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as { type?: string, content?: unknown };
            if (b.type === "tool_result") {
              const text = typeof b.content === "string"
                ? b.content
                : Array.isArray(b.content)
                  ? b.content.map(part => (part as { text?: string }).text ?? "").join("")
                  : "";
              yield { type: "tool_result", content: text.slice(0, 2000) };
            }
          }
        }
      } else if (message.type === "result") {
        const resultMessage = message as unknown as { result?: string, total_cost_usd?: number };
        yield {
          type: "result",
          result: resultMessage.result ?? "",
          costUsd: typeof resultMessage.total_cost_usd === "number" ? resultMessage.total_cost_usd : null,
        };
      }
    }
  } catch (error) {
    yield { type: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
