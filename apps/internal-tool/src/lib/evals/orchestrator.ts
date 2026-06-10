// Eval run orchestrator. Each run gets one Vercel Sandbox; steps execute
// sequentially inside it as headless Claude Code sessions whose inference is
// routed through OpenRouter. All progress (run/step status, worklog message
// traces, artifacts) is persisted to SpacetimeDB so the UI updates live.

import { randomUUID } from "node:crypto";
import type { Command, Sandbox } from "@vercel/sandbox";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import type { EvalRunRow } from "@/types";
import { assertOpenRouterKeyValid, claudeCodeOpenRouterEnv, computeOpenRouterCostUsd } from "./openrouter";
import {
  DEFAULT_RUN_TIMEOUT_MINUTES,
  EVAL_DIR,
  WORKSPACE_DIR,
  createEvalSandbox,
  getEvalSandbox,
  readSandboxFile,
  runCapturedCommand,
  runStreamedCommand,
  writeSandboxFile,
} from "./sandbox";
import {
  addEvalArtifact,
  appendEvalWorklog,
  createEvalRun,
  getRun,
  getWorkflow,
  listStepRuns,
  updateEvalRun,
  upsertEvalStepRun,
} from "./stdb";
import { FRAMEWORK_CHOICES } from "./default-workflow";
import { ACTIVE_RUN_STATUSES, parseSteps, renderTemplate, type EvalRunConfig, type EvalStepDefinition, type RunStatus } from "./types";

// Runs are fully headless (`claude -p`), so any interactive turn — plan-mode
// approval or a clarifying question — hangs forever with nobody to answer, and
// the step ends having written no code. This preamble is prepended to every
// step prompt, and the matching tools are hard-disabled on the CLI below.
const AUTONOMY_PREAMBLE = `<execution_mode>
You are running FULLY AUTONOMOUSLY and HEADLESS. There is NO human available to approve plans, answer questions, or confirm anything — any attempt to wait for a person will hang the run and the step will fail with no work done.

Rules:
- Do NOT enter plan mode. Do NOT call ExitPlanMode. Do NOT call AskUserQuestion. Do NOT pause for approval, confirmation, or review.
- When you would normally ask the user or present a plan, instead choose the most reasonable assumption, state it in one line, and immediately proceed to do the work.
- Complete the task end-to-end in THIS session: actually create/edit every file and run every command yourself. A plan or description is not a deliverable — working output is.
</execution_mode>

`;

const MAX_ARTIFACT_CHARS = 1_500_000;
const WORKLOG_FLUSH_INTERVAL_MS = 1000;
const WORKLOG_FLUSH_BATCH_SIZE = 20;
// Worklog entries are stored in FULL — never trimmed. To avoid packing many
// large entries into a single oversized reducer call, flush eagerly once a
// pending batch crosses this byte budget. This only affects how entries are
// split across reducer calls, not their content.
const WORKLOG_FLUSH_BYTES = 256 * 1024;

type ActiveRun = {
  abortController: AbortController,
  sandbox: Sandbox | null,
  currentCommand: Command | null,
};

const globalStore = globalThis as unknown as { __hexclaveEvalActiveRuns?: Map<string, ActiveRun> };
function activeRuns(): Map<string, ActiveRun> {
  globalStore.__hexclaveEvalActiveRuns = globalStore.__hexclaveEvalActiveRuns ?? new Map();
  return globalStore.__hexclaveEvalActiveRuns;
}

class WorklogWriter {
  private pending: { seq: number, kind: string, content: string }[] = [];
  private pendingBytes = 0;
  private seq = 0;
  private lastFlush = Date.now();
  // Raw stream-json lines kept so they can be written back into the sandbox
  // for the report step to analyze.
  readonly rawLines: string[] = [];

  constructor(private readonly runId: string, private readonly stepRunId: string) {}

  nextSeq(): number {
    return this.seq;
  }

  add(kind: string, content: string, options?: { raw?: boolean }): void {
    // The log is kept in FULL — content is never trimmed.
    if (options?.raw !== false) this.rawLines.push(content);
    this.pending.push({ seq: this.seq++, kind, content });
    this.pendingBytes += content.length;
    if (
      this.pending.length >= WORKLOG_FLUSH_BATCH_SIZE ||
      this.pendingBytes >= WORKLOG_FLUSH_BYTES ||
      Date.now() - this.lastFlush > WORKLOG_FLUSH_INTERVAL_MS
    ) {
      runAsynchronously(() => this.flush());
    }
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const entries = this.pending;
    this.pending = [];
    this.pendingBytes = 0;
    this.lastFlush = Date.now();
    try {
      await appendEvalWorklog({ runId: this.runId, stepRunId: this.stepRunId, entries });
    } catch (error) {
      console.error(`[evals] failed to flush worklog for ${this.stepRunId}:`, error);
    }
  }
}

