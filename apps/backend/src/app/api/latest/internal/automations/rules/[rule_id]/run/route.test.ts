import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import {
  AutomationRuleExecutionStatePrisma,
  createPrismaAutomationRuleExecutionStateStore,
} from "@/lib/automations/execution-state-store";
import { AutomationActionAdapter, AutomationSourceAdapter, AutomationSourceDecision } from "@/lib/automations/rule-evaluator";
import {
  AutomationRuleExecutionStateStore,
  automationRunResultToApiBody,
  runAutomationRuleForRoute,
} from "@/lib/automations/run-route";

const ruleId = "low-api-credits";
const scheduledAt = new Date("2026-07-01T12:00:00.000Z");

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

function createDecision(options: {
  userId?: string,
  kind?: "near" | "over",
} = {}): AutomationSourceDecision {
  const kind = options.kind ?? "near";
  return {
    subject: {
      type: "user",
      id: options.userId ?? "user-1",
    },
    signal: {
      key: `api_credits:${kind}`,
      kind,
    },
    sourceSnapshot: {
      sourceType: "payments-item-quota",
      itemId: "api_credits",
      itemDisplayName: "API credits",
      currentQuantity: kind === "over" ? 0 : 7,
      entitlementQuantity: 100,
      thresholdKind: kind,
      ownedProductIds: ["pro"],
      activeSubscriptionIds: ["sub_1"],
    },
  };
}

function createSourceAdapter(decisionFactory: () => AutomationSourceDecision = createDecision): AutomationSourceAdapter {
  const evaluate: AutomationSourceAdapter["evaluate"] = async () => ({
    evaluatedCount: 1,
    nextCursor: "cursor-2",
    decisions: [decisionFactory()],
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
      ...options.decision.sourceSnapshot,
      projectDisplayName: "Acme App",
    },
  });
  return {
    buildPlan: vi.fn(buildPlan),
  };
}

type InMemoryExecutionState = {
  lastTriggeredAt: Date,
  lastActionAt: Date | null,
  lastEmailOutboxId: string | null,
  lastSourceSnapshot: Record<string, unknown>,
};

function createInMemoryStateStore() {
  const states = new Map<string, InMemoryExecutionState>();
  const keyFor = (options: {
    tenancyId: string,
    ruleId: string,
    subjectType: string,
    subjectId: string,
    signalKey: string,
  }) => `${options.tenancyId}:${options.ruleId}:${options.subjectType}:${options.subjectId}:${options.signalKey}`;

  const stateStore: AutomationRuleExecutionStateStore = {
    claimExecution: vi.fn(async (options) => {
      const key = keyFor(options);
      const existing = states.get(key);
      const cooldownCutoff = new Date(options.lastTriggeredAt.getTime() - options.cooldownDays * 24 * 60 * 60 * 1000);
      const staleClaimCutoff = new Date(options.lastTriggeredAt.getTime() - 15 * 60 * 1000);
      if (existing?.lastActionAt === null && existing.lastTriggeredAt >= staleClaimCutoff) {
        return {
          claimed: false,
          lastActionAt: null,
        };
      }
      if (existing?.lastActionAt != null && existing.lastActionAt >= cooldownCutoff) {
        return {
          claimed: false,
          lastActionAt: existing.lastActionAt,
        };
      }

      states.set(key, {
        lastTriggeredAt: options.lastTriggeredAt,
        lastActionAt: existing?.lastActionAt ?? null,
        lastEmailOutboxId: existing?.lastEmailOutboxId ?? null,
        lastSourceSnapshot: options.sourceSnapshot,
      });
      return {
        claimed: true,
        lastActionAt: existing?.lastActionAt ?? null,
      };
    }),
    markActionCompleted: vi.fn(async (options) => {
      const key = keyFor(options);
      const existing = states.get(key);
      if (existing === undefined) {
        throw new Error("Expected state to be claimed before marking action completed.");
      }
      states.set(key, {
        ...existing,
        lastActionAt: options.lastActionAt,
        lastEmailOutboxId: options.lastEmailOutboxId,
      });
    }),
  };

  return {
    stateStore,
    states,
  };
}

