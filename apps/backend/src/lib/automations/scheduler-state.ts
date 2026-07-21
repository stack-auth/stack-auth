import { randomUUID } from "crypto";
import { retryTransaction } from "@/prisma-client";

export const automationSchedulerStateKey = "usage-email-v1";
export const automationSchedulerLeaseDurationMs = 120_000;
export const automationSchedulerLeaseRenewalThresholdMs = 30_000;

export type AutomationSchedulerCheckpoint = {
  completedTenancyCursor: string | null,
  activeTenancyId: string | null,
  completedRuleCursor: string | null,
  activeRuleId: string | null,
  activeRuleEvaluationStartedAt: Date | null,
  nextSubjectCursor: string | null,
};

export type AutomationSchedulerLease = {
  ownerId: string,
  checkpoint: AutomationSchedulerCheckpoint,
  renewIfNeeded: () => Promise<void>,
  saveCheckpoint: (checkpoint: AutomationSchedulerCheckpoint) => Promise<void>,
  completeRuleEvaluation: (options: {
    checkpoint: AutomationSchedulerCheckpoint,
    tenancyId: string,
    ruleId: string,
    evaluationStartedAt: Date,
  }) => Promise<void>,
  release: () => Promise<void>,
};

type AutomationSchedulerStatePrisma = Parameters<typeof retryTransaction>[0];

export function createPrismaAutomationSchedulerStateStore(options: {
  prisma: AutomationSchedulerStatePrisma,
  now?: () => Date,
  ownerId?: () => string,
  leaseDurationMs?: number,
  renewalThresholdMs?: number,
}) {
  const now = options.now ?? (() => new Date());
  const ownerId = options.ownerId ?? randomUUID;
  const leaseDurationMs = options.leaseDurationMs ?? automationSchedulerLeaseDurationMs;
  const renewalThresholdMs = options.renewalThresholdMs ?? automationSchedulerLeaseRenewalThresholdMs;
  validateLeaseDurations(leaseDurationMs, renewalThresholdMs);

  return {
    async acquire(): Promise<AutomationSchedulerLease | null> {
      const acquiredAt = now();
      const owner = ownerId();
      const leaseExpiresAt = new Date(acquiredAt.getTime() + leaseDurationMs);
      const acquired = await options.prisma.automationSchedulerState.updateMany({
        where: {
          key: automationSchedulerStateKey,
          OR: [
            { leaseOwner: null },
            { leaseExpiresAt: { lte: acquiredAt } },
          ],
        },
        data: {
          leaseOwner: owner,
          leaseExpiresAt,
        },
      });
      if (acquired.count === 0) {
        const existing = await options.prisma.automationSchedulerState.findUnique({
          where: { key: automationSchedulerStateKey },
          select: { key: true },
        });
        if (existing === null) {
          throw new Error(`Automation scheduler state "${automationSchedulerStateKey}" is missing. Apply the scheduler-state migration before running cron.`);
        }
        return null;
      }
      assertSingleMutation(acquired.count, "acquire automation scheduler lease");

      const state = await options.prisma.automationSchedulerState.findUnique({
        where: { key: automationSchedulerStateKey },
        select: {
          completedTenancyCursor: true,
          activeTenancyId: true,
          completedRuleCursor: true,
          activeRuleId: true,
          activeRuleEvaluationStartedAt: true,
          nextSubjectCursor: true,
          leaseOwner: true,
          leaseExpiresAt: true,
        },
      });
      if (state === null || state.leaseOwner !== owner || state.leaseExpiresAt === null) {
        throw new Error("Automation scheduler lease changed while it was being acquired.");
      }

      let currentLeaseExpiresAt = state.leaseExpiresAt;
      let checkpoint = readCheckpoint(state);
      let released = false;

      const assertActive = () => {
        if (released) {
          throw new Error("Automation scheduler lease has already been released.");
        }
      };

      const mutateOwnedUnexpiredLease = async (
        action: string,
        data: Parameters<typeof options.prisma.automationSchedulerState.updateMany>[0]["data"],
      ) => {
        assertActive();
        const mutationNow = now();
        const result = await options.prisma.automationSchedulerState.updateMany({
          where: {
            key: automationSchedulerStateKey,
            leaseOwner: owner,
            leaseExpiresAt: { gt: mutationNow },
          },
          data,
        });
        assertSingleMutation(result.count, action);
      };

      return {
        ownerId: owner,
        get checkpoint() {
          return checkpoint;
        },
        async renewIfNeeded() {
          assertActive();
          const renewalNow = now();
          if (currentLeaseExpiresAt.getTime() - renewalNow.getTime() >= renewalThresholdMs) {
            return;
          }
          const renewedUntil = new Date(renewalNow.getTime() + leaseDurationMs);
          await mutateOwnedUnexpiredLease("renew automation scheduler lease", {
            leaseExpiresAt: renewedUntil,
          });
          currentLeaseExpiresAt = renewedUntil;
        },
        async saveCheckpoint(nextCheckpoint) {
          assertActiveRuleCheckpointInvariant(nextCheckpoint);
          await mutateOwnedUnexpiredLease("save automation scheduler checkpoint", nextCheckpoint);
          checkpoint = nextCheckpoint;
        },
        async completeRuleEvaluation(completion) {
          assertActive();
          assertActiveRuleCheckpointInvariant(completion.checkpoint);
          const completionNow = now();
          await retryTransaction(options.prisma, async (tx) => {
            const checkpointResult = await tx.automationSchedulerState.updateMany({
              where: {
                key: automationSchedulerStateKey,
                leaseOwner: owner,
                leaseExpiresAt: { gt: completionNow },
              },
              data: completion.checkpoint,
            });
            assertSingleMutation(checkpointResult.count, "complete automation rule evaluation");

            await tx.automationRuleScheduleState.upsert({
              where: {
                tenancyId_ruleId: {
                  tenancyId: completion.tenancyId,
                  ruleId: completion.ruleId,
                },
              },
              create: {
                tenancyId: completion.tenancyId,
                ruleId: completion.ruleId,
                lastCompletedEvaluationStartedAt: completion.evaluationStartedAt,
              },
              update: {
                lastCompletedEvaluationStartedAt: completion.evaluationStartedAt,
              },
            });
          });
          checkpoint = completion.checkpoint;
        },
        async release() {
          assertActive();
          const result = await options.prisma.automationSchedulerState.updateMany({
            where: {
              key: automationSchedulerStateKey,
              leaseOwner: owner,
            },
            data: {
              leaseOwner: null,
              leaseExpiresAt: null,
            },
          });
          assertSingleMutation(result.count, "release automation scheduler lease");
          released = true;
        },
      };
    },
  };
}