export type StartRunOptions = {
  workflowId: string,
  model?: string,
  label?: string,
  timeoutMinutes?: number,
  variables?: Record<string, string>,
  stepModels?: Record<number, string>,
};

export async function startEvalRun(options: StartRunOptions): Promise<string> {
  const workflow = await getWorkflow(options.workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${options.workflowId}`);
  const steps = parseSteps(workflow.stepsJson);
  if (steps.length === 0) throw new Error("Workflow has no steps");

  const runId = randomUUID();
  const model = options.model ?? workflow.defaultModel;
  const config: EvalRunConfig = {
    timeoutMinutes: options.timeoutMinutes ?? DEFAULT_RUN_TIMEOUT_MINUTES,
    variables: options.variables,
    stepModels: options.stepModels,
  };
  await createEvalRun({
    runId,
    workflowId: workflow.workflowId,
    workflowName: workflow.name,
    label: options.label ?? `${workflow.name} · ${model}`,
    model,
    totalSteps: steps.length + 1, // +1 for the sandbox-setup step
    configJson: JSON.stringify(config),
  });

  const active: ActiveRun = { abortController: new AbortController(), sandbox: null, currentCommand: null };
  activeRuns().set(runId, active);
  // Fire and forget; progress is observable via SpacetimeDB.
  runAsynchronously(async () => {
    try {
      await executeRun(runId, workflow.workflowId, model, steps, config, active);
    } catch (error) {
      console.error(`[evals] run ${runId} crashed:`, error);
    } finally {
      activeRuns().delete(runId);
    }
  });
  return runId;
}

export type BatchRunOptions = {
  workflowId: string,
  models: string[],
  runsPerModel?: number,
  timeoutMinutes?: number,
  variables?: Record<string, string>,
  labelPrefix?: string,
};

export async function startEvalBatch(options: BatchRunOptions): Promise<string[]> {
  const runsPerModel = Math.max(1, Math.min(options.runsPerModel ?? 1, 10));
  if (options.models.length === 0) throw new Error("At least one model is required");
  const runIds: string[] = [];
  for (const model of options.models) {
    for (let i = 0; i < runsPerModel; i++) {
      const suffix = runsPerModel > 1 ? ` #${i + 1}` : "";
      runIds.push(await startEvalRun({
        workflowId: options.workflowId,
        model,
        label: `${options.labelPrefix ?? "batch"} · ${model}${suffix}`,
        timeoutMinutes: options.timeoutMinutes,
        variables: options.variables,
      }));
    }
  }
  return runIds;
}

