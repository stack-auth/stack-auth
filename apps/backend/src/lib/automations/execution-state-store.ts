import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getAutomationCooldownStatus } from "./cooldown";
import type { AutomationRuleExecutionStateStore } from "./run-route";
import type { AutomationJson } from "./rules";

export const automationActiveClaimStaleTimeoutMs = 15 * 60 * 1000;
export const automationDeferredDecisionRetryDelayMs = 15 * 60 * 1000;
export const automationExecutionStateReadBatchLimit = 1000;

// Claims move active -> completed after enqueue, or active -> deferred after a recoverable
// failure. Due deferred claims and stale active claims return to active with the same outbox ID;
// completed claims start a new active cooldown cycle with a new outbox ID.

type AutomationRuleExecutionStateKey = {
  tenancyId: string,
  ruleId: string,
  subjectType: "user",
  subjectId: string,
  signalKey: string,
};

export type AutomationRuleExecutionStateDecisionKey = Pick<
  AutomationRuleExecutionStateKey,
  "subjectType" | "subjectId" | "signalKey"
>;

export type AutomationRuleExecutionStatePrisma = {
  automationRuleExecutionState: {
    create: (options: {
      data: AutomationRuleExecutionStateKey & {
        sourceType: string,
        actionType: string,
        lastTriggeredAt: Date,
        lastActionAt: Date | null,
        nextRetryAt: Date | null,
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
        nextRetryAt: true,
        emailOutboxId: true,
      },
    }) => Promise<{ lastTriggeredAt: Date, lastActionAt: Date | null, nextRetryAt: Date | null, emailOutboxId: string } | null>,
    updateMany: (options: {
      where: AutomationRuleExecutionStateKey & {
        lastActionAt: null | { lt: Date },
        lastTriggeredAt?: Date | { lt: Date },
        nextRetryAt?: Date | null | { lte: Date },
        emailOutboxId?: string,
      },
      data: {
        sourceType?: string,
        actionType?: string,
        lastTriggeredAt?: Date,
        lastActionAt?: Date | null,
        nextRetryAt?: Date | null,
        emailOutboxId?: string,
        lastSourceSnapshot?: Prisma.InputJsonObject,
      },
    }) => Promise<{ count: number }>,
  },
};

export type AutomationRuleExecutionStateReaderPrisma = {
  automationRuleExecutionState: {
    findMany: (options: {
      where: {
        tenancyId: string,
        ruleId: string,
        OR: AutomationRuleExecutionStateDecisionKey[],
      },
      select: {
        subjectType: true,
        subjectId: true,
        signalKey: true,
        lastTriggeredAt: true,
        lastActionAt: true,
        nextRetryAt: true,
      },
    }) => Promise<Array<Omit<AutomationRuleExecutionStateDecisionKey, "subjectType"> & {
      subjectType: string,
      lastTriggeredAt: Date,
      lastActionAt: Date | null,
      nextRetryAt: Date | null,
    }>>,
  },
};

export type AutomationExecutionStatus =
  | { blocked: false }
  | {
    blocked: true,
    reason: "cooldown" | "in-flight" | "retry-backoff",
    lastActionAt?: Date,
    nextEligibleAt: Date,
  };

export type AutomationRuleExecutionStateReader = {
  getExecutionStatuses: (options: Pick<AutomationRuleExecutionStateKey, "tenancyId" | "ruleId"> & {
    keys: AutomationRuleExecutionStateDecisionKey[],
    cooldownDays: number,
    now: Date,
  }) => Promise<Map<string, AutomationExecutionStatus>>,
};

