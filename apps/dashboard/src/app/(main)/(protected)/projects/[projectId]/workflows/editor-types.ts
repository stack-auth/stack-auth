// Type definitions injected into Monaco for workflow authoring. The event
// catalog mirrors packages/shared/src/interface/workflows.ts, while
// hexclaveApp is the actual HexclaveAdminApp type from @hexclave/js.

export const WORKFLOWS_EDITOR_DTS = `
declare module "@hexclave/workflows" {
  import type { HexclaveAdminApp } from "@hexclave/js";

  export type UserEventData = {
    id: string,
    primary_email: string | null,
    primary_email_verified: boolean,
    primary_email_auth_enabled: boolean,
    display_name: string | null,
    selected_team_id: string | null,
    profile_image_url: string | null,
    signed_up_at_millis: number,
    has_password: boolean,
    otp_auth_enabled: boolean,
    passkey_auth_enabled: boolean,
    client_metadata?: unknown,
    client_read_only_metadata?: unknown,
    server_metadata?: unknown,
    last_active_at_millis: number,
    is_anonymous: boolean,
    is_restricted: boolean,
    restricted_reason: unknown | null,
    restricted_by_admin: boolean,
    restricted_by_admin_reason: string | null,
    restricted_by_admin_private_details: string | null,
    country_code: string | null,
    risk_scores: { sign_up: { bot: number, free_trial_abuse: number } },
    oauth_providers: { id: string, account_id: string, email: string | null }[],
  };

  export type TeamEventData = {
    id: string,
    display_name: string,
    profile_image_url: string | null,
    client_metadata?: unknown,
    client_read_only_metadata?: unknown,
    server_metadata?: unknown,
    created_at_millis: number,
  };

  export type WorkflowLifecycleEventData = {
    workflow_id: string,
    run_id: string,
    run_key: string | null,
    version: number,
    trigger_type: string,
  };

  export type WorkflowPlatformEventMap = {
    "user.created": UserEventData,
    "user.updated": UserEventData,
    "user.deleted": { id: string, teams: { id: string }[] },
    "team.created": TeamEventData,
    "team.updated": TeamEventData,
    "team.deleted": { id: string },
    "team_membership.created": { team_id: string, user_id: string },
    "team_membership.deleted": { team_id: string, user_id: string },
    "team_permission.created": { id: string, user_id: string, team_id: string },
    "team_permission.deleted": { id: string, user_id: string, team_id: string },
    "project_permission.created": { id: string, user_id: string },
    "project_permission.deleted": { id: string, user_id: string },
    "workflow.run.started": WorkflowLifecycleEventData,
    "workflow.run.completed": WorkflowLifecycleEventData,
    "workflow.run.failed": WorkflowLifecycleEventData,
    "workflow.run.canceled": WorkflowLifecycleEventData,
  };

  export type WorkflowEvent<TType extends string = string, TData = unknown> = {
    /** Platform UUID of the trigger event. */
    id: string,
    /** Wire type, e.g. "user.created", "custom.order.shipped", "schedule". */
    type: TType,
    /** When the event happened. Payloads are snapshots at this time. */
    ts: Date,
    data: TData,
  };

  export type StepRunOptions = {
    retries?: number,
    timeout?: string | number,
  };

  export type Step = {
    /** Durable unit; the result is memoized by id and never re-executed. */
    run<T>(id: string, fn: () => T | Promise<T>, options?: StepRunOptions): Promise<T>,
    sleep(id: string, duration: string | number): Promise<void>,
    sleepUntil(id: string, until: Date | string | number): Promise<void>,
  };

  export type CustomEventTrigger<TName extends string = string, TData = unknown> = {
    __hexclaveWorkflowTrigger: "custom-event",
    name: TName,
    __payload?: TData,
  };
  export type ScheduleTrigger = { __hexclaveWorkflowTrigger: "schedule", cron: string, timezone: string };
  export type WorkflowTrigger = keyof WorkflowPlatformEventMap | CustomEventTrigger<string, unknown> | ScheduleTrigger;

  export type EventForTrigger<TTrigger> =
    TTrigger extends keyof WorkflowPlatformEventMap
      ? WorkflowEvent<TTrigger, WorkflowPlatformEventMap[TTrigger]>
      : TTrigger extends CustomEventTrigger<infer TName, infer TData>
        ? WorkflowEvent<\`custom.\${TName}\`, TData>
        : TTrigger extends ScheduleTrigger
          ? WorkflowEvent<"schedule", { workflow_id: string, scheduled_at_millis: number }>
          : never;

  export type WorkflowOptions<TTriggers extends readonly WorkflowTrigger[]> = {
    /** Each matching trigger starts a new run. */
    on: TTriggers,
    runKey?: (event: EventForTrigger<TTriggers[number]>) => string,
    onConflict?: "skip" | "cancel-existing" | "error",
  };

  /** Defines one workflow. The handler event is inferred from options.on. */
  export function workflow<const TTriggers extends readonly WorkflowTrigger[]>(
    id: string,
    options: WorkflowOptions<TTriggers>,
    handler: (event: EventForTrigger<TTriggers[number]>, step: Step) => unknown | Promise<unknown>,
  ): unknown;

  export function customEvent<const TName extends string, TData = unknown>(name: TName): CustomEventTrigger<TName, TData>;
  export function schedule(cron: string, options: { timezone: string }): ScheduleTrigger;

  export class NonRetriableError extends Error {
    constructor(message: string);
  }

  /** A real admin SDK instance, authenticated to this workflow's environment. */
  export const hexclaveApp: HexclaveAdminApp<false>;
}
`;

export const WORKFLOWS_EDITOR_AMBIENT_DTS = `declare module "date-fns";\ndeclare module "date-fns/*";`;
