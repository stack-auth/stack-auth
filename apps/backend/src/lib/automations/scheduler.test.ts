import { describe, expect, it, vi } from "vitest";
import type { AutomationSchedulerCheckpoint, AutomationSchedulerLease } from "./scheduler-state";

const captureErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/automations/actions/send-email", () => ({
  createSendEmailActionAdapter: () => ({}),
}));
vi.mock("@/lib/automations/execution-state-store", () => ({
  createPrismaAutomationRuleExecutionStateStore: () => ({}),
}));
vi.mock("@/lib/automations/sources/payments-item-quota", () => ({
  createPaymentsItemQuotaSourceAdapter: () => ({}),
  paymentsItemQuotaCustomerDataReaders: {},
  prismaPaymentsItemQuotaProjectUserReader: {},
}));
vi.mock("@/lib/emails", () => ({
  sendEmailToMany: async () => ({ createdCount: 1, alreadyEnqueuedCount: 0 }),
}));
vi.mock("@/lib/tenancies", () => ({ getTenancy: async () => null }));
vi.mock("@/prisma-client", () => ({
  getPrismaClientForTenancy: async () => ({}),
  globalPrismaClient: {
    tenancy: { findMany: async () => [] },
    automationSchedulerState: {},
  },
}));
vi.mock("@hexclave/shared/dist/utils/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hexclave/shared/dist/utils/errors")>();
  return { ...actual, captureError: captureErrorMock };
});

import {
  normalizeScheduledAutomationDiscoveryLimit,
  normalizeScheduledAutomationMaxPages,
  normalizeScheduledAutomationRunPageLimit,
  normalizeScheduledAutomationWorkBudgetMs,
  runScheduledAutomations,
} from "./scheduler";
import type { AutomationRunResult } from "./run-route";
import { NonRetryableAutomationRuleError } from "./rules";

const ruleId = "low-api-credits";

function emptyCheckpoint(): AutomationSchedulerCheckpoint {
  return {
    completedTenancyCursor: null,
    activeTenancyId: null,
    completedRuleCursor: null,
    activeRuleId: null,
    activeRuleEvaluationStartedAt: null,
    nextSubjectCursor: null,
  };
}

function createStateHarness(initial: AutomationSchedulerCheckpoint = emptyCheckpoint()) {
  let checkpoint = initial;
  const saveCheckpoint = vi.fn(async (next: AutomationSchedulerCheckpoint) => {
    checkpoint = next;
  });
  const release = vi.fn(async () => {});
  const renewIfNeeded = vi.fn(async () => {});
  const completeRuleEvaluation = vi.fn(async (options: {
    checkpoint: AutomationSchedulerCheckpoint,
    tenancyId: string,
    ruleId: string,
    evaluationStartedAt: Date,
  }) => {
    checkpoint = options.checkpoint;
  });
  const acquire = vi.fn(async (): Promise<AutomationSchedulerLease> => ({
    ownerId: "00000000-0000-4000-8000-000000000001",
    get checkpoint() {
      return checkpoint;
    },
    saveCheckpoint,
    completeRuleEvaluation,
    release,
    renewIfNeeded,
  }));
  return {
    stateStore: { acquire },
    getCheckpoint: () => checkpoint,
    acquire,
    saveCheckpoint,
    release,
    renewIfNeeded,
    completeRuleEvaluation,
  };
}

function createPrisma(tenancyIds: string[], options: {
  scheduleStates?: Map<string, Date>,
  dueDeferredRuleIds?: Set<string>,
} = {}) {
  return {
    tenancy: {
      findMany: vi.fn(async (options: any) => tenancyIds
        .filter((id) => options.where.id?.gt === undefined || id > options.where.id.gt)
        .slice(0, options.take)
        .map((id) => ({ id }))),
    },
    automationRuleScheduleState: {
      findUnique: vi.fn(async ({ where }: any) => {
        const key = `${where.tenancyId_ruleId.tenancyId}:${where.tenancyId_ruleId.ruleId}`;
        const lastCompletedEvaluationStartedAt = options.scheduleStates?.get(key);
        return lastCompletedEvaluationStartedAt === undefined ? null : { lastCompletedEvaluationStartedAt };
      }),
    },
    automationRuleExecutionState: {
      findFirst: vi.fn(async ({ where }: any) => options.dueDeferredRuleIds?.has(where.ruleId)
        ? { signalKey: "api-credits:near" }
        : null),
    },
  };
}

