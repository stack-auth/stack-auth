// The invocation protocol between the workflow engine (backend) and the
// in-sandbox runtime (runtime-source.tsx). The engine builds a
// WorkflowSandboxInput, injects it as a global via a prelude prepended to the
// stored bundle, and the runtime returns a WorkflowSandboxOutcome through the
// js-execution result envelope.
//
// Error channel separation happens at this boundary: user-code errors
// (handler/step throws, import-time throws) come back as normal outcomes
// ("step-failed" / "handler-failed") inside a SUCCESSFUL invocation, while a
// js-execution-level error result or thrown invocation failure is a PLATFORM
// error (our bug or infra) and must never surface raw to users.
//
// IMPORTANT: runtime-source.tsx contains a self-contained copy of this
// protocol's semantics (it cannot import backend code). If you change
// anything here, bump WORKFLOWS_PROTOCOL_VERSION and update the runtime
// source in the same commit.

export const WORKFLOWS_PROTOCOL_VERSION = 1;

export type WorkflowSandboxEvent = {
  id: string,
  type: string,
  tsMillis: number,
  data: unknown,
};

export type WorkflowSandboxStepBagEntry = {
  kind: "run" | "sleep",
  stepId: string,
  result: unknown,
};

export type WorkflowSandboxLimits = {
  stepResultMaxBytes: number,
  defaultStepTimeoutMs: number,
  maxStepTimeoutMs: number,
  logsMaxBytes: number,
  /** Sleeps at or below this duration are awaited inside the invocation (precise). */
  inlineSleepMaxMs: number,
  /** Cap on TOTAL inline-awaited sleep per invocation; prevents chains of short sleeps from blowing the attempt timeout. */
  inlineSleepBudgetMs: number,
};

export type WorkflowSandboxCredentials = {
  apiUrl: string,
  projectId: string,
  branchId: string,
  secretServerKey: string,
  superSecretAdminKey: string,
};

export type WorkflowSandboxInput = {
  protocolVersion: typeof WORKFLOWS_PROTOCOL_VERSION,
  mode: "manifest" | "run-key" | "probe" | "execute",
  limits: WorkflowSandboxLimits,
  /** Present in run-key/probe/execute modes. */
  event?: WorkflowSandboxEvent,
  /** Memoized facts, keyed by stepKey. Present in probe/execute modes. */
  steps?: Record<string, WorkflowSandboxStepBagEntry>,
  /** Present in execute mode. */
  run?: { id: string, workflowId: string, version: number },
  /** Present in execute mode; run-key/probe/manifest never execute user side effects. */
  credentials?: WorkflowSandboxCredentials,
};

export type WorkflowSandboxError = {
  name: string,
  message: string,
  stack?: string,
};

export type WorkflowSandboxManifest = {
  workflowId: string,
  triggers: ({ type: "event", eventType: string } | { type: "schedule", cron: string, timezone: string })[],
  hasRunKey: boolean,
  onConflict: "skip" | "cancel-existing" | "error",
};

/** A sleep that the runtime completed inside this invocation (inline-awaited or already elapsed) and that must be recorded as a fact. */
export type WorkflowSandboxCompletedSleep = {
  stepKey: string,
  stepId: string,
  untilMillis: number,
};

export type WorkflowSandboxOutcome =
  | { type: "manifest", manifest: WorkflowSandboxManifest }
  | { type: "run-key", runKey: string | null }
  | {
    type: "probe",
    /** True when the handler returned without requesting a new step. */
    completed: boolean,
    /** First non-memoized step the code requested, if any. */
    firstRequest: { kind: "run" | "sleep", stepKey: string, stepId: string } | null,
    consumedStepKeys: string[],
    /** Set when the handler (or module import) threw during the probe replay. */
    threwError: WorkflowSandboxError | null,
  }
  | {
    type: "step-completed",
    stepKey: string,
    stepId: string,
    result: unknown,
    resultSizeBytes: number,
    elapsedMs: number,
    completedSleeps: WorkflowSandboxCompletedSleep[],
    logs: string | null,
  }
  | {
    type: "sleeping",
    stepKey: string,
    stepId: string,
    untilMillis: number,
    completedSleeps: WorkflowSandboxCompletedSleep[],
    logs: string | null,
  }
  | {
    type: "completed",
    completedSleeps: WorkflowSandboxCompletedSleep[],
    logs: string | null,
  }
  | {
    type: "step-failed",
    stepKey: string,
    stepId: string,
    nonRetriable: boolean,
    /** Resolved attempt budget for this step (default 4, overridable via step.run(id, fn, { retries })). */
    maxAttempts: number,
    error: WorkflowSandboxError,
    completedSleeps: WorkflowSandboxCompletedSleep[],
    logs: string | null,
  }
  | {
    type: "handler-failed",
    /** "import" = the workflow module itself threw while loading (top-level user code); "handler" = the handler threw outside any step; "run-key" = the runKey function threw. */
    phase: "import" | "handler" | "run-key",
    /** True for contract violations (parallel steps, non-serializable results, ...) where retrying can never help. */
    nonRetriable: boolean,
    error: WorkflowSandboxError,
    completedSleeps: WorkflowSandboxCompletedSleep[],
    logs: string | null,
  };

export const WORKFLOWS_DEFAULT_LIMITS: WorkflowSandboxLimits = {
  stepResultMaxBytes: 1024 * 1024,
  defaultStepTimeoutMs: 2 * 60 * 1000,
  maxStepTimeoutMs: 10 * 60 * 1000,
  logsMaxBytes: 64 * 1024,
  inlineSleepMaxMs: 60 * 1000,
  inlineSleepBudgetMs: 90 * 1000,
};
