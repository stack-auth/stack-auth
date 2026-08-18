import { IssueAlertDeliveryState, type IssueAlertDeliveryState as IssueAlertDeliveryStateValue } from "@/generated/prisma/enums";
import {
  buildWorkflowRunLifecycleEvent,
  parseWorkflowRunLifecycleEvent,
  type WorkflowRunLifecycleKind,
  type WorkflowRunLifecycleTransition,
} from "@/lib/workflows/events";
import {
  ISSUE_ALERT_EMAIL_WORKFLOW_ID,
  ISSUE_ALERT_WORKFLOW_PAYLOAD_VERSION,
  ISSUE_ALERT_WORKFLOW_EVENT_TYPE,
} from "@/lib/workflows/issue-alerts/contract";
import {
  buildIssueAlertWorkflowReplayPlan,
  parseIssueAlertWorkflowLifecycle,
  reconcileIssueAlertWorkflowLifecycle,
  type IssueAlertWorkflowDeliveryRef,
  type IssueAlertWorkflowStatusStore,
} from "./workflow-status";
import type { IssueAlertWorkflowUpdate } from "./persistence";
import type { IssueAlertRuleScope } from "./types";
import { describe, expect, it } from "vitest";

const tenancyId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
const triggerEventId = "00000000-0000-4000-8000-000000000003";
const deliveryId = "00000000-0000-4000-8000-000000000004";
const occurredAt = new Date("2026-08-06T12:00:00.000Z");
const retryAt = new Date("2026-08-06T12:00:10.000Z");
const lifecycleKinds: readonly WorkflowRunLifecycleKind[] = ["success", "failure", "retry", "cancel"];

const scope: IssueAlertRuleScope = {
  tenancyId,
  projectId: "project-status-test",
  branchId: "branch-status-test",
};

function buildLifecycle(kind: WorkflowRunLifecycleKind, error?: string) {
  const transition: WorkflowRunLifecycleTransition = {
    kind,
    attempt: kind === "retry" ? 2 : 1,
    retryEpoch: 0,
    eventKey: kind,
    ...(kind === "retry" ? { retryAt } : {}),
    ...(error === undefined ? {} : { error }),
  };
  const built = buildWorkflowRunLifecycleEvent({
    tenancy: { id: tenancyId },
    workflowId: ISSUE_ALERT_EMAIL_WORKFLOW_ID,
    runId,
    workflowVersion: 1,
    runKey: "issue-alert-cooldown",
    triggerEventId,
    triggerType: ISSUE_ALERT_WORKFLOW_EVENT_TYPE,
    transition,
    occurredAt,
  });
  if (built.status !== "ok") throw new Error(`Could not build ${kind} lifecycle event: ${built.reason}`);
  return built;
}

function makeStore(
  initialState: IssueAlertDeliveryStateValue = IssueAlertDeliveryState.ENQUEUED,
  shouldApply = true,
): {
  store: IssueAlertWorkflowStatusStore,
  updates: IssueAlertWorkflowUpdate[],
} {
  let delivery: IssueAlertWorkflowDeliveryRef = {
    id: deliveryId,
    scope,
    workflowEventId: triggerEventId,
    state: initialState,
    nextRetryAt: null,
    lastAttemptAt: null,
  };
  const updates: IssueAlertWorkflowUpdate[] = [];
  const store: IssueAlertWorkflowStatusStore = {
    async findDeliveryByWorkflowEventId(foundTenancyId, foundWorkflowEventId) {
      if (foundTenancyId !== tenancyId || foundWorkflowEventId !== delivery.workflowEventId) return null;
      return delivery;
    },
    async applyWorkflowUpdate(updateScope, foundDeliveryId, expectedWorkflowEventId, expectedDelivery, update) {
      expect(updateScope).toEqual(scope);
      expect(foundDeliveryId).toBe(deliveryId);
      expect(expectedWorkflowEventId).toBe(delivery.workflowEventId);
      expect(expectedDelivery).toEqual({
        state: delivery.state,
        nextRetryAt: delivery.nextRetryAt,
        lastAttemptAt: delivery.lastAttemptAt,
      });
      if (!shouldApply) return false;
      updates.push(update);
      if (update.kind === "delivered") {
        delivery = { ...delivery, state: IssueAlertDeliveryState.DELIVERED, nextRetryAt: null };
      } else if (update.kind === "failed") {
        // Mirrors the persistence layer, which stamps `lastAttemptAt` on every
        // failure/retry it applies.
        delivery = { ...delivery, state: IssueAlertDeliveryState.FAILED, nextRetryAt: update.nextRetryAt, lastAttemptAt: update.at ?? null };
      } else if (update.kind === "dropped") {
        delivery = { ...delivery, state: IssueAlertDeliveryState.DROPPED, nextRetryAt: null, lastAttemptAt: update.at ?? null };
      }
      return true;
    },
  };
  return { store, updates };
}

