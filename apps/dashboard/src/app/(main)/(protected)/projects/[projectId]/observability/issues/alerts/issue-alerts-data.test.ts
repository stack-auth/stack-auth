import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchIssueAlertDeliveries,
  fetchIssueAlertRules,
  type IssueAlertDelivery,
  replayIssueAlertDelivery,
  saveIssueAlertRule,
  type IssueAlertRulePayload,
  type IssueAlertRuleResponse,
} from "./issue-alerts-data";

const { sendInternalAdminRequestMock } = vi.hoisted(() => ({
  sendInternalAdminRequestMock: vi.fn(),
}));

vi.mock("@/lib/hexclave-app-internals", () => ({
  sendInternalAdminRequest: sendInternalAdminRequestMock,
}));

const adminApp = { projectId: "project-1" };

const rule: IssueAlertRuleResponse = {
  schemaVersion: 1,
  id: "issue-alert",
  version: 3,
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
};

const delivery: IssueAlertDelivery = {
  id: "delivery-id",
  rule_id: "rule-database-id",
  issue_id: "issue-id",
  canonical_issue_id: "issue-id",
  redirected: false,
  redirected_from_issue_id: null,
  occurrence_id: "occurrence-id",
  rule_version: 3,
  event_kind: "new",
  deduplication_key: "deduplication-key",
  cooldown_key: "cooldown-key",
  cooldown_duration_seconds: 3600,
  cooldown_expires_at_millis: null,
  state: "delivered",
  outcome: "workflow_delivered",
  workflow_event_id: "workflow-event-id",
  attempt_count: 1,
  replay_count: 0,
  last_attempt_at_millis: 1_700_000_000_000,
  next_retry_at_millis: null,
  last_error: null,
  claimed_at_millis: 1_700_000_000_000,
  enqueued_at_millis: 1_700_000_000_100,
  completed_at_millis: 1_700_000_000_200,
  created_at_millis: 1_700_000_000_000,
  updated_at_millis: 1_700_000_000_200,
};

beforeEach(() => {
  sendInternalAdminRequestMock.mockReset();
});

describe("fetchIssueAlertRules", () => {
  it("uses the authenticated issue-alert route and validates its rule envelope", async () => {
    sendInternalAdminRequestMock.mockResolvedValue(new Response(JSON.stringify({
      rules: [rule],
      truncated: false,
    }), { status: 200 }));

    await expect(fetchIssueAlertRules(adminApp)).resolves.toEqual({ rules: [rule], truncated: false });
    expect(sendInternalAdminRequestMock).toHaveBeenCalledWith(adminApp, "/issues/alerts", { method: "GET" });
  });

  it("does not expose an upstream error body to the dashboard", async () => {
    sendInternalAdminRequestMock.mockResolvedValue(new Response("internal database details", { status: 502 }));

    await expect(fetchIssueAlertRules(adminApp)).rejects.toThrow("Loading issue alert rules failed with status 502");
  });
});

describe("fetchIssueAlertDeliveries", () => {
  it("requests a bounded recent page and validates delivery status", async () => {
    sendInternalAdminRequestMock.mockResolvedValue(new Response(JSON.stringify({
      deliveries: [delivery],
      truncated: true,
    }), { status: 200 }));

    await expect(fetchIssueAlertDeliveries(adminApp)).resolves.toEqual({
      deliveries: [delivery],
      truncated: true,
    });
    expect(sendInternalAdminRequestMock).toHaveBeenCalledWith(
      adminApp,
      "/issues/alerts/deliveries?limit=20",
      { method: "GET" },
    );
  });

  it("rejects an unsafe delivery page size instead of widening the query", async () => {
    await expect(fetchIssueAlertDeliveries(adminApp, 101)).rejects.toThrow("delivery limit");
    expect(sendInternalAdminRequestMock).not.toHaveBeenCalled();
  });
});

describe("replayIssueAlertDelivery", () => {
  it("posts replay for a delivery id", async () => {
    sendInternalAdminRequestMock.mockResolvedValue(new Response(JSON.stringify({ replayed: true }), { status: 200 }));
    await expect(replayIssueAlertDelivery(adminApp, delivery.id)).resolves.toEqual({ replayed: true });
    expect(sendInternalAdminRequestMock).toHaveBeenCalledWith(
      adminApp,
      `/issues/alerts/deliveries/${delivery.id}/replay`,
      { method: "POST" },
    );
  });
});

describe("saveIssueAlertRule", () => {
  it("posts the complete versioned rule through the authenticated route", async () => {
    const payload: IssueAlertRulePayload = {
      schemaVersion: rule.schemaVersion,
      id: rule.id,
      version: 4,
      enabled: false,
      conditions: rule.conditions,
      cooldown: rule.cooldown,
      action: rule.action,
    };
    const savedRule: IssueAlertRuleResponse = { ...payload, database_id: rule.database_id };
    sendInternalAdminRequestMock.mockResolvedValue(new Response(JSON.stringify({ rule: savedRule }), { status: 200 }));

    await expect(saveIssueAlertRule(adminApp, payload)).resolves.toEqual(savedRule);
    expect(sendInternalAdminRequestMock).toHaveBeenCalledWith(adminApp, "/issues/alerts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rule: payload }),
    });
  });
});
