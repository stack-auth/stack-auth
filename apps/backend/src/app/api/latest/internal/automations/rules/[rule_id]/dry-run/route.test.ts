import { describe, expect, it, vi } from "vitest";
import { evaluateAutomationRuleDryRunForRoute } from "@/lib/automations/dry-run-route";
import {
  automationExecutionStateReadBatchLimit,
  createPrismaAutomationRuleExecutionStateReader,
  type AutomationRuleExecutionStateDecisionKey,
} from "@/lib/automations/execution-state-store";
import { AutomationSourceAdapter } from "@/lib/automations/rule-evaluator";
import {
  automationRouteTestRuleId as ruleId,
  createAutomationRouteTestActionAdapter,
  createAutomationRouteTestSourceAdapter,
  createAutomationRouteTestSourceDecision,
  createAutomationRouteTestTenancy,
} from "../test-helpers";

const now = new Date("2026-07-01T00:00:00.000Z");

type FakeExecutionStateRow = {
  tenancyId: string,
  ruleId: string,
  subjectType: "user",
  subjectId: string,
  signalKey: string,
  lastTriggeredAt: Date,
  lastActionAt: Date | null,
  nextRetryAt: Date | null,
};

function createFakePrisma(options: {
  lastActionAt?: Date | null,
  lastTriggeredAt?: Date,
  nextRetryAt?: Date | null,
  rows?: FakeExecutionStateRow[],
} = {}) {
  const rows: FakeExecutionStateRow[] = options.rows ?? (options.lastActionAt === undefined ? [] : [{
    tenancyId: "tenancy-1",
    ruleId,
    subjectType: "user",
    subjectId: "user-1",
    signalKey: "api_credits:near",
    lastTriggeredAt: options.lastTriggeredAt ?? new Date("2026-06-30T00:00:00.000Z"),
    lastActionAt: options.lastActionAt,
    nextRetryAt: options.nextRetryAt ?? null,
  }]);
  return {
    automationRuleExecutionState: {
      findMany: vi.fn(async (query: {
        where: {
          tenancyId: string,
          ruleId: string,
          OR: Array<{ subjectType: "user", subjectId: string, signalKey: string }>,
        },
      }) => rows.filter((row) => row.tenancyId === query.where.tenancyId
        && row.ruleId === query.where.ruleId
        && query.where.OR.some((key) => key.subjectId === row.subjectId
          && key.signalKey === row.signalKey))
        .map(({ subjectType, subjectId, signalKey, lastTriggeredAt, lastActionAt, nextRetryAt }) => ({
          subjectType,
          subjectId,
          signalKey,
          lastTriggeredAt,
          lastActionAt,
          nextRetryAt,
        }))),
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

function createSourceAdapter(decisions: ReturnType<typeof createAutomationRouteTestSourceDecision>[]): AutomationSourceAdapter {
  return {
    evaluate: vi.fn(async () => ({
      evaluatedCount: decisions.length,
      nextCursor: null,
      decisions,
    })),
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
    expect(fakePrisma.automationRuleExecutionState.findMany).not.toHaveBeenCalled();
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

    expect(fakePrisma.automationRuleExecutionState.findMany).toHaveBeenCalledOnce();
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

  it("classifies mixed execution states in one bounded query at exact time boundaries", async () => {
    const decisions = ["absent", "cooldown", "active", "stale", "deferred", "due"].map((userId) => (
      createAutomationRouteTestSourceDecision({ userId })
    ));
    const fakePrisma = createFakePrisma({
      rows: [
        {
          tenancyId: "tenancy-1",
          ruleId,
          subjectType: "user",
          subjectId: "cooldown",
          signalKey: "api_credits:near",
          lastTriggeredAt: new Date("2026-06-24T00:00:00.000Z"),
          lastActionAt: new Date("2026-06-24T00:00:00.000Z"),
          nextRetryAt: null,
        },
        {
          tenancyId: "tenancy-1",
          ruleId,
          subjectType: "user",
          subjectId: "active",
          signalKey: "api_credits:near",
          lastTriggeredAt: new Date("2026-06-30T23:45:00.000Z"),
          lastActionAt: null,
          nextRetryAt: null,
        },
        {
          tenancyId: "tenancy-1",
          ruleId,
          subjectType: "user",
          subjectId: "stale",
          signalKey: "api_credits:near",
          lastTriggeredAt: new Date("2026-06-30T23:44:59.999Z"),
          lastActionAt: null,
          nextRetryAt: null,
        },
        {
          tenancyId: "tenancy-1",
          ruleId,
          subjectType: "user",
          subjectId: "deferred",
          signalKey: "api_credits:near",
          lastTriggeredAt: new Date("2026-06-30T23:45:00.000Z"),
          lastActionAt: null,
          nextRetryAt: new Date("2026-07-01T00:05:00.000Z"),
        },
        {
          tenancyId: "tenancy-1",
          ruleId,
          subjectType: "user",
          subjectId: "due",
          signalKey: "api_credits:near",
          lastTriggeredAt: new Date("2026-06-30T23:45:00.000Z"),
          lastActionAt: null,
          nextRetryAt: now,
        },
      ],
    });

    const result = await evaluateAutomationRuleDryRunForRoute({
      tenancy: createAutomationRouteTestTenancy(),
      ruleId,
      prisma: fakePrisma,
      sourceAdapter: createSourceAdapter(decisions),
      actionAdapter: createAutomationRouteTestActionAdapter(),
      recipientStatusReader: async () => new Map(),
      executionStateReader: createPrismaAutomationRuleExecutionStateReader(fakePrisma),
      now,
    });

    expect(result).toMatchObject({
      evaluated_count: 6,
      eligible_count: 3,
      suppressed_count: 3,
    });
    const decisionByUserId = new Map(result.decisions.map((decision) => [decision.subject_id, decision]));
    expect(decisionByUserId.get("absent")).toMatchObject({ cooldown: { blocked: false } });
    expect(decisionByUserId.get("cooldown")).toMatchObject({
      cooldown: {
        blocked: true,
        next_eligible_at_millis: now.getTime(),
      },
      skip_reason: "cooldown",
    });
    expect(decisionByUserId.get("active")).toMatchObject({
      cooldown: {
        blocked: true,
        next_eligible_at_millis: now.getTime(),
      },
      skip_reason: "in-flight",
    });
    expect(decisionByUserId.get("stale")).toMatchObject({ cooldown: { blocked: false } });
    expect(decisionByUserId.get("deferred")).toMatchObject({
      cooldown: {
        blocked: true,
        next_eligible_at_millis: new Date("2026-07-01T00:05:00.000Z").getTime(),
      },
      skip_reason: "retry-backoff",
    });
    expect(decisionByUserId.get("due")).toMatchObject({ cooldown: { blocked: false } });
    expect(fakePrisma.automationRuleExecutionState.findMany).toHaveBeenCalledOnce();
    expect(fakePrisma.automationRuleExecutionState.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenancyId: "tenancy-1",
        ruleId,
        OR: expect.arrayContaining([
          { subjectType: "user", subjectId: "absent", signalKey: "api_credits:near" },
          { subjectType: "user", subjectId: "due", signalKey: "api_credits:near" },
        ]),
      }),
    }));
    expect(fakePrisma.automationRuleExecutionState.create).not.toHaveBeenCalled();
    expect(fakePrisma.automationRuleExecutionState.updateMany).not.toHaveBeenCalled();
    expect(fakePrisma.emailOutbox.createMany).not.toHaveBeenCalled();
  });

  it("deduplicates state query keys while preserving duplicate dry-run decisions", async () => {
    const decision = createAutomationRouteTestSourceDecision({ userId: "duplicate-user" });
    const fakePrisma = createFakePrisma({
      rows: [{
        tenancyId: "tenancy-1",
        ruleId,
        subjectType: "user",
        subjectId: "duplicate-user",
        signalKey: "api_credits:near",
        lastTriggeredAt: now,
        lastActionAt: null,
        nextRetryAt: new Date("2026-07-01T00:15:00.000Z"),
      }],
    });

    const result = await evaluateAutomationRuleDryRunForRoute({
      tenancy: createAutomationRouteTestTenancy(),
      ruleId,
      prisma: fakePrisma,
      sourceAdapter: createSourceAdapter([decision, decision]),
      actionAdapter: createAutomationRouteTestActionAdapter(),
      recipientStatusReader: async () => new Map(),
      executionStateReader: createPrismaAutomationRuleExecutionStateReader(fakePrisma),
      now,
    });

    expect(result).toMatchObject({
      evaluated_count: 2,
      eligible_count: 0,
      suppressed_count: 2,
      decisions: [
        { subject_id: "duplicate-user", skip_reason: "retry-backoff" },
        { subject_id: "duplicate-user", skip_reason: "retry-backoff" },
      ],
    });
    const query = fakePrisma.automationRuleExecutionState.findMany.mock.calls[0][0];
    expect(query.where.OR).toEqual([{
      subjectType: "user",
      subjectId: "duplicate-user",
      signalKey: "api_credits:near",
    }]);
  });

  it("keeps batch reads scoped to the requested rule", async () => {
    const fakePrisma = createFakePrisma({
      rows: [{
        tenancyId: "tenancy-1",
        ruleId: "another-rule",
        subjectType: "user",
        subjectId: "user-1",
        signalKey: "api_credits:near",
        lastTriggeredAt: now,
        lastActionAt: now,
        nextRetryAt: null,
      }],
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
    });
    expect(fakePrisma.automationRuleExecutionState.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ruleId }),
    }));
  });

  it("uses one query for a full batch and rejects an oversized batch before reading", async () => {
    const fakePrisma = createFakePrisma();
    const reader = createPrismaAutomationRuleExecutionStateReader(fakePrisma);
    const keys: AutomationRuleExecutionStateDecisionKey[] = Array.from({ length: automationExecutionStateReadBatchLimit }, (_, index) => ({
      subjectType: "user",
      subjectId: `user-${index}`,
      signalKey: "api_credits:near",
    }));

    await expect(reader.getExecutionStatuses({
      tenancyId: "tenancy-1",
      ruleId,
      keys,
      cooldownDays: 7,
      now,
    })).resolves.toHaveProperty("size", automationExecutionStateReadBatchLimit);
    expect(fakePrisma.automationRuleExecutionState.findMany).toHaveBeenCalledOnce();
    const query = fakePrisma.automationRuleExecutionState.findMany.mock.calls[0][0];
    expect(query.where.OR).toHaveLength(automationExecutionStateReadBatchLimit);

    fakePrisma.automationRuleExecutionState.findMany.mockClear();
    await expect(reader.getExecutionStatuses({
      tenancyId: "tenancy-1",
      ruleId,
      keys: [...keys, {
        subjectType: "user",
        subjectId: "one-too-many",
        signalKey: "api_credits:near",
      }],
      cooldownDays: 7,
      now,
    })).rejects.toThrow(`Automation execution state batch exceeds the maximum of ${automationExecutionStateReadBatchLimit} unique decisions.`);
    expect(fakePrisma.automationRuleExecutionState.findMany).not.toHaveBeenCalled();
  });

  it("performs no state query for an empty decision page", async () => {
    const fakePrisma = createFakePrisma();

    await expect(evaluateAutomationRuleDryRunForRoute({
      tenancy: createAutomationRouteTestTenancy(),
      ruleId,
      prisma: fakePrisma,
      sourceAdapter: createSourceAdapter([]),
      actionAdapter: createAutomationRouteTestActionAdapter(),
      recipientStatusReader: async () => new Map(),
      executionStateReader: createPrismaAutomationRuleExecutionStateReader(fakePrisma),
      now,
    })).resolves.toMatchObject({
      evaluated_count: 0,
      eligible_count: 0,
      suppressed_count: 0,
      decisions: [],
    });
    expect(fakePrisma.automationRuleExecutionState.findMany).not.toHaveBeenCalled();
  });

  it("fails loudly when a batch read fails or cannot classify every requested decision", async () => {
    const fakePrisma = createFakePrisma();
    fakePrisma.automationRuleExecutionState.findMany.mockRejectedValueOnce(new Error("execution state database unavailable"));
    const baseOptions = {
      tenancy: createAutomationRouteTestTenancy(),
      ruleId,
      prisma: fakePrisma,
      sourceAdapter: createAutomationRouteTestSourceAdapter(),
      actionAdapter: createAutomationRouteTestActionAdapter(),
      recipientStatusReader: async () => new Map(),
      now,
    };

    await expect(evaluateAutomationRuleDryRunForRoute({
      ...baseOptions,
      executionStateReader: createPrismaAutomationRuleExecutionStateReader(fakePrisma),
    })).rejects.toThrow("execution state database unavailable");
    await expect(evaluateAutomationRuleDryRunForRoute({
      ...baseOptions,
      executionStateReader: {
        getExecutionStatuses: vi.fn(async () => new Map()),
      },
    })).rejects.toThrow("Automation dry-run execution state reader did not classify a requested decision.");
    expect(fakePrisma.automationRuleExecutionState.create).not.toHaveBeenCalled();
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
