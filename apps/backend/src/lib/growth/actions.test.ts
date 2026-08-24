import { describe, expect, test } from "vitest";
import {
  getGrowthActionActivationEventType,
  growthActionItemToWire,
  growthManifestTriggersIncludeActivationEvent,
  growthWorkflowTriggerSetsEqual,
  parseStoredGrowthWorkflowManifestTriggers,
} from "./actions";

const baseItem = {
  id: "9b2e7c1a-0000-4000-8000-000000000001",
  typeId: "custom",
  category: "activation",
  tags: ["onboarding"],
  title: "Send a welcome email",
  description: "desc",
  status: "proposed",
  payload: null,
  watchedMetrics: [{ metricId: "new_signups", windowDays: 14 }],
  reportId: null,
  briefId: null,
  workflowId: null,
  workflowSource: null,
  workflowManifest: null,
  workflowExplanation: null,
  workflowRollbackNote: null,
  workflowDeployedAt: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  activatedAt: null,
  completedAt: null,
};

const workflowColumns = {
  workflowId: "growth-action-welcome-email",
  workflowSource: "export default workflow(...); // calls https://api.example.com",
  workflowManifest: {
    workflow_id: "growth-action-welcome-email",
    triggers: [{ type: "event", event_type: "custom.growth.action.welcome-email" }],
    has_run_key: true,
    on_conflict: "skip",
    uses_stdlib: [],
  },
  workflowExplanation: "Sends a welcome email when activated.",
  workflowRollbackNote: "Delete the workflow.",
};

describe("parseStoredGrowthWorkflowManifestTriggers", () => {
  test("parses event and schedule triggers, normalized to the manifest trigger shape", () => {
    expect(parseStoredGrowthWorkflowManifestTriggers({
      workflow_id: "growth-task-x",
      triggers: [
        { type: "event", event_type: "user.created", extra_field: "dropped" },
        { type: "schedule", cron: "0 9 * * *", timezone: "UTC" },
      ],
    })).toEqual([
      { type: "event", event_type: "user.created" },
      { type: "schedule", cron: "0 9 * * *", timezone: "UTC" },
    ]);
  });

  test("rejects non-manifest values", () => {
    expect(() => parseStoredGrowthWorkflowManifestTriggers(null)).toThrowError(/not a manifest object/);
    expect(() => parseStoredGrowthWorkflowManifestTriggers([])).toThrowError(/not a manifest object/);
    expect(() => parseStoredGrowthWorkflowManifestTriggers({ triggers: "nope" })).toThrowError(/not a manifest object/);
  });

  test("rejects malformed triggers", () => {
    expect(() => parseStoredGrowthWorkflowManifestTriggers({ triggers: ["nope"] })).toThrowError(/unexpected shape/);
    expect(() => parseStoredGrowthWorkflowManifestTriggers({ triggers: [{ type: "event" }] })).toThrowError(/unknown type or missing fields/);
    expect(() => parseStoredGrowthWorkflowManifestTriggers({ triggers: [{ type: "webhook", url: "x" }] })).toThrowError(/unknown type or missing fields/);
  });
});

describe("getGrowthActionActivationEventType", () => {
  test("derives the wire type from the workflow id's slug", () => {
    expect(getGrowthActionActivationEventType("growth-action-welcome-email")).toBe("custom.growth.action.welcome-email");
    expect(getGrowthActionActivationEventType("growth-task-digest")).toBe("custom.growth.action.digest");
  });
});

describe("growthManifestTriggersIncludeActivationEvent", () => {
  test("matches only the item's own activation event", () => {
    const triggers = [{ type: "event" as const, event_type: "custom.growth.action.welcome-email" }];
    expect(growthManifestTriggersIncludeActivationEvent(triggers, "growth-action-welcome-email")).toBe(true);
    expect(growthManifestTriggersIncludeActivationEvent(triggers, "growth-action-other")).toBe(false);
    expect(growthManifestTriggersIncludeActivationEvent([{ type: "schedule", cron: "0 * * * *", timezone: "UTC" }], "growth-action-welcome-email")).toBe(false);
  });
});

describe("growthWorkflowTriggerSetsEqual", () => {
  test("is order-insensitive", () => {
    const a = [
      { type: "event" as const, event_type: "user.created" },
      { type: "schedule" as const, cron: "0 9 * * *", timezone: "UTC" },
    ];
    expect(growthWorkflowTriggerSetsEqual(a, [...a].reverse())).toBe(true);
  });

  test("detects differences in content and cardinality", () => {
    const a = [{ type: "event" as const, event_type: "user.created" }];
    expect(growthWorkflowTriggerSetsEqual(a, [{ type: "event", event_type: "team.created" }])).toBe(false);
    expect(growthWorkflowTriggerSetsEqual(a, [])).toBe(false);
    expect(growthWorkflowTriggerSetsEqual(a, [...a, { type: "schedule", cron: "0 * * * *", timezone: "UTC" }])).toBe(false);
  });
});

describe("growthActionItemToWire — workflow field", () => {
  test("plain items have workflow: null", () => {
    expect(growthActionItemToWire(baseItem, null).workflow).toBe(null);
  });

  test("undeployed workflow-bearing items need no runtime info and report not_deployed", () => {
    const wire = growthActionItemToWire({ ...baseItem, ...workflowColumns }, null);
    expect(wire.workflow).toEqual({
      workflow_id: "growth-action-welcome-email",
      source: workflowColumns.workflowSource,
      triggers: [{ type: "event", event_type: "custom.growth.action.welcome-email" }],
      explanation: workflowColumns.workflowExplanation,
      rollback_note: workflowColumns.workflowRollbackNote,
      status: "not_deployed",
      last_run_state: null,
      warnings: ["Source references external domain: api.example.com"],
    });
  });

  test("deployed items derive deployed/deleted from definition existence and pass last_run_state through", () => {
    const deployedItem = { ...baseItem, ...workflowColumns, status: "active", workflowDeployedAt: new Date("2026-08-02T00:00:00.000Z") };
    const deployed = growthActionItemToWire(deployedItem, { definitionExists: true, lastRunState: "completed" });
    expect(deployed.workflow?.status).toBe("deployed");
    expect(deployed.workflow?.last_run_state).toBe("completed");
    const deleted = growthActionItemToWire(deployedItem, { definitionExists: false, lastRunState: null });
    expect(deleted.workflow?.status).toBe("deleted");
    expect(deleted.workflow?.last_run_state).toBe(null);
  });

  test("deployed items without runtime info fail loud", () => {
    const deployedItem = { ...baseItem, ...workflowColumns, workflowDeployedAt: new Date("2026-08-02T00:00:00.000Z") };
    expect(() => growthActionItemToWire(deployedItem, null)).toThrowError(/without runtime info/);
  });

  test("partially-populated workflow columns fail loud (all-or-nothing violated)", () => {
    expect(() => growthActionItemToWire({ ...baseItem, ...workflowColumns, workflowSource: null }, null)).toThrowError(/all-or-nothing/);
    expect(() => growthActionItemToWire({ ...baseItem, ...workflowColumns, workflowManifest: null }, null)).toThrowError(/all-or-nothing/);
    expect(() => growthActionItemToWire({ ...baseItem, ...workflowColumns, workflowExplanation: null }, null)).toThrowError(/all-or-nothing/);
    expect(() => growthActionItemToWire({ ...baseItem, ...workflowColumns, workflowRollbackNote: null }, null)).toThrowError(/all-or-nothing/);
  });
});
