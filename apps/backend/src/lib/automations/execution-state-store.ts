import { Prisma } from "@/generated/prisma/client";
import { getAutomationCooldownStatus, type AutomationCooldownStatus } from "./cooldown";
import { AutomationRuleExecutionStateStore } from "./run-route";
import { AutomationJson } from "./rules";

type AutomationRuleExecutionStateKey = {
  tenancyId: string,
  ruleId: string,
  subjectType: "user",
  subjectId: string,
  signalKey: string,
};

export type AutomationRuleExecutionStatePrisma = {
  automationRuleExecutionState: {
    create: (options: {
      data: AutomationRuleExecutionStateKey & {
        sourceType: string,
        actionType: string,
        lastTriggeredAt: Date,
        lastActionAt: Date | null,
        lastEmailOutboxId: string | null,
        lastSourceSnapshot: Prisma.InputJsonObject,
      },
    }) => Promise<unknown>,
    findUnique: (options: {
      where: {
        tenancyId_ruleId_subjectType_subjectId_signalKey: AutomationRuleExecutionStateKey,
      },
      select: {
        lastTriggeredAt: true,
        lastActionAt: true,
      },
    }) => Promise<{ lastTriggeredAt: Date, lastActionAt: Date | null } | null>,
    updateMany: (options: {
      where: AutomationRuleExecutionStateKey & {
        OR: Array<
          | {
            lastActionAt: null,
            lastTriggeredAt: { lt: Date },
          }
          | { lastActionAt: { lt: Date } }
        >,
      },
      data: {
        sourceType: string,
        actionType: string,
        lastTriggeredAt: Date,
        lastActionAt: Date | null,
        lastSourceSnapshot: Prisma.InputJsonObject,
      },
    }) => Promise<{ count: number }>,
    update: (options: {
      where: {
        tenancyId_ruleId_subjectType_subjectId_signalKey: AutomationRuleExecutionStateKey,
      },
      data: {
        lastActionAt: Date,
        lastEmailOutboxId: string | null,
      },
    }) => Promise<unknown>,
  },
};

export type AutomationRuleExecutionStateReaderPrisma = {
  automationRuleExecutionState: {
    findUnique: (options: {
      where: {
        tenancyId_ruleId_subjectType_subjectId_signalKey: AutomationRuleExecutionStateKey,
      },
      select: {
        lastActionAt: true,
      },
    }) => Promise<{ lastActionAt: Date | null } | null>,
  },
};

export type AutomationRuleExecutionStateReader = {
  getCooldownStatus: (options: AutomationRuleExecutionStateKey & {
    cooldownDays: number,
    now: Date,
  }) => Promise<AutomationCooldownStatus>,
};

export function createPrismaAutomationRuleExecutionStateReader(prisma: AutomationRuleExecutionStateReaderPrisma): AutomationRuleExecutionStateReader {
  return {
    async getCooldownStatus(options) {
      const state = await prisma.automationRuleExecutionState.findUnique({
        where: {
          tenancyId_ruleId_subjectType_subjectId_signalKey: getAutomationRuleExecutionStateKey(options),
        },
        select: {
          lastActionAt: true,
        },
      });

      return getAutomationCooldownStatus({
        lastActionAt: state?.lastActionAt,
        cooldownDays: options.cooldownDays,
        now: options.now,
      });
    },
  };
}

export function createPrismaAutomationRuleExecutionStateStore(prisma: AutomationRuleExecutionStatePrisma): AutomationRuleExecutionStateStore {
  return {
    async claimExecution(options) {
      const cooldownCutoff = new Date(options.lastTriggeredAt.getTime() - options.cooldownDays * 24 * 60 * 60 * 1000);
      // A row with lastActionAt=null means another run has claimed this signal but has not
      // finished enqueueing email yet. Treat recent claims as in-flight idempotency locks.
      const staleClaimCutoff = new Date(options.lastTriggeredAt.getTime() - 15 * 60 * 1000);
      const stateKey = getAutomationRuleExecutionStateKey(options);
      const lastSourceSnapshot = getPrismaJsonObject(options.sourceSnapshot);

      try {
        await prisma.automationRuleExecutionState.create({
          data: {
            tenancyId: options.tenancyId,
            ruleId: options.ruleId,
            sourceType: options.sourceType,
            actionType: options.actionType,
            subjectType: options.subjectType,
            subjectId: options.subjectId,
            signalKey: options.signalKey,
            lastTriggeredAt: options.lastTriggeredAt,
            lastActionAt: null,
            lastEmailOutboxId: null,
            lastSourceSnapshot,
          },
        });

        return {
          claimed: true,
          lastActionAt: null,
        };
      } catch (error) {
        if (!isPrismaUniqueConstraintError(error)) {
          throw error;
        }
      }

      const existing = await prisma.automationRuleExecutionState.findUnique({
        where: {
          tenancyId_ruleId_subjectType_subjectId_signalKey: stateKey,
        },
        select: {
          lastTriggeredAt: true,
          lastActionAt: true,
        },
      });
      if (existing === null) {
        throw new Error("Automation rule execution state disappeared after a unique constraint conflict.");
      }

      const updateResult = await prisma.automationRuleExecutionState.updateMany({
        where: {
          tenancyId: options.tenancyId,
          ruleId: options.ruleId,
          subjectType: options.subjectType,
          subjectId: options.subjectId,
          signalKey: options.signalKey,
          OR: [
            {
              lastActionAt: null,
              lastTriggeredAt: {
                lt: staleClaimCutoff,
              },
            },
            {
              lastActionAt: {
                lt: cooldownCutoff,
              },
            },
          ],
        },
        data: {
          sourceType: options.sourceType,
          actionType: options.actionType,
          lastTriggeredAt: options.lastTriggeredAt,
          lastActionAt: null,
          lastSourceSnapshot,
        },
      });
      if (updateResult.count === 1) {
        return {
          claimed: true,
          lastActionAt: existing.lastActionAt,
        };
      }
      if (updateResult.count !== 0) {
        throw new Error(`Expected at most one automation execution claim row to update, received ${updateResult.count}.`);
      }

      const current = await prisma.automationRuleExecutionState.findUnique({
        where: {
          tenancyId_ruleId_subjectType_subjectId_signalKey: stateKey,
        },
        select: {
          lastTriggeredAt: true,
          lastActionAt: true,
        },
      });
      if (current === null) {
        throw new Error("Automation rule execution state disappeared while evaluating cooldown.");
      }

      return {
        claimed: false,
        lastActionAt: current.lastActionAt,
      };
    },
    async markActionCompleted(options) {
      await prisma.automationRuleExecutionState.update({
        where: {
          tenancyId_ruleId_subjectType_subjectId_signalKey: getAutomationRuleExecutionStateKey(options),
        },
        data: {
          lastActionAt: options.lastActionAt,
          lastEmailOutboxId: options.lastEmailOutboxId,
        },
      });
    },
  };
}

function getAutomationRuleExecutionStateKey(options: AutomationRuleExecutionStateKey) {
  return {
    tenancyId: options.tenancyId,
    ruleId: options.ruleId,
    subjectType: options.subjectType,
    subjectId: options.subjectId,
    signalKey: options.signalKey,
  };
}

function getPrismaJsonObject(sourceSnapshot: Record<string, AutomationJson>): Prisma.InputJsonObject {
  return sourceSnapshot;
}

function isPrismaUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