async function runWithFakes(options: {
  stateStore?: AutomationRuleExecutionStateStore,
  decisionFactory?: () => AutomationSourceDecision,
  now?: Date,
  limit?: number,
  cursor?: string | null,
  ruleEnabled?: boolean,
} = {}) {
  const sourceAdapter = createSourceAdapter(options.decisionFactory);
  const actionAdapter = createActionAdapter();
  const emailSender = vi.fn(async () => {});
  let createdStore: ReturnType<typeof createInMemoryStateStore> | undefined;
  let stateStore = options.stateStore;
  if (stateStore === undefined) {
    createdStore = createInMemoryStateStore();
    stateStore = createdStore.stateStore;
  }

  const result = await runAutomationRuleForRoute({
    tenancy: createTenancy(options.ruleEnabled === undefined ? {} : { enabled: options.ruleEnabled }),
    ruleId,
    limit: options.limit,
    cursor: options.cursor,
    scheduledAt,
    now: options.now ?? new Date("2026-07-01T12:00:00.000Z"),
    sourceAdapter,
    actionAdapter,
    stateStore,
    emailSender,
  });

  return {
    result,
    sourceAdapter,
    actionAdapter,
    emailSender,
    states: createdStore?.states,
  };
}

describe("automation real-send route helpers", () => {
  it("refuses disabled rules before evaluating, claiming state, or sending email", async () => {
    const sourceAdapter = createSourceAdapter();
    const actionAdapter = createActionAdapter();
    const emailSender = vi.fn(async () => {});
    const { stateStore } = createInMemoryStateStore();

    await expect(runAutomationRuleForRoute({
      tenancy: createTenancy({ enabled: false }),
      ruleId,
      scheduledAt,
      now: new Date("2026-07-01T12:00:00.000Z"),
      sourceAdapter,
      actionAdapter,
      stateStore,
      emailSender,
    })).rejects.toThrowErrorMatchingInlineSnapshot(`[StatusError: Automation rule "low-api-credits" is disabled and cannot be manually sent.]`);

    expect(sourceAdapter.evaluate).not.toHaveBeenCalled();
    expect(actionAdapter.buildPlan).not.toHaveBeenCalled();
    expect(stateStore.claimExecution).not.toHaveBeenCalled();
    expect(stateStore.markActionCompleted).not.toHaveBeenCalled();
    expect(emailSender).not.toHaveBeenCalled();
  });

  it("claims state, enqueues email, and marks action completed", async () => {
    const { result, emailSender, states } = await runWithFakes();

    expect(result.sentCount).toBe(1);
    expect(emailSender).toHaveBeenCalledWith(expect.objectContaining({
      scheduledAt,
      action: expect.objectContaining({
        recipient: {
          type: "user-primary-email",
          userId: "user-1",
        },
        variables: expect.objectContaining({
          automationRuleId: ruleId,
          currentQuantity: 7,
        }),
      }),
    }));
    expect([...states!.values()]).toMatchObject([{
      lastActionAt: new Date("2026-07-01T12:00:00.000Z"),
      lastEmailOutboxId: null,
      lastSourceSnapshot: expect.objectContaining({
        itemId: "api_credits",
        thresholdKind: "near",
      }),
    }]);
  });

  it("suppresses repeated same-signal sends during cooldown", async () => {
    const { stateStore } = createInMemoryStateStore();

    const first = await runWithFakes({ stateStore });
    const second = await runWithFakes({
      stateStore,
      now: new Date("2026-07-02T12:00:00.000Z"),
    });

    expect(first.result.sentCount).toBe(1);
    expect(second.result.sentCount).toBe(0);
    expect(second.result.suppressedCount).toBe(1);
    expect(second.emailSender).not.toHaveBeenCalled();
    expect(automationRunResultToApiBody(second.result)).toMatchObject({
      decisions: [{
        sent: false,
        cooldown: {
          blocked: true,
          last_action_at_millis: new Date("2026-07-01T12:00:00.000Z").getTime(),
          next_eligible_at_millis: new Date("2026-07-08T12:00:00.000Z").getTime(),
        },
        skip_reason: "cooldown",
      }],
    });
  });

  it("suppresses a second run while the first claim is still in flight", async () => {
    const { stateStore, states } = createInMemoryStateStore();
    states.set("tenancy-1:low-api-credits:user:user-1:api_credits:near", {
      lastTriggeredAt: new Date("2026-07-01T12:00:00.000Z"),
      lastActionAt: null,
      lastEmailOutboxId: null,
      lastSourceSnapshot: createDecision().sourceSnapshot,
    });

    const second = await runWithFakes({
      stateStore,
      now: new Date("2026-07-01T12:01:00.000Z"),
    });

    expect(second.result.sentCount).toBe(0);
    expect(second.result.suppressedCount).toBe(1);
    expect(second.emailSender).not.toHaveBeenCalled();
    expect(automationRunResultToApiBody(second.result)).toMatchObject({
      decisions: [{
        sent: false,
        cooldown: {
          blocked: true,
        },
        skip_reason: "cooldown",
      }],
    });
  });

  it("allows over signal after near signal because signal keys differ", async () => {
    const { stateStore } = createInMemoryStateStore();

    const near = await runWithFakes({ stateStore });
    const over = await runWithFakes({
      stateStore,
      decisionFactory: () => createDecision({ kind: "over" }),
      now: new Date("2026-07-02T12:00:00.000Z"),
    });

    expect(near.result.sentCount).toBe(1);
    expect(over.result.sentCount).toBe(1);
    expect(over.emailSender).toHaveBeenCalledTimes(1);
  });

  it("allows same signal again after cooldown expires", async () => {
    const { stateStore } = createInMemoryStateStore();

    await runWithFakes({ stateStore });
    const afterCooldown = await runWithFakes({
      stateStore,
      now: new Date("2026-07-09T12:00:00.000Z"),
    });

    expect(afterCooldown.result.sentCount).toBe(1);
    expect(afterCooldown.emailSender).toHaveBeenCalledTimes(1);
  });

  it("passes pagination through and does not duplicate sends for the same cursor result", async () => {
    const { stateStore } = createInMemoryStateStore();

    const first = await runWithFakes({
      stateStore,
      limit: 25,
      cursor: "cursor-1",
    });
    const second = await runWithFakes({
      stateStore,
      limit: 25,
      cursor: "cursor-1",
      now: new Date("2026-07-01T12:01:00.000Z"),
    });

    expect(first.sourceAdapter.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      limit: 25,
      cursor: "cursor-1",
    }));
    expect(first.result.nextCursor).toBe("cursor-2");
    expect(first.result.sentCount).toBe(1);
    expect(second.result.sentCount).toBe(0);
  });
});

