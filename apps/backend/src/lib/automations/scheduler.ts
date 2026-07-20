import { createSendEmailActionAdapter } from "@/lib/automations/actions/send-email";
import { createPrismaAutomationRuleExecutionStateStore } from "@/lib/automations/execution-state-store";
import {
  createPrismaAutomationSchedulerStateStore,
  type AutomationSchedulerCheckpoint,
  type AutomationSchedulerLease,
} from "@/lib/automations/scheduler-state";
import {
  createPaymentsItemQuotaSourceAdapter,
  paymentsItemQuotaCustomerDataReaders,
  prismaPaymentsItemQuotaProjectUserReader,
} from "@/lib/automations/sources/payments-item-quota";
import { sendEmailToMany } from "@/lib/emails";
import { getTenancy, type Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { captureError, HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { getSingleAutomationEmailSendResult, runAutomationRuleForRoute, type AutomationRunResult } from "./run-route";
import { assertSupportedAutomationRule, type AutomationRuleTenancy, listAutomationRules, NonRetryableAutomationRuleError } from "./rules";

export const scheduledAutomationDiscoveryLimit = 500;
export const scheduledAutomationRunPageLimit = 100;
export const scheduledAutomationMaxPages = 10;
export const scheduledAutomationDefaultPages = 5;
export const scheduledAutomationWorkBudgetMs = 45_000;

type AutomationDiscoveryPrisma = {
  tenancy: {
    findMany: (options: {
      where: {
        id?: { gt: string },
      },
      orderBy: { id: "asc" },
      take: number,
      select: { id: true },
    }) => Promise<Array<{ id: string }>>,
  },
};

type ScheduledAutomationRunner<TTenancy extends AutomationRuleTenancy> = (options: {
  tenancy: TTenancy,
  ruleId: string,
  cursor: string | null,
  limit: number,
  scheduledAt: Date,
  now: Date,
}) => Promise<AutomationRunResult>;

type AutomationSchedulerStateStore = {
  acquire: () => Promise<AutomationSchedulerLease | null>,
};

type ScheduledAutomationOptions = {
  prisma?: AutomationDiscoveryPrisma,
  stateStore?: AutomationSchedulerStateStore,
  now?: () => Date,
  elapsedNow?: () => number,
  pageLimit?: number,
  maxPages?: number,
  maxTenancies?: number,
  workBudgetMs?: number,
};

export type ScheduledAutomationCronResult = {
  status: "ran" | "lease-held",
  tenanciesScanned: number,
  rulesProcessed: number,
  pagesProcessed: number,
  evaluatedCount: number,
  sentCount: number,
  suppressedCount: number,
  deferredCount: number,
  cycleCompleted: boolean,
};

export function normalizeScheduledAutomationDiscoveryLimit(limit: number | undefined) {
  if (limit === undefined) return scheduledAutomationDiscoveryLimit;
  return Math.max(1, Math.min(Math.floor(limit), scheduledAutomationDiscoveryLimit));
}

export function normalizeScheduledAutomationRunPageLimit(limit: number | undefined) {
  if (limit === undefined) return scheduledAutomationRunPageLimit;
  return Math.max(1, Math.min(Math.floor(limit), scheduledAutomationRunPageLimit));
}

export function normalizeScheduledAutomationMaxPages(limit: number | undefined) {
  if (limit === undefined) return scheduledAutomationDefaultPages;
  return Math.max(1, Math.min(Math.floor(limit), scheduledAutomationMaxPages));
}

export function normalizeScheduledAutomationWorkBudgetMs(value: number | undefined) {
  if (value === undefined) return scheduledAutomationWorkBudgetMs;
  return Math.max(1, Math.min(Math.floor(value), scheduledAutomationWorkBudgetMs));
}

export function runScheduledAutomations(
  options?: ScheduledAutomationOptions & {
    getTenancyById?: undefined,
    runRule?: undefined,
  },
): Promise<ScheduledAutomationCronResult>;
export function runScheduledAutomations<TTenancy extends AutomationRuleTenancy>(
  options: ScheduledAutomationOptions & {
    getTenancyById: (tenancyId: string) => Promise<TTenancy | null>,
    runRule: ScheduledAutomationRunner<TTenancy>,
  },
): Promise<ScheduledAutomationCronResult>;
export async function runScheduledAutomations(options: ScheduledAutomationOptions & {
  getTenancyById?: (tenancyId: string) => Promise<AutomationRuleTenancy | null>,
  runRule?: ScheduledAutomationRunner<AutomationRuleTenancy>,
} = {}): Promise<ScheduledAutomationCronResult> {
  if (options.getTenancyById === undefined && options.runRule === undefined) {
    return await runScheduledAutomationsWithDependencies(options, {
      getTenancyById: getTenancy,
      runRule: runProductionScheduledAutomationRulePage,
    });
  }
  if (options.getTenancyById === undefined || options.runRule === undefined) {
    throw new Error("Automation scheduler test dependencies must provide both getTenancyById and runRule.");
  }
  return await runScheduledAutomationsWithDependencies(options, {
    getTenancyById: options.getTenancyById,
    runRule: options.runRule,
  });
}

async function runScheduledAutomationsWithDependencies<TTenancy extends AutomationRuleTenancy>(
  options: ScheduledAutomationOptions,
  dependencies: {
    getTenancyById: (tenancyId: string) => Promise<TTenancy | null>,
    runRule: ScheduledAutomationRunner<TTenancy>,
  },
): Promise<ScheduledAutomationCronResult> {
  const prisma = options.prisma ?? globalPrismaClient;
  const stateStore = options.stateStore ?? createPrismaAutomationSchedulerStateStore({
    prisma: globalPrismaClient,
  });
  const lease = await stateStore.acquire();
  if (lease === null) {
    return emptyCronResult("lease-held");
  }

  try {
    const result = await runWithLease({
      prisma,
      lease,
      getTenancyById: dependencies.getTenancyById,
      runRule: dependencies.runRule,
      now: options.now ?? (() => new Date()),
      elapsedNow: options.elapsedNow ?? (() => performance.now()),
      pageLimit: normalizeScheduledAutomationRunPageLimit(options.pageLimit),
      maxPages: normalizeScheduledAutomationMaxPages(options.maxPages),
      maxTenancies: normalizeScheduledAutomationDiscoveryLimit(options.maxTenancies),
      workBudgetMs: normalizeScheduledAutomationWorkBudgetMs(options.workBudgetMs),
    });
    await lease.release();
    return result;
  } catch (error) {
    try {
      await lease.release();
    } catch (releaseError) {
      captureError("automation-scheduler-release-after-failure", new HexclaveAssertionError("Failed to release the automation scheduler lease after an execution failure.", {
        cause: releaseError,
      }));
    }
    throw error;
  }
}

async function runWithLease<TTenancy extends AutomationRuleTenancy>(options: {
  prisma: AutomationDiscoveryPrisma,
  lease: AutomationSchedulerLease,
  getTenancyById: (tenancyId: string) => Promise<TTenancy | null>,
  runRule: ScheduledAutomationRunner<TTenancy>,
  now: () => Date,
  elapsedNow: () => number,
  pageLimit: number,
  maxPages: number,
  maxTenancies: number,
  workBudgetMs: number,
}): Promise<ScheduledAutomationCronResult> {
  const startedAt = options.now();
  const startedElapsedAt = options.elapsedNow();
  const scheduledAt = startedAt;
  let checkpoint = options.lease.checkpoint;
  let tenanciesScanned = 0;
  let rulesProcessed = 0;
  let pagesProcessed = 0;
  let evaluatedCount = 0;
  let sentCount = 0;
  let suppressedCount = 0;
  let deferredCount = 0;
  let cycleCompleted = false;
  let discoveredTenancyIds: string[] = [];

  const saveCheckpoint = async (next: AutomationSchedulerCheckpoint) => {
    await options.lease.saveCheckpoint(next);
    checkpoint = next;
  };

  while (
    pagesProcessed < options.maxPages
    && tenanciesScanned < options.maxTenancies
    && options.elapsedNow() - startedElapsedAt < options.workBudgetMs
  ) {
    if (checkpoint.activeTenancyId === null) {
      if (discoveredTenancyIds.length === 0) {
        const rows = await options.prisma.tenancy.findMany({
          where: checkpoint.completedTenancyCursor === null ? {} : {
            id: { gt: checkpoint.completedTenancyCursor },
          },
          orderBy: { id: "asc" },
          take: Math.min(
            scheduledAutomationDiscoveryLimit,
            options.maxTenancies - tenanciesScanned,
          ),
          select: { id: true },
        });
        if (rows.length === 0) {
          await saveCheckpoint(emptyCheckpoint());
          cycleCompleted = true;
          break;
        }
        discoveredTenancyIds = rows.map((row) => row.id);
      }

      const nextTenancyId = discoveredTenancyIds.shift();
      if (nextTenancyId === undefined) {
        throw new Error("Automation scheduler discovery returned no next tenancy unexpectedly.");
      }
      await saveCheckpoint({
        ...checkpoint,
        activeTenancyId: nextTenancyId,
        completedRuleCursor: null,
        activeRuleId: null,
        nextSubjectCursor: null,
      });
      tenanciesScanned++;
    }

    const activeTenancyId = checkpoint.activeTenancyId;
    if (activeTenancyId === null) {
      throw new Error("Automation scheduler checkpoint lost its active tenancy unexpectedly.");
    }
    const tenancy = await options.getTenancyById(activeTenancyId);
    if (tenancy === null) {
      await saveCheckpoint(completeActiveTenancy(checkpoint));
      continue;
    }

    const sortedRules = listAutomationRules(tenancy)
      .sort((left, right) => stringCompare(left.ruleId, right.ruleId));
    if (checkpoint.activeRuleId === null) {
      const nextRule = sortedRules.find(({ ruleId }) => (
        checkpoint.completedRuleCursor === null || stringCompare(ruleId, checkpoint.completedRuleCursor) > 0
      ));
      if (nextRule === undefined) {
        await saveCheckpoint(completeActiveTenancy(checkpoint));
        continue;
      }
      await saveCheckpoint({
        ...checkpoint,
        activeRuleId: nextRule.ruleId,
        nextSubjectCursor: null,
      });
    }

    const activeRuleId = checkpoint.activeRuleId;
    if (activeRuleId === null) {
      throw new Error("Automation scheduler checkpoint lost its active rule unexpectedly.");
    }
    const ruleEntry = sortedRules.find(({ ruleId }) => ruleId === activeRuleId);
    if (ruleEntry === undefined) {
      await saveCheckpoint(completeActiveRule(checkpoint, activeRuleId));
      rulesProcessed++;
      continue;
    }
    if (!ruleEntry.rule.enabled) {
      await saveCheckpoint(completeActiveRule(checkpoint, activeRuleId));
      rulesProcessed++;
      continue;
    }
    try {
      assertSupportedAutomationRule(activeRuleId, ruleEntry.rule);
    } catch (error) {
      if (!(error instanceof NonRetryableAutomationRuleError)) {
        throw error;
      }
      captureError("automation-scheduler-invalid-rule", new HexclaveAssertionError(`Skipping invalid scheduled automation rule "${activeRuleId}" for tenancy "${tenancy.id}".`, {
        cause: error,
        tenancyId: tenancy.id,
        ruleId: activeRuleId,
        reason: error.reason,
      }));
      await saveCheckpoint(completeActiveRule(checkpoint, activeRuleId));
      rulesProcessed++;
      continue;
    }

    if (
      pagesProcessed >= options.maxPages
      || options.elapsedNow() - startedElapsedAt >= options.workBudgetMs
    ) {
      break;
    }
    await options.lease.renewIfNeeded();

    let result: AutomationRunResult;
    try {
      result = await options.runRule({
        tenancy,
        ruleId: activeRuleId,
        cursor: checkpoint.nextSubjectCursor,
        limit: options.pageLimit,
        scheduledAt,
        now: options.now(),
      });
    } catch (error) {
      if (!(error instanceof NonRetryableAutomationRuleError)) {
        throw error;
      }
      captureError("automation-scheduler-non-retryable-rule", new HexclaveAssertionError(`Skipping non-retryable scheduled automation rule "${activeRuleId}" for tenancy "${tenancy.id}".`, {
        cause: error,
        tenancyId: tenancy.id,
        ruleId: activeRuleId,
        reason: error.reason,
      }));
      await saveCheckpoint(completeActiveRule(checkpoint, activeRuleId));
      rulesProcessed++;
      continue;
    }
    pagesProcessed++;
    evaluatedCount += result.evaluatedCount;
    sentCount += result.sentCount;
    suppressedCount += result.suppressedCount;
    deferredCount += result.deferredCount;

    if (result.nextCursor === null) {
      await saveCheckpoint(completeActiveRule(checkpoint, activeRuleId));
      rulesProcessed++;
    } else {
      await saveCheckpoint({
        ...checkpoint,
        nextSubjectCursor: result.nextCursor,
      });
    }
  }

  return {
    status: "ran",
    tenanciesScanned,
    rulesProcessed,
    pagesProcessed,
    evaluatedCount,
    sentCount,
    suppressedCount,
    deferredCount,
    cycleCompleted,
  };
}

async function runProductionScheduledAutomationRulePage(options: {
  tenancy: Tenancy,
  ruleId: string,
  cursor: string | null,
  limit: number,
  scheduledAt: Date,
  now: Date,
}): Promise<AutomationRunResult> {
  const tenancy = options.tenancy;
  const prisma = await getPrismaClientForTenancy(tenancy);
  const sourceAdapter = createPaymentsItemQuotaSourceAdapter({
    prisma,
    projectUserReader: prismaPaymentsItemQuotaProjectUserReader,
    customerDataReaders: paymentsItemQuotaCustomerDataReaders,
  });

  return await runAutomationRuleForRoute({
    tenancy,
    ruleId: options.ruleId,
    limit: options.limit,
    cursor: options.cursor,
    scheduledAt: options.scheduledAt,
    now: options.now,
    sourceAdapter,
    actionAdapter: createSendEmailActionAdapter(),
    stateStore: createPrismaAutomationRuleExecutionStateStore(prisma),
    emailSender: async ({ action, scheduledAt, emailOutboxId }) => {
      const enqueueResult = await sendEmailToMany({
        tenancy,
        recipients: [action.recipient],
        tsxSource: action.tsxSource,
        extraVariables: action.variables,
        themeId: action.themeId ?? null,
        isHighPriority: action.isHighPriority,
        shouldSkipDeliverabilityCheck: action.shouldSkipDeliverabilityCheck,
        scheduledAt,
        createdWith: action.createdWith,
        overrideSubject: action.subject,
        overrideNotificationCategoryId: action.notificationCategoryId,
        emailOutboxIds: [emailOutboxId],
      });
      return getSingleAutomationEmailSendResult(enqueueResult);
    },
  });
}

function completeActiveRule(checkpoint: AutomationSchedulerCheckpoint, ruleId: string): AutomationSchedulerCheckpoint {
  return {
    ...checkpoint,
    completedRuleCursor: ruleId,
    activeRuleId: null,
    nextSubjectCursor: null,
  };
}

function completeActiveTenancy(checkpoint: AutomationSchedulerCheckpoint): AutomationSchedulerCheckpoint {
  if (checkpoint.activeTenancyId === null) {
    throw new Error("Cannot complete an automation scheduler tenancy without an active tenancy.");
  }
  return {
    completedTenancyCursor: checkpoint.activeTenancyId,
    activeTenancyId: null,
    completedRuleCursor: null,
    activeRuleId: null,
    nextSubjectCursor: null,
  };
}

function emptyCheckpoint(): AutomationSchedulerCheckpoint {
  return {
    completedTenancyCursor: null,
    activeTenancyId: null,
    completedRuleCursor: null,
    activeRuleId: null,
    nextSubjectCursor: null,
  };
}

function emptyCronResult(status: "lease-held"): ScheduledAutomationCronResult {
  return {
    status,
    tenanciesScanned: 0,
    rulesProcessed: 0,
    pagesProcessed: 0,
    evaluatedCount: 0,
    sentCount: 0,
    suppressedCount: 0,
    deferredCount: 0,
    cycleCompleted: false,
  };
}
