// Eval run orchestrator. Each run gets one Freestyle VM; steps execute
// sequentially inside it as headless AI SDK harness sessions whose inference
// is routed through OpenRouter. All progress (run/step status, worklog message
// traces, artifacts) is persisted to SpacetimeDB so the UI updates live.

import { HarnessAgent, type HarnessAgentSession } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { randomUUID } from "node:crypto";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import type { EvalRunRow, EvalStepRunRow } from "@/types";
import { assertOpenRouterKeyValid, computeOpenRouterCostUsd, openRouterAnthropicAuth } from "./openrouter";
import { StreamUsageAccumulator } from "./usage";
import {
  DEFAULT_RUN_TIMEOUT_MINUTES,
  EVAL_DIR,
  type EvalSandbox,
  WORKSPACE_DIR,
  type RunningCommand,
  createFreestyleHarnessSandboxProvider,
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
  getStepRun,
  getWorkflow,
  listWorklog,
  listStepRuns,
  updateEvalRun,
  upsertEvalStepRun,
} from "./stdb";
import { FRAMEWORK_CHOICES } from "./default-workflow";
import { ACTIVE_RUN_STATUSES, describeError, parseSteps, renderTemplate, type EvalRunConfig, type EvalStepDefinition, type RunStatus } from "./types";

// Runs are fully headless, so any interactive turn — plan-mode
// approval or a clarifying question — hangs forever with nobody to answer, and
// the step ends having written no code. This preamble is applied to every
// HarnessAgent session and also persisted beside the prompt for later analysis.
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
  sandbox: EvalSandbox | null,
  currentCommand: RunningCommand | null,
  currentHarnessSession: HarnessAgentSession | null,
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

  constructor(private readonly runId: string, private readonly stepRunId: string, initialSeq = 0) {
    this.seq = initialSeq;
  }

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

  const active: ActiveRun = { abortController: new AbortController(), sandbox: null, currentCommand: null, currentHarnessSession: null };
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

