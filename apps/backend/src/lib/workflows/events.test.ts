import { describe, expect, it } from "vitest";
import {
  WORKFLOW_INTERNAL_RUN_LIFECYCLE_PREFIX,
  buildWorkflowRunLifecycleEvent,
  parseWorkflowRunLifecycleEvent,
  type WorkflowRunLifecyclePayload,
} from "./events";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const TRIGGER_EVENT_ID = "22222222-2222-4222-8222-222222222222";

function validPayload(): WorkflowRunLifecyclePayload {
  return {
    schema_version: 1,
    workflow_id: "issue-alert-email",
    run_id: RUN_ID,
    workflow_version: 1,
    run_key: "issue-alert-key",
    trigger_event_id: TRIGGER_EVENT_ID,
    trigger_type: "custom.hexclave.issue-alert",
    lifecycle: "success",
    attempt: 1,
    retry_at_millis: null,
    error: null,
    occurred_at_millis: 1_754_000_000_000,
  };
}

describe("parseWorkflowRunLifecycleEvent", () => {
  it("normalizes control characters in errors into a payload the parser accepts", () => {
    const built = buildWorkflowRunLifecycleEvent({
      tenancy: { id: "33333333-3333-4333-8333-333333333333" },
      workflowId: "issue-alert-email",
      runId: RUN_ID,
      workflowVersion: 1,
      runKey: "issue-alert-key",
      triggerEventId: TRIGGER_EVENT_ID,
      triggerType: "custom.hexclave.issue-alert",
      transition: {
        kind: "failure",
        attempt: 1,
        retryEpoch: 0,
        retryAt: null,
        error: "first line\nsecond\u0000line",
      },
    });
    expect(built).toMatchObject({ status: "ok", payload: { error: "first line second line" } });
    if (built.status !== "ok") throw new Error("Expected lifecycle event to be built");
    expect(parseWorkflowRunLifecycleEvent(built.type, built.payload).status).toBe("ok");
  });

  it("returns a typed payload after validating every wire field", () => {
    const result = parseWorkflowRunLifecycleEvent(
      `${WORKFLOW_INTERNAL_RUN_LIFECYCLE_PREFIX}success`,
      validPayload(),
    );

    expect(result).toEqual({
      status: "ok",
      type: `${WORKFLOW_INTERNAL_RUN_LIFECYCLE_PREFIX}success`,
      payload: validPayload(),
    });
  });

  it.each([
    { field: "run_id", value: 42 },
    { field: "trigger_event_id", value: { id: TRIGGER_EVENT_ID } },
    { field: "lifecycle", value: "completed" },
    { field: "retry_at_millis", value: "later" },
  ])("rejects an unknown $field value without coercion", ({ field, value }) => {
    const payload = { ...validPayload(), [field]: value };

    expect(parseWorkflowRunLifecycleEvent(
      `${WORKFLOW_INTERNAL_RUN_LIFECYCLE_PREFIX}success`,
      payload,
    )).toEqual({
      status: "invalid",
      reason: "lifecycle payload failed bounded validation",
    });
  });

  it("does not claim public or unknown lifecycle event types", () => {
    expect(parseWorkflowRunLifecycleEvent(42, validPayload())).toEqual({ status: "ignored" });
    expect(parseWorkflowRunLifecycleEvent("custom.workflow-event", validPayload())).toEqual({ status: "ignored" });
    expect(parseWorkflowRunLifecycleEvent(
      `${WORKFLOW_INTERNAL_RUN_LIFECYCLE_PREFIX}completed`,
      validPayload(),
    )).toEqual({ status: "invalid", reason: "unknown lifecycle event type" });
  });
});