function makeReplayPayload(): Record<string, unknown> {
  return {
    schema_version: ISSUE_ALERT_WORKFLOW_PAYLOAD_VERSION,
    kind: "issue_alert",
    event_kind: "new",
    project_id: scope.projectId,
    branch_id: scope.branchId,
    issue_id: "00000000-0000-4000-8000-000000000005",
    issue_short_id: "42",
    issue_status: "unresolved",
    occurrence_id: "occurrence-status-test",
    occurred_at_millis: occurredAt.getTime(),
    environment: "test",
    release: "status-test",
    summary: "Issue alert replay",
    culprit: "workflow-status.test.ts",
    rule_id: "status-test-rule",
    rule_version: 1,
    deduplication_key: "dedupe-status-test",
    cooldown_key: "cooldown-status-test",
    cooldown_seconds: 60,
    action: {
      type: "email",
      user_ids: ["user-status-test"],
      subject: "Issue alert",
      html: "<p>Issue alert</p>",
    },
  };
}

function firstUpdate(updates: readonly IssueAlertWorkflowUpdate[]): IssueAlertWorkflowUpdate {
  if (updates.length === 0) throw new Error("Expected a lifecycle update");
  return updates[0];
}

describe("issue-alert workflow lifecycle bridge", () => {
  it("parses all bounded lifecycle kinds and rejects oversized errors", () => {
    for (const kind of lifecycleKinds) {
      const built = buildLifecycle(kind);
      const parsed = parseWorkflowRunLifecycleEvent(built.type, built.payload);
      expect(parsed).toEqual({ status: "ok", type: built.type, payload: built.payload });
    }

    const built = buildLifecycle("failure");
    const parsed = parseWorkflowRunLifecycleEvent(built.type, { ...built.payload, error: "x".repeat(9_000) });
    expect(parsed.status).toBe("invalid");
  });

  it("reconciles success, failure, retry, and cancel into durable delivery updates", async () => {
    for (const kind of lifecycleKinds) {
      const { store, updates } = makeStore();
      const built = buildLifecycle(kind);
      const result = await reconcileIssueAlertWorkflowLifecycle({
        tenancyId,
        type: built.type,
        payload: built.payload,
        store,
      });

      expect(result.status).toBe("reconciled");
      expect(updates).toHaveLength(1);
      const update = firstUpdate(updates);
      if (kind === "success") expect(update.kind).toBe("delivered");
      if (kind === "failure") expect(update.kind).toBe("dropped");
      if (kind === "retry") {
        expect(update.kind).toBe("failed");
        if (update.kind === "failed") expect(update.nextRetryAt).toEqual(retryAt);
      }
      if (kind === "cancel") expect(update.kind).toBe("dropped");
    }
  });

  it("scrubs credentials from failure status and ignores stale lifecycle events", async () => {
    const { store, updates } = makeStore();
    const built = buildLifecycle("failure", "request failed authorization=Bearer super-secret-token");
    const result = await reconcileIssueAlertWorkflowLifecycle({ tenancyId, type: built.type, payload: built.payload, store });
    expect(result.status).toBe("reconciled");
    const update = firstUpdate(updates);
    if (update.kind !== "dropped") throw new Error("Expected a dead-letter delivery update");
    expect(update.error).not.toContain("super-secret-token");
    expect(update.error).toContain("[Filtered]");

    const staleStore = makeStore(IssueAlertDeliveryState.DELIVERED);
    const stale = await reconcileIssueAlertWorkflowLifecycle({
      tenancyId,
      type: built.type,
      payload: built.payload,
      store: staleStore.store,
    });
    expect(stale).toEqual({ status: "ignored", reason: "stale_lifecycle" });

    const compareAndApplyRace = makeStore(IssueAlertDeliveryState.ENQUEUED, false);
    const raceResult = await reconcileIssueAlertWorkflowLifecycle({
      tenancyId,
      type: built.type,
      payload: built.payload,
      store: compareAndApplyRace.store,
    });
    expect(raceResult).toEqual({ status: "ignored", reason: "stale_lifecycle" });
  });

  it("keeps the reducer monotonic across out-of-order failure/retry lifecycle events", async () => {
    const buildLifecycleWith = (kind: WorkflowRunLifecycleKind, options: { occurredAt: Date, retryAt?: Date, attempt?: number }) => {
      const built = buildWorkflowRunLifecycleEvent({
        tenancy: { id: tenancyId },
        workflowId: ISSUE_ALERT_EMAIL_WORKFLOW_ID,
        runId,
        workflowVersion: 1,
        runKey: "issue-alert-cooldown",
        triggerEventId,
        triggerType: ISSUE_ALERT_WORKFLOW_EVENT_TYPE,
        transition: {
          kind,
          attempt: options.attempt ?? 1,
          retryEpoch: 0,
          eventKey: `${kind}-${options.occurredAt.getTime()}`,
          ...(options.retryAt === undefined ? {} : { retryAt: options.retryAt }),
        },
        occurredAt: options.occurredAt,
      });
      if (built.status !== "ok") throw new Error(`Could not build ${kind} lifecycle event: ${built.reason}`);
      return built;
    };
    const reconcile = async (built: ReturnType<typeof buildLifecycleWith>, store: IssueAlertWorkflowStatusStore) =>
      await reconcileIssueAlertWorkflowLifecycle({ tenancyId, type: built.type, payload: built.payload, store });

    const { store, updates } = makeStore();

    // The retry for attempt #1 is processed BEFORE its matching failure.
    const firstRetry = await reconcile(buildLifecycleWith("retry", { occurredAt, retryAt, attempt: 2 }), store);
    expect(firstRetry.status).toBe("reconciled");

    // The matching failure (same scheduled retry, occurred just before the
    // retry event) must be recognized as the same attempt, not applied again —
    // applying it would increment `attemptCount` twice for one execution.
    const lateFailure = await reconcile(
      buildLifecycleWith("failure", { occurredAt: new Date(occurredAt.getTime() - 1_000), retryAt }),
      store,
    );
    expect(lateFailure).toEqual({ status: "ignored", reason: "stale_lifecycle" });

    // A newer retry legitimately moves the schedule forward...
    const laterOccurredAt = new Date(occurredAt.getTime() + 60_000);
    const laterRetryAt = new Date(retryAt.getTime() + 60_000);
    const secondRetry = await reconcile(
      buildLifecycleWith("retry", { occurredAt: laterOccurredAt, retryAt: laterRetryAt, attempt: 3 }),
      store,
    );
    expect(secondRetry.status).toBe("reconciled");

    // ...and a delayed failure from the FIRST attempt must not roll it back.
    const veryLateFailure = await reconcile(
      buildLifecycleWith("failure", { occurredAt: new Date(occurredAt.getTime() - 500), retryAt }),
      store,
    );
    expect(veryLateFailure).toEqual({ status: "ignored", reason: "stale_lifecycle" });

    expect(updates).toHaveLength(2);
  });

  it("dead-letters terminal failures and ignores a delayed retry lifecycle", async () => {
    const { store, updates } = makeStore();
    const terminalFailure = buildLifecycle("failure", "provider configuration is invalid");
    const failureResult = await reconcileIssueAlertWorkflowLifecycle({
      tenancyId,
      type: terminalFailure.type,
      payload: terminalFailure.payload,
      store,
    });

    expect(failureResult.status).toBe("reconciled");
    expect(firstUpdate(updates)).toEqual({
      kind: "dropped",
      error: "provider configuration is invalid",
      at: occurredAt,
    });

    const delayedRetry = buildLifecycle("retry");
    const retryResult = await reconcileIssueAlertWorkflowLifecycle({
      tenancyId,
      type: delayedRetry.type,
      payload: delayedRetry.payload,
      store,
    });
    expect(retryResult).toEqual({ status: "ignored", reason: "stale_lifecycle" });
    expect(updates).toHaveLength(1);
  });

  it("builds a deterministic bounded replay event from the durable source payload", () => {
    const input = {
      deliveryId,
      sourceEventId: triggerEventId,
      sourceEventType: ISSUE_ALERT_WORKFLOW_EVENT_TYPE,
      sourcePayload: makeReplayPayload(),
      replayCount: 0,
      scheduledAt: occurredAt,
    };
    const first = buildIssueAlertWorkflowReplayPlan(input);
    const second = buildIssueAlertWorkflowReplayPlan(input);
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status !== "ok" || second.status !== "ok") throw new Error("Expected replay plans");
    expect(first.plan.eventId).toBe(second.plan.eventId);
    expect(first.plan.replayCount).toBe(1);
    expect(new TextEncoder().encode(first.plan.payloadJson).byteLength).toBeLessThanOrEqual(32 * 1024);

    expect(buildIssueAlertWorkflowReplayPlan({ ...input, sourceEventType: "custom.other" })).toEqual({
      status: "drop",
      reason: "invalid_event_type",
    });
    expect(buildIssueAlertWorkflowReplayPlan({ ...input, replayCount: 1_000 })).toEqual({
      status: "drop",
      reason: "replay_limit",
    });

    const webhookReplay = buildIssueAlertWorkflowReplayPlan({
      ...input,
      sourcePayload: { ...makeReplayPayload(), action: { type: "webhook", integration_id: "integration-prod-errors" } },
    });
    expect(webhookReplay.status).toBe("ok");
  });

  it("keeps non-issue-alert internal lifecycle events out of the delivery bridge", () => {
    const built = buildWorkflowRunLifecycleEvent({
      tenancy: { id: tenancyId },
      workflowId: "other-workflow",
      runId,
      workflowVersion: 1,
      runKey: null,
      triggerEventId,
      triggerType: "custom.other",
      transition: { kind: "success", attempt: 1, retryEpoch: 0 },
      occurredAt,
    });
    if (built.status !== "ok") throw new Error("Could not build non-alert lifecycle event");
    expect(parseIssueAlertWorkflowLifecycle(built.type, built.payload)).toEqual({
      status: "ignored",
      reason: "not_issue_alert_workflow",
    });
  });
});