export type ResumeRunMode = "continue" | "restart-step";

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
    setupLog.add("meta", `Freestyle VM ${sandbox.sandboxId} created (timeout ${config.timeoutMinutes}m). Installing pnpm and turbo...`, { raw: false });
    await setupLog.flush();
    const setup = await runStreamedCommand(sandbox, {
      cmd: "bash",
      // The Freestyle base image installs Node via nvm and exposes node/npm only
      // by symlinking them into /usr/local/bin; the nvm bin dir itself is NOT on
      // PATH. So `npm install -g` succeeds but the resulting pnpm/turbo binaries
      // land in an off-PATH directory and every later shell hits "command not
      // found" (exit 127). Symlink the freshly installed global bins into
      // /usr/local/bin (on PATH for both login and non-login shells, including the
      // ones the agent spawns) so pnpm/turbo are reachable for the whole run.
      // Pin pnpm to v9: the claude-code harness bootstrap runs
      // `pnpm install --frozen-lockfile` against a v9.0-format lockfile, and
      // pnpm v10+ turns "Ignored build scripts" into a hard error
      // (ERR_PNPM_IGNORED_BUILDS, exit 1) for @anthropic-ai/claude-code. The
      // harness already runs that package's install.cjs itself, so the build
      // script never needs to run during install — pnpm v9 only warns, so the
      // bootstrap succeeds. turbo stays latest.
      args: ["-lc", `set -e && mkdir -p ${WORKSPACE_DIR} ${EVAL_DIR}/worklogs && npm install -g pnpm@9 turbo 2>&1 && NPM_BIN="$(npm prefix -g)/bin" && for b in pnpm pnpx turbo; do [ -e "$NPM_BIN/$b" ] && ln -sf "$NPM_BIN/$b" "/usr/local/bin/$b"; done && pnpm --version && turbo --version`],
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
      status: "completed", resultText: `Freestyle VM ${sandbox.sandboxId} ready`, numMessages: 0,
    });

    await executeStepsFrom({
      runId,
      runModel,
      steps,
      config,
      active,
      sandbox,
      signal,
      context,
      startStepIndex: 1,
    });

    await updateEvalRun({ runId, status: "completed", currentStepIndex: steps.length, contextJson: JSON.stringify(context) });
  } catch (error) {
    const status: RunStatus = signal.aborted ? "cancelled" : "failed";
    const message = describeError(error);
    try {
      await updateEvalRun({ runId, status, currentStepIndex: 0, error: signal.aborted ? "Cancelled by user" : message });
      await markPendingStepsAs(runId, status === "cancelled" ? "cancelled" : "failed");
    } catch (updateError) {
      console.error(`[evals] failed to record terminal status for ${runId}:`, updateError);
    }
    failed = status === "failed";
  } finally {
    // Keep failed VMs alive (until their idle timeout) for post-mortem exec;
    // delete the rest to save resources.
    if (active.sandbox && !failed && !signal.aborted) {
      try {
        await active.sandbox.delete();
      } catch (stopError) {
        console.error(`[evals] failed to delete Freestyle VM for ${runId}:`, stopError);
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
  sandbox: EvalSandbox,
  signal: AbortSignal,
  active: ActiveRun,
  context: Record<string, string>,
  attemptMode?: ResumeRunMode,
  resumeFrom?: EvalStepRunRow,
};

async function executeStep(params: ExecuteStepParams): Promise<{ success: boolean, resultText: string, error?: string }> {
  const { runId, stepRunId, stepIndex, step, model, sandbox, signal, active, context, attemptMode, resumeFrom } = params;
  const nextSeq = await nextWorklogSeq(stepRunId);
  const worklog = new WorklogWriter(runId, stepRunId, nextSeq);

  let numMessages = 0;
  let resultText = "";
  let costUsd: string | undefined;
  // Sums usage across every API call in the stream (deduped by message id);
  // the result message's own usage only covers the final call.
  const usage = new StreamUsageAccumulator();
  let sessionId: string | undefined;
  // Widened so the closure assignment below isn't narrowed away at the final check.
  let isError = false as boolean;
  let lastStepUpsert = 0;

  const upsertStep = async (status: string, error?: string) => {
    const totals = usage.totals();
    await upsertEvalStepRun({
      stepRunId, runId, stepIndex, stepName: step.name, model, status,
      resultText, error, numMessages, costUsd,
      inputTokens: totals.sawUsage ? totals.inputTokens : undefined,
      outputTokens: totals.sawUsage ? totals.outputTokens : undefined,
      cacheReadTokens: totals.sawUsage ? totals.cacheReadTokens : undefined,
      cacheCreationTokens: totals.sawUsage ? totals.cacheCreationTokens : undefined,
      sessionId,
    });
  };

  await upsertStep("running");

  const prompt = buildStepPrompt({
    step,
    context,
    attemptMode,
    resumeFrom,
  });
  const promptPath = `${EVAL_DIR}/step-${stepIndex}-prompt.md`;
  await writeSandboxFile(sandbox, promptPath, AUTONOMY_PREAMBLE + prompt);
  worklog.add("meta", JSON.stringify({
    type: "eval_step_started",
    stepIndex,
    stepName: step.name,
    model,
    attemptMode: attemptMode ?? "initial",
    previousStatus: resumeFrom?.status,
    previousError: resumeFrom?.error,
    prompt,
  }), { raw: false });
  // The next long-running call may hang before Claude Code emits its first
  // stream part. Persist the start marker immediately so the run detail panel
  // is never blank while a step is already running.
  await worklog.flush();

  const handleStreamPart = (part: unknown) => {
    const kind = typeof part === "object" && part !== null && typeof (part as { type?: unknown }).type === "string"
      ? (part as { type: string }).type
      : "meta";
    numMessages += 1;
    worklog.add(kind, JSON.stringify(part));
    const now = Date.now();
    if (now - lastStepUpsert > 2000) {
      lastStepUpsert = now;
      runAsynchronously(() => upsertStep("running"));
    }
  };

  try {
    const auth = openRouterAnthropicAuth(model);
    const agent = new HarnessAgent({
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
      instructions: AUTONOMY_PREAMBLE,
      permissionMode: "allow-all",
      onSandboxSession: async ({ session, sessionWorkDir, abortSignal }) => {
        await session.run({
          command: `rm -rf ${shellQuote(sessionWorkDir)} && ln -s ${shellQuote(WORKSPACE_DIR)} ${shellQuote(sessionWorkDir)}`,
          abortSignal,
        });
      },
    });
    const session = await agent.createSession({ sessionId: stepRunId, abortSignal: signal });
    active.currentHarnessSession = session;
    sessionId = session.sessionId;

    const result = await agent.stream({
      session,
      prompt,
      abortSignal: signal,
    });

    for await (const part of result.stream) {
      handleStreamPart(part);
      if (part.type === "text-delta") {
        resultText += part.text;
      } else if (part.type === "error") {
        isError = true;
      }
    }

    resultText = await result.text;
    usage.addAiSdkUsage(await result.usage);
    await session.destroy();
    active.currentHarnessSession = null;
    active.currentCommand = null;
    await worklog.flush();

    // Reprice from the model's actual OpenRouter rates.
    costUsd = await computeOpenRouterCostUsd(model, usage.totals()) ?? costUsd;

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
    if (isError) {
      const error = "Harness agent reported an error result";
      await upsertStep("failed", error);
      return { success: false, resultText, error };
    }
    await upsertStep("completed");
    return { success: true, resultText };
  } catch (error) {
    await active.currentHarnessSession?.destroy();
    active.currentHarnessSession = null;
    active.currentCommand = null;
    await worklog.flush();
    const message = describeError(error);
    await upsertStep(signal.aborted ? "cancelled" : "failed", message);
    return { success: false, resultText, error: message };
  }
}

async function collectArtifacts(params: { runId: string, stepRunId: string, sandbox: EvalSandbox, paths: string[] }): Promise<void> {
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
      await active.currentHarnessSession?.destroy();
      await active.currentCommand?.kill();
    } catch {
      // Command may have already exited.
    }
    return; // executeRun's catch records the cancelled status.
  }
  // Stale run (e.g. dev server restarted while a run row stayed active).
  if (ACTIVE_RUN_STATUSES.includes(run.status as RunStatus)) {
    await updateEvalRun({ runId, status: "cancelled", currentStepIndex: run.currentStepIndex, error: "Cancelled by user" });
    await markPendingStepsAs(runId, "cancelled");
  }
}

