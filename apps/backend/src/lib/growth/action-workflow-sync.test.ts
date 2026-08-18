import { WorkflowRunState } from "@/generated/prisma/enums";
import { describe, expect, test } from "vitest";
import { classifyGrowthActionWorkflow, hasGrowthWatchWindowElapsed, resolveGrowthOneShotCompletion } from "./action-workflow-sync";

const now = new Date("2026-08-04T12:00:00.000Z");

describe("classifyGrowthActionWorkflow", () => {
  test("one-shot iff the triggers contain the item's OWN activation event", () => {
    expect(classifyGrowthActionWorkflow({
      workflowId: "growth-action-welcome-email",
      triggers: [{ type: "event", event_type: "custom.growth.action.welcome-email" }],
    })).toBe("one-shot");
  });

  test("another item's activation event does not make it one-shot", () => {
    expect(classifyGrowthActionWorkflow({
      workflowId: "growth-action-welcome-email",
      triggers: [{ type: "event", event_type: "custom.growth.action.other-item" }],
    })).toBe("recurring-or-reactive");
  });

  test("schedule and platform-event triggers classify as recurring-or-reactive", () => {
    expect(classifyGrowthActionWorkflow({
      workflowId: "growth-task-weekly-digest",
      triggers: [{ type: "schedule", cron: "0 9 * * 1", timezone: "UTC" }],
    })).toBe("recurring-or-reactive");
    expect(classifyGrowthActionWorkflow({
      workflowId: "growth-task-onboarding-nudge",
      triggers: [{ type: "event", event_type: "user.created" }],
    })).toBe("recurring-or-reactive");
  });

  test("mixed triggers with the own activation event are one-shot", () => {
    expect(classifyGrowthActionWorkflow({
      workflowId: "growth-task-digest",
      triggers: [
        { type: "schedule", cron: "0 9 * * *", timezone: "UTC" },
        { type: "event", event_type: "custom.growth.action.digest" },
      ],
    })).toBe("one-shot");
  });
});

describe("hasGrowthWatchWindowElapsed", () => {
  const activatedAt = new Date("2026-07-01T00:00:00.000Z");
  const watched = [
    { metricId: "new_signups" as const, windowDays: 7 },
    { metricId: "total_users" as const, windowDays: 14 },
  ];

  test("uses the MAX window across watched metrics", () => {
    expect(hasGrowthWatchWindowElapsed({ watched, activatedAt }, new Date("2026-07-08T00:00:00.000Z"))).toBe(false);
    expect(hasGrowthWatchWindowElapsed({ watched, activatedAt }, new Date("2026-07-14T23:59:59.999Z"))).toBe(false);
    expect(hasGrowthWatchWindowElapsed({ watched, activatedAt }, new Date("2026-07-15T00:00:00.000Z"))).toBe(true);
  });

  test("an empty watch list falls back to a 1-day window instead of completing instantly", () => {
    expect(hasGrowthWatchWindowElapsed({ watched: [], activatedAt }, new Date("2026-07-01T12:00:00.000Z"))).toBe(false);
    expect(hasGrowthWatchWindowElapsed({ watched: [], activatedAt }, new Date("2026-07-02T00:00:00.000Z"))).toBe(true);
  });
});

describe("resolveGrowthOneShotCompletion", () => {
  const completedAt = new Date("2026-08-01T00:00:00.000Z");

  test("no run yet keeps the item active (event may still be in the outbox)", () => {
    expect(resolveGrowthOneShotCompletion(null, now)).toBe(null);
  });

  test("in-flight and failed runs keep the item active", () => {
    for (const state of [WorkflowRunState.QUEUED, WorkflowRunState.RUNNING, WorkflowRunState.SLEEPING, WorkflowRunState.FAILED, WorkflowRunState.CANCELED]) {
      expect(resolveGrowthOneShotCompletion({ state, completedAt }, now)).toBe(null);
    }
  });

  test("a completed run completes the item at the run's completion time", () => {
    expect(resolveGrowthOneShotCompletion({ state: WorkflowRunState.COMPLETED, completedAt }, now)).toBe(completedAt);
  });

  test("a completed run without completedAt falls back to now", () => {
    expect(resolveGrowthOneShotCompletion({ state: WorkflowRunState.COMPLETED, completedAt: null }, now)).toBe(now);
  });
});
