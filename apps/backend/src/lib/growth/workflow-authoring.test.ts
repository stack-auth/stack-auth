import { describe, expect, it } from "vitest";
import {
  consumeGrowthWorkflowValidationRateLimit,
  getGrowthActionEventSlug,
  getGrowthWorkflowAuthoringGuide,
  getGrowthWorkflowRules,
  GROWTH_WORKFLOW_VALIDATION_RATE_LIMIT,
  GROWTH_WORKFLOW_VALIDATION_RATE_WINDOW_MS,
  scanWorkflowSourceWarnings,
} from "./workflow-authoring";

describe("getGrowthActionEventSlug", () => {
  it("strips the growth-action- prefix", () => {
    expect(getGrowthActionEventSlug("growth-action-signup-emails")).toBe("signup-emails");
  });

  it("strips the growth-task- prefix", () => {
    expect(getGrowthActionEventSlug("growth-task-weekly-digest")).toBe("weekly-digest");
  });

  it("strips the bare growth- prefix when no convention prefix matches", () => {
    expect(getGrowthActionEventSlug("growth-something")).toBe("something");
  });

  it("returns ids without a growth prefix unchanged (validation rejects them separately)", () => {
    expect(getGrowthActionEventSlug("my-workflow")).toBe("my-workflow");
  });

  it("does not strip a prefix that would leave an empty slug", () => {
    expect(getGrowthActionEventSlug("growth-")).toBe("growth-");
  });
});

describe("scanWorkflowSourceWarnings", () => {
  it("returns no warnings for a clean workflow", () => {
    const source = `
      import { workflow, customEvent, hexclaveApp } from "@hexclave/workflows";
      export default workflow("growth-action-welcome", {
        on: [customEvent("growth.action.welcome")],
        runKey: () => "activation",
        onConflict: "skip",
      }, async (event, step) => {
        await step.run("load", () => hexclaveApp.getUser("someone"));
      });
    `;
    expect(scanWorkflowSourceWarnings(source)).toEqual([]);
  });

  it("flags sk_-style secret literals without echoing them fully", () => {
    // Join at runtime so the fixture never appears as a contiguous sk_live_/sk_test_ token
    // (GitHub push protection treats those as Stripe secrets even when they are fake).
    const secretLike = ["sk", "live", "abcdefghijklmnopqrstuvwx"].join("_");
    const warnings = scanWorkflowSourceWarnings(`const key = "${secretLike}";`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("looks like a secret");
    expect(warnings[0]).not.toContain(secretLike);
  });

  it("flags high-entropy literals", () => {
    const warnings = scanWorkflowSourceWarnings(`const token = "qA7xP2mK9fVbT4wZ8rN1cJ6yH3sD5gLu";`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("looks like a secret");
  });

  it("does not flag long but low-entropy literals", () => {
    expect(scanWorkflowSourceWarnings(`const label = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";`)).toEqual([]);
  });

  it("extracts external fetch domains, deduplicated and sorted", () => {
    const warnings = scanWorkflowSourceWarnings(`
      await fetch("https://api.example.com/v1/things");
      await fetch("https://api.example.com/v1/other");
      await fetch("http://hooks.other.io/notify");
    `);
    expect(warnings).toEqual([
      "Source references external domain: api.example.com",
      "Source references external domain: hooks.other.io",
    ]);
  });

  it("reports secrets and domains together", () => {
    const secretLike = ["sk", "test", "abcdefghijklmnopqrstuvwx"].join("_");
    const warnings = scanWorkflowSourceWarnings(`
      const key = "${secretLike}";
      await fetch("https://api.example-payments.test/v1/charges");
    `);
    expect(warnings.some((warning) => warning.includes("looks like a secret"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("api.example-payments.test"))).toBe(true);
  });
});

describe("consumeGrowthWorkflowValidationRateLimit", () => {
  it("allows up to the limit within a window, then rejects", () => {
    const projectId = `rate-limit-test-${Math.random()}`;
    const now = 1_000_000;
    for (let i = 0; i < GROWTH_WORKFLOW_VALIDATION_RATE_LIMIT; i++) {
      expect(consumeGrowthWorkflowValidationRateLimit(projectId, now + i)).toBe(true);
    }
    expect(consumeGrowthWorkflowValidationRateLimit(projectId, now + GROWTH_WORKFLOW_VALIDATION_RATE_LIMIT)).toBe(false);
  });

  it("frees capacity once old calls fall out of the window", () => {
    const projectId = `rate-limit-test-${Math.random()}`;
    const now = 1_000_000;
    for (let i = 0; i < GROWTH_WORKFLOW_VALIDATION_RATE_LIMIT; i++) {
      expect(consumeGrowthWorkflowValidationRateLimit(projectId, now)).toBe(true);
    }
    expect(consumeGrowthWorkflowValidationRateLimit(projectId, now + 1)).toBe(false);
    expect(consumeGrowthWorkflowValidationRateLimit(projectId, now + GROWTH_WORKFLOW_VALIDATION_RATE_WINDOW_MS + 1)).toBe(true);
  });

  it("tracks projects independently", () => {
    const projectA = `rate-limit-test-${Math.random()}`;
    const projectB = `rate-limit-test-${Math.random()}`;
    const now = 1_000_000;
    for (let i = 0; i < GROWTH_WORKFLOW_VALIDATION_RATE_LIMIT; i++) {
      expect(consumeGrowthWorkflowValidationRateLimit(projectA, now)).toBe(true);
    }
    expect(consumeGrowthWorkflowValidationRateLimit(projectA, now)).toBe(false);
    expect(consumeGrowthWorkflowValidationRateLimit(projectB, now)).toBe(true);
  });
});

describe("getGrowthWorkflowAuthoringGuide", () => {
  it("replaces the hand-to-user deployment section with growth deployment rules", () => {
    const guide = getGrowthWorkflowAuthoringGuide();
    expect(guide).not.toContain("hand it to the user");
    expect(guide).not.toContain("New workflow");
    expect(guide).toContain("attach the workflow to an action item");
    // The rest of the skill text survives untouched.
    expect(guide).toContain("## Writing a workflow");
    expect(guide).toContain("## Triggers");
    expect(guide).toContain("NonRetriableError");
  });
});

describe("getGrowthWorkflowRules", () => {
  it("documents the naming convention and the three trigger recipes", () => {
    const rules = getGrowthWorkflowRules();
    expect(rules).toContain("growth-action-<slug>");
    expect(rules).toContain("growth-task-<slug>");
    expect(rules).toContain('customEvent("growth.action.<slug>")');
    expect(rules).toContain("action_item_id");
    expect(rules).toContain("schedule(");
    expect(rules).toContain("NEVER place secrets");
  });
});