function createRule(options: { enabled?: boolean, sourceType?: string, cadence?: string } = {}) {
  return {
    enabled: options.enabled ?? true,
    source: {
      type: options.sourceType ?? "payments-item-quota",
      itemId: "api-credits",
      customerType: "user",
      thresholds: { nearRemainingQuantity: 10 },
    },
    action: {
      type: "send-email",
      templateId: "8c6f6960-7a87-4ebd-b2a6-bfd06d68e2d1",
      notificationCategoryName: "Marketing",
    },
    cooldown: { days: 7 },
    ...(options.cadence === undefined ? {} : { schedule: { cadence: options.cadence } }),
  };
}

function createTenancy(id: string, rules: Record<string, ReturnType<typeof createRule>> = { [ruleId]: createRule() }) {
  return {
    id,
    project: { display_name: "Acme App" },
    config: { automations: { rules } },
  };
}

function createRunResult(nextCursor: string | null, options: Partial<AutomationRunResult> = {}): AutomationRunResult {
  return {
    ruleId,
    mode: "run",
    evaluatedCount: 100,
    eligibleCount: 1,
    suppressedCount: 0,
    sentCount: 1,
    deferredCount: 0,
    nextCursor,
    decisions: [],
    ...options,
  };
}

describe("scheduled automation bounds", () => {
  it("strictly normalizes internal limits", () => {
    expect(normalizeScheduledAutomationDiscoveryLimit(900)).toBe(500);
    expect(normalizeScheduledAutomationRunPageLimit(900)).toBe(100);
    expect(normalizeScheduledAutomationMaxPages(900)).toBe(10);
    expect(normalizeScheduledAutomationWorkBudgetMs(90_000)).toBe(45_000);
  });
});

