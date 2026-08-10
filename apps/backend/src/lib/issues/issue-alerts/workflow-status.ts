import {
  IssueAlertDeliveryOutcome,
  IssueAlertDeliveryState,
  type IssueAlertDeliveryState as IssueAlertDeliveryStateValue,
} from "@/generated/prisma/enums";
import { globalPrismaClient, retryTransaction, type PrismaClientTransaction } from "@/prisma-client";
import { scrubErrorIngestPayload, type ErrorIngestScrubbedValue } from "@/lib/error-ingest";
import {
  deterministicWorkflowUuid,
  parseWorkflowRunLifecycleEvent,
  type WorkflowRunLifecycleEventType,
  type WorkflowRunLifecyclePayload,
} from "@/lib/workflows/events";
import {
  ISSUE_ALERT_EMAIL_WORKFLOW_ID,
  ISSUE_ALERT_WORKFLOW_PAYLOAD_VERSION,
  ISSUE_ALERT_WORKFLOW_EVENT_TYPE,
} from "@/lib/workflows/issue-alerts/contract";
import { parseOwnershipRoutingMetadata } from "@/lib/issues/ownership/routing-metadata";
import {
  IssueAlertPersistenceInputError,
  issueAlertPersistenceService,
  type IssueAlertWorkflowUpdate,
} from "./persistence";
import type { IssueAlertRuleScope } from "./types";

export const ISSUE_ALERT_WORKFLOW_REPLAY_MAX_COUNT = 1_000;
export const ISSUE_ALERT_WORKFLOW_REPLAY_MAX_PAYLOAD_BYTES = 32 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f]+$/u;
const TEXT_ENCODER = new TextEncoder();
type IssueAlertWorkflowReplayPayload = { [key: string]: ErrorIngestScrubbedValue };

export type IssueAlertWorkflowDeliveryRef = {
  id: string,
  scope: IssueAlertRuleScope,
  workflowEventId: string,
  state: IssueAlertDeliveryStateValue,
  nextRetryAt: Date | null,
};

export type IssueAlertWorkflowStatusStore = {
  findDeliveryByWorkflowEventId(tenancyId: string, workflowEventId: string): Promise<IssueAlertWorkflowDeliveryRef | null>,
  applyWorkflowUpdate(scope: IssueAlertRuleScope, deliveryId: string, expectedWorkflowEventId: string, update: IssueAlertWorkflowUpdate): Promise<boolean>,
};

export type IssueAlertWorkflowLifecycle = {
  type: WorkflowRunLifecycleEventType,
  payload: WorkflowRunLifecyclePayload,
};

export type IssueAlertWorkflowLifecycleParseResult =
  | { status: "ignored", reason: "not_internal_lifecycle" | "not_issue_alert_workflow" }
  | { status: "invalid", reason: string }
  | { status: "ok", lifecycle: IssueAlertWorkflowLifecycle };

export type IssueAlertWorkflowStatusResult =
  | { status: "ignored", reason: "not_internal_lifecycle" | "not_issue_alert_workflow" | "delivery_not_found" | "stale_lifecycle" }
  | { status: "invalid", reason: string }
  | {
    status: "reconciled",
    deliveryId: string,
    lifecycle: WorkflowRunLifecyclePayload["lifecycle"],
    update: IssueAlertWorkflowUpdate,
  };

function isObject(value: unknown): value is { readonly [key: string]: ErrorIngestScrubbedValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedIdentifier(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && IDENTIFIER_PATTERN.test(value)
    && TEXT_ENCODER.encode(value).byteLength <= maximumBytes;
}

function isBoundedUniqueUserIdArray(value: ErrorIngestScrubbedValue | undefined): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return false;
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isBoundedIdentifier(entry, 256) || seen.has(entry)) return false;
    seen.add(entry);
  }
  return true;
}

function validateScope(scope: IssueAlertRuleScope): void {
  if (!UUID_PATTERN.test(scope.tenancyId)
    || !isBoundedIdentifier(scope.projectId, 256)
    || !isBoundedIdentifier(scope.branchId, 256)) {
    throw new IssueAlertPersistenceInputError("Issue alert workflow status scope is invalid");
  }
}