type PrismaStoreState = {
  tenancyId: string,
  ruleId: string,
  sourceType: string,
  actionType: string,
  subjectType: "user",
  subjectId: string,
  signalKey: string,
  lastTriggeredAt: Date,
  lastActionAt: Date | null,
  lastEmailOutboxId: string | null,
  lastSourceSnapshot: Prisma.InputJsonObject,
};

function createPrismaUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the automation execution state primary key.", {
    code: "P2002",
    clientVersion: "test",
  });
}

function createMockExecutionStatePrisma(initialRows: PrismaStoreState[] = []) {
  const rows = new Map<string, PrismaStoreState>();
  const keyFor = (options: {
    tenancyId: string,
    ruleId: string,
    subjectType: "user",
    subjectId: string,
    signalKey: string,
  }) => `${options.tenancyId}:${options.ruleId}:${options.subjectType}:${options.subjectId}:${options.signalKey}`;

  for (const row of initialRows) {
    rows.set(keyFor(row), row);
  }

  const prisma: AutomationRuleExecutionStatePrisma = {
    automationRuleExecutionState: {
      create: vi.fn(async (options) => {
        const key = keyFor(options.data);
        if (rows.has(key)) {
          throw createPrismaUniqueConstraintError();
        }
        rows.set(key, options.data);
        return options.data;
      }),
      findUnique: vi.fn(async (options) => {
        const row = rows.get(keyFor(options.where.tenancyId_ruleId_subjectType_subjectId_signalKey));
        return row === undefined ? null : {
          lastTriggeredAt: row.lastTriggeredAt,
          lastActionAt: row.lastActionAt,
        };
      }),
      updateMany: vi.fn(async (options) => {
        const row = rows.get(keyFor(options.where));
        if (row === undefined) {
          return { count: 0 };
        }

        const canClaim = options.where.OR.some((clause) => {
          if ("lastTriggeredAt" in clause) {
            return row.lastActionAt === null && row.lastTriggeredAt < clause.lastTriggeredAt.lt;
          }
          return row.lastActionAt !== null && row.lastActionAt < clause.lastActionAt.lt;
        });
        if (!canClaim) {
          return { count: 0 };
        }

        rows.set(keyFor(options.where), {
          ...row,
          ...options.data,
        });
        return { count: 1 };
      }),
      update: vi.fn(async (options) => {
        const key = keyFor(options.where.tenancyId_ruleId_subjectType_subjectId_signalKey);
        const row = rows.get(key);
        if (row === undefined) {
          throw new Error("Expected automation execution state row to exist before update.");
        }
        rows.set(key, {
          ...row,
          ...options.data,
        });
        return rows.get(key);
      }),
    },
  };

  return {
    prisma,
    rows,
  };
}