export async function resumeEvalRun(runId: string, mode: ResumeRunMode): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.status === "completed") {
    throw new Error(`Run ${runId} is already completed`);
  }
  const workflow = await getWorkflow(run.workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${run.workflowId}`);
  const steps = parseSteps(workflow.stepsJson);
  const stepRuns = await listStepRuns(runId);
  const failedOrCancelled = stepRuns.find(s => s.status === "failed" || s.status === "cancelled");
  const resumeStepIndex = failedOrCancelled?.stepIndex ?? Math.max(1, Math.min(run.currentStepIndex, steps.length));
  await launchRunFromStep(runId, resumeStepIndex, mode, failedOrCancelled);
}

// Re-run a specific workflow step (and every step after it, since downstream
// outputs depend on it) inside the run's existing sandbox. "continue" injects
// the prior partial attempt; "restart-step" runs the step from scratch.
export async function runStepFromIndex(runId: string, stepIndex: number, mode: ResumeRunMode): Promise<void> {
  const resumeFrom = mode === "continue" ? await getStepRun(`${runId}-step-${stepIndex}`) : undefined;
  await launchRunFromStep(runId, stepIndex, mode, resumeFrom);
}

// Mark a step back to "pending" and clear its prior result/error/usage so it
// reads as not-yet-run in the UI. Does NOT execute anything — pair with
// runStepFromIndex to re-run, or with the run-level resume buttons.
export async function resetStep(runId: string, stepIndex: number): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (ACTIVE_RUN_STATUSES.includes(run.status as RunStatus) || activeRuns().has(runId)) {
    throw new Error(`Run ${runId} is active; stop it before resetting a step`);
  }
  if (stepIndex < 1) throw new Error("The sandbox setup step cannot be reset; start a new run instead");
  const stepRun = await getStepRun(`${runId}-step-${stepIndex}`);
  if (!stepRun) throw new Error(`Run ${runId} has no step ${stepIndex}`);
  await upsertEvalStepRun({
    stepRunId: stepRun.stepRunId, runId, stepIndex: stepRun.stepIndex, stepName: stepRun.stepName,
    model: stepRun.model, status: "pending", resultText: "", error: undefined, numMessages: 0,
    costUsd: undefined, inputTokens: undefined, outputTokens: undefined,
    cacheReadTokens: undefined, cacheCreationTokens: undefined, sessionId: undefined,
  });
}

// Shared launcher for resume / per-step re-runs. Validates the run is idle and
// has a live sandbox, then runs the workflow forward from `startStepIndex`.
async function launchRunFromStep(runId: string, startStepIndex: number, mode: ResumeRunMode, resumeFrom: EvalStepRunRow | undefined): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (ACTIVE_RUN_STATUSES.includes(run.status as RunStatus) || activeRuns().has(runId)) {
    throw new Error(`Run ${runId} is already active`);
  }
  if (!run.sandboxId) {
    throw new Error(`Run ${runId} has no sandbox to resume; start a new run instead`);
  }

  const workflow = await getWorkflow(run.workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${run.workflowId}`);
  const steps = parseSteps(workflow.stepsJson);
  const config = parseRunConfig(run.configJson);
  const context = parseRunContext(run.contextJson);
  if (startStepIndex === 0) {
    throw new Error("Sandbox setup cannot be resumed; start a new run instead");
  }
  if (startStepIndex < 1 || startStepIndex > steps.length) {
    throw new Error(`Run ${runId} has no workflow step ${startStepIndex}`);
  }

  const active: ActiveRun = {
    abortController: new AbortController(),
    sandbox: await getEvalSandbox(run.sandboxId),
    currentCommand: null,
    currentHarnessSession: null,
  };
  activeRuns().set(runId, active);
  runAsynchronously(async () => {
    let failed = false;
    try {
      await updateEvalRun({
        runId,
        status: "running",
        currentStepIndex: startStepIndex,
        contextJson: JSON.stringify(context),
        error: undefined,
      });
      await executeStepsFrom({
        runId,
        runModel: run.model,
        steps,
        config,
        active,
        sandbox: active.sandbox ?? throwErr("Resume active run lost its sandbox before execution"),
        signal: active.abortController.signal,
        context,
        startStepIndex,
        resumeMode: mode,
        resumeFrom,
      });
      await updateEvalRun({ runId, status: "completed", currentStepIndex: steps.length, contextJson: JSON.stringify(context), error: undefined });
    } catch (error) {
      const status: RunStatus = active.abortController.signal.aborted ? "cancelled" : "failed";
      const message = describeError(error);
      failed = status === "failed";
      try {
        await updateEvalRun({ runId, status, currentStepIndex: startStepIndex, contextJson: JSON.stringify(context), error: status === "cancelled" ? "Cancelled by user" : message });
        await markPendingStepsAs(runId, status === "cancelled" ? "cancelled" : "failed");
      } catch (updateError) {
        console.error(`[evals] failed to record resumed terminal status for ${runId}:`, updateError);
      }
    } finally {
      activeRuns().delete(runId);
      if (active.sandbox && !failed && !active.abortController.signal.aborted) {
        try {
          await active.sandbox.delete();
        } catch (stopError) {
          console.error(`[evals] failed to delete Freestyle VM for resumed run ${runId}:`, stopError);
        }
      }
    }
  });
}