async function executeRun(
  runId: string,
  workflowId: string,
  runModel: string,
  steps: EvalStepDefinition[],
  config: EvalRunConfig,
  active: ActiveRun,
): Promise<void> {
  const signal = active.abortController.signal;
  const context: Record<string, string> = {
    framework: FRAMEWORK_CHOICES[Math.floor(Math.random() * FRAMEWORK_CHOICES.length)],
    model: runModel,
    workflow_id: workflowId,
    run_id: runId,
    ...config.variables,
  };

  const setupStepRunId = `${runId}-step-0`;
  let failed = false;
  try {
    await updateEvalRun({ runId, status: "booting", currentStepIndex: 0, contextJson: JSON.stringify(context) });
    await upsertEvalStepRun({
      stepRunId: setupStepRunId, runId, stepIndex: 0, stepName: "Sandbox setup", model: "-",
      status: "running", resultText: "", numMessages: 0,
    });

    // Fail fast on a bad OpenRouter key before paying for a sandbox that would
    // otherwise spin in an endless api_retry loop.
    await assertOpenRouterKeyValid();

    const sandbox = await createEvalSandbox({ timeoutMinutes: config.timeoutMinutes });
    active.sandbox = sandbox;
    await updateEvalRun({ runId, status: "booting", sandboxId: sandbox.sandboxId, currentStepIndex: 0 });

    const setupLog = new WorklogWriter(runId, setupStepRunId);
    setupLog.add("meta", `Sandbox ${sandbox.sandboxId} created (timeout ${config.timeoutMinutes}m). Installing Claude Code, pnpm and turbo…`, { raw: false });
    const setup = await runStreamedCommand(sandbox, {
      cmd: "bash",
      args: ["-lc", `mkdir -p ${WORKSPACE_DIR} ${EVAL_DIR}/worklogs && npm install -g @anthropic-ai/claude-code pnpm turbo 2>&1 && claude --version`],
      signal,
      onStdoutLine: line => setupLog.add("stdout", line, { raw: false }),
      onStderrLine: line => setupLog.add("stderr", line, { raw: false }),
      onCommand: cmd => { active.currentCommand = cmd; },
    });
    active.currentCommand = null;
    await setupLog.flush();
    if (setup.exitCode !== 0) {
      await upsertEvalStepRun({
        stepRunId: setupStepRunId, runId, stepIndex: 0, stepName: "Sandbox setup", model: "-",
        status: "failed", resultText: "", error: `Setup exited with code ${setup.exitCode}`, numMessages: 0,
      });
      throw new Error(`Sandbox setup failed with exit code ${setup.exitCode}`);
    }
    await upsertEvalStepRun({
      stepRunId: setupStepRunId, runId, stepIndex: 0, stepName: "Sandbox setup", model: "-",
      status: "completed", resultText: `Sandbox ${sandbox.sandboxId} ready`, numMessages: 0,
    });

    for (let i = 0; i < steps.length; i++) {
      throwIfAborted(signal);
      const step = steps[i];
      const stepIndex = i + 1;
      const stepRunId = `${runId}-step-${stepIndex}`;
      const stepModel = config.stepModels?.[stepIndex] ?? step.model ?? runModel;

      await updateEvalRun({ runId, status: "running", currentStepIndex: stepIndex, contextJson: JSON.stringify(context) });
      const result = await executeStep({
        runId, stepRunId, stepIndex, step, model: stepModel, sandbox, signal, active, context,
      });

      context[step.outputKey ?? `step${stepIndex}`] = result.resultText;
      await updateEvalRun({ runId, status: "running", currentStepIndex: stepIndex, contextJson: JSON.stringify(context) });
      if (!result.success) {
        failed = true;
        throw new Error(`Step ${stepIndex} (${step.name}) failed: ${result.error ?? "unknown error"}`);
      }
    }

    await updateEvalRun({ runId, status: "completed", currentStepIndex: steps.length, contextJson: JSON.stringify(context) });
  } catch (error) {
    const status: RunStatus = signal.aborted ? "cancelled" : "failed";
    const message = error instanceof Error ? error.message : String(error);
    try {
      await updateEvalRun({ runId, status, currentStepIndex: 0, error: signal.aborted ? "Cancelled by user" : message });
      await markPendingStepsAs(runId, status === "cancelled" ? "cancelled" : "failed");
    } catch (updateError) {
      console.error(`[evals] failed to record terminal status for ${runId}:`, updateError);
    }
    failed = status === "failed";
  } finally {
    // Keep failed sandboxes alive (until their timeout) for post-mortem exec;
    // stop the rest to save resources.
    if (active.sandbox && !failed) {
      try {
        await active.sandbox.stop();
      } catch (stopError) {
        console.error(`[evals] failed to stop sandbox for ${runId}:`, stopError);
      }
    }
  }
}

type ExecuteStepParams = {
  runId: string,
  stepRunId: string,
  stepIndex: number,
  step: EvalStepDefinition,
  model: string,
  sandbox: Sandbox,
  signal: AbortSignal,
  active: ActiveRun,
  context: Record<string, string>,
};

