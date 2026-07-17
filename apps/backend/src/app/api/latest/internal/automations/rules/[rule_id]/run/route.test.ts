import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import {
  AutomationRuleExecutionStatePrisma,
  createPrismaAutomationRuleExecutionStateStore,
} from "@/lib/automations/execution-state-store";
import { AutomationSourceDecision } from "@/lib/automations/rule-evaluator";
import {
  AutomationEmailSender,
  AutomationRuleExecutionStateStore,
  automationRunResultToApiBody,
  getSingleAutomationEmailSendResult,
  runAutomationRuleForManualRoute,
  runAutomationRuleForRoute,
} from "@/lib/automations/run-route";
import { parseAutomationScheduledAtMillis } from "@/lib/automations/scheduled-at";
import {
  automationRouteTestRuleId as ruleId,
  createAutomationRouteTestActionAdapter,
  createAutomationRouteTestSourceAdapter,
  createAutomationRouteTestSourceDecision,
  createAutomationRouteTestTenancy,
} from "../test-helpers";

const scheduledAt = new Date("2026-07-01T12:00:00.000Z");

describe("automation scheduled timestamp parsing", () => {
  it("accepts valid scheduled millis", () => {
    expect(parseAutomationScheduledAtMillis(1782907200000, "scheduled_at_millis")).toEqual(new Date("2026-07-01T12:00:00.000Z"));
  });

  it("rejects out-of-range manual run scheduled millis", () => {
    expect(() => parseAutomationScheduledAtMillis(8640000000000001, "scheduled_at_millis"))
      .toThrowErrorMatchingInlineSnapshot(`[StatusError: scheduled_at_millis must be a valid JavaScript timestamp in milliseconds.]`);
  });

  it("rejects out-of-range scheduled worker millis", () => {
    expect(() => parseAutomationScheduledAtMillis(-8640000000000001, "scheduledAtMillis"))
      .toThrowErrorMatchingInlineSnapshot(`[StatusError: scheduledAtMillis must be a valid JavaScript timestamp in milliseconds.]`);
  });
});

describe("automation email enqueue result classification", () => {
  it("distinguishes newly created and already-enqueued single-recipient rows", () => {
    expect(getSingleAutomationEmailSendResult({ createdCount: 1, alreadyEnqueuedCount: 0 })).toEqual({ outcome: "created" });
    expect(getSingleAutomationEmailSendResult({ createdCount: 0, alreadyEnqueuedCount: 1 })).toEqual({ outcome: "already-enqueued" });
  });

  it("fails loudly for partial or otherwise invalid single-recipient results", () => {
    expect(() => getSingleAutomationEmailSendResult({ createdCount: 1, alreadyEnqueuedCount: 1 }))
      .toThrow(/Expected one automation email enqueue result/);
  });
});

type InMemoryExecutionState = {
  lastTriggeredAt: Date,
  lastActionAt: Date | null,
  emailOutboxId: string,
  lastSourceSnapshot: Record<string, unknown>,
};