function validateDate(value: Date, field: string): void {
  if (!Number.isFinite(value.getTime())) throw new IssueAlertPersistenceInputError(`${field} must be a valid date`);
}

function defaultLifecycleError(kind: WorkflowRunLifecyclePayload["lifecycle"]): string {
  switch (kind) {
    case "failure": {
      return "Workflow run failed before issue-alert email delivery completed";
    }
    case "retry": {
      return "Workflow run retry scheduled for issue-alert email delivery";
    }
    case "cancel": {
      return "Workflow run was canceled before issue-alert email delivery completed";
    }
    case "success": {
      return "";
    }
  }
}

function parseIssueAlertWorkflowLifecycleFromPayload(
  type: string,
  payload: unknown,
): IssueAlertWorkflowLifecycleParseResult {
  const parsed = parseWorkflowRunLifecycleEvent(type, payload);
  if (parsed.status === "ignored") return { status: "ignored", reason: "not_internal_lifecycle" };
  if (parsed.status === "invalid") return parsed;
  if (parsed.payload.workflow_id !== ISSUE_ALERT_EMAIL_WORKFLOW_ID
    || parsed.payload.trigger_type !== ISSUE_ALERT_WORKFLOW_EVENT_TYPE
    || parsed.payload.trigger_event_id === null) {
    return { status: "ignored", reason: "not_issue_alert_workflow" };
  }
  return { status: "ok", lifecycle: { type: parsed.type, payload: parsed.payload } };
}

export function parseIssueAlertWorkflowLifecycle(
  type: string,
  payload: unknown,
): IssueAlertWorkflowLifecycleParseResult {
  return parseIssueAlertWorkflowLifecycleFromPayload(type, payload);
}

function toLifecycleDate(milliseconds: number, field: string): Date {
  const result = new Date(milliseconds);
  validateDate(result, field);
  return result;
}

function updateForLifecycle(payload: WorkflowRunLifecyclePayload): IssueAlertWorkflowUpdate {
  const at = toLifecycleDate(payload.occurred_at_millis, "workflow lifecycle time");
  switch (payload.lifecycle) {
    case "success": {
      return { kind: "delivered", at };
    }
    case "failure": {
      // Workflows emits a separate `retry` lifecycle event whenever another
      // execution is scheduled. A terminal failure therefore has no retry
      // timestamp and must enter the existing DROPPED state so it is visible
      // as a dead letter instead of being mistaken for an endlessly retryable
      // delivery.
      if (payload.retry_at_millis === null) {
        return {
          kind: "dropped",
          error: payload.error ?? defaultLifecycleError(payload.lifecycle),
          at,
        };
      }
      return {
        kind: "failed",
        error: payload.error ?? defaultLifecycleError(payload.lifecycle),
        nextRetryAt: toLifecycleDate(payload.retry_at_millis, "workflow retry time"),
        at,
      };
    }
    case "retry": {
      return {
        kind: "failed",
        error: payload.error ?? defaultLifecycleError(payload.lifecycle),
        nextRetryAt: payload.retry_at_millis === null ? null : toLifecycleDate(payload.retry_at_millis, "workflow retry time"),
        at,
      };
    }
    case "cancel": {
      return { kind: "dropped", error: defaultLifecycleError(payload.lifecycle), at };
    }
  }
}

function isStaleLifecycle(
  delivery: IssueAlertWorkflowDeliveryRef,
  lifecycle: WorkflowRunLifecyclePayload["lifecycle"],
  retryAt: Date | null,
): boolean {
  if (delivery.state === IssueAlertDeliveryState.DELIVERED) return true;
  if (delivery.state === IssueAlertDeliveryState.DROPPED) return true;
  if (lifecycle === "failure" && delivery.state === IssueAlertDeliveryState.FAILED && delivery.nextRetryAt === null) return true;
  if (lifecycle === "retry"
    && delivery.state === IssueAlertDeliveryState.FAILED
    && delivery.nextRetryAt?.getTime() === retryAt?.getTime()) return true;
  return false;
}

