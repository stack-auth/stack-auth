import {
  automationCadenceDurationsMs,
  type AutomationCadence,
  type AutomationRuleConfig,
  NonRetryableAutomationRuleError,
} from "./rules";

export type AutomationRuleScheduleReaderPrisma = {
  automationRuleScheduleState: {
    findUnique: (options: {
      where: {
        tenancyId_ruleId: {
          tenancyId: string,
          ruleId: string,
        },
      },
      select: {
        lastCompletedEvaluationStartedAt: true,
      },
    }) => Promise<{ lastCompletedEvaluationStartedAt: Date } | null>,
  },
  automationRuleExecutionState: {
    findFirst: (options: {
      where: {
        tenancyId: string,
        ruleId: string,
        lastActionAt: null,
        nextRetryAt: {
          not: null,
          lte: Date,
          gt: Date,
        },
      },
      select: { signalKey: true },
    }) => Promise<{ signalKey: string } | null>,
  },
};

export type AutomationRuleScheduleEligibility = {
  due: boolean,
  reason: "default" | "never-completed" | "cadence" | "deferred-retry" | "not-due",
};

export function getAutomationRuleCadence(ruleId: string, rule: AutomationRuleConfig): AutomationCadence | undefined {
  const cadence = rule.schedule?.cadence;
  if (cadence === undefined) return undefined;
  if (!isAutomationCadence(cadence)) {
    throw new NonRetryableAutomationRuleError("unsupported-rule", `Automation rule "${ruleId}" has unsupported schedule.cadence "${cadence}".`);
  }
  return cadence;
}

export async function getAutomationRuleScheduleEligibility(options: {
  prisma: AutomationRuleScheduleReaderPrisma,
  tenancyId: string,
  ruleId: string,
  cadence: AutomationCadence | undefined,
  now: Date,
}): Promise<AutomationRuleScheduleEligibility> {
  if (options.cadence === undefined) {
    return { due: true, reason: "default" };
  }

  const scheduleState = await options.prisma.automationRuleScheduleState.findUnique({
    where: {
      tenancyId_ruleId: {
        tenancyId: options.tenancyId,
        ruleId: options.ruleId,
      },
    },
    select: {
      lastCompletedEvaluationStartedAt: true,
    },
  });
  if (scheduleState === null) {
    return { due: true, reason: "never-completed" };
  }

  const cadenceDurationMs = automationCadenceDurationsMs[options.cadence];
  const nextCadenceAt = new Date(scheduleState.lastCompletedEvaluationStartedAt.getTime() + cadenceDurationMs);
  if (options.now.getTime() >= nextCadenceAt.getTime()) {
    return { due: true, reason: "cadence" };
  }

  // A completed traversal covers deferred rows that were already due when it began. Rows
  // deferred during that traversal have a later retry timestamp and can wake the rule early.
  const dueDeferredState = await options.prisma.automationRuleExecutionState.findFirst({
    where: {
      tenancyId: options.tenancyId,
      ruleId: options.ruleId,
      lastActionAt: null,
      nextRetryAt: {
        not: null,
        lte: options.now,
        gt: scheduleState.lastCompletedEvaluationStartedAt,
      },
    },
    select: { signalKey: true },
  });
  return dueDeferredState === null
    ? { due: false, reason: "not-due" }
    : { due: true, reason: "deferred-retry" };
}

function isAutomationCadence(value: string): value is AutomationCadence {
  return value === "every-15-minutes"
    || value === "hourly"
    || value === "every-6-hours"
    || value === "daily";
}