export function createPrismaAutomationRuleExecutionStateReader(prisma: AutomationRuleExecutionStateReaderPrisma): AutomationRuleExecutionStateReader {
  return {
    async getExecutionStatuses(options) {
      const uniqueKeys = new Map<string, AutomationRuleExecutionStateDecisionKey>();
      for (const key of options.keys) {
        uniqueKeys.set(getAutomationRuleExecutionStateLookupKey({
          tenancyId: options.tenancyId,
          ruleId: options.ruleId,
          ...key,
        }), key);
      }
      if (uniqueKeys.size > automationExecutionStateReadBatchLimit) {
        throw new Error(`Automation execution state batch exceeds the maximum of ${automationExecutionStateReadBatchLimit} unique decisions.`);
      }
      if (uniqueKeys.size === 0) {
        return new Map();
      }

      const states = await prisma.automationRuleExecutionState.findMany({
        where: {
          tenancyId: options.tenancyId,
          ruleId: options.ruleId,
          OR: [...uniqueKeys.values()],
        },
        select: {
          subjectType: true,
          subjectId: true,
          signalKey: true,
          lastTriggeredAt: true,
          lastActionAt: true,
          nextRetryAt: true,
        },
      });

      const stateByKey = new Map(states.map((state) => [getAutomationRuleExecutionStateLookupKey({
        tenancyId: options.tenancyId,
        ruleId: options.ruleId,
        subjectType: state.subjectType,
        subjectId: state.subjectId,
        signalKey: state.signalKey,
      }), state]));
      const statuses = new Map<string, AutomationExecutionStatus>();
      for (const [lookupKey] of uniqueKeys) {
        statuses.set(lookupKey, getAutomationExecutionStatus(
          stateByKey.get(lookupKey) ?? null,
          options.cooldownDays,
          options.now,
          automationActiveClaimStaleTimeoutMs,
        ));
      }
      return statuses;
    },
  };
}

export function getAutomationRuleExecutionStateLookupKey(options: Omit<AutomationRuleExecutionStateKey, "subjectType"> & {
  subjectType: string,
}) {
  return JSON.stringify([
    options.tenancyId,
    options.ruleId,
    options.subjectType,
    options.subjectId,
    options.signalKey,
  ]);
}