const defaultStatusStore: IssueAlertWorkflowStatusStore = {
  async findDeliveryByWorkflowEventId(tenancyId, workflowEventId) {
    const row = await globalPrismaClient.issueAlertDelivery.findFirst({
      // This read controls an immediate durable state transition. It must use
      // the primary so a fresh lifecycle event cannot race a lagging replica.
      where: { tenancyId, workflowEventId },
      select: {
        id: true,
        tenancyId: true,
        projectId: true,
        branchId: true,
        workflowEventId: true,
        state: true,
        nextRetryAt: true,
      },
    });
    if (row === null || row.workflowEventId === null) return null;
    return {
      id: row.id,
      scope: { tenancyId: row.tenancyId, projectId: row.projectId, branchId: row.branchId },
      workflowEventId: row.workflowEventId,
      state: row.state,
      nextRetryAt: row.nextRetryAt,
    };
  },
  async applyWorkflowUpdate(scope, deliveryId, expectedWorkflowEventId, update) {
    const result = await issueAlertPersistenceService.recordWorkflowUpdateIfCurrent(scope, deliveryId, expectedWorkflowEventId, update);
    return result !== null;
  },
};

export async function reconcileIssueAlertWorkflowLifecycle(options: {
  tenancyId: string,
  type: string,
  payload: unknown,
  store?: IssueAlertWorkflowStatusStore,
}): Promise<IssueAlertWorkflowStatusResult> {
  const parsed = parseIssueAlertWorkflowLifecycleFromPayload(options.type, options.payload);
  if (parsed.status !== "ok") return parsed;
  if (!UUID_PATTERN.test(options.tenancyId)) return { status: "invalid", reason: "workflow lifecycle tenancy id is invalid" };
  const lifecycle = parsed.lifecycle;
  const triggerEventId = lifecycle.payload.trigger_event_id;
  if (triggerEventId === null) return { status: "ignored", reason: "not_issue_alert_workflow" };
  const store = options.store ?? defaultStatusStore;
  const delivery = await store.findDeliveryByWorkflowEventId(options.tenancyId, triggerEventId);
  if (delivery === null) return { status: "ignored", reason: "delivery_not_found" };
  const update = updateForLifecycle(lifecycle.payload);
  const retryAt = update.kind === "failed" ? update.nextRetryAt : null;
  if (isStaleLifecycle(delivery, lifecycle.payload.lifecycle, retryAt)) {
    return { status: "ignored", reason: "stale_lifecycle" };
  }
  const applied = await store.applyWorkflowUpdate(delivery.scope, delivery.id, triggerEventId, update);
  if (!applied) return { status: "ignored", reason: "stale_lifecycle" };
  return {
    status: "reconciled",
    deliveryId: delivery.id,
    lifecycle: lifecycle.payload.lifecycle,
    update,
  };
}

export type IssueAlertWorkflowReplayPlan = {
  eventId: string,
  type: typeof ISSUE_ALERT_WORKFLOW_EVENT_TYPE,
  payload: IssueAlertWorkflowReplayPayload,
  payloadJson: string,
  scheduledAt: Date,
  replayCount: number,
};

export type IssueAlertWorkflowReplayPlanResult =
  | { status: "ok", plan: IssueAlertWorkflowReplayPlan }
  | {
    status: "drop",
    reason: IssueAlertWorkflowReplayDropReason,
  };

export type IssueAlertWorkflowReplayDropReason =
  | "invalid_delivery_id"
  | "invalid_source_event_id"
  | "replay_limit"
  | "invalid_event_type"
  | "invalid_event_payload"
  | "payload_too_large"
  | "invalid_replay_time";

