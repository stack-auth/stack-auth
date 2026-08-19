import { describe, expect, it } from "vitest";
import { humanizeGrowthWorkflowTrigger, humanizeGrowthWorkflowTriggers, splitGrowthWorkflowWarnings } from "./growth-workflow-format";

describe("humanizeGrowthWorkflowTrigger", () => {
  it("describes the activation event as a one-shot", () => {
    expect(humanizeGrowthWorkflowTrigger({ type: "event", eventType: "custom.growth.action.dormant-reactivation" }))
      .toBe("once, immediately when you activate this action");
  });

  it("describes schedules mechanically with cron and timezone", () => {
    expect(humanizeGrowthWorkflowTrigger({ type: "schedule", cron: "0 9 * * 1", timezone: "UTC" }))
      .toBe("on a schedule (cron `0 9 * * 1`, UTC)");
  });

  it("distinguishes custom events from platform events", () => {
    expect(humanizeGrowthWorkflowTrigger({ type: "event", eventType: "custom.my-event" }))
      .toBe("whenever the custom event `custom.my-event` is sent");
    expect(humanizeGrowthWorkflowTrigger({ type: "event", eventType: "user.created" }))
      .toBe("whenever a `user.created` event happens in your project");
  });
});

describe("humanizeGrowthWorkflowTriggers", () => {
  it("joins multiple triggers and is honest about trigger-less workflows", () => {
    expect(humanizeGrowthWorkflowTriggers([
      { type: "event", eventType: "user.created" },
      { type: "schedule", cron: "0 6 * * *", timezone: "UTC" },
    ])).toBe("whenever a `user.created` event happens in your project, and on a schedule (cron `0 6 * * *`, UTC)");
    expect(humanizeGrowthWorkflowTriggers([])).toBe("never — this automation has no triggers");
  });
});

describe("splitGrowthWorkflowWarnings", () => {
  it("separates external-domain lines from other warnings, preserving order", () => {
    const result = splitGrowthWorkflowWarnings([
      "Source contains a literal that looks like a secret (sk_live_abcd…). Workflow source is visible in the customer dashboard — never embed secrets in it.",
      "Source references external domain: api.example.com",
      "Source references external domain: hooks.slack.com",
    ]);
    expect(result.externalDomains).toEqual(["api.example.com", "hooks.slack.com"]);
    expect(result.otherWarnings).toHaveLength(1);
    expect(result.otherWarnings[0]).toContain("looks like a secret");
  });

  it("returns empty arrays for no warnings", () => {
    expect(splitGrowthWorkflowWarnings([])).toEqual({ externalDomains: [], otherWarnings: [] });
  });
});
