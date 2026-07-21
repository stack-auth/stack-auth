// The in-sandbox workflow runtime: the source of the virtual
// "@hexclave/workflows" module that gets bundled with every workflow file at
// sync time (same inlined-virtual-package mechanism as @hexclave/emails in
// email-rendering.tsx), plus the entry harness.
//
// This code executes INSIDE the js-execution sandbox, never in the backend
// process. It is deliberately self-contained (no imports) and communicates
// with the engine exclusively through the protocol in protocol.tsx: input
// arrives as globalThis.__HEXCLAVE_WORKFLOWS_INPUT__ (set by a prelude the
// engine prepends per invocation), and the outcome is the harness's return
// value. If you change the protocol, update BOTH files in the same commit
// and bump WORKFLOWS_PROTOCOL_VERSION.
//
// The runtime is versioned as part of the workflow runtime environment
// (runtime-env.tsx): compiled bundles embed a byte-copy of this source, so
// editing this file only affects workflow versions synced AFTER the change.
// Behavioral changes MUST bump WORKFLOWS_CURRENT_RUNTIME_ENV_VERSION.
//
// Style note: the source below avoids backticks and "${" so it can live in
// an ordinary template literal without escaping headaches.

export const WORKFLOWS_RUNTIME_PACKAGE_SOURCE = `
// Virtual module "@hexclave/workflows" (workflow runtime, executes in the sandbox).

type SandboxTrigger = { type: "event", eventType: string } | { type: "schedule", cron: string, timezone: string };
type SandboxStepBagEntry = { kind: "run" | "sleep", stepId: string, result: unknown };
type SandboxInput = {
  protocolVersion: number,
  mode: "manifest" | "run-key" | "probe" | "execute",
  limits: {
    stepResultMaxBytes: number,
    defaultStepTimeoutMs: number,
    maxStepTimeoutMs: number,
    logsMaxBytes: number,
    inlineSleepMaxMs: number,
    inlineSleepBudgetMs: number,
  },
  event?: { id: string, type: string, tsMillis: number, data: unknown },
  steps?: Record<string, SandboxStepBagEntry>,
  run?: { id: string, workflowId: string, version: number },
  credentials?: { apiUrl: string, projectId: string, branchId: string, secretServerKey: string },
  secrets?: Record<string, string>,
};

function getInput(): SandboxInput {
  const input = (globalThis as any).__HEXCLAVE_WORKFLOWS_INPUT__;
  if (input == null) throw new Error("Workflow runtime input missing — the invocation prelude was not injected. This is a platform bug.");
  if (input.protocolVersion !== 1) throw new Error("Workflow runtime protocol version mismatch: got " + JSON.stringify(input.protocolVersion) + ". This is a platform bug.");
  return input as SandboxInput;
}

// ─── Public authoring API ──────────────────────────────────────────────────

export type WorkflowEvent<T = unknown> = {
  /** Platform UUID of the trigger event. */
  id: string,
  /** Wire type, e.g. "user.created", "custom.order.shipped", "schedule". */
  type: string,
  /** When the event happened. Payloads are snapshots at this time — re-fetch inside the run (guard steps) when freshness matters. */
  ts: Date,
  data: T,
};

export type StepRunOptions = {
  /** Extra retries after the first attempt. Default 3 (4 attempts total). */
  retries?: number,
  /** Per-attempt timeout, e.g. "5m" or a number of milliseconds. Default 2m, capped at 10m. */
  timeout?: string | number,
};

export type Step = {
  run<T>(id: string, fn: () => T | Promise<T>, options?: StepRunOptions): Promise<T>,
  sleep(id: string, duration: string | number): Promise<void>,
  sleepUntil(id: string, until: Date | string | number): Promise<void>,
};

export type RunKeyFn<T = any> = (event: WorkflowEvent<T>) => string;

export type WorkflowOptions = {
  on: (string | CustomEventTrigger<any> | ScheduleTrigger)[],
  runKey?: RunKeyFn,
  onConflict?: "skip" | "cancel-existing" | "error",
};

export type CustomEventTrigger<T> = { __hexclaveWorkflowTrigger: "custom-event", name: string, __payload?: T };
export type ScheduleTrigger = { __hexclaveWorkflowTrigger: "schedule", cron: string, timezone: string };

export class NonRetriableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetriableError";
  }
}

// Thrown for violations of the step contract (parallel steps, kind
// mismatches, non-serializable results). Never retried — the code itself is
// wrong, so retrying cannot help.
class WorkflowContractViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowContractViolationError";
  }
}

export function customEvent<T = unknown>(name: string): CustomEventTrigger<T> {
  if (typeof name !== "string" || name.length === 0) throw new Error("customEvent() requires a non-empty event name");
  if (name.startsWith("custom.")) throw new Error('customEvent() names are automatically prefixed with "custom." — pass "' + name.slice("custom.".length) + '" instead of "' + name + '"');
  return { __hexclaveWorkflowTrigger: "custom-event", name: name };
}

export function schedule(cron: string, options: { timezone: string }): ScheduleTrigger {
  if (typeof cron !== "string" || cron.trim().split(/\\s+/).length !== 5) throw new Error("schedule() requires a 5-field cron expression (minute hour day-of-month month day-of-week)");
  // Timezone is REQUIRED: there is no silent UTC default.
  if (typeof options?.timezone !== "string" || options.timezone.length === 0) throw new Error('schedule() requires an explicit timezone, e.g. schedule("0 11 * * *", { timezone: "America/Los_Angeles" })');
  return { __hexclaveWorkflowTrigger: "schedule", cron: cron.trim(), timezone: options.timezone };
}

type WorkflowInstance = {
  __hexclaveWorkflow: true,
  id: string,
  triggers: SandboxTrigger[],
  hasRunKey: boolean,
  onConflict: "skip" | "cancel-existing" | "error",
  runKeyFn: RunKeyFn | undefined,
  handler: (event: WorkflowEvent<any>, step: Step) => Promise<unknown>,
};

const workflowRegistry: WorkflowInstance[] = [];

export function workflow<T = any>(
  id: string,
  options: WorkflowOptions,
  handler: (event: WorkflowEvent<T>, step: Step) => unknown | Promise<unknown>,
): WorkflowInstance {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    throw new Error("Workflow ids must be 1-64 chars of lowercase letters, digits, and dashes (got " + JSON.stringify(id) + ")");
  }
  if (!Array.isArray(options?.on) || options.on.length === 0) {
    throw new Error('Workflow "' + id + '" must declare at least one trigger in options.on');
  }
  if (options.onConflict != null && !["skip", "cancel-existing", "error"].includes(options.onConflict)) {
    throw new Error('Workflow "' + id + '" has invalid onConflict ' + JSON.stringify(options.onConflict) + ' (must be "skip", "cancel-existing", or "error")');
  }
  if (options.runKey != null && typeof options.runKey !== "function") {
    throw new Error('Workflow "' + id + '" runKey must be a function of the trigger event');
  }
  if (typeof handler !== "function") {
    throw new Error('Workflow "' + id + '" requires a handler function');
  }
  const triggers: SandboxTrigger[] = options.on.map((trigger) => {
    if (typeof trigger === "string") {
      if (trigger.length === 0) throw new Error('Workflow "' + id + '" has an empty string trigger');
      return { type: "event", eventType: trigger };
    }
    if (trigger != null && (trigger as any).__hexclaveWorkflowTrigger === "custom-event") {
      return { type: "event", eventType: "custom." + (trigger as CustomEventTrigger<any>).name };
    }
    if (trigger != null && (trigger as any).__hexclaveWorkflowTrigger === "schedule") {
      const st = trigger as ScheduleTrigger;
      return { type: "schedule", cron: st.cron, timezone: st.timezone };
    }
    throw new Error('Workflow "' + id + '" has an invalid trigger: ' + JSON.stringify(trigger));
  });
  const instance: WorkflowInstance = {
    __hexclaveWorkflow: true,
    id: id,
    triggers: triggers,
    hasRunKey: options.runKey != null,
    onConflict: options.onConflict ?? "skip",
    runKeyFn: options.runKey,
    handler: handler as any,
  };
  workflowRegistry.push(instance);
  return instance;
}

// ─── Console capture ───────────────────────────────────────────────────────

const logMethods = ["log", "info", "warn", "error", "debug"] as const;
let capturedLogs: string[] = [];
let capturedLogsBytes = 0;
let logsTruncated = false;

function formatLogArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch (e) {
    return String(arg);
  }
}

function captureLog(level: string, args: unknown[], maxBytes: number) {
  if (logsTruncated) return;
  const line = "[" + level + "] " + args.map(formatLogArg).join(" ");
  const bytes = line.length + 1;
  if (capturedLogsBytes + bytes > maxBytes) {
    capturedLogs.push("[platform] log output truncated (exceeded " + maxBytes + " bytes)");
    logsTruncated = true;
    return;
  }
  capturedLogsBytes += bytes;
  capturedLogs.push(line);
}

function getCapturedLogs(): string | null {
  return capturedLogs.length === 0 ? null : capturedLogs.join("\\n");
}

// ─── Step machinery ────────────────────────────────────────────────────────

// Control-flow exceptions that unwind the handler when the invocation is
// done (one step per invocation; the engine re-invokes for the next step).
class StopReplay {
  constructor(public readonly partialOutcome: Record<string, unknown>) {}
}
class ProbeStop {
  constructor(public readonly kind: "run" | "sleep", public readonly stepKey: string, public readonly stepId: string) {}
}

type StepState = {
  bag: Record<string, SandboxStepBagEntry>,
  consumedStepKeys: string[],
  keyCounts: Map<string, number>,
  completedSleeps: { stepKey: string, stepId: string, untilMillis: number }[],
  inlineSleepUsedMs: number,
  // Non-null while a step.run callback is executing; used both to forbid
  // parallel/nested steps and to key first-party idempotency headers.
  currentStep: { stepKey: string, callCounter: number } | null,
};

let stepState: StepState | null = null;

function requireStepState(): StepState {
  if (stepState == null) throw new Error("Workflow step state missing. This is a platform bug.");
  return stepState;
}

function nextStepKey(state: StepState, id: string): string {
  if (typeof id !== "string" || id.length === 0) throw new WorkflowContractViolationError("Step ids must be non-empty strings");
  if (id.includes("#")) throw new WorkflowContractViolationError('Step ids must not contain "#" (reserved for the loop counter suffix): ' + JSON.stringify(id));
  const count = state.keyCounts.get(id) ?? 0;
  state.keyCounts.set(id, count + 1);
  // The same step id executing again (a loop) memoizes under id#2, id#3, ...
  return count === 0 ? id : id + "#" + (count + 1);
}

function parseDurationMs(duration: string | number, context: string): number {
  if (typeof duration === "number") {
    if (!Number.isFinite(duration) || duration < 0) throw new WorkflowContractViolationError(context + ": invalid duration " + JSON.stringify(duration));
    return duration;
  }
  const match = /^([0-9]+(?:\\.[0-9]+)?)(ms|s|m|h|d)$/.exec(String(duration).trim());
  if (match == null) throw new WorkflowContractViolationError(context + ': invalid duration ' + JSON.stringify(duration) + ' (expected a number of milliseconds or a string like "30s", "5m", "2h", "7d")');
  const value = Number(match[1]);
  const unitMs = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "ms" | "s" | "m" | "h" | "d"];
  return Math.round(value * unitMs);
}

function serializeError(error: unknown): { name: string, message: string, stack?: string } {
  if (error instanceof Error) {
    let message = error.message;
    // fetch() failures bury the useful part (ECONNREFUSED etc.) in .cause;
    // surface it so run history is actually diagnosable.
    const cause = (error as any).cause;
    if (cause != null) {
      const causeText = cause instanceof Error ? (((cause as any).code ? (cause as any).code + " " : "") + cause.message) : formatLogArg(cause);
      message = message + " (cause: " + causeText + ")";
    }
    return { name: error.name || "Error", message: message, stack: error.stack };
  }
  return { name: "Error", message: formatLogArg(error) };
}

function byteLength(s: string): number {
  // TextEncoder is available in all sandbox runtimes (node >= 11).
  return new TextEncoder().encode(s).length;
}

function makeStep(input: SandboxInput): Step {
  const limits = input.limits;
  const isProbe = input.mode === "probe";

  const runStep = async function <T>(id: string, fn: () => T | Promise<T>, options?: StepRunOptions): Promise<T> {
    const state = requireStepState();
    if (state.currentStep != null) {
      throw new WorkflowContractViolationError('step.run("' + id + '") was called while step "' + state.currentStep.stepKey + '" is still executing. Parallel or nested steps are not supported in v1 — await each step sequentially.');
    }
    const stepKey = nextStepKey(state, id);
    const memoized = state.bag[stepKey];
    if (memoized != null) {
      if (memoized.kind !== "run") throw new WorkflowContractViolationError('Step "' + stepKey + '" was recorded as a sleep but the code now calls step.run with the same id. A step id names a recorded fact; if the meaning changes, the id must change.');
      state.consumedStepKeys.push(stepKey);
      return memoized.result as T;
    }
    if (isProbe) throw new ProbeStop("run", stepKey, id);

    const retries = options?.retries;
    if (retries != null && (!Number.isInteger(retries) || retries < 0 || retries > 10)) {
      throw new WorkflowContractViolationError('step.run("' + id + '") has invalid retries ' + JSON.stringify(retries) + " (must be an integer between 0 and 10)");
    }
    const maxAttempts = (retries ?? 3) + 1;
    const timeoutMs = Math.min(
      options?.timeout != null ? parseDurationMs(options.timeout, 'step.run("' + id + '") timeout') : limits.defaultStepTimeoutMs,
      limits.maxStepTimeoutMs,
    );

    state.currentStep = { stepKey: stepKey, callCounter: 0 };
    const startedAt = Date.now();
    let result: T;
    try {
      let timer: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StepTimeoutMarker(timeoutMs)), timeoutMs);
      });
      try {
        result = await Promise.race([Promise.resolve().then(fn), timeoutPromise]);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      if (error instanceof StopReplay || error instanceof ProbeStop) throw error;
      const isTimeout = error instanceof StepTimeoutMarker;
      throw new StopReplay({
        type: "step-failed",
        stepKey: stepKey,
        stepId: id,
        nonRetriable: !isTimeout && (error instanceof NonRetriableError || error instanceof WorkflowContractViolationError),
        maxAttempts: maxAttempts,
        error: isTimeout
          ? { name: "StepTimeoutError", message: 'step "' + id + '" exceeded its ' + Math.round(timeoutMs / 1000) + "s attempt timeout" }
          : serializeError(error),
      });
    } finally {
      state.currentStep = null;
    }

    // Step results must be JSON-serializable plain data — enforced here with
    // explicit errors so a bad result fails the step immediately (never
    // retried; the value would be just as unserializable next time).
    let resultJson: string;
    try {
      resultJson = JSON.stringify(result === undefined ? null : result);
    } catch (error) {
      throw new StopReplay({
        type: "step-failed",
        stepKey: stepKey,
        stepId: id,
        nonRetriable: true,
        maxAttempts: maxAttempts,
        error: { name: "StepResultNotSerializableError", message: 'step "' + id + '" returned a value that is not JSON-serializable: ' + (error instanceof Error ? error.message : String(error)) },
      });
    }
    if ((resultJson as string | undefined) === undefined) {
      // JSON.stringify returns undefined (without throwing) for functions
      // and symbols — the explicit-error promise covers those too.
      throw new StopReplay({
        type: "step-failed",
        stepKey: stepKey,
        stepId: id,
        nonRetriable: true,
        maxAttempts: maxAttempts,
        error: { name: "StepResultNotSerializableError", message: 'step "' + id + '" returned a function or symbol, which is not JSON-serializable' },
      });
    }
    const resultSizeBytes = byteLength(resultJson);
    if (resultSizeBytes > limits.stepResultMaxBytes) {
      throw new StopReplay({
        type: "step-failed",
        stepKey: stepKey,
        stepId: id,
        nonRetriable: true,
        maxAttempts: maxAttempts,
        error: { name: "StepResultTooLargeError", message: 'step "' + id + '" returned ' + resultSizeBytes + " bytes, exceeding the " + limits.stepResultMaxBytes + "-byte step-result limit. Store large blobs externally and return a reference instead." },
      });
    }
    throw new StopReplay({
      type: "step-completed",
      stepKey: stepKey,
      stepId: id,
      result: JSON.parse(resultJson),
      resultSizeBytes: resultSizeBytes,
      elapsedMs: Date.now() - startedAt,
    });
  };

  const sleepUntilMillis = async (id: string, untilMillis: number): Promise<void> => {
    const state = requireStepState();
    if (state.currentStep != null) {
      throw new WorkflowContractViolationError('step.sleep("' + id + '") was called inside step "' + state.currentStep.stepKey + '". Sleeps must happen between steps, not inside a step callback.');
    }
    // 8.64e15 is the ECMAScript Date range; anything beyond it would reach
    // the engine as an unrepresentable timestamp.
    if (!Number.isFinite(untilMillis) || Math.abs(untilMillis) > 8.64e15) throw new WorkflowContractViolationError('Sleep "' + id + '" has an invalid wake-up time');
    const stepKey = nextStepKey(state, id);
    const memoized = state.bag[stepKey];
    if (memoized != null) {
      if (memoized.kind !== "sleep") throw new WorkflowContractViolationError('Step "' + stepKey + '" was recorded as a step.run but the code now sleeps with the same id. A step id names a recorded fact; if the meaning changes, the id must change.');
      state.consumedStepKeys.push(stepKey);
      return;
    }
    if (isProbe) throw new ProbeStop("sleep", stepKey, id);

    const remainingMs = untilMillis - Date.now();
    if (remainingMs <= 0) {
      // Already elapsed (e.g. sleepUntil a past date): record the fact and
      // continue without a checkpoint.
      state.completedSleeps.push({ stepKey: stepKey, stepId: id, untilMillis: untilMillis });
      state.consumedStepKeys.push(stepKey);
      return;
    }
    // Short sleeps are awaited inside the invocation (precise), but only up
    // to a total budget: a chain of many short sleeps with no step boundary
    // in between would otherwise re-await ALL of them on every replay and
    // blow the attempt timeout. Escalating to a durable timer creates the
    // missing checkpoint at the cost of ~1min granularity for that sleep.
    if (remainingMs <= limits.inlineSleepMaxMs && state.inlineSleepUsedMs + remainingMs <= limits.inlineSleepBudgetMs) {
      await new Promise((resolve) => setTimeout(resolve, remainingMs));
      state.inlineSleepUsedMs += remainingMs;
      state.completedSleeps.push({ stepKey: stepKey, stepId: id, untilMillis: untilMillis });
      state.consumedStepKeys.push(stepKey);
      return;
    }
    throw new StopReplay({
      type: "sleeping",
      stepKey: stepKey,
      stepId: id,
      untilMillis: untilMillis,
    });
  };

  return {
    run: runStep,
    sleep: (id, duration) => sleepUntilMillis(id, Date.now() + parseDurationMs(duration, 'step.sleep("' + id + '")')),
    sleepUntil: (id, until) => {
      const millis = until instanceof Date ? until.getTime() : typeof until === "string" ? Date.parse(until) : until;
      return sleepUntilMillis(id, millis);
    },
  };
}

class StepTimeoutMarker {
  constructor(public readonly timeoutMs: number) {}
}

// ─── hexclaveApp (first-party server API, scoped per-run credentials) ──────

export class HexclaveApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly body: unknown) {
    super(message);
    this.name = "HexclaveApiError";
  }
}

async function apiRequest(method: string, path: string, body?: unknown, query?: Record<string, string | undefined>): Promise<{ status: number, body: any }> {
  const input = getInput();
  if (input.mode !== "execute" || input.credentials == null) {
    throw new WorkflowContractViolationError("hexclaveApp can only be used while the workflow is executing (not from runKey functions or module top-level)");
  }
  const state = stepState;
  const headers: Record<string, string> = {
    "x-stack-access-type": "server",
    "x-stack-project-id": input.credentials.projectId,
    "x-stack-branch-id": input.credentials.branchId,
    "x-stack-secret-server-key": input.credentials.secretServerKey,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") {
    if (state?.currentStep != null && input.event != null) {
      // The idempotency floor: first-party actions are keyed by run + step
      // (+ call index within the step). The run id is itself deterministic
      // per (trigger event, workflow), so the key is stable across retries,
      // upgrades, and restarts — no sequence of platform operations
      // double-fires an action — while two workflows triggered by the SAME
      // event can never collide on identical step ids. A renamed step id is
      // a new key, by design.
      const runId = input.run != null ? input.run.id : "-";
      headers["x-hexclave-idempotency-key"] = "wf1:" + runId + ":" + input.event.id + ":" + state.currentStep.stepKey + ":" + state.currentStep.callCounter++;
    } else {
      console.warn("hexclaveApp." + method + " " + path + " was called outside step.run — it will re-execute on every replay of this workflow and is not protected by the idempotency floor. Wrap it in step.run.");
    }
  }
  let url = input.credentials.apiUrl.replace(/\\/+$/, "") + "/api/v1" + path;
  if (query != null) {
    const params = Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v as string));
    if (params.length > 0) url += "?" + params.join("&");
  }
  const response = await fetch(url, {
    method: method,
    headers: headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let responseBody: any = null;
  const text = await response.text();
  try {
    responseBody = text.length === 0 ? null : JSON.parse(text);
  } catch (e) {
    responseBody = text;
  }
  return { status: response.status, body: responseBody };
}

async function apiRequestOrThrow(method: string, path: string, body?: unknown, query?: Record<string, string | undefined>): Promise<any> {
  const result = await apiRequest(method, path, body, query);
  if (result.status >= 400) {
    const message = (result.body != null && typeof result.body === "object" && typeof result.body.error === "string") ? result.body.error : JSON.stringify(result.body);
    throw new HexclaveApiError(result.status, "hexclaveApp: " + method + " " + path + " failed with status " + result.status + ": " + message, result.body);
  }
  return result.body;
}

const userUpdateKeyMap: Record<string, string> = {
  displayName: "display_name",
  primaryEmail: "primary_email",
  primaryEmailVerified: "primary_email_verified",
  primaryEmailAuthEnabled: "primary_email_auth_enabled",
  clientMetadata: "client_metadata",
  clientReadOnlyMetadata: "client_read_only_metadata",
  serverMetadata: "server_metadata",
  selectedTeamId: "selected_team_id",
  profileImageUrl: "profile_image_url",
};

function mapUpdateKeys(data: Record<string, unknown>, keyMap: Record<string, string>, context: string): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const snakeKey = keyMap[key];
    if (snakeKey == null) throw new WorkflowContractViolationError(context + ": unknown field " + JSON.stringify(key) + " (supported: " + Object.keys(keyMap).join(", ") + ")");
    mapped[snakeKey] = value;
  }
  return mapped;
}

/**
 * The first-party server API, bound per-run to short-lived scoped
 * credentials injected at invocation. All side-effectful calls must live
 * inside step.run — the runtime warns when they don't.
 *
 * v1 exposes a curated subset of the server SDK surface; the published
 * server SDK replaces this at external launch.
 */
export const hexclaveApp = {
  async getUser(userId: string): Promise<any | null> {
    const result = await apiRequest("GET", "/users/" + encodeURIComponent(userId));
    // 404 = deleted (or never-existing) user: the guard-step pattern relies
    // on this returning null rather than throwing.
    if (result.status === 404) return null;
    if (result.status >= 400) throw new HexclaveApiError(result.status, "hexclaveApp.getUser failed with status " + result.status, result.body);
    return result.body;
  },
  /** Returns a single page of users (default server page size; pass limit/cursor to page manually). v1 keeps the array shape; a paginated shape comes with the real server SDK at external launch. */
  async listUsers(options?: { limit?: number, cursor?: string, orderBy?: string, query?: string }): Promise<any[]> {
    const body = await apiRequestOrThrow("GET", "/users", undefined, {
      limit: options?.limit != null ? String(options.limit) : undefined,
      cursor: options?.cursor,
      order_by: options?.orderBy,
      query: options?.query,
    });
    return body.items;
  },
  async updateUser(userId: string, data: Record<string, unknown>): Promise<any> {
    return await apiRequestOrThrow("PATCH", "/users/" + encodeURIComponent(userId), mapUpdateKeys(data, userUpdateKeyMap, "hexclaveApp.updateUser"));
  },
  async sendEmail(options: {
    userIds?: string[],
    allUsers?: true,
    emails?: string[],
    subject?: string,
    notificationCategoryName?: string,
    themeId?: string | null | false,
    isHighPriority?: boolean,
    scheduledAtMillis?: number,
    html?: string,
    templateId?: string,
    variables?: Record<string, unknown>,
    draftId?: string,
  }): Promise<{ results: unknown[] }> {
    return await apiRequestOrThrow("POST", "/emails/send-email", {
      user_ids: options.userIds,
      all_users: options.allUsers,
      emails: options.emails,
      subject: options.subject,
      notification_category_name: options.notificationCategoryName,
      theme_id: options.themeId,
      is_high_priority: options.isHighPriority,
      scheduled_at_millis: options.scheduledAtMillis,
      html: options.html,
      template_id: options.templateId,
      variables: options.variables,
      draft_id: options.draftId,
    });
  },
  workflows: {
    /** Emit a custom event (auto-prefixed to "custom.<name>" on the wire). */
    async send(name: string, data: unknown): Promise<{ eventId: string }> {
      const body = await apiRequestOrThrow("POST", "/internal/workflows/events", { name: name, data: data });
      return { eventId: body.event_id };
    },
    async listRuns(filter: { workflow: string, state?: string, runKey?: string, version?: number, cursor?: string, limit?: number, includeState?: boolean }): Promise<{ runs: any[], nextCursor: string | null }> {
      const body = await apiRequestOrThrow("GET", "/internal/workflows/" + encodeURIComponent(filter.workflow) + "/runs", undefined, {
        state: filter.state,
        run_key: filter.runKey,
        version: filter.version != null ? String(filter.version) : undefined,
        cursor: filter.cursor,
        limit: filter.limit != null ? String(filter.limit) : undefined,
        include_state: filter.includeState != null ? String(filter.includeState) : undefined,
      });
      return { runs: body.runs, nextCursor: body.next_cursor };
    },
    async getRun(query: { runId: string } | { workflow: string, runKey: string }): Promise<any | null> {
      if ("runId" in query) {
        const result = await apiRequest("GET", "/internal/workflows/runs/" + encodeURIComponent(query.runId));
        if (result.status === 404) return null;
        if (result.status >= 400) throw new HexclaveApiError(result.status, "hexclaveApp.workflows.getRun failed with status " + result.status, result.body);
        return result.body;
      }
      // runKey addresses the ACTIVE run for that key (keys recur over time,
      // UUIDs never).
      const body = await apiRequestOrThrow("GET", "/internal/workflows/" + encodeURIComponent(query.workflow) + "/runs", undefined, {
        run_key: query.runKey,
        only_active: "true",
        limit: "1",
      });
      return body.runs.length > 0 ? body.runs[0] : null;
    },
    /** Cancel the active run with the given runKey (atomic key lookup). */
    async cancelRun(query: { workflow: string, runKey: string }): Promise<{ canceledCount: number }> {
      return await this.cancelRuns({ workflow: query.workflow, runKey: query.runKey });
    },
    /** Atomic server-side query-cancel; race-safe against concurrently waking runs. */
    async cancelRuns(query: { workflow: string, runKey?: string, state?: string, version?: number }): Promise<{ canceledCount: number }> {
      const body = await apiRequestOrThrow("POST", "/internal/workflows/" + encodeURIComponent(query.workflow) + "/runs/cancel", {
        run_key: query.runKey,
        state: query.state,
        version: query.version,
      });
      return { canceledCount: body.canceled_count };
    },
    async upgradeRuns(query: { workflow: string, toVersion: number, runKey?: string, fromVersion?: number }): Promise<{ upgradedCount: number, skipped: any[] }> {
      const body = await apiRequestOrThrow("POST", "/internal/workflows/" + encodeURIComponent(query.workflow) + "/runs/upgrade", {
        to_version: query.toVersion,
        run_key: query.runKey,
        from_version: query.fromVersion,
      });
      return { upgradedCount: body.upgraded_count, skipped: body.skipped };
    },
  },
};

// ─── Invocation driver (called by the entry harness, not by user code) ─────

function reviveEvent(input: SandboxInput): WorkflowEvent<any> {
  const event = input.event;
  if (event == null) throw new Error("Workflow invocation is missing its trigger event. This is a platform bug.");
  return { id: event.id, type: event.type, ts: new Date(event.tsMillis), data: event.data };
}

function resolveWorkflow(mod: any): WorkflowInstance {
  const def = mod?.default;
  if (def == null || def.__hexclaveWorkflow !== true) {
    throw new WorkflowContractViolationError("The workflow file must default-export the result of workflow(...): export default workflow(...)");
  }
  if (workflowRegistry.length !== 1) {
    throw new WorkflowContractViolationError("One file = one workflow: expected exactly 1 workflow() definition, found " + workflowRegistry.length);
  }
  if (workflowRegistry[0] !== def) {
    throw new WorkflowContractViolationError("The default export must be the workflow() defined in this file");
  }
  return def as WorkflowInstance;
}

export async function runWorkflowInvocation(rawInput: unknown, loadModule: () => Promise<any>): Promise<Record<string, unknown>> {
  const input = rawInput as SandboxInput;
  if (input == null || input.protocolVersion !== 1) {
    throw new Error("Workflow runtime protocol version mismatch. This is a platform bug.");
  }
  (globalThis as any).__HEXCLAVE_WORKFLOWS_INPUT__ = input;

  capturedLogs = [];
  capturedLogsBytes = 0;
  logsTruncated = false;
  const originalConsole: Partial<Record<string, any>> = {};
  for (const method of logMethods) {
    originalConsole[method] = (console as any)[method];
    (console as any)[method] = (...args: unknown[]) => {
      captureLog(method, args, input.limits.logsMaxBytes);
      originalConsole[method].apply(console, args);
    };
  }

  const finishFailure = (phase: "import" | "handler" | "run-key", error: unknown) => ({
    type: "handler-failed",
    phase: phase,
    // NonRetriableError is honored outside steps too: retrying a handler
    // that deliberately declared itself non-retriable cannot help.
    nonRetriable: error instanceof WorkflowContractViolationError || error instanceof NonRetriableError,
    error: serializeError(error),
    completedSleeps: stepState?.completedSleeps ?? [],
    logs: getCapturedLogs(),
  });

  try {
    // Secrets become env vars before ANY user code (including module
    // top-level) runs, so process.env.MY_SECRET works everywhere.
    if (input.secrets != null) Object.assign(process.env, input.secrets);

    let mod: any;
    try {
      mod = await loadModule();
    } catch (error) {
      return finishFailure("import", error);
    }
    let wf: WorkflowInstance;
    try {
      wf = resolveWorkflow(mod);
    } catch (error) {
      return finishFailure("import", error);
    }

    switch (input.mode) {
      case "manifest": {
        return {
          type: "manifest",
          manifest: {
            workflowId: wf.id,
            triggers: wf.triggers,
            hasRunKey: wf.hasRunKey,
            onConflict: wf.onConflict,
          },
        };
      }
      case "run-key": {
        if (wf.runKeyFn == null) return { type: "run-key", runKey: null };
        try {
          const runKey = await wf.runKeyFn(reviveEvent(input));
          if (typeof runKey !== "string" || runKey.length === 0) {
            throw new WorkflowContractViolationError("runKey must return a non-empty string (got " + JSON.stringify(runKey) + ")");
          }
          if (runKey.length > 512) {
            throw new WorkflowContractViolationError("runKey is " + runKey.length + " chars long, exceeding the 512-char limit");
          }
          return { type: "run-key", runKey: runKey };
        } catch (error) {
          return finishFailure("run-key", error);
        }
      }
      case "probe":
      case "execute": {
        stepState = {
          bag: input.steps ?? {},
          consumedStepKeys: [],
          keyCounts: new Map(),
          completedSleeps: [],
          inlineSleepUsedMs: 0,
          currentStep: null,
        };
        const step = makeStep(input);
        const event = reviveEvent(input);
        try {
          await wf.handler(event, step);
          if (input.mode === "probe") {
            return { type: "probe", completed: true, firstRequest: null, consumedStepKeys: stepState.consumedStepKeys, threwError: null };
          }
          // Handler returned: the run is completed. An early return is the
          // guard-step self-cancellation pattern — still just "completed".
          return { type: "completed", completedSleeps: stepState.completedSleeps, logs: getCapturedLogs() };
        } catch (error) {
          if (error instanceof ProbeStop) {
            return {
              type: "probe",
              completed: false,
              firstRequest: { kind: error.kind, stepKey: error.stepKey, stepId: error.stepId },
              consumedStepKeys: stepState.consumedStepKeys,
              threwError: null,
            };
          }
          if (error instanceof StopReplay) {
            return {
              ...error.partialOutcome,
              completedSleeps: stepState.completedSleeps,
              logs: getCapturedLogs(),
            };
          }
          if (input.mode === "probe") {
            return { type: "probe", completed: false, firstRequest: null, consumedStepKeys: stepState.consumedStepKeys, threwError: serializeError(error) };
          }
          return finishFailure("handler", error);
        }
      }
      default: {
        throw new Error("Unknown workflow invocation mode " + JSON.stringify((input as any).mode) + ". This is a platform bug.");
      }
    }
  } finally {
    stepState = null;
    for (const method of logMethods) {
      (console as any)[method] = originalConsole[method];
    }
  }
}
`;

// The entry harness: the bundle's default export, called once per sandbox
// invocation (mirrors the email pipeline's entryJs). User-code errors are
// normal outcomes; only runtime/platform bugs escape into the js-execution
// error envelope.
export const WORKFLOWS_ENTRY_JS = `export default async () => {
  try {
    const { runWorkflowInvocation } = await import("@hexclave/workflows");
    const input = globalThis.__HEXCLAVE_WORKFLOWS_INPUT__;
    const outcome = await runWorkflowInvocation(input, () => import("./workflow.ts"));
    return { status: "ok", data: outcome };
  } catch (e) {
    if (e instanceof Error) {
      return { status: "error", error: { message: e.message, stack: e.stack, cause: e.cause } };
    }
    return { status: "error", error: { message: String(e), stack: undefined, cause: undefined } };
  }
};`;
