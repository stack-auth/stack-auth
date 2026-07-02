import { describe, expect, it, vi } from "vitest";
import { AutomationActionAdapter, AutomationSourceAdapter } from "@/lib/automations/rule-evaluator";
import { evaluateAutomationRuleDryRunForRoute } from "@/lib/automations/dry-run-route";
import { createPrismaAutomationRuleExecutionStateReader } from "@/lib/automations/execution-state-store";

const ruleId = "low-api-credits";
const now = new Date("2026-07-01T00:00:00.000Z");

function createTenancy(options: {
  enabled?: boolean,
} = {}) {
  return {
    id: "tenancy-1",
    project: {
      display_name: "Acme App",
    },
    config: {
      automations: {
        rules: {
          [ruleId]: {
            enabled: options.enabled ?? true,
            source: {
              type: "payments-item-quota",
              itemId: "api_credits",
              customerType: "user",
              thresholds: {
                nearRemainingQuantity: 10,
              },
            },
            action: {
              type: "send-email",
              templateId: "8c6f6960-7a87-4ebd-b2a6-bfd06d68e2d1",
              notificationCategoryName: "Marketing",
            },
            cooldown: {
              days: 7,
            },
          },
        },
      },
    },
  };
}

function createSourceAdapter(): AutomationSourceAdapter {
  const evaluate: AutomationSourceAdapter["evaluate"] = async () => ({
    evaluatedCount: 2,
    nextCursor: "cursor-2",
    decisions: [{
      subject: {
        type: "user",
        id: "user-1",
      },
      signal: {
        key: "api_credits:near",
        kind: "near",
      },
      sourceSnapshot: {
        sourceType: "payments-item-quota",
        itemId: "api_credits",
        itemDisplayName: "API credits",
        currentQuantity: 7,
        entitlementQuantity: 100,
        thresholdKind: "near",
        ownedProductIds: ["pro"],
        activeSubscriptionIds: ["sub_1"],
      },
    }],
  });
  return {
    evaluate: vi.fn(evaluate),
  };
}

function createActionAdapter(): AutomationActionAdapter {
  const buildPlan: AutomationActionAdapter["buildPlan"] = async (options) => ({
    type: "send-email",
    recipient: {
      type: "user-primary-email",
      userId: options.decision.subject.id,
    },
    tsxSource: "export function EmailTemplate() { return null; }",
    templateId: options.rule.action.templateId,
    themeId: null,
    notificationCategoryName: "Marketing",
    notificationCategoryId: "4f6f8873-3d04-46bd-8bef-18338b1a1b4c",
    createdWith: {
      type: "programmatic-call",
      templateId: options.rule.action.templateId,
    },
    isHighPriority: false,
    shouldSkipDeliverabilityCheck: false,
    variables: {
      automationRuleId: options.ruleId,
    },
  });
  return {
    buildPlan: vi.fn(buildPlan),
  };
}

function createFakePrisma(options: {
  lastActionAt?: Date | null,
} = {}) {
  return {
    automationRuleExecutionState: {
      findUnique: vi.fn(async () => options.lastActionAt === undefined ? null : {
        lastActionAt: options.lastActionAt,
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
  it("allows disabled rules to be previewed without writing automation state or email outbox rows", async () => {
    const fakePrisma = createFakePrisma();
    const sourceAdapter = createSourceAdapter();
    const actionAdapter = createActionAdapter();

    await expect(evaluateAutomationRuleDryRunForRoute({
      tenancy: createTenancy({ enabled: false }),
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
    const sourceAdapter = createSourceAdapter();
    const actionAdapter = createActionAdapter();
    const recipientStatusReader = vi.fn(async () => new Map([["user-1", {
      userExists: true,
      hasPrimaryEmail: true,
    }]]));

    await expect(evaluateAutomationRuleDryRunForRoute({
      tenancy: createTenancy(),
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
      tenancy: createTenancy(),
      ruleId,
      prisma: fakePrisma,
      sourceAdapter: createSourceAdapter(),
      actionAdapter: createActionAdapter(),
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
      tenancy: createTenancy(),
      ruleId,
      prisma: fakePrisma,
      sourceAdapter: createSourceAdapter(),
      actionAdapter: createActionAdapter(),
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

  it("marks missing recipient records as not currently emailable", async () => {
    const fakePrisma = createFakePrisma();

    await expect(evaluateAutomationRuleDryRunForRoute({
      tenancy: createTenancy(),
      ruleId,
      prisma: fakePrisma,
      sourceAdapter: createSourceAdapter(),
      actionAdapter: createActionAdapter(),
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