function createInMemoryStateStore() {
  const states = new Map<string, InMemoryExecutionState>();
  let nextEmailOutboxId = 1;
  const createEmailOutboxId = () => `00000000-0000-4000-8000-${String(nextEmailOutboxId++).padStart(12, "0")}`;
  const keyFor = (options: {
    tenancyId: string,
    ruleId: string,
    subjectType: string,
    subjectId: string,
    signalKey: string,
  }) => `${options.tenancyId}:${options.ruleId}:${options.subjectType}:${options.subjectId}:${options.signalKey}`;

  const stateStore: AutomationRuleExecutionStateStore = {
    claimExecution: vi.fn(async (options): Promise<Awaited<ReturnType<AutomationRuleExecutionStateStore["claimExecution"]>>> => {
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

      const emailOutboxId = existing?.lastActionAt === null ? existing.emailOutboxId : createEmailOutboxId();
      states.set(key, {
        lastTriggeredAt: options.lastTriggeredAt,
        lastActionAt: null,
        emailOutboxId,
        lastSourceSnapshot: options.sourceSnapshot,
      });
      return {
        claimed: true,
        lastActionAt: existing?.lastActionAt ?? null,
        emailOutboxId,
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
        emailOutboxId: options.emailOutboxId,
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
  emailSender?: Parameters<typeof runAutomationRuleForRoute>[0]["emailSender"],
  now?: Date,
  limit?: number,
  cursor?: string | null,
  ruleEnabled?: boolean,
} = {}) {
  const sourceAdapter = createAutomationRouteTestSourceAdapter(options.decisionFactory, { evaluatedCount: 1 });
  const actionAdapter = createAutomationRouteTestActionAdapter();
  const emailSender = vi.fn(options.emailSender ?? (async () => ({ outcome: "created" as const })));
  let createdStore: ReturnType<typeof createInMemoryStateStore> | undefined;
  let stateStore = options.stateStore;
  if (stateStore === undefined) {
    createdStore = createInMemoryStateStore();
    stateStore = createdStore.stateStore;
  }

  const result = await runAutomationRuleForRoute({
    tenancy: createAutomationRouteTestTenancy(options.ruleEnabled === undefined ? {} : { enabled: options.ruleEnabled }),
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
  it("returns 404 for missing manual rules before evaluating, claiming state, or sending email", async () => {
    const sourceAdapter = createAutomationRouteTestSourceAdapter();
    const actionAdapter = createAutomationRouteTestActionAdapter();
    const emailSender = vi.fn(async () => ({ outcome: "created" as const }));
    const { stateStore } = createInMemoryStateStore();

    const resultPromise = runAutomationRuleForManualRoute({
      tenancy: createAutomationRouteTestTenancy({ ruleExists: false }),
      ruleId,
      scheduledAt,
      now: new Date("2026-07-01T12:00:00.000Z"),
      sourceAdapter,
      actionAdapter,
      stateStore,
      emailSender,
    });
    await expect(resultPromise).rejects.toMatchObject({ statusCode: 404 });
    await expect(resultPromise).rejects.toThrowErrorMatchingInlineSnapshot(`[StatusError: Automation rule "low-api-credits" was not found for tenancy "tenancy-1".]`);

    expect(sourceAdapter.evaluate).not.toHaveBeenCalled();
    expect(actionAdapter.buildPlan).not.toHaveBeenCalled();
    expect(stateStore.claimExecution).not.toHaveBeenCalled();
    expect(stateStore.markActionCompleted).not.toHaveBeenCalled();
    expect(emailSender).not.toHaveBeenCalled();
  });

  it("refuses disabled rules before evaluating, claiming state, or sending email", async () => {
    const sourceAdapter = createAutomationRouteTestSourceAdapter();
    const actionAdapter = createAutomationRouteTestActionAdapter();
    const emailSender = vi.fn(async () => ({ outcome: "created" as const }));
    const { stateStore } = createInMemoryStateStore();

    await expect(runAutomationRuleForManualRoute({
      tenancy: createAutomationRouteTestTenancy({ enabled: false }),
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
      emailOutboxId: expect.any(String),
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
      emailOutboxId: "00000000-0000-4000-8000-000000000001",
      lastSourceSnapshot: createAutomationRouteTestSourceDecision().sourceSnapshot,
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
      decisionFactory: () => createAutomationRouteTestSourceDecision({ kind: "over" }),
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

  it("leaves failed sends as temporary in-flight claims and does not mark completion", async () => {
    const { stateStore, states } = createInMemoryStateStore();
    const failingEmailSender = vi.fn(async () => {
      throw new Error("email provider unavailable");
    });

    await expect(runWithFakes({
      stateStore,
      emailSender: failingEmailSender,
    })).rejects.toThrow("email provider unavailable");

    expect(failingEmailSender).toHaveBeenCalledOnce();
    expect(stateStore.claimExecution).toHaveBeenCalledOnce();
    expect(stateStore.markActionCompleted).not.toHaveBeenCalled();
    expect([...states.values()]).toMatchObject([{
      lastTriggeredAt: new Date("2026-07-01T12:00:00.000Z"),
      lastActionAt: null,
      emailOutboxId: expect.any(String),
    }]);

    const immediateRetry = await runWithFakes({
      stateStore,
      now: new Date("2026-07-01T12:01:00.000Z"),
    });

    expect(immediateRetry.result.sentCount).toBe(0);
    expect(immediateRetry.result.suppressedCount).toBe(1);
    expect(immediateRetry.emailSender).not.toHaveBeenCalled();
  });

  it("allows retry after a failed send claim becomes stale", async () => {
    const { stateStore } = createInMemoryStateStore();

    await expect(runWithFakes({
      stateStore,
      emailSender: async () => {
        throw new Error("email provider unavailable");
      },
    })).rejects.toThrow("email provider unavailable");

    const retryAfterStaleClaim = await runWithFakes({
      stateStore,
      now: new Date("2026-07-01T12:16:00.000Z"),
    });

    expect(retryAfterStaleClaim.result.sentCount).toBe(1);
    expect(retryAfterStaleClaim.emailSender).toHaveBeenCalledOnce();
  });

  it("does not enqueue a duplicate when completion fails after the outbox row was created", async () => {
    const { prisma, rows } = createMockExecutionStatePrisma();
    const reservedEmailOutboxId = "00000000-0000-4000-8000-000000000001";
    const prismaStore = createPrismaAutomationRuleExecutionStateStore(prisma, {
      createEmailOutboxId: () => reservedEmailOutboxId,
    });
    let shouldFailCompletion = true;
    const stateStore: AutomationRuleExecutionStateStore = {
      claimExecution: prismaStore.claimExecution,
      markActionCompleted: vi.fn(async (options) => {
        if (shouldFailCompletion) {
          shouldFailCompletion = false;
          throw new Error("completion database write failed");
        }
        await prismaStore.markActionCompleted(options);
      }),
    };
    const enqueuedEmailOutboxIds = new Set<string>();
    const emailSender = vi.fn(async (options: Parameters<AutomationEmailSender>[0]) => {
      if (enqueuedEmailOutboxIds.has(options.emailOutboxId)) {
        return { outcome: "already-enqueued" as const };
      }
      enqueuedEmailOutboxIds.add(options.emailOutboxId);
      return { outcome: "created" as const };
    });

    await expect(runWithFakes({
      stateStore,
      emailSender,
    })).rejects.toThrow("completion database write failed");

    const retry = await runWithFakes({
      stateStore,
      emailSender,
      now: new Date("2026-07-01T12:16:00.000Z"),
    });

    expect(retry.result.sentCount).toBe(1);
    expect(emailSender).toHaveBeenCalledTimes(2);
    expect(emailSender).toHaveBeenNthCalledWith(1, expect.objectContaining({ emailOutboxId: reservedEmailOutboxId }));
    expect(emailSender).toHaveBeenNthCalledWith(2, expect.objectContaining({ emailOutboxId: reservedEmailOutboxId }));
    expect(enqueuedEmailOutboxIds).toEqual(new Set([reservedEmailOutboxId]));
    expect([...rows.values()]).toMatchObject([{
      emailOutboxId: reservedEmailOutboxId,
      lastActionAt: new Date("2026-07-01T12:16:00.000Z"),
    }]);
  });

  it("suppresses a second run after an expired cooldown is reclaimed but not completed", async () => {
    const { stateStore } = createInMemoryStateStore();

    await runWithFakes({ stateStore });
    await expect(runWithFakes({
      stateStore,
      now: new Date("2026-07-09T12:00:00.000Z"),
      emailSender: async () => {
        throw new Error("email provider unavailable");
      },
    })).rejects.toThrow("email provider unavailable");

    const secondReclaimAttempt = await runWithFakes({
      stateStore,
      now: new Date("2026-07-09T12:01:00.000Z"),
    });

    expect(secondReclaimAttempt.result.sentCount).toBe(0);
    expect(secondReclaimAttempt.result.suppressedCount).toBe(1);
    expect(secondReclaimAttempt.emailSender).not.toHaveBeenCalled();
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
  emailOutboxId: string,
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
          emailOutboxId: row.emailOutboxId,
        };
      }),
      updateMany: vi.fn(async (options) => {
        const row = rows.get(keyFor(options.where));
        if (row === undefined) {
          return { count: 0 };
        }

        const lastActionMatches = options.where.lastActionAt === null
          ? row.lastActionAt === null
          : row.lastActionAt !== null && row.lastActionAt < options.where.lastActionAt.lt;
        const lastTriggeredMatches = options.where.lastTriggeredAt === undefined
          || (options.where.lastTriggeredAt instanceof Date
            ? row.lastTriggeredAt.getTime() === options.where.lastTriggeredAt.getTime()
            : row.lastTriggeredAt < options.where.lastTriggeredAt.lt);
        const emailOutboxIdMatches = options.where.emailOutboxId === undefined
          || row.emailOutboxId === options.where.emailOutboxId;
        if (!lastActionMatches || !lastTriggeredMatches || !emailOutboxIdMatches) {
          return { count: 0 };
        }

        rows.set(keyFor(options.where), {
          ...row,
          ...options.data,
        });
        return { count: 1 };
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
    sourceSnapshot: createAutomationRouteTestSourceDecision().sourceSnapshot,
  };
}

describe("Prisma automation execution state store", () => {
  it("claims a new execution state row with Prisma create", async () => {
    const { prisma, rows } = createMockExecutionStatePrisma();
    const store = createPrismaAutomationRuleExecutionStateStore(prisma, {
      createEmailOutboxId: () => "00000000-0000-4000-8000-000000000001",
    });

    const result = await store.claimExecution(createClaimOptions());

    expect(result).toEqual({
      claimed: true,
      lastActionAt: null,
      emailOutboxId: "00000000-0000-4000-8000-000000000001",
    });
    expect(prisma.automationRuleExecutionState.create).toHaveBeenCalledOnce();
    expect([...rows.values()]).toMatchObject([{
      lastTriggeredAt: new Date("2026-07-01T12:00:00.000Z"),
      lastActionAt: null,
      emailOutboxId: "00000000-0000-4000-8000-000000000001",
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
      emailOutboxId: "00000000-0000-4000-8000-000000000001",
      lastSourceSnapshot: {
        itemId: "old",
      },
    }]);
    const store = createPrismaAutomationRuleExecutionStateStore(prisma);

    const result = await store.claimExecution(createClaimOptions());

    expect(result).toEqual({
      claimed: true,
      lastActionAt: oldActionAt,
      emailOutboxId: expect.any(String),
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
      emailOutboxId: "00000000-0000-4000-8000-000000000001",
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
      emailOutboxId: expect.any(String),
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
    const store = createPrismaAutomationRuleExecutionStateStore(prisma, {
      createEmailOutboxId: () => "00000000-0000-4000-8000-000000000001",
    });

    await store.claimExecution(createClaimOptions({
      lastTriggeredAt: new Date("2026-07-01T12:00:00.000Z"),
    }));
    await store.markActionCompleted({
      tenancyId: "tenancy-1",
      ruleId,
      subjectType: "user",
      subjectId: "user-1",
      signalKey: "api_credits:near",
      claimTriggeredAt: new Date("2026-07-01T12:00:00.000Z"),
      lastActionAt: new Date("2026-07-01T12:05:00.000Z"),
      emailOutboxId: "00000000-0000-4000-8000-000000000001",
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
      emailOutboxId: expect.any(String),
    });
  });

  it("allows only one expired cooldown reclaim before completion", async () => {
    const lastActionAt = new Date("2026-07-01T12:05:00.000Z");
    const { prisma, rows } = createMockExecutionStatePrisma([{
      ...createClaimOptions(),
      sourceType: "payments-item-quota",
      actionType: "send-email",
      lastTriggeredAt: new Date("2026-07-01T12:00:00.000Z"),
      lastActionAt,
      emailOutboxId: "00000000-0000-4000-8000-000000000001",
      lastSourceSnapshot: {
        itemId: "api_credits",
      },
    }]);
    const store = createPrismaAutomationRuleExecutionStateStore(prisma);

    const first = await store.claimExecution(createClaimOptions({
      lastTriggeredAt: new Date("2026-07-09T12:06:00.000Z"),
    }));
    const second = await store.claimExecution(createClaimOptions({
      lastTriggeredAt: new Date("2026-07-09T12:07:00.000Z"),
    }));

    expect(first).toEqual({
      claimed: true,
      lastActionAt,
      emailOutboxId: expect.any(String),
    });
    expect(second).toEqual({
      claimed: false,
      lastActionAt: null,
    });
    expect([...rows.values()]).toMatchObject([{
      lastTriggeredAt: new Date("2026-07-09T12:06:00.000Z"),
      lastActionAt: null,
    }]);
  });

  it("reuses an in-flight reservation after staleness and fences the previous claimant", async () => {
    const reservedEmailOutboxId = "00000000-0000-4000-8000-000000000001";
    const { prisma } = createMockExecutionStatePrisma([{
      ...createClaimOptions(),
      sourceType: "payments-item-quota",
      actionType: "send-email",
      lastTriggeredAt: new Date("2026-07-01T12:00:00.000Z"),
      lastActionAt: null,
      emailOutboxId: reservedEmailOutboxId,
      lastSourceSnapshot: { itemId: "api_credits" },
    }]);
    const store = createPrismaAutomationRuleExecutionStateStore(prisma);

    await expect(store.claimExecution(createClaimOptions({
      lastTriggeredAt: new Date("2026-07-01T12:16:00.000Z"),
    }))).resolves.toEqual({
      claimed: true,
      lastActionAt: null,
      emailOutboxId: reservedEmailOutboxId,
    });

    await expect(store.markActionCompleted({
      tenancyId: "tenancy-1",
      ruleId,
      subjectType: "user",
      subjectId: "user-1",
      signalKey: "api_credits:near",
      claimTriggeredAt: new Date("2026-07-01T12:00:00.000Z"),
      lastActionAt: new Date("2026-07-01T12:17:00.000Z"),
      emailOutboxId: reservedEmailOutboxId,
    })).rejects.toThrow("lost ownership");

    await expect(store.markActionCompleted({
      tenancyId: "tenancy-1",
      ruleId,
      subjectType: "user",
      subjectId: "user-1",
      signalKey: "api_credits:near",
      claimTriggeredAt: new Date("2026-07-01T12:16:00.000Z"),
      lastActionAt: new Date("2026-07-01T12:16:00.000Z"),
      emailOutboxId: reservedEmailOutboxId,
    })).resolves.toBeUndefined();
  });

  it("marks a claimed action completed with a fenced Prisma updateMany", async () => {
    const { prisma, rows } = createMockExecutionStatePrisma([{
      ...createClaimOptions(),
      sourceType: "payments-item-quota",
      actionType: "send-email",
      lastTriggeredAt: new Date("2026-07-01T12:00:00.000Z"),
      lastActionAt: null,
      emailOutboxId: "9ddfd5da-8cca-48be-944a-f59235892877",
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
      claimTriggeredAt: new Date("2026-07-01T12:00:00.000Z"),
      lastActionAt: new Date("2026-07-01T12:05:00.000Z"),
      emailOutboxId: "9ddfd5da-8cca-48be-944a-f59235892877",
    });

    expect(prisma.automationRuleExecutionState.updateMany).toHaveBeenCalledOnce();
    expect([...rows.values()]).toMatchObject([{
      lastActionAt: new Date("2026-07-01T12:05:00.000Z"),
      emailOutboxId: "9ddfd5da-8cca-48be-944a-f59235892877",
    }]);

    await expect(store.markActionCompleted({
      tenancyId: "tenancy-1",
      ruleId,
      subjectType: "user",
      subjectId: "user-1",
      signalKey: "api_credits:near",
      claimTriggeredAt: new Date("2026-07-01T12:00:00.000Z"),
      lastActionAt: new Date("2026-07-01T12:05:00.000Z"),
      emailOutboxId: "9ddfd5da-8cca-48be-944a-f59235892877",
    })).resolves.toBeUndefined();
  });
});