async function executeStep(params: ExecuteStepParams): Promise<{ success: boolean, resultText: string, error?: string }> {
  const { runId, stepRunId, stepIndex, step, model, sandbox, signal, active, context } = params;
  const worklog = new WorklogWriter(runId, stepRunId);

  let numMessages = 0;
  let resultText = "";
  let costUsd: string | undefined;
  let inputTokens: bigint | undefined;
  let outputTokens: bigint | undefined;
  let cacheReadTokens: bigint | undefined;
  let cacheCreationTokens: bigint | undefined;
  let sessionId: string | undefined;
  // Widened so the closure assignment below isn't narrowed away at the final check.
  let isError = false as boolean;
  let lastStepUpsert = 0;

  const upsertStep = async (status: string, error?: string) => {
    await upsertEvalStepRun({
      stepRunId, runId, stepIndex, stepName: step.name, model, status,
      resultText, error, numMessages, costUsd,
      inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, sessionId,
    });
  };

  await upsertStep("running");

  const prompt = AUTONOMY_PREAMBLE + renderTemplate(step.prompt, context);
  const promptPath = `${EVAL_DIR}/step-${stepIndex}-prompt.md`;
  await writeSandboxFile(sandbox, promptPath, prompt);
  worklog.add("meta", JSON.stringify({ type: "eval_step_started", stepIndex, stepName: step.name, model, prompt }), { raw: false });

  const handleStreamLine = (line: string) => {
    let kind = "meta";
    try {
      const message = JSON.parse(line) as { type?: string, result?: unknown, total_cost_usd?: unknown, usage?: unknown, session_id?: unknown, is_error?: unknown };
      kind = typeof message.type === "string" ? message.type : "meta";
      numMessages += 1;
      if (message.type === "result") {
        resultText = typeof message.result === "string" ? message.result : JSON.stringify(message.result ?? "");
        if (typeof message.total_cost_usd === "number") costUsd = message.total_cost_usd.toFixed(6);
        // The final result's `usage` is the cumulative token usage for the step.
        const usage = message.usage as Record<string, unknown> | undefined;
        if (usage) {
          inputTokens = toTokenCount(usage.input_tokens) ?? inputTokens;
          outputTokens = toTokenCount(usage.output_tokens) ?? outputTokens;
          cacheReadTokens = toTokenCount(usage.cache_read_input_tokens) ?? cacheReadTokens;
          cacheCreationTokens = toTokenCount(usage.cache_creation_input_tokens) ?? cacheCreationTokens;
        }
        if (typeof message.session_id === "string") sessionId = message.session_id;
        if (message.is_error === true) isError = true;
      } else if (typeof (message as { session_id?: unknown }).session_id === "string" && !sessionId) {
        sessionId = (message as { session_id: string }).session_id;
      }
    } catch {
      kind = "stdout";
    }
    worklog.add(kind, line);
    const now = Date.now();
    if (now - lastStepUpsert > 2000) {
      lastStepUpsert = now;
      void upsertStep("running").catch(() => {});
    }
  };

  try {
    // Hard guard: even if the model tries, these interactive tools can't be used
    // headless. Disabling them forces it to implement instead of stalling.
    const claudeCommand = `claude -p --output-format stream-json --verbose --dangerously-skip-permissions --disallowedTools "ExitPlanMode,AskUserQuestion" < ${shellQuote(promptPath)}`;
    const { exitCode } = await runStreamedCommand(sandbox, {
      cmd: "bash",
      args: ["-lc", claudeCommand],
      cwd: WORKSPACE_DIR,
      env: {
        ...claudeCodeOpenRouterEnv(model),
        IS_SANDBOX: "1",
      },
      signal,
      onStdoutLine: handleStreamLine,
      onStderrLine: line => worklog.add("stderr", line, { raw: false }),
      onCommand: cmd => { active.currentCommand = cmd; },
    });
    active.currentCommand = null;
    await worklog.flush();

    // Reprice from the model's actual OpenRouter rates; the stream's
    // total_cost_usd (kept as fallback) is Claude Code pricing tokens against
    // its built-in Anthropic table, which is wrong for OpenRouter models.
    costUsd = await computeOpenRouterCostUsd(model, { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }) ?? costUsd;

    // Persist the raw trace into the sandbox so later steps (the report step)
    // can analyze the full message history.
    try {
      await writeSandboxFile(sandbox, `${EVAL_DIR}/worklogs/step-${stepIndex}.jsonl`, worklog.rawLines.join("\n"));
    } catch (writeError) {
      console.error(`[evals] failed to write worklog file for step ${stepIndex}:`, writeError);
    }

    await collectArtifacts({ runId, stepRunId, sandbox, paths: step.artifacts ?? [] });

    if (signal.aborted) {
      await upsertStep("cancelled", "Cancelled by user");
      return { success: false, resultText, error: "Cancelled by user" };
    }
    if (exitCode !== 0 || isError) {
      const error = exitCode !== 0 ? `Claude Code exited with code ${exitCode}` : "Claude Code reported an error result";
      await upsertStep("failed", error);
      return { success: false, resultText, error };
    }
    await upsertStep("completed");
    return { success: true, resultText };
  } catch (error) {
    active.currentCommand = null;
    await worklog.flush();
    const message = error instanceof Error ? error.message : String(error);
    await upsertStep(signal.aborted ? "cancelled" : "failed", message);
    return { success: false, resultText, error: message };
  }
}