function isReplayableAction(value: ErrorIngestScrubbedValue | undefined): value is IssueAlertWorkflowReplayPayload {
  if (!isObject(value)) return false;
  if (value.type === "webhook") {
    return typeof value.integration_id === "string" && value.integration_id.length > 0;
  }
  const userIds = value.user_ids;
  const routingResolution = Object.prototype.hasOwnProperty.call(value, "routing_resolution")
    ? parseOwnershipRoutingMetadata(value.routing_resolution)
    : undefined;
  const userIdCount = Array.isArray(userIds) ? userIds.length : null;
  const validUserIds = isBoundedUniqueUserIdArray(userIds);
  const validRoutingRecipients = routingResolution === undefined
    ? validUserIds && userIdCount !== null && userIdCount > 0
    : routingResolution !== null
      && validUserIds
      && routingResolution.recipient_count === userIdCount
      && (routingResolution.status === "resolved" ? userIdCount > 0 : userIdCount === 0);
  return value.type === "email"
    && validRoutingRecipients
    && typeof value.subject === "string"
    && value.subject.length > 0
    && typeof value.html === "string"
    && value.html.length > 0;
}

function isReplayablePayload(value: ErrorIngestScrubbedValue | undefined): value is IssueAlertWorkflowReplayPayload {
  if (!isObject(value)) return false;
  return value.schema_version === ISSUE_ALERT_WORKFLOW_PAYLOAD_VERSION
    && value.kind === "issue_alert"
    && typeof value.event_kind === "string"
    && typeof value.project_id === "string"
    && typeof value.branch_id === "string"
    && typeof value.issue_id === "string"
    && typeof value.occurrence_id === "string"
    && typeof value.rule_id === "string"
    && typeof value.deduplication_key === "string"
    && typeof value.cooldown_key === "string"
    && isReplayableAction(value.action);
}

export function buildIssueAlertWorkflowReplayPlan(input: {
  deliveryId: string,
  sourceEventId: string,
  sourceEventType: string,
  sourcePayload: unknown,
  replayCount: number,
  scheduledAt: Date,
}): IssueAlertWorkflowReplayPlanResult {
  if (!UUID_PATTERN.test(input.deliveryId)) return { status: "drop", reason: "invalid_delivery_id" };
  if (!UUID_PATTERN.test(input.sourceEventId)) return { status: "drop", reason: "invalid_source_event_id" };
  if (!Number.isSafeInteger(input.replayCount) || input.replayCount < 0 || input.replayCount >= ISSUE_ALERT_WORKFLOW_REPLAY_MAX_COUNT) {
    return { status: "drop", reason: "replay_limit" };
  }
  if (input.sourceEventType !== ISSUE_ALERT_WORKFLOW_EVENT_TYPE) return { status: "drop", reason: "invalid_event_type" };
  if (!Number.isFinite(input.scheduledAt.getTime())) return { status: "drop", reason: "invalid_replay_time" };

  const scrubbed = scrubErrorIngestPayload(input.sourcePayload, {
    maxDepth: 6,
    maxPayloadBytes: ISSUE_ALERT_WORKFLOW_REPLAY_MAX_PAYLOAD_BYTES,
    maxStringBytes: 8 * 1024,
    maxKeyBytes: 128,
    maxCollectionEntries: 64,
  });
  if (!isReplayablePayload(scrubbed.value)) return { status: "drop", reason: "invalid_event_payload" };
  const payloadJson = JSON.stringify(scrubbed.value);
  if (TEXT_ENCODER.encode(payloadJson).byteLength > ISSUE_ALERT_WORKFLOW_REPLAY_MAX_PAYLOAD_BYTES) {
    return { status: "drop", reason: "payload_too_large" };
  }
  return {
    status: "ok",
    plan: {
      eventId: deterministicWorkflowUuid(`issue-alert-replay:${input.deliveryId}:${input.replayCount + 1}`),
      type: ISSUE_ALERT_WORKFLOW_EVENT_TYPE,
      payload: scrubbed.value,
      payloadJson,
      scheduledAt: input.scheduledAt,
      replayCount: input.replayCount + 1,
    },
  };
}

export type IssueAlertWorkflowReplayResult =
  | { status: "replayed", deliveryId: string, workflowEventId: string, replayCount: number }
  | {
    status: "not_replayed",
    reason: "delivery_not_found" | "delivery_not_failed" | "missing_workflow_event" | IssueAlertWorkflowReplayDropReason,
  };

