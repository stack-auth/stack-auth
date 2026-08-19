import type { Tenancy } from "@/lib/tenancies";
import { PrismaClientTransaction } from "@/prisma-client";
import { WORKFLOW_CUSTOM_EVENT_PREFIX, WORKFLOW_EVENT_PAYLOAD_MAX_BYTES } from "@hexclave/shared/dist/interface/workflows";
import { captureError, HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import { createHash } from "node:crypto";

/**
 * Internal run lifecycle notifications are persisted in the same outbox as
 * trigger events, but are consumed by the engine before user workflow
 * matching. Keeping this namespace out of the public platform catalog avoids
 * the self-amplifying workflow.run.* trigger cycle that the public API
 * intentionally does not support.
 */
export const WORKFLOW_INTERNAL_RUN_LIFECYCLE_PREFIX = "workflow.internal.run.";
export const WORKFLOW_INTERNAL_RUN_LIFECYCLE_SCHEMA_VERSION: 1 = 1;
export const WORKFLOW_INTERNAL_RUN_LIFECYCLE_MAX_BYTES = 16 * 1024;
export const WORKFLOW_INTERNAL_RUN_LIFECYCLE_MAX_ERROR_BYTES = 8 * 1024;

export type WorkflowRunLifecycleKind = "success" | "failure" | "retry" | "cancel";
export type WorkflowRunLifecycleEventType = `${typeof WORKFLOW_INTERNAL_RUN_LIFECYCLE_PREFIX}${WorkflowRunLifecycleKind}`;

export type WorkflowRunLifecyclePayload = {
  schema_version: typeof WORKFLOW_INTERNAL_RUN_LIFECYCLE_SCHEMA_VERSION,
  workflow_id: string,
  run_id: string,
  workflow_version: number,
  run_key: string | null,
  trigger_event_id: string | null,
  trigger_type: string,
  lifecycle: WorkflowRunLifecycleKind,
  attempt: number,
  retry_at_millis: number | null,
  error: string | null,
  occurred_at_millis: number,
};

export type WorkflowRunLifecycleTransition = {
  kind: WorkflowRunLifecycleKind,
  attempt: number,
  retryEpoch: number,
  retryAt?: Date | null,
  error?: string | null,
  eventKey?: string,
};

export type WorkflowRunLifecycleEventBuildResult =
  | {
    status: "ok",
    eventId: string,
    type: WorkflowRunLifecycleEventType,
    payload: WorkflowRunLifecyclePayload,
  }
  | {
    status: "drop",
    reason: "invalid_lifecycle_payload" | "lifecycle_payload_too_large",
  };

export type WorkflowRunLifecycleParseResult =
  | { status: "ignored" }
  | { status: "invalid", reason: string }
  | {
    status: "ok",
    type: WorkflowRunLifecycleEventType,
    payload: WorkflowRunLifecyclePayload,
  };

const WORKFLOW_LIFECYCLE_KIND_VALUES: readonly WorkflowRunLifecycleKind[] = ["success", "failure", "retry", "cancel"];
const WORKFLOW_LIFECYCLE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WORKFLOW_LIFECYCLE_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const WORKFLOW_LIFECYCLE_TEXT_ENCODER = new TextEncoder();

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedLifecycleText(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && !WORKFLOW_LIFECYCLE_CONTROL_CHARACTER_PATTERN.test(value)
    && WORKFLOW_LIFECYCLE_TEXT_ENCODER.encode(value).byteLength <= maximumBytes;
}

function isNullableBoundedLifecycleText(value: unknown, maximumBytes: number): value is string | null {
  return value === null || isBoundedLifecycleText(value, maximumBytes);
}

function isWorkflowRunLifecycleKind(value: unknown): value is WorkflowRunLifecycleKind {
  return typeof value === "string" && WORKFLOW_LIFECYCLE_KIND_VALUES.some((candidate) => candidate === value);
}

function isWorkflowLifecycleUuid(value: unknown): value is string {
  return typeof value === "string" && WORKFLOW_LIFECYCLE_UUID_PATTERN.test(value);
}

function isNullableWorkflowLifecycleUuid(value: unknown): value is string | null {
  return value === null || isWorkflowLifecycleUuid(value);
}

function isNullableSafeInteger(value: unknown, minimum: number, maximum: number): value is number | null {
  return value === null || isSafeInteger(value, minimum, maximum);
}

function isSafeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function lifecycleEventType(kind: WorkflowRunLifecycleKind): WorkflowRunLifecycleEventType {
  switch (kind) {
    case "success": {
      return `${WORKFLOW_INTERNAL_RUN_LIFECYCLE_PREFIX}success`;
    }
    case "failure": {
      return `${WORKFLOW_INTERNAL_RUN_LIFECYCLE_PREFIX}failure`;
    }
    case "retry": {
      return `${WORKFLOW_INTERNAL_RUN_LIFECYCLE_PREFIX}retry`;
    }
    case "cancel": {
      return `${WORKFLOW_INTERNAL_RUN_LIFECYCLE_PREFIX}cancel`;
    }
  }
}

function sanitizeLifecycleError(error: string | null | undefined): string | null {
  if (error == null || error.length === 0) return null;
  const sanitized = error
    .replace(/\b(Bearer|Basic|Digest)\s+[^\s,;]+/giu, "$1 [Filtered]")
    .replace(/\b(authorization|access[_-]?token|api[_-]?key|client[_-]?secret|password|refresh[_-]?token|secret|token)\s*[:=]\s*[^\s,;]+/giu, "$1=[Filtered]")
    // The parser deliberately rejects control characters. Normalize them at
    // the producer so an ordinary multiline error cannot make its own durable
    // lifecycle update unreadable.
    .replace(/[\u0000-\u001f\u007f]/gu, " ");
  if (WORKFLOW_LIFECYCLE_TEXT_ENCODER.encode(sanitized).byteLength <= WORKFLOW_INTERNAL_RUN_LIFECYCLE_MAX_ERROR_BYTES) return sanitized;
  let truncated = "";
  let byteLength = 0;
  for (const character of sanitized) {
    const characterBytes = WORKFLOW_LIFECYCLE_TEXT_ENCODER.encode(character).byteLength;
    if (byteLength + characterBytes > WORKFLOW_INTERNAL_RUN_LIFECYCLE_MAX_ERROR_BYTES) break;
    truncated += character;
    byteLength += characterBytes;
  }
  return truncated;
}

export function buildWorkflowRunLifecycleEvent(options: {
  tenancy: Pick<Tenancy, "id">,
  workflowId: string,
  runId: string,
  workflowVersion: number,
  runKey: string | null,
  triggerEventId: string | null,
  triggerType: string,
  transition: WorkflowRunLifecycleTransition,
  occurredAt?: Date,
}): WorkflowRunLifecycleEventBuildResult {
  const occurredAt = options.occurredAt ?? new Date();
  const retryAt = options.transition.retryAt ?? null;
  const occurredAtMillis = occurredAt.getTime();
  const retryAtMillis = retryAt?.getTime() ?? null;
  const error = sanitizeLifecycleError(options.transition.error);
  const eventKey = options.transition.eventKey ?? `${options.transition.retryEpoch}:${options.transition.attempt}`;
  const payload: WorkflowRunLifecyclePayload = {
    schema_version: WORKFLOW_INTERNAL_RUN_LIFECYCLE_SCHEMA_VERSION,
    workflow_id: options.workflowId,
    run_id: options.runId,
    workflow_version: options.workflowVersion,
    run_key: options.runKey,
    trigger_event_id: options.triggerEventId,
    trigger_type: options.triggerType,
    lifecycle: options.transition.kind,
    attempt: options.transition.attempt,
    retry_at_millis: retryAtMillis,
    error,
    occurred_at_millis: occurredAtMillis,
  };
  if (!WORKFLOW_LIFECYCLE_UUID_PATTERN.test(options.tenancy.id)
    || !isBoundedLifecycleText(options.workflowId, 64)
    || !WORKFLOW_LIFECYCLE_UUID_PATTERN.test(options.runId)
    || !isSafeInteger(options.workflowVersion, 1, Number.MAX_SAFE_INTEGER)
    || (options.runKey !== null && !isBoundedLifecycleText(options.runKey, 512))
    || (options.triggerEventId !== null && !WORKFLOW_LIFECYCLE_UUID_PATTERN.test(options.triggerEventId))
    || !isBoundedLifecycleText(options.triggerType, 256)
    || !isSafeInteger(options.transition.attempt, 0, 1_000_000)
    || !isSafeInteger(options.transition.retryEpoch, 0, 1_000_000)
    || !Number.isFinite(occurredAtMillis)
    || (retryAtMillis !== null && !Number.isFinite(retryAtMillis))
    || !isBoundedLifecycleText(eventKey, 512)) {
    return { status: "drop", reason: "invalid_lifecycle_payload" };
  }
  const serialized = JSON.stringify(payload);
  const byteLength = WORKFLOW_LIFECYCLE_TEXT_ENCODER.encode(serialized).byteLength;
  if (byteLength > WORKFLOW_INTERNAL_RUN_LIFECYCLE_MAX_BYTES) {
    return { status: "drop", reason: "lifecycle_payload_too_large" };
  }
  return {
    status: "ok",
    eventId: deterministicWorkflowUuid(`workflow-run-lifecycle:${options.runId}:${options.transition.kind}:${eventKey}`),
    type: lifecycleEventType(options.transition.kind),
    payload,
  };
}

export function parseWorkflowRunLifecycleEvent(type: unknown, value: unknown): WorkflowRunLifecycleParseResult {
  if (typeof type !== "string" || !type.startsWith(WORKFLOW_INTERNAL_RUN_LIFECYCLE_PREFIX)) return { status: "ignored" };
  const kind = type.slice(WORKFLOW_INTERNAL_RUN_LIFECYCLE_PREFIX.length);
  if (!isWorkflowRunLifecycleKind(kind)) {
    return { status: "invalid", reason: "unknown lifecycle event type" };
  }
  if (!isRecord(value)) return { status: "invalid", reason: "lifecycle payload must be an object" };
  if (value.schema_version !== WORKFLOW_INTERNAL_RUN_LIFECYCLE_SCHEMA_VERSION) {
    return { status: "invalid", reason: "lifecycle payload failed bounded validation" };
  }
  const workflowId = value.workflow_id;
  if (!isBoundedLifecycleText(workflowId, 64)) {
    return { status: "invalid", reason: "lifecycle payload failed bounded validation" };
  }
  const runId = value.run_id;
  if (!isWorkflowLifecycleUuid(runId)) {
    return { status: "invalid", reason: "lifecycle payload failed bounded validation" };
  }
  const workflowVersion = value.workflow_version;
  if (!isSafeInteger(workflowVersion, 1, Number.MAX_SAFE_INTEGER)) {
    return { status: "invalid", reason: "lifecycle payload failed bounded validation" };
  }
  const runKey = value.run_key;
  if (!isNullableBoundedLifecycleText(runKey, 512)) {
    return { status: "invalid", reason: "lifecycle payload failed bounded validation" };
  }
  const triggerEventId = value.trigger_event_id;
  if (!isNullableWorkflowLifecycleUuid(triggerEventId)) {
    return { status: "invalid", reason: "lifecycle payload failed bounded validation" };
  }
  const triggerType = value.trigger_type;
  if (!isBoundedLifecycleText(triggerType, 256)) {
    return { status: "invalid", reason: "lifecycle payload failed bounded validation" };
  }
  const lifecycle = value.lifecycle;
  if (!isWorkflowRunLifecycleKind(lifecycle) || lifecycle !== kind) {
    return { status: "invalid", reason: "lifecycle payload failed bounded validation" };
  }
  const attempt = value.attempt;
  if (!isSafeInteger(attempt, 0, 1_000_000)) {
    return { status: "invalid", reason: "lifecycle payload failed bounded validation" };
  }
  const retryAtMillis = value.retry_at_millis;
  if (!isNullableSafeInteger(retryAtMillis, 0, 8.64e15)) {
    return { status: "invalid", reason: "lifecycle payload failed bounded validation" };
  }
  const error = value.error;
  if (!isNullableBoundedLifecycleText(error, WORKFLOW_INTERNAL_RUN_LIFECYCLE_MAX_ERROR_BYTES)) {
    return { status: "invalid", reason: "lifecycle payload failed bounded validation" };
  }
  const occurredAtMillis = value.occurred_at_millis;
  if (!isSafeInteger(occurredAtMillis, -8.64e15, 8.64e15)) {
    return { status: "invalid", reason: "lifecycle payload failed bounded validation" };
  }
  const payload: WorkflowRunLifecyclePayload = {
    schema_version: WORKFLOW_INTERNAL_RUN_LIFECYCLE_SCHEMA_VERSION,
    workflow_id: workflowId,
    run_id: runId,
    workflow_version: workflowVersion,
    run_key: runKey,
    trigger_event_id: triggerEventId,
    trigger_type: triggerType,
    lifecycle,
    attempt,
    retry_at_millis: retryAtMillis,
    error,
    occurred_at_millis: occurredAtMillis,
  };
  const serialized = JSON.stringify(payload);
  if (WORKFLOW_LIFECYCLE_TEXT_ENCODER.encode(serialized).byteLength > WORKFLOW_INTERNAL_RUN_LIFECYCLE_MAX_BYTES) {
    return { status: "invalid", reason: "lifecycle payload exceeds byte limit" };
  }
  return { status: "ok", type: lifecycleEventType(payload.lifecycle), payload };
}

export async function enqueueWorkflowRunLifecycleEvent(
  client: PrismaClientTransaction,
  options: {
    tenancy: Pick<Tenancy, "id">,
    workflowId: string,
    runId: string,
    workflowVersion: number,
    runKey: string | null,
    triggerEventId: string | null,
    triggerType: string,
    transition: WorkflowRunLifecycleTransition,
    occurredAt?: Date,
  },
): Promise<{ eventId: string } | null> {
  const occurredAt = options.occurredAt ?? new Date();
  const built = buildWorkflowRunLifecycleEvent({ ...options, occurredAt });
  if (built.status === "drop") {
    captureError("workflow-run-lifecycle-invalid", new HexclaveAssertionError(
      `Workflow run lifecycle event was dropped: ${built.reason}`,
      { tenancyId: options.tenancy.id, runId: options.runId, workflowId: options.workflowId, lifecycle: options.transition.kind },
    ));
    return null;
  }
  return await enqueueWorkflowEvent(client, {
    tenancy: options.tenancy,
    type: built.type,
    payload: built.payload,
    scheduledAt: occurredAt,
    eventId: built.eventId,
  });
}

// The workflow event outbox writer. Platform events are enqueued INSIDE the
// same transaction as the entity mutation (at the webhook call sites), which
// is what makes delivery at-least-once from our own tables — a stronger
// guarantee than the fire-and-forget Svix webhook path next to it.
//
// NOTE ON SHARDING: workflow tables live in the global Prisma client's
// database. Today getPrismaClientForTenancy() also returns the global
// client, so passing a tenancy-scoped `tx` here is transactional. If
// per-source-of-truth sharding ever becomes real, this helper must move the
// outbox row into the same shard as the entity mutation (or lose the
// transactional guarantee) — revisit then.

/**
 * Deterministic UUID derived from a name; used wherever event/run creation
 * must be idempotent (schedule occurrences, lifecycle events, crash-replayed
 * outbox processing). Standard UUIDv5-style shape (version/variant bits set)
 * over sha256.
 */
export function deterministicWorkflowUuid(name: string): string {
  const hash = createHash("sha256").update("hexclave-workflows:").update(name).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type EnqueueWorkflowEventOptions = {
  tenancy: Pick<Tenancy, "id">,
  type: string,
  payload: unknown,
  /** For schedule occurrences: the nominal cron tick time. Defaults to now. */
  scheduledAt?: Date,
  /** Deterministic id for idempotent inserts (duplicates are silently skipped). */
  eventId?: string,
};

/**
 * Inserts a workflow event row, unconditionally: like every other app, Workflows
 * does not check `apps.installed` on the write path, so a tenancy with no
 * workflows still accrues outbox rows (the engine simply matches them against an
 * empty definition list and marks them processed).
 *
 * An oversized payload is a null no-op with a captured error rather than a throw,
 * because this runs inside entity-mutation transactions that must never fail on
 * account of workflows.
 */
export async function enqueueWorkflowEvent(client: PrismaClientTransaction, options: EnqueueWorkflowEventOptions): Promise<{ eventId: string } | null> {
  const payloadJson = JSON.stringify(options.payload ?? null);
  const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
  if (payloadBytes > WORKFLOW_EVENT_PAYLOAD_MAX_BYTES) {
    captureError("workflow-event-payload-too-large", new HexclaveAssertionError(
      `Workflow event payload for ${options.type} is ${payloadBytes} bytes, exceeding the ${WORKFLOW_EVENT_PAYLOAD_MAX_BYTES}-byte limit; the event was dropped`,
      { tenancyId: options.tenancy.id, type: options.type },
    ));
    return null;
  }

  const eventId = options.eventId ?? generateUuid();
  // createMany + skipDuplicates so deterministic ids make re-inserts no-ops.
  await client.workflowEvent.createMany({
    data: [{
      tenancyId: options.tenancy.id,
      id: eventId,
      type: options.type,
      payload: JSON.parse(payloadJson),
      scheduledAt: options.scheduledAt ?? new Date(),
    }],
    skipDuplicates: true,
  });
  return { eventId };
}

/**
 * Validates a custom event name as provided to workflows.send() and returns
 * the prefixed wire type. send() only emits custom events; the unprefixed
 * namespace is reserved for platform events forever.
 */
export function customEventNameToWireType(name: string): { wireType: string } | { error: string } {
  if (typeof name !== "string" || name.length === 0 || name.length > 200) {
    return { error: "Custom event names must be non-empty strings of at most 200 characters" };
  }
  if (name.startsWith(WORKFLOW_CUSTOM_EVENT_PREFIX)) {
    return { error: `Custom event names are automatically prefixed with "${WORKFLOW_CUSTOM_EVENT_PREFIX}" — send "${name.slice(WORKFLOW_CUSTOM_EVENT_PREFIX.length)}" instead of "${name}"` };
  }
  if (/\s/.test(name)) {
    return { error: "Custom event names must not contain whitespace" };
  }
  return { wireType: `${WORKFLOW_CUSTOM_EVENT_PREFIX}${name}` };
}

// Internal lifecycle events remain outside the user-trigger catalog. The engine
// consumes them before user matching for durable first-party delivery status.
