// Type definitions injected into the Monaco editor for workflow authoring.
// This mirrors the public surface of the in-sandbox runtime
// (apps/backend/src/lib/workflows/runtime-source.tsx) — if the runtime's
// authoring API changes, update this in the same commit.
//
// Platform event payloads are typed loosely (any) in v1; precise types
// derived from the webhook schemas are a follow-up. TypeScript here is
// editor UX only — real validation is the sync-time compile + manifest
// extraction on the backend.

export const WORKFLOWS_EDITOR_DTS = `
declare module "@hexclave/workflows" {
  export type WorkflowEvent<T = any> = {
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
    /** Durable unit; the result is memoized by id and never re-executed. ALL side effects must live inside step.run. */
    run<T>(id: string, fn: () => T | Promise<T>, options?: StepRunOptions): Promise<T>,
    /** Relative durable sleep, e.g. step.sleep("wait", "24h"). Sleeps <= 60s are precise; longer sleeps have ~1min granularity. */
    sleep(id: string, duration: string | number): Promise<void>,
    /** Absolute durable sleep; recommended for scheduled sequences. */
    sleepUntil(id: string, until: Date | string | number): Promise<void>,
  };

  export type RunKeyFn<T = any> = (event: WorkflowEvent<T>) => string;

  export type CustomEventTrigger<T> = { __hexclaveWorkflowTrigger: "custom-event", name: string };
  export type ScheduleTrigger = { __hexclaveWorkflowTrigger: "schedule", cron: string, timezone: string };

  export type WorkflowOptions = {
    /** Triggers: platform event strings ("user.created"), customEvent(...), or schedule(...). Each matching event starts a NEW run. */
    on: (string | CustomEventTrigger<any> | ScheduleTrigger)[],
    /** Derives a business key from the trigger event at run creation. Unique per workflow among ACTIVE runs. */
    runKey?: RunKeyFn,
    /** What happens when an event maps to an already-active runKey. Default "skip" (dedupe + idempotent delivery). */
    onConflict?: "skip" | "cancel-existing" | "error",
  };

  /** Defines a workflow. Must be the file's default export; one file = one workflow. */
  export function workflow<T = any>(
    id: string,
    options: WorkflowOptions,
    handler: (event: WorkflowEvent<T>, step: Step) => unknown | Promise<unknown>,
  ): unknown;

  /** Subscribes to a custom event (wire type "custom.<name>", emitted via hexclaveApp.workflows.send). */
  export function customEvent<T = any>(name: string): CustomEventTrigger<T>;

  /** Cron schedule trigger. The timezone is REQUIRED — there is no silent UTC default. Missed occurrences catch up (delayed, never skipped). */
  export function schedule(cron: string, options: { timezone: string }): ScheduleTrigger;

  /** Throw inside a step to fail it immediately with no retries. */
  export class NonRetriableError extends Error {
    constructor(message: string);
  }

  export class HexclaveApiError extends Error {
    readonly status: number;
    readonly body: unknown;
  }

  /**
   * The first-party server API, bound per-run to scoped credentials.
   * ALL side-effectful calls must live inside step.run — outside a step they
   * re-execute on every replay.
   */
  export const hexclaveApp: {
    getUser(userId: string): Promise<any | null>,
    listUsers(options?: { limit?: number, cursor?: string, orderBy?: string, query?: string }): Promise<any[]>,
    updateUser(userId: string, data: {
      displayName?: string,
      primaryEmail?: string,
      primaryEmailVerified?: boolean,
      primaryEmailAuthEnabled?: boolean,
      clientMetadata?: unknown,
      clientReadOnlyMetadata?: unknown,
      serverMetadata?: unknown,
      selectedTeamId?: string | null,
      profileImageUrl?: string | null,
    }): Promise<any>,
    sendEmail(options: {
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
    }): Promise<{ results: unknown[] }>,
    workflows: {
      /** Emit a custom event (auto-prefixed to "custom.<name>" on the wire). */
      send(name: string, data?: unknown): Promise<{ eventId: string }>,
      listRuns(filter: { workflow: string, state?: string, runKey?: string, version?: number, cursor?: string, limit?: number, includeState?: boolean }): Promise<{ runs: any[], nextCursor: string | null }>,
      getRun(query: { runId: string } | { workflow: string, runKey: string }): Promise<any | null>,
      /** Cancel the active run with the given runKey (atomic key lookup). */
      cancelRun(query: { workflow: string, runKey: string }): Promise<{ canceledCount: number }>,
      /** Atomic server-side query-cancel; race-safe against concurrently waking runs. */
      cancelRuns(query: { workflow: string, runKey?: string, state?: string, version?: number }): Promise<{ canceledCount: number }>,
      upgradeRuns(query: { workflow: string, toVersion: number, runKey?: string, fromVersion?: number }): Promise<{ upgradedCount: number, skipped: any[] }>,
    },
  };
}
`;

// The pinned stdlib is importable under its own name; typed as \`any\` in
// the editor for now (fetching the real d.ts from unpkg is a follow-up).
export const WORKFLOWS_EDITOR_AMBIENT_DTS = `declare module "date-fns";\ndeclare module "date-fns/*";`;