export function createPrismaAutomationRuleExecutionStateStore(
  prisma: AutomationRuleExecutionStatePrisma,
  options: {
    createEmailOutboxId?: () => string,
    activeClaimStaleTimeoutMs?: number,
    deferredDecisionRetryDelayMs?: number,
  } = {},
): AutomationRuleExecutionStateStore {
  const createEmailOutboxId = options.createEmailOutboxId ?? randomUUID;
  const activeClaimStaleTimeoutMs = options.activeClaimStaleTimeoutMs ?? automationActiveClaimStaleTimeoutMs;
  const deferredDecisionRetryDelayMs = options.deferredDecisionRetryDelayMs ?? automationDeferredDecisionRetryDelayMs;
  return {
    async claimExecution(options) {
      const cooldownCutoff = new Date(options.lastTriggeredAt.getTime() - options.cooldownDays * 24 * 60 * 60 * 1000);
      // A row with lastActionAt=null means another run has claimed this signal but has not
      // finished enqueueing email yet. Treat recent claims as in-flight idempotency locks.
      const staleClaimCutoff = new Date(options.lastTriggeredAt.getTime() - activeClaimStaleTimeoutMs);
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
            nextRetryAt: null,
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
          nextRetryAt: true,
          emailOutboxId: true,
        },
      });
      if (existing === null) {
        throw new Error("Automation rule execution state disappeared after a unique constraint conflict.");
      }

      // Deferred and stale-active retries reuse their outbox reservation. A completed cooldown
      // cycle is a new notification and therefore receives a new reservation.
      const emailOutboxId = existing.lastActionAt === null ? existing.emailOutboxId : createEmailOutboxId();
      const reclaimWhere = existing.lastActionAt !== null
        ? {
          lastActionAt: { lt: cooldownCutoff },
          nextRetryAt: null,
        }
        : existing.nextRetryAt !== null
          ? {
            lastActionAt: null,
            nextRetryAt: { lte: options.lastTriggeredAt },
            lastTriggeredAt: existing.lastTriggeredAt,
            emailOutboxId: existing.emailOutboxId,
          }
          : {
            lastActionAt: null,
            nextRetryAt: null,
            lastTriggeredAt: { lt: staleClaimCutoff },
            emailOutboxId: existing.emailOutboxId,
          };
      const updateResult = await prisma.automationRuleExecutionState.updateMany({
        where: {
          ...stateKey,
          ...reclaimWhere,
        },
        data: {
          sourceType: options.sourceType,
          actionType: options.actionType,
          lastTriggeredAt: options.lastTriggeredAt,
          lastActionAt: null,
          nextRetryAt: null,
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
          nextRetryAt: true,
          emailOutboxId: true,
        },
      });
      if (current === null) {
        throw new Error("Automation rule execution state disappeared while evaluating cooldown.");
      }

      const status = getAutomationExecutionStatus(current, options.cooldownDays, options.lastTriggeredAt, activeClaimStaleTimeoutMs);
      if (!status.blocked) {
        throw new Error("Automation execution state was eligible but could not be claimed.");
      }
      return {
        claimed: false,
        lastActionAt: current.lastActionAt,
        nextEligibleAt: status.nextEligibleAt,
        reason: status.reason,
      };
    },
    async markActionCompleted(options) {
      const stateKey = getAutomationRuleExecutionStateKey(options);
      const updateResult = await prisma.automationRuleExecutionState.updateMany({
        where: {
          ...stateKey,
          lastActionAt: null,
          nextRetryAt: null,
          lastTriggeredAt: options.claimTriggeredAt,
          emailOutboxId: options.emailOutboxId,
        },
        data: {
          lastActionAt: options.lastActionAt,
          nextRetryAt: null,
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
          nextRetryAt: true,
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
    async deferActionRetry(options) {
      const stateKey = getAutomationRuleExecutionStateKey(options);
      const nextRetryAt = new Date(options.failedAt.getTime() + deferredDecisionRetryDelayMs);
      const updateResult = await prisma.automationRuleExecutionState.updateMany({
        where: {
          ...stateKey,
          lastActionAt: null,
          nextRetryAt: null,
          lastTriggeredAt: options.claimTriggeredAt,
          emailOutboxId: options.emailOutboxId,
        },
        data: {
          nextRetryAt,
        },
      });
      if (updateResult.count === 1) {
        return {
          outcome: "deferred",
          nextRetryAt,
        };
      }
      if (updateResult.count !== 0) {
        throw new Error(`Expected at most one automation execution state row to defer, received ${updateResult.count}.`);
      }

      const current = await prisma.automationRuleExecutionState.findUnique({
        where: {
          tenancyId_ruleId_subjectType_subjectId_signalKey: stateKey,
        },
        select: {
          lastTriggeredAt: true,
          lastActionAt: true,
          nextRetryAt: true,
          emailOutboxId: true,
        },
      });
      const ownsSameAttempt = current?.emailOutboxId === options.emailOutboxId
        && current.lastTriggeredAt.getTime() === options.claimTriggeredAt.getTime();
      if (ownsSameAttempt && current.lastActionAt !== null) {
        return {
          outcome: "already-completed",
          lastActionAt: current.lastActionAt,
        };
      }
      if (ownsSameAttempt && current.nextRetryAt !== null) {
        return {
          outcome: "deferred",
          nextRetryAt: current.nextRetryAt,
        };
      }
      throw new Error("Automation retry deferral lost ownership of its reserved EmailOutbox row.");
    },
  };
}

function getAutomationExecutionStatus(
  state: { lastTriggeredAt: Date, lastActionAt: Date | null, nextRetryAt: Date | null } | null,
  cooldownDays: number,
  now: Date,
  activeClaimStaleTimeoutMs: number,
): AutomationExecutionStatus {
  if (state === null) {
    return { blocked: false };
  }
  if (state.lastActionAt !== null) {
    const cooldownStatus = getAutomationCooldownStatus({
      lastActionAt: state.lastActionAt,
      cooldownDays,
      now,
    });
    return cooldownStatus.blocked
      ? {
        blocked: true,
        reason: "cooldown",
        lastActionAt: cooldownStatus.lastActionAt,
        nextEligibleAt: cooldownStatus.nextEligibleAt,
      }
      : { blocked: false };
  }
  if (state.nextRetryAt !== null) {
    return now.getTime() < state.nextRetryAt.getTime()
      ? {
        blocked: true,
        reason: "retry-backoff",
        nextEligibleAt: state.nextRetryAt,
      }
      : { blocked: false };
  }

  const nextEligibleAt = new Date(state.lastTriggeredAt.getTime() + activeClaimStaleTimeoutMs);
  return now.getTime() <= nextEligibleAt.getTime()
    ? {
      blocked: true,
      reason: "in-flight",
      nextEligibleAt,
    }
    : { blocked: false };
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