function readCheckpoint(state: AutomationSchedulerCheckpoint): AutomationSchedulerCheckpoint {
  const checkpoint = {
    completedTenancyCursor: state.completedTenancyCursor,
    activeTenancyId: state.activeTenancyId,
    completedRuleCursor: state.completedRuleCursor,
    activeRuleId: state.activeRuleId,
    activeRuleEvaluationStartedAt: state.activeRuleEvaluationStartedAt,
    nextSubjectCursor: state.nextSubjectCursor,
  };
  assertActiveRuleCheckpointInvariant(checkpoint);
  return checkpoint;
}

export function assertActiveRuleCheckpointInvariant(checkpoint: Pick<AutomationSchedulerCheckpoint, "activeRuleId" | "activeRuleEvaluationStartedAt">) {
  if ((checkpoint.activeRuleId === null) !== (checkpoint.activeRuleEvaluationStartedAt === null)) {
    throw new Error("Automation scheduler checkpoint must set activeRuleId and activeRuleEvaluationStartedAt together.");
  }
}

function validateLeaseDurations(leaseDurationMs: number, renewalThresholdMs: number) {
  if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new Error("Automation scheduler lease duration must be positive.");
  }
  if (!Number.isFinite(renewalThresholdMs) || renewalThresholdMs <= 0 || renewalThresholdMs >= leaseDurationMs) {
    throw new Error("Automation scheduler renewal threshold must be positive and shorter than the lease duration.");
  }
}

function assertSingleMutation(count: number, action: string) {
  if (count !== 1) {
    throw new Error(`Unable to ${action}; the scheduler lease was lost or expired.`);
  }
}