function createClaimOptions(options: {
  lastTriggeredAt?: Date,
} = {}) {
  return {
    tenancyId: "tenancy-1",
    ruleId,
    sourceType: "payments-item-quota" as const,
    actionType: "send-email" as const,
    subjectType: "user" as const,
    subjectId: "user-1",
    signalKey: "api_credits:near",
    lastTriggeredAt: options.lastTriggeredAt ?? new Date("2026-07-01T12:00:00.000Z"),
    cooldownDays: 7,
    sourceSnapshot: createDecision().sourceSnapshot,
  };
}

describe("Prisma automation execution state store", () => {
  it("claims a new execution state row with Prisma create", async () => {
    const { prisma, rows } = createMockExecutionStatePrisma();
    const store = createPrismaAutomationRuleExecutionStateStore(prisma);

    const result = await store.claimExecution(createClaimOptions());

    expect(result).toEqual({
      claimed: true,
      lastActionAt: null,
    });
    expect(prisma.automationRuleExecutionState.create).toHaveBeenCalledOnce();
    expect([...rows.values()]).toMatchObject([{
      lastTriggeredAt: new Date("2026-07-01T12:00:00.000Z"),
      lastActionAt: null,
      lastEmailOutboxId: null,
      lastSourceSnapshot: expect.objectContaining({
        itemId: "api_credits",
      }),
    }]);
  });

  it("updates an existing cooled-down execution state row with Prisma updateMany", async () => {
    const oldActionAt = new Date("2026-06-01T12:00:00.000Z");
    const { prisma } = createMockExecutionStatePrisma([{
      ...createClaimOptions(),
      sourceType: "payments-item-quota",
      actionType: "send-email",
      lastTriggeredAt: new Date("2026-06-01T12:00:00.000Z"),
      lastActionAt: oldActionAt,
      lastEmailOutboxId: null,
      lastSourceSnapshot: {
        itemId: "old",
      },
    }]);
    const store = createPrismaAutomationRuleExecutionStateStore(prisma);

    const result = await store.claimExecution(createClaimOptions());

    expect(result).toEqual({
      claimed: true,
      lastActionAt: oldActionAt,
    });
    expect(prisma.automationRuleExecutionState.updateMany).toHaveBeenCalledOnce();
  });

  it("does not claim an execution state row inside the cooldown window", async () => {
    const lastActionAt = new Date("2026-06-30T12:00:00.000Z");
    const { prisma } = createMockExecutionStatePrisma([{
      ...createClaimOptions(),
      sourceType: "payments-item-quota",
      actionType: "send-email",
      lastTriggeredAt: new Date("2026-06-30T12:00:00.000Z"),
      lastActionAt,
      lastEmailOutboxId: null,
      lastSourceSnapshot: {
        itemId: "api_credits",
      },
    }]);
    const store = createPrismaAutomationRuleExecutionStateStore(prisma);

    const result = await store.claimExecution(createClaimOptions());

    expect(result).toEqual({
      claimed: false,
      lastActionAt,
    });
    expect(prisma.automationRuleExecutionState.updateMany).toHaveBeenCalledOnce();
  });

  it("allows only one concurrent claim while the first claim is in flight", async () => {
    const { prisma } = createMockExecutionStatePrisma();
    const store = createPrismaAutomationRuleExecutionStateStore(prisma);

    const first = await store.claimExecution(createClaimOptions({
      lastTriggeredAt: new Date("2026-07-01T12:00:00.000Z"),
    }));
    const second = await store.claimExecution(createClaimOptions({
      lastTriggeredAt: new Date("2026-07-01T12:01:00.000Z"),
    }));

    expect(first).toEqual({
      claimed: true,
      lastActionAt: null,
    });
    expect(second).toEqual({
      claimed: false,
      lastActionAt: null,
    });
    expect(prisma.automationRuleExecutionState.create).toHaveBeenCalledTimes(2);
    expect(prisma.automationRuleExecutionState.updateMany).toHaveBeenCalledOnce();
  });

  it("continues to apply cooldown and retry rules after a claim completes", async () => {
    const { prisma } = createMockExecutionStatePrisma();
    const store = createPrismaAutomationRuleExecutionStateStore(prisma);

    await store.claimExecution(createClaimOptions({
      lastTriggeredAt: new Date("2026-07-01T12:00:00.000Z"),
    }));
    await store.markActionCompleted({
      tenancyId: "tenancy-1",
      ruleId,
      subjectType: "user",
      subjectId: "user-1",
      signalKey: "api_credits:near",
      lastActionAt: new Date("2026-07-01T12:05:00.000Z"),
      lastEmailOutboxId: null,
    });

    await expect(store.claimExecution(createClaimOptions({
      lastTriggeredAt: new Date("2026-07-02T12:00:00.000Z"),
    }))).resolves.toEqual({
      claimed: false,
      lastActionAt: new Date("2026-07-01T12:05:00.000Z"),
    });
    await expect(store.claimExecution(createClaimOptions({
      lastTriggeredAt: new Date("2026-07-09T12:06:00.000Z"),
    }))).resolves.toEqual({
      claimed: true,
      lastActionAt: new Date("2026-07-01T12:05:00.000Z"),
    });
  });

  it("marks a claimed action completed with Prisma update", async () => {
    const { prisma, rows } = createMockExecutionStatePrisma([{
      ...createClaimOptions(),
      sourceType: "payments-item-quota",
      actionType: "send-email",
      lastTriggeredAt: new Date("2026-07-01T12:00:00.000Z"),
      lastActionAt: null,
      lastEmailOutboxId: null,
      lastSourceSnapshot: {
        itemId: "api_credits",
      },
    }]);
    const store = createPrismaAutomationRuleExecutionStateStore(prisma);

    await store.markActionCompleted({
      tenancyId: "tenancy-1",
      ruleId,
      subjectType: "user",
      subjectId: "user-1",
      signalKey: "api_credits:near",
      lastActionAt: new Date("2026-07-01T12:05:00.000Z"),
      lastEmailOutboxId: "9ddfd5da-8cca-48be-944a-f59235892877",
    });

    expect(prisma.automationRuleExecutionState.update).toHaveBeenCalledOnce();
    expect([...rows.values()]).toMatchObject([{
      lastActionAt: new Date("2026-07-01T12:05:00.000Z"),
      lastEmailOutboxId: "9ddfd5da-8cca-48be-944a-f59235892877",
    }]);
  });
});
