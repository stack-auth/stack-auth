import { describe, expect, it, vi } from "vitest";
import { getAutomationRuleCadence, getAutomationRuleScheduleEligibility } from "./rule-schedule";
import { assertSupportedAutomationRule, type AutomationCadence } from "./rules";

const cadenceBoundaryCases: [AutomationCadence, number][] = [
  ["every-15-minutes", 15 * 60 * 1000],
  ["hourly", 60 * 60 * 1000],
  ["every-6-hours", 6 * 60 * 60 * 1000],
  ["daily", 24 * 60 * 60 * 1000],
];

function createRule(cadence?: string) {
  return {
    enabled: true,
    source: {
      type: "payments-item-quota",
      itemId: "credits",
      customerType: "user",
      thresholds: { nearRemainingQuantity: 10 },
    },
    action: {
      type: "send-email",
      templateId: "00000000-0000-4000-8000-000000000001",
    },
    cooldown: { days: 7 },
    ...(cadence === undefined ? {} : { schedule: { cadence } }),
  };
}

function createPrisma(options: {
  lastCompletedEvaluationStartedAt?: Date,
  dueDeferred?: boolean,
} = {}) {
  return {
    automationRuleScheduleState: {
      findUnique: vi.fn(async () => options.lastCompletedEvaluationStartedAt === undefined
        ? null
        : { lastCompletedEvaluationStartedAt: options.lastCompletedEvaluationStartedAt }),
    },
    automationRuleExecutionState: {
      findFirst: vi.fn(async () => options.dueDeferred ? { signalKey: "credits:near" } : null),
    },
  };
}

describe("automation rule cadence", () => {
  it("accepts the bounded cadence set and preserves missing cadence as the default", () => {
    expect(getAutomationRuleCadence("rule", createRule())).toBeUndefined();
    expect(getAutomationRuleCadence("rule", createRule("every-15-minutes"))).toBe("every-15-minutes");
    expect(getAutomationRuleCadence("rule", createRule("hourly"))).toBe("hourly");
    expect(getAutomationRuleCadence("rule", createRule("every-6-hours"))).toBe("every-6-hours");
    expect(getAutomationRuleCadence("rule", createRule("daily"))).toBe("daily");
    expect(() => getAutomationRuleCadence("rule", createRule("every-minute")))
      .toThrow('Automation rule "rule" has unsupported schedule.cadence "every-minute".');
  });

  it("keeps cadence outside the shared manual and dry-run support assertion", () => {
    expect(() => assertSupportedAutomationRule("rule", createRule("every-minute"))).not.toThrow();
    expect(() => getAutomationRuleCadence("rule", createRule("every-minute"))).toThrow();
  });

  it("does not read schedule state for the default cadence", async () => {
    const prisma = createPrisma();
    await expect(getAutomationRuleScheduleEligibility({
      prisma,
      tenancyId: "00000000-0000-4000-8000-000000000001",
      ruleId: "rule",
      cadence: undefined,
      now: new Date("2026-07-21T12:00:00.000Z"),
    })).resolves.toEqual({ due: true, reason: "default" });
    expect(prisma.automationRuleScheduleState.findUnique).not.toHaveBeenCalled();
    expect(prisma.automationRuleExecutionState.findFirst).not.toHaveBeenCalled();
  });

  it("treats a configured rule with no completed evaluation as due", async () => {
    const prisma = createPrisma();
    await expect(getAutomationRuleScheduleEligibility({
      prisma,
      tenancyId: "00000000-0000-4000-8000-000000000001",
      ruleId: "rule",
      cadence: "hourly",
      now: new Date("2026-07-21T12:00:00.000Z"),
    })).resolves.toEqual({ due: true, reason: "never-completed" });
    expect(prisma.automationRuleExecutionState.findFirst).not.toHaveBeenCalled();
  });

  it.each(cadenceBoundaryCases)("uses start-to-start boundaries for %s", async (cadence, durationMs) => {
    const startedAt = new Date("2026-07-21T00:00:00.000Z");
    const before = createPrisma({ lastCompletedEvaluationStartedAt: startedAt });
    await expect(getAutomationRuleScheduleEligibility({
      prisma: before,
      tenancyId: "00000000-0000-4000-8000-000000000001",
      ruleId: "rule",
      cadence,
      now: new Date(startedAt.getTime() + durationMs - 1),
    })).resolves.toEqual({ due: false, reason: "not-due" });

    const boundary = createPrisma({ lastCompletedEvaluationStartedAt: startedAt });
    await expect(getAutomationRuleScheduleEligibility({
      prisma: boundary,
      tenancyId: "00000000-0000-4000-8000-000000000001",
      ruleId: "rule",
      cadence,
      now: new Date(startedAt.getTime() + durationMs),
    })).resolves.toEqual({ due: true, reason: "cadence" });
    expect(boundary.automationRuleExecutionState.findFirst).not.toHaveBeenCalled();
  });

  it("requires a genuinely deferred row for the cadence override", async () => {
    const startedAt = new Date("2026-07-21T12:00:00.000Z");
    const now = new Date("2026-07-21T12:30:00.000Z");
    const prisma = createPrisma({
      lastCompletedEvaluationStartedAt: startedAt,
      dueDeferred: true,
    });

    await expect(getAutomationRuleScheduleEligibility({
      prisma,
      tenancyId: "00000000-0000-4000-8000-000000000001",
      ruleId: "rule",
      cadence: "hourly",
      now,
    })).resolves.toEqual({ due: true, reason: "deferred-retry" });
    expect(prisma.automationRuleExecutionState.findFirst).toHaveBeenCalledWith({
      where: {
        tenancyId: "00000000-0000-4000-8000-000000000001",
        ruleId: "rule",
        lastActionAt: null,
        nextRetryAt: {
          not: null,
          lte: now,
          gt: startedAt,
        },
      },
      select: { signalKey: true },
    });
  });
});