async function executeStepsFrom(params: {
  runId: string,
  runModel: string,
  steps: EvalStepDefinition[],
  config: EvalRunConfig,
  active: ActiveRun,
  sandbox: EvalSandbox,
  signal: AbortSignal,
  context: Record<string, string>,
  startStepIndex: number,
  resumeMode?: ResumeRunMode,
  resumeFrom?: EvalStepRunRow,
}): Promise<void> {
  for (let stepIndex = params.startStepIndex; stepIndex <= params.steps.length; stepIndex++) {
    throwIfAborted(params.signal);
    const step = params.steps[stepIndex - 1] ?? throwErr(`Workflow is missing step ${stepIndex}`);
    const stepRunId = `${params.runId}-step-${stepIndex}`;
    const stepModel = params.config.stepModels?.[stepIndex] ?? step.model ?? params.runModel;
    const resumeFrom = stepIndex === params.startStepIndex ? params.resumeFrom : undefined;

    await updateEvalRun({
      runId: params.runId,
      status: "running",
      currentStepIndex: stepIndex,
      contextJson: JSON.stringify(params.context),
    });
    const result = await executeStep({
      runId: params.runId,
      stepRunId,
      stepIndex,
      step,
      model: stepModel,
      sandbox: params.sandbox,
      signal: params.signal,
      active: params.active,
      context: params.context,
      attemptMode: stepIndex === params.startStepIndex ? params.resumeMode : undefined,
      resumeFrom,
    });

    params.context[step.outputKey ?? `step${stepIndex}`] = result.resultText;
    await updateEvalRun({
      runId: params.runId,
      status: "running",
      currentStepIndex: stepIndex,
      contextJson: JSON.stringify(params.context),
    });
    if (!result.success) {
      throw new Error(`Step ${stepIndex} (${step.name}) failed: ${result.error ?? "unknown error"}`);
    }
  }
}