async function collectArtifacts(params: { runId: string, stepRunId: string, sandbox: Sandbox, paths: string[] }): Promise<void> {
  for (const path of params.paths) {
    try {
      const absolutePath = path.startsWith("/") ? path : `${WORKSPACE_DIR}/${path}`;
      const content = await readSandboxFile(params.sandbox, absolutePath, MAX_ARTIFACT_CHARS);
      if (content === null) continue;
      await addEvalArtifact({
        runId: params.runId,
        stepRunId: params.stepRunId,
        path: absolutePath,
        contentType: contentTypeForPath(absolutePath),
        content,
      });
    } catch (error) {
      console.error(`[evals] failed to collect artifact ${path}:`, error);
    }
  }
}

function contentTypeForPath(path: string): string {
  if (path.endsWith(".html") || path.endsWith(".htm")) return "text/html";
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".json") || path.endsWith(".jsonl")) return "application/json";
  return "text/plain";
}

// Claude Code reports token counts as JS numbers; coerce to a non-negative
// bigint for the u64 column (ignoring missing/garbage values).
function toTokenCount(value: unknown): bigint | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return BigInt(Math.round(value));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Run cancelled");
}

async function markPendingStepsAs(runId: string, status: "failed" | "cancelled"): Promise<void> {
  const stepRuns = await listStepRuns(runId);
  for (const stepRun of stepRuns) {
    if (stepRun.status === "running" || stepRun.status === "pending") {
      await upsertEvalStepRun({
        stepRunId: stepRun.stepRunId, runId, stepIndex: stepRun.stepIndex, stepName: stepRun.stepName,
        model: stepRun.model, status, resultText: stepRun.resultText,
        error: status === "cancelled" ? "Cancelled by user" : "Run failed",
        numMessages: stepRun.numMessages, costUsd: stepRun.costUsd,
        inputTokens: stepRun.inputTokens, outputTokens: stepRun.outputTokens,
        cacheReadTokens: stepRun.cacheReadTokens, cacheCreationTokens: stepRun.cacheCreationTokens,
        sessionId: stepRun.sessionId,
      });
    }
  }
}

export async function cancelEvalRun(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  const active = activeRuns().get(runId);
  if (active) {
    active.abortController.abort();
    try {
      await active.currentCommand?.kill();
    } catch {
      // Command may have already exited.
    }
    try {
      await active.sandbox?.stop();
    } catch {
      // Sandbox may have already stopped.
    }
    return; // executeRun's catch records the cancelled status.
  }
  // Stale run (e.g. dev server restarted while a run row stayed active).
  if (ACTIVE_RUN_STATUSES.includes(run.status as RunStatus)) {
    if (run.sandboxId) {
      try {
        const sandbox = await getEvalSandbox(run.sandboxId);
        await sandbox.stop();
      } catch {
        // Sandbox already gone.
      }
    }
    await updateEvalRun({ runId, status: "cancelled", currentStepIndex: run.currentStepIndex, error: "Cancelled by user" });
    await markPendingStepsAs(runId, "cancelled");
  }
}

// Resolves the live sandbox for a run, reattaching via Sandbox.get when the
// run isn't tracked in this process (e.g. after an HMR reload).
export async function getRunSandbox(runId: string): Promise<Sandbox> {
  const active = activeRuns().get(runId);
  if (active?.sandbox) return active.sandbox;
  const run = await getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (!run.sandboxId) throw new Error(`Run ${runId} has no sandbox (status: ${run.status})`);
  const sandbox = await getEvalSandbox(run.sandboxId);
  if (sandbox.status !== "running" && sandbox.status !== "pending") {
    throw new Error(`Sandbox for run ${runId} is not running (status: ${sandbox.status})`);
  }
  return sandbox;
}

export async function execInRun(runId: string, command: string): Promise<{ exitCode: number, stdout: string, stderr: string, truncated: boolean }> {
  const sandbox = await getRunSandbox(runId);
  return await runCapturedCommand(sandbox, command);
}

export async function readRunFile(runId: string, path: string): Promise<string | null> {
  const sandbox = await getRunSandbox(runId);
  const absolutePath = path.startsWith("/") ? path : `${WORKSPACE_DIR}/${path}`;
  return await readSandboxFile(sandbox, absolutePath);
}

export function isRunActiveInProcess(runId: string): boolean {
  return activeRuns().has(runId);
}

export function describeRunForDisplay(run: EvalRunRow): { isLiveInProcess: boolean } {
  return { isLiveInProcess: activeRuns().has(run.runId) };
}
