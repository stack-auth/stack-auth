import { describe, expect, it } from "vitest";
import {
  buildIssueAlertRule,
  DEFAULT_ALERT_RULE_DRAFT,
  getSupportedAlertRuleDraft,
  issueAlertTriggerLabel,
} from "./alert-rule-form";
import type { IssueAlertRuleResponse } from "./issue-alerts-data";

function sampleRule(overrides: Partial<IssueAlertRuleResponse> = {}): IssueAlertRuleResponse {
  return {
    schemaVersion: 1,
    id: "issue-alert",
    version: 2,
    enabled: true,
    conditions: { any: [{ type: "new", value: true }] },
    cooldown: { durationSeconds: 3600, keyBy: "issue" },
    action: {
      type: "email",
      userIds: ["user-1"],
      subject: "Issue alert",
      html: "<p>Issue alert</p>",
    },
    database_id: "rule-database-id",
    ...overrides,
  };
}

describe("getSupportedAlertRuleDraft", () => {
  it("round-trips the supported trigger shapes", () => {
    const draft = getSupportedAlertRuleDraft(sampleRule({
      conditions: {
        all: [{ type: "frequency", operator: "gte", count: 12, windowSeconds: 600 }],
      },
    }));

    expect(draft).toMatchObject({
      trigger: "frequency",
      frequencyCount: "12",
      frequencyWindowSeconds: "600",
      userIds: ["user-1"],
    });
  });

  it("keeps configured filters and advanced predicates read-only", () => {
    expect(getSupportedAlertRuleDraft(sampleRule({
      filters: { environments: ["production"] },
    }))).toBeNull();
    expect(getSupportedAlertRuleDraft(sampleRule({
      conditions: { all: [{ type: "attribute", path: "issue.value", operator: "contains", value: "timeout" }] },
    }))).toBeNull();
  });
});

describe("buildIssueAlertRule", () => {
  it("builds a new backend-compatible rule", () => {
    const result = buildIssueAlertRule({
      ...DEFAULT_ALERT_RULE_DRAFT,
      id: "production-frequency",
      trigger: "frequency",
      frequencyCount: "20",
      frequencyWindowSeconds: "900",
      userIds: ["user-1", "user-2"],
    }, null);

    expect(result).toEqual({
      status: "ok",
      rule: expect.objectContaining({
        schemaVersion: 1,
        id: "production-frequency",
        version: 1,
        enabled: true,
        conditions: { all: [{ type: "frequency", operator: "gte", count: 20, windowSeconds: 900 }] },
        action: expect.objectContaining({ userIds: ["user-1", "user-2"] }),
      }),
    });
  });

  it("increments the version for updates without changing the rule key", () => {
    const existingRule = sampleRule();
    const draft = getSupportedAlertRuleDraft(existingRule);
    if (draft == null) throw new Error("Expected the sample rule to be editable");

    const result = buildIssueAlertRule({ ...draft, subject: "Updated issue alert" }, existingRule);

    expect(result).toEqual({
      status: "ok",
      rule: expect.objectContaining({
        id: existingRule.id,
        version: existingRule.version + 1,
        action: expect.objectContaining({ subject: "Updated issue alert" }),
      }),
    });
  });

  it("round-trips a provider-safe webhook reference without email recipients", () => {
    const webhookRule = sampleRule({
      action: { type: "webhook", integrationId: "integration-prod-errors" },
    });
    const draft = getSupportedAlertRuleDraft(webhookRule);
    expect(draft).toMatchObject({ destination: "webhook", webhookIntegrationId: "integration-prod-errors", userIds: [] });
    if (draft == null) throw new Error("Expected the webhook rule to be editable");

    const result = buildIssueAlertRule({ ...draft, webhookIntegrationId: "integration-prod-errors" }, webhookRule);
    expect(result).toEqual(expect.objectContaining({ status: "ok" }));
    if (result.status === "ok") expect(result.rule.action).toEqual({ type: "webhook", integrationId: "integration-prod-errors" });
  });

  it("rejects URLs and empty webhook references", () => {
    expect(buildIssueAlertRule({ ...DEFAULT_ALERT_RULE_DRAFT, destination: "webhook", webhookIntegrationId: "https://example.test/hook" }, null)).toEqual({
      status: "error",
      message: "Webhook integration reference must be an opaque identifier, not a URL or credential.",
    });
    expect(buildIssueAlertRule({ ...DEFAULT_ALERT_RULE_DRAFT, destination: "webhook", webhookIntegrationId: "" }, null)).toEqual({
      status: "error",
      message: "Webhook integration reference is required",
    });
  });

  it("rejects unsafe or incomplete editor input", () => {
    expect(buildIssueAlertRule({
      ...DEFAULT_ALERT_RULE_DRAFT,
      userIds: [],
    }, null)).toEqual({
      status: "error",
      message: "Choose at least one project user to receive the email.",
    });
    expect(buildIssueAlertRule({
      ...DEFAULT_ALERT_RULE_DRAFT,
      userIds: ["user-1"],
      subject: "Bad\nsubject",
    }, null)).toEqual({
      status: "error",
      message: "Subject contains unsupported control characters",
    });
  });
});

describe("issueAlertTriggerLabel", () => {
  it("labels frequency and combined issue triggers", () => {
    expect(issueAlertTriggerLabel(sampleRule({
      conditions: { all: [{ type: "frequency", operator: "gte", count: 4, windowSeconds: 60 }] },
    }))).toBe("gte 4 events / 1m");
    expect(issueAlertTriggerLabel(sampleRule({
      conditions: {
        any: [
          { type: "new", value: true },
          { type: "regression", value: true },
        ],
      },
    }))).toBe("New or regressed issues");
  });
});
