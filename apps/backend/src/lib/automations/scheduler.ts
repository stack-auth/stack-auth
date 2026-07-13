import { createSendEmailActionAdapter } from "@/lib/automations/actions/send-email";
import { createPrismaAutomationRuleExecutionStateStore } from "@/lib/automations/execution-state-store";
import {
  AutomationRunResult,
  runAutomationRuleForRoute,
} from "@/lib/automations/run-route";
import {
  createPaymentsItemQuotaSourceAdapter,
  paymentsItemQuotaCustomerDataReaders,
  prismaPaymentsItemQuotaProjectUserReader,
} from "@/lib/automations/sources/payments-item-quota";
import { sendEmailToMany } from "@/lib/emails";
import { getTenancy, type Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { captureError, HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { assertSupportedAutomationRule, AutomationRuleTenancy, getAutomationRule, listAutomationRules } from "./rules";

export const scheduledAutomationDiscoveryLimit = 500;
export const scheduledAutomationRunPageLimit = 100;
export const scheduledAutomationRunRoutePath = "/api/latest/internal/automations/scheduled-run";

type AutomationScheduleTarget = {
  tenancyId: string,
  ruleId: string,
};

export type AutomationScheduleDiscoveryResult = {
  scannedTenancyCount: number,
  targets: AutomationScheduleTarget[],
  nextCursor: string | null,
};

export type AutomationScheduledRunPayload = {
  tenancyId: string,
  ruleId: string,
  cursor: string | null,
  limit: number,
  scheduledAtMillis: number,
};

export type AutomationScheduledRunResult =
  | {
    status: "skipped",
    reason: "tenancy-not-found" | "rule-not-found" | "rule-disabled",
  }
  | {
    status: "ran",
    result: AutomationRunResult,
    enqueuedContinuation: boolean,
  };

type AutomationDiscoveryPrisma = {
  tenancy: {
    findMany: (options: {
      where: {
        id?: {
          gt: string,
        },
      },
      orderBy: {
        id: "asc",
      },
      take: number,
      select: {
        id: true,
      },
    }) => Promise<Array<{ id: string }>>,
  },
};

type AutomationQueuePrisma = {
  outgoingRequest: {
    createMany: (options: {
      data: Array<{
        qstashOptions: {
          url: string,
          body: AutomationScheduledRunPayload,
          flowControl: {
            key: string,
            parallelism: number,
          },
        },
        deduplicationKey: string,
      }>,
      skipDuplicates: true,
    }) => Promise<{ count: number }>,
  },
};

type ScheduledAutomationRunner = (options: {
  tenancy: AutomationRuleTenancy,
  ruleId: string,
  cursor: string | null,
  limit: number,
  scheduledAt: Date,
  now: Date,
}) => Promise<AutomationRunResult>;

export function normalizeScheduledAutomationDiscoveryLimit(limit: number | undefined) {
  if (limit === undefined) return scheduledAutomationDiscoveryLimit;
  return Math.max(1, Math.min(Math.floor(limit), scheduledAutomationDiscoveryLimit));
}

export function normalizeScheduledAutomationRunPageLimit(limit: number | undefined) {
  if (limit === undefined) return scheduledAutomationRunPageLimit;
  return Math.max(1, Math.min(Math.floor(limit), scheduledAutomationRunPageLimit));
}

export async function discoverEnabledScheduledAutomationRules(options: {
  prisma?: AutomationDiscoveryPrisma,
  getTenancyById?: (tenancyId: string) => Promise<AutomationRuleTenancy | null>,
  limit?: number,
  cursor?: string | null,
} = {}): Promise<AutomationScheduleDiscoveryResult> {
  const prisma = options.prisma ?? globalPrismaClient;
  const limit = normalizeScheduledAutomationDiscoveryLimit(options.limit);
  const tenancyRows = await prisma.tenancy.findMany({
    where: {
      ...(options.cursor == null ? {} : {
        id: {
          gt: options.cursor,
        },
      }),
    },
    orderBy: {
      id: "asc",
    },
    take: limit,
    select: {
      id: true,
    },
  });
  const getTenancyById = options.getTenancyById ?? getTenancy;
  const targets: AutomationScheduleTarget[] = [];

  for (const row of tenancyRows) {
    const tenancy = await getTenancyById(row.id);
    if (tenancy === null) {
      continue;
    }

    for (const { ruleId, rule } of listAutomationRules(tenancy)) {
      if (!rule.enabled) {
        continue;
      }
      try {
        assertSupportedAutomationRule(ruleId, rule);
      } catch (error) {
        captureError("automation-scheduler-invalid-rule", new HexclaveAssertionError(`Skipping invalid scheduled automation rule "${ruleId}" for tenancy "${tenancy.id}".`, {
          cause: error,
          tenancyId: tenancy.id,
          ruleId,
        }));
        continue;
      }
      targets.push({
        tenancyId: tenancy.id,
        ruleId,
      });
    }
  }

  return {
    scannedTenancyCount: tenancyRows.length,
    targets,
    nextCursor: tenancyRows.length === limit ? tenancyRows[tenancyRows.length - 1]?.id ?? null : null,
  };
}

export async function enqueueScheduledAutomationRuns(options: {
  prisma?: AutomationQueuePrisma,
  targets: AutomationScheduleTarget[],
  limit?: number,
  cursor?: string | null,
  scheduledAt: Date,
}): Promise<{ enqueuedCount: number }> {
  if (options.targets.length === 0) {
    return { enqueuedCount: 0 };
  }

  const prisma = options.prisma ?? globalPrismaClient;
  const limit = normalizeScheduledAutomationRunPageLimit(options.limit);
  const cursor = options.cursor ?? null;
  const createResult = await prisma.outgoingRequest.createMany({
    data: options.targets.map((target) => ({
      qstashOptions: {
        url: scheduledAutomationRunRoutePath,
        body: {
          tenancyId: target.tenancyId,
          ruleId: target.ruleId,
          cursor,
          limit,
          scheduledAtMillis: options.scheduledAt.getTime(),
        },
        flowControl: {
          key: getScheduledAutomationFlowControlKey(target.tenancyId),
          parallelism: 1,
        },
      },
      deduplicationKey: getScheduledAutomationDeduplicationKey({
        ...target,
        cursor,
      }),
    })),
    skipDuplicates: true,
  });

  return {
    enqueuedCount: createResult.count,
  };
}

export async function enqueueScheduledAutomationContinuation(options: {
  tenancyId: string,
  ruleId: string,
  cursor: string,
  limit: number,
  scheduledAt: Date,
  prisma?: AutomationQueuePrisma,
}): Promise<{ enqueuedCount: number }> {
  return await enqueueScheduledAutomationRuns({
    prisma: options.prisma,
    targets: [{
      tenancyId: options.tenancyId,
      ruleId: options.ruleId,
    }],
    cursor: options.cursor,
    limit: options.limit,
    scheduledAt: options.scheduledAt,
  });
}

export async function runScheduledAutomationRulePage(options: {
  tenancyId: string,
  ruleId: string,
  cursor?: string | null,
  limit?: number,
  scheduledAt: Date,
  now: Date,
  getTenancyById?: (tenancyId: string) => Promise<AutomationRuleTenancy | null>,
  runRule?: ScheduledAutomationRunner,
  enqueueContinuation?: typeof enqueueScheduledAutomationContinuation,
}): Promise<AutomationScheduledRunResult> {
  const getTenancyById = options.getTenancyById ?? getTenancy;
  const tenancy = await getTenancyById(options.tenancyId);
  if (tenancy === null) {
    return {
      status: "skipped",
      reason: "tenancy-not-found",
    };
  }

  const rule = getAutomationRule(tenancy, options.ruleId);
  if (rule === undefined) {
    return {
      status: "skipped",
      reason: "rule-not-found",
    };
  }
  if (!rule.enabled) {
    return {
      status: "skipped",
      reason: "rule-disabled",
    };
  }
  assertSupportedAutomationRule(options.ruleId, rule);

  const limit = normalizeScheduledAutomationRunPageLimit(options.limit);
  const result = options.runRule === undefined
    ? await runProductionScheduledAutomationRulePage({
      tenancyId: options.tenancyId,
      ruleId: options.ruleId,
      cursor: options.cursor ?? null,
      limit,
      scheduledAt: options.scheduledAt,
      now: options.now,
    })
    : await options.runRule({
      tenancy,
      ruleId: options.ruleId,
      cursor: options.cursor ?? null,
      limit,
      scheduledAt: options.scheduledAt,
      now: options.now,
    });

  let enqueuedContinuation = false;
  if (result.nextCursor !== null) {
    const enqueueContinuation = options.enqueueContinuation ?? enqueueScheduledAutomationContinuation;
    const enqueueResult = await enqueueContinuation({
      tenancyId: options.tenancyId,
      ruleId: options.ruleId,
      cursor: result.nextCursor,
      limit,
      scheduledAt: options.scheduledAt,
    });
    enqueuedContinuation = enqueueResult.enqueuedCount > 0;
  }

  return {
    status: "ran",
    result,
    enqueuedContinuation,
  };
}

async function runProductionScheduledAutomationRulePage(options: {
  tenancyId: string,
  ruleId: string,
  cursor: string | null,
  limit: number,
  scheduledAt: Date,
  now: Date,
}) {
  const tenancy = await getTenancy(options.tenancyId);
  if (tenancy === null) {
    throw new Error(`Tenancy "${options.tenancyId}" disappeared between scheduled automation validation and execution.`);
  }
  return await runAutomationRuleForScheduledWorker({
    tenancy,
    ruleId: options.ruleId,
    cursor: options.cursor,
    limit: options.limit,
    scheduledAt: options.scheduledAt,
    now: options.now,
  });
}

async function runAutomationRuleForScheduledWorker(options: {
  tenancy: Tenancy,
  ruleId: string,
  cursor: string | null,
  limit: number,
  scheduledAt: Date,
  now: Date,
}): Promise<AutomationRunResult> {
  const prisma = await getPrismaClientForTenancy(options.tenancy);
  const sourceAdapter = createPaymentsItemQuotaSourceAdapter({
    prisma,
    projectUserReader: prismaPaymentsItemQuotaProjectUserReader,
    customerDataReaders: paymentsItemQuotaCustomerDataReaders,
  });

  return await runAutomationRuleForRoute({
    tenancy: options.tenancy,
    ruleId: options.ruleId,
    limit: options.limit,
    cursor: options.cursor,
    scheduledAt: options.scheduledAt,
    now: options.now,
    sourceAdapter,
    actionAdapter: createSendEmailActionAdapter(),
    stateStore: createPrismaAutomationRuleExecutionStateStore(prisma),
    emailSender: async ({ action, scheduledAt }) => {
      await sendEmailToMany({
        tenancy: options.tenancy,
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
      });
    },
  });
}

function getScheduledAutomationFlowControlKey(tenancyId: string) {
  return `automation-rule-run:${tenancyId}`;
}

export function getScheduledAutomationDeduplicationKey(options: {
  tenancyId: string,
  ruleId: string,
  cursor: string | null,
}) {
  return `automation-rule-run:${options.tenancyId}:${options.ruleId}:${options.cursor ?? "start"}`;
}
