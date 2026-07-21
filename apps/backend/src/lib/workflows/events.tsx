import { PrismaClientTransaction } from "@/prisma-client";
import { WORKFLOW_CUSTOM_EVENT_PREFIX, WORKFLOW_EVENT_PAYLOAD_MAX_BYTES, WorkflowLifecycleEventType } from "@hexclave/shared/dist/interface/workflows";
import { captureError, HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import { createHash } from "node:crypto";
import { areWorkflowsEnabled } from "./gate";

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
  tenancy: { id: string, project: { id: string } },
  type: string,
  payload: unknown,
  /** For schedule occurrences: the nominal cron tick time. Defaults to now. */
  scheduledAt?: Date,
  /** Deterministic id for idempotent inserts (duplicates are silently skipped). */
  eventId?: string,
};

/**
 * Inserts a workflow event row. No-ops (returning null) when workflows are
 * disabled for the project — disabled projects must not silently accumulate
 * event state. Oversized payloads are also a null no-op with a captured
 * error rather than a throw, because this runs inside entity-mutation
 * transactions that must never fail on account of workflows.
 */
export async function enqueueWorkflowEvent(client: PrismaClientTransaction, options: EnqueueWorkflowEventOptions): Promise<{ eventId: string } | null> {
  if (!areWorkflowsEnabled(options.tenancy.project.id)) return null;

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

export type WorkflowRunForLifecycleEvent = {
  id: string,
  workflowId: string,
  runKey: string | null,
  version: number,
  triggerType: string,
};

/**
 * Lifecycle events (workflow.run.started/completed/failed/canceled) are
 * platform-emitted on run state transitions and reactable like any event.
 * Ids are deterministic per (run, transition) so crash-replayed transitions
 * never double-emit.
 *
 * KNOWN v1 LIMITATIONS (deliberate): (1) a manually retried run that fails
 * AGAIN does not emit a second workflow.run.failed (same deterministic id
 * as the first failure) — fixing this needs a per-run generation counter;
 * (2) there is no self-trigger loop protection (chain-depth cap) — the spec
 * explicitly defers it because of the internal-only rollout, and it must be
 * revisited before opening workflows to external projects.
 */
export async function enqueueWorkflowLifecycleEvent(client: PrismaClientTransaction, options: {
  tenancy: { id: string, project: { id: string } },
  type: WorkflowLifecycleEventType,
  run: WorkflowRunForLifecycleEvent,
}): Promise<void> {
  await enqueueWorkflowEvent(client, {
    tenancy: options.tenancy,
    type: options.type,
    eventId: deterministicWorkflowUuid(`lifecycle:${options.run.id}:${options.type}`),
    payload: {
      workflow_id: options.run.workflowId,
      run_id: options.run.id,
      run_key: options.run.runKey,
      version: options.run.version,
      trigger_type: options.run.triggerType,
    },
  });
}