function buildStepPrompt(params: {
  step: EvalStepDefinition,
  context: Record<string, string>,
  attemptMode?: ResumeRunMode,
  resumeFrom?: EvalStepRunRow,
}): string {
  const basePrompt = renderTemplate(params.step.prompt, params.context);
  if (params.attemptMode !== "continue" || !params.resumeFrom) return basePrompt;
  return `<resume_previous_attempt>
The previous attempt of this same workflow step stopped with status "${params.resumeFrom.status}".
Error: ${params.resumeFrom.error ?? "none recorded"}

Partial assistant output from the previous attempt:
${params.resumeFrom.resultText || "(no partial output was recorded)"}

Continue from that point in the existing sandbox. Preserve useful existing files and state. If the previous attempt left a bad partial change, repair it before proceeding.
</resume_previous_attempt>

${basePrompt}`;
}

async function nextWorklogSeq(stepRunId: string): Promise<number> {
  const rows = await listWorklog(stepRunId);
  return rows.reduce((max, row) => Math.max(max, row.seq + 1), 0);
}

function parseRunContext(contextJson: string): Record<string, string> {
  const parsed = JSON.parse(contextJson) as Record<string, unknown>;
  const context: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") context[key] = value;
  }
  return context;
}

function parseRunConfig(configJson: string): EvalRunConfig {
  const parsed = JSON.parse(configJson) as Partial<EvalRunConfig>;
  return {
    timeoutMinutes: typeof parsed.timeoutMinutes === "number" ? parsed.timeoutMinutes : DEFAULT_RUN_TIMEOUT_MINUTES,
    variables: parsed.variables,
    stepModels: parsed.stepModels,
  };
}

function throwErr(message: string): never {
  throw new Error(message);
}

// Resolves the live sandbox for a run, reattaching via Freestyle when the
// run isn't tracked in this process (e.g. after an HMR reload).
export async function getRunSandbox(runId: string): Promise<EvalSandbox> {
  const active = activeRuns().get(runId);
  if (active?.sandbox) return active.sandbox;
  const run = await getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (!run.sandboxId) throw new Error(`Run ${runId} has no sandbox (status: ${run.status})`);
  return await getEvalSandbox(run.sandboxId);
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
