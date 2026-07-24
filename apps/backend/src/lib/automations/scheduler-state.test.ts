import { afterEach, describe, expect, it, vi } from "vitest";
import {
  automationSchedulerStateKey,
  createPrismaAutomationSchedulerStateStore,
  type AutomationSchedulerCheckpoint,
} from "./scheduler-state";

const emptyCheckpoint: AutomationSchedulerCheckpoint = {
  completedTenancyCursor: null,
  activeTenancyId: null,
  completedRuleCursor: null,
  activeRuleId: null,
  activeRuleEvaluationStartedAt: null,
  nextSubjectCursor: null,
};

function createFakePrisma(options: {
  missing?: boolean,
  checkpoint?: Partial<AutomationSchedulerCheckpoint>,
} = {}) {
  const scheduleStates = new Map<string, Date>();
  let state = options.missing ? null : {
    key: automationSchedulerStateKey,
    ...emptyCheckpoint,
    ...options.checkpoint,
    leaseOwner: null as string | null,
    leaseExpiresAt: null as Date | null,
  };

  const matchesWhere = (where: any) => {
    const currentState = state;
    if (currentState === null || where.key !== currentState.key) return false;
    if (where.leaseOwner !== undefined && where.leaseOwner !== currentState.leaseOwner) return false;
    if (where.leaseExpiresAt?.gt !== undefined && !(currentState.leaseExpiresAt !== null && currentState.leaseExpiresAt > where.leaseExpiresAt.gt)) return false;
    if (where.OR !== undefined) {
      return where.OR.some((condition: any) => {
        if (condition.leaseOwner === null) return currentState.leaseOwner === null;
        if (condition.leaseExpiresAt?.lte !== undefined) {
          return currentState.leaseExpiresAt !== null && currentState.leaseExpiresAt <= condition.leaseExpiresAt.lte;
        }
        return false;
      });
    }
    return true;
  };

  const prisma = {
    automationSchedulerState: {
      async updateMany({ where, data }: any) {
        if (!matchesWhere(where)) return { count: 0 };
        state = { ...state!, ...data };
        return { count: 1 };
      },
      async findUnique() {
        return state === null ? null : { ...state };
      },
    },
    automationRuleScheduleState: {
      async upsert({ where, create, update }: any) {
        const key = `${where.tenancyId_ruleId.tenancyId}:${where.tenancyId_ruleId.ruleId}`;
        scheduleStates.set(key, scheduleStates.has(key)
          ? update.lastCompletedEvaluationStartedAt
          : create.lastCompletedEvaluationStartedAt);
        return {};
      },
    },
    async $transaction(callback: (tx: unknown) => Promise<unknown>) {
      const stateBeforeTransaction = state === null ? null : { ...state };
      const scheduleStatesBeforeTransaction = new Map(scheduleStates);
      try {
        return await callback(prisma);
      } catch (error) {
        state = stateBeforeTransaction;
        scheduleStates.clear();
        for (const [key, value] of scheduleStatesBeforeTransaction) {
          scheduleStates.set(key, value);
        }
        throw error;
      }
    },
  };

  return {
    prisma: prisma as any,
    getState: () => state,
    getScheduleState: (tenancyId: string, ruleId: string) => scheduleStates.get(`${tenancyId}:${ruleId}`),
  };
}

function createClock(initial: string) {
  let current = new Date(initial);
  return {
    now: () => new Date(current),
    advance: (milliseconds: number) => {
      current = new Date(current.getTime() + milliseconds);
    },
  };
}

