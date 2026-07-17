import { randomUUID } from "node:crypto";
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
        emailOutboxId: string,
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
        emailOutboxId: true,
      },
    }) => Promise<{ lastTriggeredAt: Date, lastActionAt: Date | null, emailOutboxId: string } | null>,
    updateMany: (options: {
      where: AutomationRuleExecutionStateKey & {
        lastActionAt: null | { lt: Date },
        lastTriggeredAt?: Date | { lt: Date },
        emailOutboxId?: string,
      },
      data: {
        sourceType?: string,
        actionType?: string,
        lastTriggeredAt?: Date,
        lastActionAt?: Date | null,
        emailOutboxId?: string,
        lastSourceSnapshot?: Prisma.InputJsonObject,
      },
    }) => Promise<{ count: number }>,
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

export function createPrismaAutomationRuleExecutionStateStore(
  prisma: AutomationRuleExecutionStatePrisma,
  options: { createEmailOutboxId?: () => string } = {},
): AutomationRuleExecutionStateStore {
  const createEmailOutboxId = options.createEmailOutboxId ?? randomUUID;
  return {
    async claimExecution(options) {
      const cooldownCutoff = new Date(options.lastTriggeredAt.getTime() - options.cooldownDays * 24 * 60 * 60 * 1000);
      // A row with lastActionAt=null means another run has claimed this signal but has not
      // finished enqueueing email yet. Treat recent claims as in-flight idempotency locks.
      const staleClaimCutoff = new Date(options.lastTriggeredAt.getTime() - 15 * 60 * 1000);
      const stateKey = getAutomationRuleExecutionStateKey(options);
      const lastSourceSnapshot = getPrismaJsonObject(options.sourceSnapshot);
      const initialEmailOutboxId = createEmailOutboxId();

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
            emailOutboxId: initialEmailOutboxId,
            lastSourceSnapshot,
          },
        });

        return {
          claimed: true,
          lastActionAt: null,
          emailOutboxId: initialEmailOutboxId,
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
          emailOutboxId: true,
        },
      });
      if (existing === null) {
        throw new Error("Automation rule execution state disappeared after a unique constraint conflict.");
      }

      // Stale in-flight retries must address the same outbox row; a completed cooldown cycle needs a new row.
      const emailOutboxId = existing.lastActionAt === null ? existing.emailOutboxId : createEmailOutboxId();
      const updateResult = await prisma.automationRuleExecutionState.updateMany({
        where: {
          tenancyId: options.tenancyId,
          ruleId: options.ruleId,
          subjectType: options.subjectType,
          subjectId: options.subjectId,
          signalKey: options.signalKey,
          lastActionAt: existing.lastActionAt === null ? null : { lt: cooldownCutoff },
          ...(existing.lastActionAt === null ? { lastTriggeredAt: { lt: staleClaimCutoff } } : {}),
        },
        data: {
          sourceType: options.sourceType,
          actionType: options.actionType,
          lastTriggeredAt: options.lastTriggeredAt,
          lastActionAt: null,
          emailOutboxId,
          lastSourceSnapshot,
        },
      });
      if (updateResult.count === 1) {
        return {
          claimed: true,
          lastActionAt: existing.lastActionAt,
          emailOutboxId,
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
          emailOutboxId: true,
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
      const stateKey = getAutomationRuleExecutionStateKey(options);
      const updateResult = await prisma.automationRuleExecutionState.updateMany({
        where: {
          ...stateKey,
          lastActionAt: null,
          lastTriggeredAt: options.claimTriggeredAt,
          emailOutboxId: options.emailOutboxId,
        },
        data: {
          lastActionAt: options.lastActionAt,
        },
      });
      if (updateResult.count === 1) {
        return;
      }
      if (updateResult.count !== 0) {
        throw new Error(`Expected at most one automation execution state row to complete, received ${updateResult.count}.`);
      }

      const current = await prisma.automationRuleExecutionState.findUnique({
        where: {
          tenancyId_ruleId_subjectType_subjectId_signalKey: stateKey,
        },
        select: {
          lastTriggeredAt: true,
          lastActionAt: true,
          emailOutboxId: true,
        },
      });
      if (
        current?.emailOutboxId === options.emailOutboxId
        && current.lastTriggeredAt.getTime() === options.claimTriggeredAt.getTime()
        && current.lastActionAt !== null
      ) {
        return;
      }
      throw new Error("Automation execution completion lost ownership of its reserved EmailOutbox row.");
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
