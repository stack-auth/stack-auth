import { describe, expect, it, vi } from "vitest";
import { evaluateAutomationRuleDryRunForRoute } from "@/lib/automations/dry-run-route";
import { createPrismaAutomationRuleExecutionStateReader } from "@/lib/automations/execution-state-store";
import {
  automationRouteTestRuleId as ruleId,
  createAutomationRouteTestActionAdapter,
  createAutomationRouteTestSourceAdapter,
  createAutomationRouteTestTenancy,
} from "../test-helpers";

const now = new Date("2026-07-01T00:00:00.000Z");

function createFakePrisma(options: {
  lastActionAt?: Date | null,
  lastTriggeredAt?: Date,
  nextRetryAt?: Date | null,
} = {}) {
  return {
    automationRuleExecutionState: {
      findUnique: vi.fn(async () => options.lastActionAt === undefined ? null : {
        lastTriggeredAt: options.lastTriggeredAt ?? new Date("2026-06-30T00:00:00.000Z"),
        lastActionAt: options.lastActionAt,
        nextRetryAt: options.nextRetryAt ?? null,
      }),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    emailOutbox: {
      createMany: vi.fn(),
    },
  };
}

describe("automation dry-run route helpers", () => {
  it("returns 404 for missing rules before evaluating or writing state", async () => {
    const fakePrisma = createFakePrisma();
    const sourceAdapter = createAutomationRouteTestSourceAdapter();
    const actionAdapter = createAutomationRouteTestActionAdapter();

    const resultPromise = evaluateAutomationRuleDryRunForRoute({
      tenancy: createAutomationRouteTestTenancy({ ruleExists: false }),
      ruleId,
      prisma: fakePrisma,
      sourceAdapter,
      actionAdapter,
      recipientStatusReader: async () => new Map(),
      executionStateReader: createPrismaAutomationRuleExecutionStateReader(fakePrisma),
      now,
    });
    await expect(resultPromise).rejects.toMatchObject({ statusCode: 404 });
    await expect(resultPromise).rejects.toThrowErrorMatchingInlineSnapshot(`[StatusError: Automation rule "low-api-credits" was not found for tenancy "tenancy-1".]`);

    expect(sourceAdapter.evaluate).not.toHaveBeenCalled();
    expect(actionAdapter.buildPlan).not.toHaveBeenCalled();
    expect(fakePrisma.automationRuleExecutionState.findUnique).not.toHaveBeenCalled();
    expect(fakePrisma.automationRuleExecutionState.create).not.toHaveBeenCalled();
    expect(fakePrisma.automationRuleExecutionState.update).not.toHaveBeenCalled();
    expect(fakePrisma.automationRuleExecutionState.updateMany).not.toHaveBeenCalled();
    expect(fakePrisma.emailOutbox.createMany).not.toHaveBeenCalled();
  });

  it("allows disabled rules to be previewed without writing automation state or email outbox rows", async () => {
    const fakePrisma = createFakePrisma();
    const sourceAdapter = createAutomationRouteTestSourceAdapter();
    const actionAdapter = createAutomationRouteTestActionAdapter();

    await expect(evaluateAutomationRuleDryRunForRoute({
      tenancy: createAutomationRouteTestTenancy({ enabled: false }),
      ruleId,
      prisma: fakePrisma,
      sourceAdapter,
      actionAdapter,
      recipientStatusReader: async () => new Map([["user-1", {
        userExists: true,
        hasPrimaryEmail: true,
      }]]),
      executionStateReader: createPrismaAutomationRuleExecutionStateReader(fakePrisma),
      now,
    })).resolves.toMatchObject({
      rule_id: ruleId,
      mode: "dry-run",
      eligible_count: 1,
      suppressed_count: 0,
      decisions: [{
        recipient: {
          user_exists: true,
          has_primary_email: true,
        },
        cooldown: {
          blocked: false,
        },
      }],
    });

    expect(sourceAdapter.evaluate).toHaveBeenCalledOnce();
    expect(actionAdapter.buildPlan).toHaveBeenCalledOnce();
    expect(fakePrisma.automationRuleExecutionState.create).not.toHaveBeenCalled();
    expect(fakePrisma.automationRuleExecutionState.update).not.toHaveBeenCalled();
    expect(fakePrisma.automationRuleExecutionState.updateMany).not.toHaveBeenCalled();
    expect(fakePrisma.emailOutbox.createMany).not.toHaveBeenCalled();
  });

  it("returns the dry-run API response without writing automation state or email outbox rows", async () => {
    const fakePrisma = createFakePrisma();
    const sourceAdapter = createAutomationRouteTestSourceAdapter();
    const actionAdapter = createAutomationRouteTestActionAdapter();
    const recipientStatusReader = vi.fn(async () => new Map([["user-1", {
      userExists: true,
      hasPrimaryEmail: true,
    }]]));

    await expect(evaluateAutomationRuleDryRunForRoute({
      tenancy: createAutomationRouteTestTenancy(),
      ruleId,
      limit: 25,
      cursor: "cursor-1",
      prisma: fakePrisma,
      sourceAdapter,
      actionAdapter,
      recipientStatusReader,
      executionStateReader: createPrismaAutomationRuleExecutionStateReader(fakePrisma),
      now,
    })).resolves.toMatchInlineSnapshot(`
      {
        "decisions": [
          {
            "action": {
              "notification_category_name": "Marketing",
              "template_id": "8c6f6960-7a87-4ebd-b2a6-bfd06d68e2d1",
              "type": "send-email",
            },
            "cooldown": {
              "blocked": false,
            },
            "recipient": {
              "has_primary_email": true,
              "user_exists": true,
            },
            "source": {
              "active_subscription_ids": [
                "sub_1",
              ],
              "current_quantity": 7,
              "entitlement_quantity": 100,
              "item_id": "api_credits",
              "owned_product_ids": [
                "pro",
              ],
              "threshold_kind": "near",
              "type": "payments-item-quota",
            },
            "subject_id": "user-1",
            "subject_type": "user",
          },
        ],
        "eligible_count": 1,
        "evaluated_count": 2,
        "mode": "dry-run",
        "next_cursor": "cursor-2",
        "rule_id": "low-api-credits",
        "suppressed_count": 0,
      }
    `);

    expect(sourceAdapter.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      limit: 25,
      cursor: "cursor-1",
    }));
    expect(recipientStatusReader).toHaveBeenCalledWith({
      prisma: fakePrisma,
      tenancyId: "tenancy-1",
      userIds: ["user-1"],
    });
    expect(fakePrisma.automationRuleExecutionState.upsert).not.toHaveBeenCalled();
    expect(fakePrisma.automationRuleExecutionState.create).not.toHaveBeenCalled();
    expect(fakePrisma.automationRuleExecutionState.update).not.toHaveBeenCalled();
    expect(fakePrisma.automationRuleExecutionState.updateMany).not.toHaveBeenCalled();
    expect(fakePrisma.emailOutbox.createMany).not.toHaveBeenCalled();
  });

  it("reports active cooldown state without writing automation state", async () => {
    const lastActionAt = new Date("2026-06-30T00:00:00.000Z");
    const fakePrisma = createFakePrisma({ lastActionAt });

    await expect(evaluateAutomationRuleDryRunForRoute({
      tenancy: createAutomationRouteTestTenancy(),
      ruleId,
      prisma: fakePrisma,
      sourceAdapter: createAutomationRouteTestSourceAdapter(),
      actionAdapter: createAutomationRouteTestActionAdapter(),
      recipientStatusReader: async () => new Map(),
      executionStateReader: createPrismaAutomationRuleExecutionStateReader(fakePrisma),
      now,
    })).resolves.toMatchObject({
      eligible_count: 0,
      suppressed_count: 1,
      decisions: [{
        cooldown: {
          blocked: true,
          last_action_at_millis: lastActionAt.getTime(),
          next_eligible_at_millis: new Date("2026-07-07T00:00:00.000Z").getTime(),
        },
      }],
    });

    expect(fakePrisma.automationRuleExecutionState.findUnique).toHaveBeenCalledOnce();
    expect(fakePrisma.automationRuleExecutionState.create).not.toHaveBeenCalled();
    expect(fakePrisma.automationRuleExecutionState.update).not.toHaveBeenCalled();
    expect(fakePrisma.automationRuleExecutionState.updateMany).not.toHaveBeenCalled();
    expect(fakePrisma.emailOutbox.createMany).not.toHaveBeenCalled();
  });

  it("reports expired cooldown state as not blocked", async () => {
    const fakePrisma = createFakePrisma({
      lastActionAt: new Date("2026-06-20T00:00:00.000Z"),
    });

    await expect(evaluateAutomationRuleDryRunForRoute({
      tenancy: createAutomationRouteTestTenancy(),
      ruleId,
      prisma: fakePrisma,
      sourceAdapter: createAutomationRouteTestSourceAdapter(),
      actionAdapter: createAutomationRouteTestActionAdapter(),
      recipientStatusReader: async () => new Map(),
      executionStateReader: createPrismaAutomationRuleExecutionStateReader(fakePrisma),
      now,
    })).resolves.toMatchObject({
      eligible_count: 1,
      suppressed_count: 0,
      decisions: [{
        cooldown: {
          blocked: false,
        },
      }],
    });

    expect(fakePrisma.automationRuleExecutionState.create).not.toHaveBeenCalled();
    expect(fakePrisma.automationRuleExecutionState.update).not.toHaveBeenCalled();
    expect(fakePrisma.automationRuleExecutionState.updateMany).not.toHaveBeenCalled();
    expect(fakePrisma.emailOutbox.createMany).not.toHaveBeenCalled();
  });

  it("reports deferred retry backoff without writing automation state or email outbox rows", async () => {
    const nextRetryAt = new Date("2026-07-01T00:15:00.000Z");
    const fakePrisma = createFakePrisma({
      lastActionAt: null,
      lastTriggeredAt: now,
      nextRetryAt,
    });

    await expect(evaluateAutomationRuleDryRunForRoute({
      tenancy: createAutomationRouteTestTenancy(),
      ruleId,
      prisma: fakePrisma,
      sourceAdapter: createAutomationRouteTestSourceAdapter(),
      actionAdapter: createAutomationRouteTestActionAdapter(),
      recipientStatusReader: async () => new Map(),
      executionStateReader: createPrismaAutomationRuleExecutionStateReader(fakePrisma),
      now,
    })).resolves.toMatchObject({
      eligible_count: 0,
      suppressed_count: 1,
      decisions: [{
        cooldown: {
          blocked: true,
          next_eligible_at_millis: nextRetryAt.getTime(),
        },
        skip_reason: "retry-backoff",
      }],
    });

    expect(fakePrisma.automationRuleExecutionState.updateMany).not.toHaveBeenCalled();
    expect(fakePrisma.emailOutbox.createMany).not.toHaveBeenCalled();
  });

  it("reports a due deferred decision as eligible without writing state", async () => {
    const fakePrisma = createFakePrisma({
      lastActionAt: null,
      lastTriggeredAt: new Date("2026-06-30T23:45:00.000Z"),
      nextRetryAt: now,
    });

    await expect(evaluateAutomationRuleDryRunForRoute({
      tenancy: createAutomationRouteTestTenancy(),
      ruleId,
      prisma: fakePrisma,
      sourceAdapter: createAutomationRouteTestSourceAdapter(),
      actionAdapter: createAutomationRouteTestActionAdapter(),
      recipientStatusReader: async () => new Map(),
      executionStateReader: createPrismaAutomationRuleExecutionStateReader(fakePrisma),
      now,
    })).resolves.toMatchObject({
      eligible_count: 1,
      suppressed_count: 0,
      decisions: [{ cooldown: { blocked: false } }],
    });

    expect(fakePrisma.automationRuleExecutionState.updateMany).not.toHaveBeenCalled();
    expect(fakePrisma.emailOutbox.createMany).not.toHaveBeenCalled();
  });

  it("marks missing recipient records as not currently emailable", async () => {
    const fakePrisma = createFakePrisma();

    await expect(evaluateAutomationRuleDryRunForRoute({
      tenancy: createAutomationRouteTestTenancy(),
      ruleId,
      prisma: fakePrisma,
      sourceAdapter: createAutomationRouteTestSourceAdapter(),
      actionAdapter: createAutomationRouteTestActionAdapter(),
      recipientStatusReader: async () => new Map(),
      executionStateReader: createPrismaAutomationRuleExecutionStateReader(fakePrisma),
      now,
    })).resolves.toMatchObject({
      decisions: [{
        recipient: {
          user_exists: false,
          has_primary_email: false,
        },
      }],
    });
  });
});