describe("Prisma automation scheduler state store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows only one concurrent lease acquisition", async () => {
    const fake = createFakePrisma();
    const clock = createClock("2026-07-17T12:00:00.000Z");
    let ownerSequence = 0;
    const store = createPrismaAutomationSchedulerStateStore({
      prisma: fake.prisma,
      now: clock.now,
      ownerId: () => `00000000-0000-4000-8000-${String(++ownerSequence).padStart(12, "0")}`,
    });

    const [first, second] = await Promise.all([store.acquire(), store.acquire()]);

    expect([first, second].filter((lease) => lease !== null)).toHaveLength(1);
    expect([first, second].filter((lease) => lease === null)).toHaveLength(1);
  });

  it("reclaims an expired lease and fences the stale owner", async () => {
    const fake = createFakePrisma();
    const clock = createClock("2026-07-17T12:00:00.000Z");
    const firstStore = createPrismaAutomationSchedulerStateStore({
      prisma: fake.prisma,
      now: clock.now,
      ownerId: () => "00000000-0000-4000-8000-000000000001",
      leaseDurationMs: 1_000,
      renewalThresholdMs: 250,
    });
    const firstLease = await firstStore.acquire() ?? undefined;
    expect(firstLease).toBeDefined();

    clock.advance(1_001);
    const secondStore = createPrismaAutomationSchedulerStateStore({
      prisma: fake.prisma,
      now: clock.now,
      ownerId: () => "00000000-0000-4000-8000-000000000002",
      leaseDurationMs: 1_000,
      renewalThresholdMs: 250,
    });
    const secondLease = await secondStore.acquire() ?? undefined;
    expect(secondLease?.ownerId).toBe("00000000-0000-4000-8000-000000000002");

    await expect(firstLease!.saveCheckpoint({
      ...emptyCheckpoint,
      activeTenancyId: "00000000-0000-4000-8000-000000000010",
    })).rejects.toThrow("lease was lost or expired");
    await expect(firstLease!.completeRuleEvaluation({
      checkpoint: emptyCheckpoint,
      tenancyId: "00000000-0000-4000-8000-000000000010",
      ruleId: "usage-upgrade",
      evaluationStartedAt: new Date("2026-07-17T12:00:00.000Z"),
    })).rejects.toThrow("lease was lost or expired");
    await expect(firstLease!.renewIfNeeded()).rejects.toThrow("lease was lost or expired");
    await expect(firstLease!.release()).rejects.toThrow("lease was lost or expired");

    await secondLease!.saveCheckpoint({
      ...emptyCheckpoint,
      activeTenancyId: "00000000-0000-4000-8000-000000000020",
    });
    expect(fake.getState()?.activeTenancyId).toBe("00000000-0000-4000-8000-000000000020");
    await secondLease!.release();
    expect(fake.getState()?.leaseOwner).toBeNull();
  });

  it("renews with injected duration values when the threshold is reached", async () => {
    const fake = createFakePrisma();
    const clock = createClock("2026-07-17T12:00:00.000Z");
    const lease = await createPrismaAutomationSchedulerStateStore({
      prisma: fake.prisma,
      now: clock.now,
      ownerId: () => "00000000-0000-4000-8000-000000000001",
      leaseDurationMs: 120_000,
      renewalThresholdMs: 30_000,
    }).acquire();

    clock.advance(89_999);
    await lease!.renewIfNeeded();
    expect(fake.getState()?.leaseExpiresAt).toEqual(new Date("2026-07-17T12:02:00.000Z"));

    clock.advance(2);
    await lease!.renewIfNeeded();
    expect(fake.getState()?.leaseExpiresAt).toEqual(new Date("2026-07-17T12:03:30.001Z"));
  });

  it("fails loudly when the migration-seeded singleton is missing", async () => {
    const fake = createFakePrisma({ missing: true });
    const store = createPrismaAutomationSchedulerStateStore({
      prisma: fake.prisma,
      ownerId: () => "00000000-0000-4000-8000-000000000001",
    });

    await expect(store.acquire()).rejects.toThrow("Apply the scheduler-state migration");
  });

  it("rejects checkpoints whose active rule and evaluation start are not paired", async () => {
    const fake = createFakePrisma();
    const lease = await createPrismaAutomationSchedulerStateStore({
      prisma: fake.prisma,
      ownerId: () => "00000000-0000-4000-8000-000000000001",
    }).acquire();

    await expect(lease!.saveCheckpoint({
      ...emptyCheckpoint,
      activeRuleId: "usage-upgrade",
    })).rejects.toThrow("activeRuleId and activeRuleEvaluationStartedAt together");
    await expect(lease!.saveCheckpoint({
      ...emptyCheckpoint,
      activeRuleEvaluationStartedAt: new Date("2026-07-21T12:00:00.000Z"),
    })).rejects.toThrow("activeRuleId and activeRuleEvaluationStartedAt together");
  });

  it("fails acquisition when persisted active rule checkpoint fields are not paired", async () => {
    const fake = createFakePrisma({
      checkpoint: { activeRuleId: "usage-upgrade" },
    });
    const store = createPrismaAutomationSchedulerStateStore({
      prisma: fake.prisma,
      ownerId: () => "00000000-0000-4000-8000-000000000001",
    });

    await expect(store.acquire()).rejects.toThrow("activeRuleId and activeRuleEvaluationStartedAt together");
  });

  it("completes cadence state with the checkpoint through the owned lease", async () => {
    const fake = createFakePrisma();
    const tenancyId = "00000000-0000-4000-8000-000000000010";
    const startedAt = new Date("2026-07-21T12:00:00.000Z");
    const lease = await createPrismaAutomationSchedulerStateStore({
      prisma: fake.prisma,
      ownerId: () => "00000000-0000-4000-8000-000000000001",
    }).acquire();

    await lease!.completeRuleEvaluation({
      checkpoint: {
        ...emptyCheckpoint,
        activeTenancyId: tenancyId,
        completedRuleCursor: "usage-upgrade",
      },
      tenancyId,
      ruleId: "usage-upgrade",
      evaluationStartedAt: startedAt,
    });

    expect(fake.getState()).toMatchObject({
      activeRuleId: null,
      activeRuleEvaluationStartedAt: null,
      completedRuleCursor: "usage-upgrade",
    });
    expect(fake.getScheduleState(tenancyId, "usage-upgrade")).toEqual(startedAt);
  });

  it("checks lease expiry against each transaction retry's start time", async () => {
    const fake = createFakePrisma();
    const startedAt = new Date("2026-07-21T12:00:00.000Z");
    const retryTimes = [
      startedAt,
      new Date(startedAt.getTime() + 500),
      new Date(startedAt.getTime() + 1_001),
    ];
    const now = vi.fn(() => retryTimes.shift() ?? new Date(startedAt.getTime() + 1_001));
    vi.spyOn(Math, "random").mockReturnValue(0);
    const lease = await createPrismaAutomationSchedulerStateStore({
      prisma: fake.prisma,
      now,
      ownerId: () => "00000000-0000-4000-8000-000000000001",
      leaseDurationMs: 1_000,
      renewalThresholdMs: 250,
    }).acquire();

    await expect(lease!.completeRuleEvaluation({
      checkpoint: emptyCheckpoint,
      tenancyId: "00000000-0000-4000-8000-000000000010",
      ruleId: "usage-upgrade",
      evaluationStartedAt: startedAt,
    })).rejects.toThrow("lease was lost or expired");

    expect(now).toHaveBeenCalledTimes(3);
    expect(fake.getScheduleState("00000000-0000-4000-8000-000000000010", "usage-upgrade")).toBeUndefined();
  });
});