async function replayIssueAlertWorkflowDeliveryInTransaction(
  client: PrismaClientTransaction,
  scope: IssueAlertRuleScope,
  deliveryId: string,
  now: Date,
): Promise<IssueAlertWorkflowReplayResult> {
  const delivery = await client.issueAlertDelivery.findFirst({
    where: {
      tenancyId: scope.tenancyId,
      projectId: scope.projectId,
      branchId: scope.branchId,
      id: deliveryId,
    },
    select: {
      id: true,
      tenancyId: true,
      projectId: true,
      branchId: true,
      state: true,
      replayCount: true,
      workflowEventId: true,
    },
  });
  if (delivery === null) return { status: "not_replayed", reason: "delivery_not_found" };
  if (delivery.state !== IssueAlertDeliveryState.FAILED && delivery.state !== IssueAlertDeliveryState.DROPPED) {
    return { status: "not_replayed", reason: "delivery_not_failed" };
  }
  if (delivery.workflowEventId === null) return { status: "not_replayed", reason: "missing_workflow_event" };
  const sourceEvent = await client.workflowEvent.findUnique({
    where: { tenancyId_id: { tenancyId: scope.tenancyId, id: delivery.workflowEventId } },
    select: { id: true, type: true, payload: true },
  });
  if (sourceEvent === null) return { status: "not_replayed", reason: "missing_workflow_event" };
  const plan = buildIssueAlertWorkflowReplayPlan({
    deliveryId: delivery.id,
    sourceEventId: sourceEvent.id,
    sourceEventType: sourceEvent.type,
    sourcePayload: sourceEvent.payload,
    replayCount: delivery.replayCount,
    scheduledAt: now,
  });
  if (plan.status === "drop") return { status: "not_replayed", reason: plan.reason };

  await client.workflowEvent.createMany({
    data: [{
      tenancyId: scope.tenancyId,
      id: plan.plan.eventId,
      type: plan.plan.type,
      payload: JSON.parse(plan.plan.payloadJson),
      scheduledAt: plan.plan.scheduledAt,
    }],
    skipDuplicates: true,
  });
  const updated = await client.issueAlertDelivery.updateMany({
    where: {
      tenancyId: scope.tenancyId,
      projectId: scope.projectId,
      branchId: scope.branchId,
      id: delivery.id,
      state: { in: [IssueAlertDeliveryState.FAILED, IssueAlertDeliveryState.DROPPED] },
      replayCount: delivery.replayCount,
    },
    data: {
      state: IssueAlertDeliveryState.ENQUEUED,
      outcome: IssueAlertDeliveryOutcome.WORKFLOW_ENQUEUED,
      workflowEventId: plan.plan.eventId,
      replayCount: { increment: 1 },
      nextRetryAt: null,
      lastError: null,
      completedAt: null,
      claimedAt: now,
      enqueuedAt: now,
    },
  });
  if (updated.count !== 1) {
    throw new Error("Issue alert replay lost its delivery claim; the transaction must be retried");
  }
  return {
    status: "replayed",
    deliveryId: delivery.id,
    workflowEventId: plan.plan.eventId,
    replayCount: plan.plan.replayCount,
  };
}

export async function replayIssueAlertWorkflowDelivery(
  scope: IssueAlertRuleScope,
  deliveryId: string,
  now = new Date(),
): Promise<IssueAlertWorkflowReplayResult> {
  validateScope(scope);
  if (!UUID_PATTERN.test(deliveryId)) return { status: "not_replayed", reason: "invalid_delivery_id" };
  validateDate(now, "issue alert replay time");
  return await retryTransaction(globalPrismaClient, async (tx) => await replayIssueAlertWorkflowDeliveryInTransaction(tx, scope, deliveryId, now), {
    level: "serializable",
  });
}

/** Manual retry is a durable replay of the original trigger event. */
export const retryIssueAlertWorkflowDelivery = replayIssueAlertWorkflowDelivery;