describe("native cron automation traversal", () => {
  it("returns without work when another invocation holds the lease", async () => {
    await expect(runScheduledAutomations({
      stateStore: { acquire: async () => null },
    })).resolves.toMatchObject({
      status: "lease-held",
      pagesProcessed: 0,
      sentCount: 0,
    });
  });

  it("persists the next subject cursor only after a page succeeds", async () => {
    const state = createStateHarness();
    const runRule = vi.fn(async () => createRunResult("00000000-0000-4000-8000-000000000100"));

    await expect(runScheduledAutomations({
      prisma: createPrisma(["00000000-0000-4000-8000-000000000010"]),
      stateStore: state.stateStore,
      getTenancyById: async (id) => createTenancy(id),
      runRule,
      maxPages: 1,
    })).resolves.toMatchObject({
      status: "ran",
      pagesProcessed: 1,
      evaluatedCount: 100,
      sentCount: 1,
    });

    expect(runRule).toHaveBeenCalledWith(expect.objectContaining({
      cursor: null,
      limit: 100,
    }));
    expect(state.getCheckpoint()).toMatchObject({
      activeRuleId: ruleId,
      nextSubjectCursor: "00000000-0000-4000-8000-000000000100",
    });
    expect(state.renewIfNeeded).toHaveBeenCalledOnce();
    expect(state.release).toHaveBeenCalledOnce();
  });

  it("advances a page after decision failures are durably deferred", async () => {
    const state = createStateHarness();
    const nextCursor = "00000000-0000-4000-8000-000000000100";

    await expect(runScheduledAutomations({
      prisma: createPrisma(["00000000-0000-4000-8000-000000000010"]),
      stateStore: state.stateStore,
      getTenancyById: async (id) => createTenancy(id),
      runRule: async () => createRunResult(nextCursor, {
        eligibleCount: 1,
        sentCount: 0,
        deferredCount: 1,
      }),
      maxPages: 1,
    })).resolves.toMatchObject({
      pagesProcessed: 1,
      sentCount: 0,
      deferredCount: 1,
    });

    expect(state.getCheckpoint()).toMatchObject({
      activeRuleId: ruleId,
      nextSubjectCursor: nextCursor,
    });
  });

  it("uses a monotonic clock for the work budget", async () => {
    const state = createStateHarness();
    let elapsedMillis = 0;
    let wallClockMillis = Date.UTC(2026, 0, 1);
    const runRule = vi.fn(async () => {
      elapsedMillis = 10;
      return createRunResult("00000000-0000-4000-8000-000000000100");
    });

    await expect(runScheduledAutomations({
      prisma: createPrisma(["00000000-0000-4000-8000-000000000010"]),
      stateStore: state.stateStore,
      getTenancyById: async (id) => createTenancy(id),
      runRule,
      now: () => new Date(wallClockMillis -= 60_000),
      elapsedNow: () => elapsedMillis,
      workBudgetMs: 10,
    })).resolves.toMatchObject({
      pagesProcessed: 1,
    });

    expect(runRule).toHaveBeenCalledOnce();
    expect(state.getCheckpoint()).toMatchObject({
      activeRuleId: ruleId,
      nextSubjectCursor: "00000000-0000-4000-8000-000000000100",
    });
  });

  it("preserves the current page checkpoint and fails on transient execution errors", async () => {
    const initial = {
      completedTenancyCursor: "00000000-0000-4000-8000-000000000001",
      activeTenancyId: "00000000-0000-4000-8000-000000000010",
      completedRuleCursor: null,
      activeRuleId: ruleId,
      activeRuleEvaluationStartedAt: new Date("2026-07-21T12:00:00.000Z"),
      nextSubjectCursor: "00000000-0000-4000-8000-000000000100",
    };
    const state = createStateHarness(initial);
    const runRule = vi.fn(async () => {
      throw new Error("email enqueue failed");
    });

    await expect(runScheduledAutomations({
      prisma: createPrisma([]),
      stateStore: state.stateStore,
      getTenancyById: async (id) => createTenancy(id),
      runRule,
    })).rejects.toThrow("email enqueue failed");

    expect(runRule).toHaveBeenCalledWith(expect.objectContaining({
      cursor: initial.nextSubjectCursor,
    }));
    expect(state.getCheckpoint()).toEqual(initial);
    expect(state.release).toHaveBeenCalledOnce();
  });

  it("propagates discovery database failures without changing the checkpoint", async () => {
    const state = createStateHarness();
    const prisma = {
      ...createPrisma([]),
      tenancy: {
        findMany: vi.fn(async () => {
          throw new Error("database unavailable");
        }),
      },
    };

    await expect(runScheduledAutomations({
      prisma,
      stateStore: state.stateStore,
    })).rejects.toThrow("database unavailable");

    expect(state.getCheckpoint()).toEqual(emptyCheckpoint());
    expect(state.release).toHaveBeenCalledOnce();
  });

  it("advances a deleted tenancy without executing a rule", async () => {
    const state = createStateHarness();
    const tenancyId = "00000000-0000-4000-8000-000000000010";
    const runRule = vi.fn(async () => createRunResult(null));

    await expect(runScheduledAutomations({
      prisma: createPrisma([tenancyId]),
      stateStore: state.stateStore,
      getTenancyById: async () => null,
      runRule,
      maxTenancies: 1,
    })).resolves.toMatchObject({
      tenanciesScanned: 1,
      cycleCompleted: false,
    });

    expect(state.getCheckpoint()).toEqual({
      completedTenancyCursor: tenancyId,
      activeTenancyId: null,
      completedRuleCursor: null,
      activeRuleId: null,
      activeRuleEvaluationStartedAt: null,
      nextSubjectCursor: null,
    });
    expect(runRule).not.toHaveBeenCalled();
  });

  it("completes rule and tenancy boundaries without resetting the full cycle", async () => {
    const state = createStateHarness();
    const tenancyId = "00000000-0000-4000-8000-000000000010";

    const first = await runScheduledAutomations({
      prisma: createPrisma([tenancyId]),
      stateStore: state.stateStore,
      getTenancyById: async (id) => createTenancy(id),
      runRule: async () => createRunResult(null),
      maxPages: 1,
    });
    expect(first.cycleCompleted).toBe(false);
    expect(state.getCheckpoint()).toEqual({
      completedTenancyCursor: null,
      activeTenancyId: tenancyId,
      completedRuleCursor: ruleId,
      activeRuleId: null,
      activeRuleEvaluationStartedAt: null,
      nextSubjectCursor: null,
    });

    const second = await runScheduledAutomations({
      prisma: createPrisma([tenancyId]),
      stateStore: state.stateStore,
      getTenancyById: async (id) => createTenancy(id),
      runRule: async () => createRunResult(null),
    });
    expect(second.cycleCompleted).toBe(true);
    expect(state.getCheckpoint()).toEqual(emptyCheckpoint());
  });

  it("continues after a full discovery page and resets only at the actual end", async () => {
    const tenancyIds = Array.from({ length: 501 }, (_, index) => (
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    ));
    const state = createStateHarness();
    const prisma = createPrisma(tenancyIds);

    const first = await runScheduledAutomations({
      prisma,
      stateStore: state.stateStore,
      getTenancyById: async (id) => createTenancy(id, {}),
      runRule: async () => createRunResult(null),
      maxTenancies: 500,
    });
    expect(first).toMatchObject({ tenanciesScanned: 500, cycleCompleted: false });
    expect(state.getCheckpoint().completedTenancyCursor).toBe(tenancyIds[499]);

    const second = await runScheduledAutomations({
      prisma,
      stateStore: state.stateStore,
      getTenancyById: async (id) => createTenancy(id, {}),
      runRule: async () => createRunResult(null),
      maxTenancies: 500,
    });
    expect(second).toMatchObject({ tenanciesScanned: 1, cycleCompleted: true });
    expect(state.getCheckpoint()).toEqual(emptyCheckpoint());
  });

  it("reports malformed rules, advances them, and runs the next valid rule", async () => {
    captureErrorMock.mockClear();
    const state = createStateHarness();
    const validRuleId = "valid-rule";
    const runRule = vi.fn(async () => createRunResult(null, { ruleId: validRuleId }));

    await runScheduledAutomations({
      prisma: createPrisma(["00000000-0000-4000-8000-000000000010"]),
      stateStore: state.stateStore,
      getTenancyById: async (id) => createTenancy(id, {
        "invalid-rule": createRule({ sourceType: "client-push-quota" }),
        [validRuleId]: createRule(),
      }),
      runRule,
      maxPages: 1,
    });

    expect(captureErrorMock).toHaveBeenCalledWith("automation-scheduler-invalid-rule", expect.any(Error));
    expect(runRule).toHaveBeenCalledWith(expect.objectContaining({ ruleId: validRuleId }));
  });

  it("advances a deterministic runtime rule failure and runs the next valid rule", async () => {
    captureErrorMock.mockClear();
    const state = createStateHarness();
    const validRuleId = "valid-rule";
    const runRule = vi.fn(async (options: { ruleId: string }) => {
      if (options.ruleId === "bad-rule") {
        throw new NonRetryableAutomationRuleError("missing-template", "Configured template no longer exists.");
      }
      return createRunResult(null, { ruleId: options.ruleId });
    });

    await runScheduledAutomations({
      prisma: createPrisma(["00000000-0000-4000-8000-000000000010"]),
      stateStore: state.stateStore,
      getTenancyById: async (id) => createTenancy(id, {
        "bad-rule": createRule(),
        [validRuleId]: createRule(),
      }),
      runRule,
      maxPages: 1,
    });

    expect(captureErrorMock).toHaveBeenCalledWith("automation-scheduler-non-retryable-rule", expect.any(Error));
    expect(runRule).toHaveBeenNthCalledWith(1, expect.objectContaining({ ruleId: "bad-rule" }));
    expect(runRule).toHaveBeenNthCalledWith(2, expect.objectContaining({ ruleId: validRuleId }));
    expect(state.getCheckpoint()).toMatchObject({
      activeTenancyId: "00000000-0000-4000-8000-000000000010",
      completedRuleCursor: validRuleId,
      activeRuleId: null,
      nextSubjectCursor: null,
    });
  });

  it("skips disabled rules without executing them", async () => {
    const state = createStateHarness();
    const runRule = vi.fn(async () => createRunResult(null));

    await runScheduledAutomations({
      prisma: createPrisma(["00000000-0000-4000-8000-000000000010"]),
      stateStore: state.stateStore,
      getTenancyById: async (id) => createTenancy(id, { [ruleId]: createRule({ enabled: false }) }),
      runRule,
    });

    expect(runRule).not.toHaveBeenCalled();
  });

  it("skips a configured rule that is not due and continues to the next rule", async () => {
    const tenancyId = "00000000-0000-4000-8000-000000000010";
    const state = createStateHarness();
    const scheduleStates = new Map([
      [`${tenancyId}:hourly-rule`, new Date("2026-07-21T12:00:00.000Z")],
    ]);
    const runRule = vi.fn(async (options: { ruleId: string }) => createRunResult(null, { ruleId: options.ruleId }));

    await expect(runScheduledAutomations({
      prisma: createPrisma([tenancyId], { scheduleStates }),
      stateStore: state.stateStore,
      getTenancyById: async (id) => createTenancy(id, {
        "hourly-rule": createRule({ cadence: "hourly" }),
        "later-rule": createRule(),
      }),
      runRule,
      now: () => new Date("2026-07-21T12:30:00.000Z"),
      maxPages: 1,
    })).resolves.toMatchObject({
      rulesProcessed: 2,
      rulesSkippedNotDue: 1,
      pagesProcessed: 1,
    });

    expect(runRule).toHaveBeenCalledOnce();
    expect(runRule).toHaveBeenCalledWith(expect.objectContaining({ ruleId: "later-rule" }));
  });

  it("allows a genuinely due deferred decision to override cadence", async () => {
    const tenancyId = "00000000-0000-4000-8000-000000000010";
    const state = createStateHarness();
    const prisma = createPrisma([tenancyId], {
      scheduleStates: new Map([
        [`${tenancyId}:${ruleId}`, new Date("2026-07-21T12:00:00.000Z")],
      ]),
      dueDeferredRuleIds: new Set([ruleId]),
    });
    const runRule = vi.fn(async () => createRunResult(null));

    await expect(runScheduledAutomations({
      prisma,
      stateStore: state.stateStore,
      getTenancyById: async (id) => createTenancy(id, { [ruleId]: createRule({ cadence: "hourly" }) }),
      runRule,
      now: () => new Date("2026-07-21T12:30:00.000Z"),
      maxPages: 1,
    })).resolves.toMatchObject({
      deferredRetryWakeups: 1,
      pagesProcessed: 1,
    });
    expect(runRule).toHaveBeenCalledOnce();
  });

  it("finishes an over-cadence active traversal without rerunning it or blocking later rules", async () => {
    const tenancyId = "00000000-0000-4000-8000-000000000010";
    const firstRuleId = "first-hourly-rule";
    const secondRuleId = "second-rule";
    const evaluationStartedAt = new Date("2026-07-21T10:00:00.000Z");
    const state = createStateHarness({
      completedTenancyCursor: null,
      activeTenancyId: tenancyId,
      completedRuleCursor: null,
      activeRuleId: firstRuleId,
      activeRuleEvaluationStartedAt: evaluationStartedAt,
      nextSubjectCursor: "00000000-0000-4000-8000-000000000100",
    });
    const runRule = vi.fn(async (options: { ruleId: string }) => createRunResult(null, { ruleId: options.ruleId }));
    const prisma = createPrisma([]);

    await expect(runScheduledAutomations({
      prisma,
      stateStore: state.stateStore,
      getTenancyById: async (id) => createTenancy(id, {
        [firstRuleId]: createRule({ cadence: "hourly" }),
        [secondRuleId]: createRule(),
      }),
      runRule,
      now: () => new Date("2026-07-21T12:00:00.000Z"),
      maxPages: 2,
    })).resolves.toMatchObject({
      pagesProcessed: 2,
      rulesProcessed: 2,
    });

    expect(runRule.mock.calls.map(([options]) => options.ruleId)).toEqual([firstRuleId, secondRuleId]);
    expect(prisma.automationRuleScheduleState.findUnique).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { tenancyId_ruleId: { tenancyId, ruleId: firstRuleId } },
    }));
    expect(state.completeRuleEvaluation).toHaveBeenNthCalledWith(1, expect.objectContaining({
      ruleId: firstRuleId,
      evaluationStartedAt,
    }));
    expect(state.getCheckpoint()).toMatchObject({
      completedRuleCursor: secondRuleId,
      activeRuleId: null,
      activeRuleEvaluationStartedAt: null,
    });
  });
});
