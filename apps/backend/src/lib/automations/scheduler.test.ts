import { describe, expect, it, vi } from "vitest";

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
  sendEmailToMany: async () => {},
}));

vi.mock("@/lib/tenancies", () => ({
  getTenancy: async () => null,
}));

vi.mock("@/prisma-client", () => ({
  getPrismaClientForTenancy: async () => ({}),
  globalPrismaClient: {
    tenancy: {
      findMany: async () => [],
    },
    outgoingRequest: {
      createMany: async () => ({ count: 0 }),
    },
  },
}));

import {
  discoverEnabledScheduledAutomationRules,
  enqueueScheduledAutomationRuns,
  getScheduledAutomationDeduplicationKey,
  runScheduledAutomationRulePage,
  scheduledAutomationRunRoutePath,
} from "./scheduler";
import { AutomationRunResult } from "./run-route";

const enabledRuleId = "low-api-credits";

function createTenancy(options: {
  enabled?: boolean,
  sourceType?: string,
} = {}) {
  return {
    id: "tenancy-1",
    branchId: "main",
    organization: null,
    project: {
      id: "project-1",
      display_name: "Acme App",
      description: "",
      logo_url: null,
      logo_full_url: null,
      logo_dark_mode_url: null,
      logo_full_dark_mode_url: null,
      created_at_millis: 0,
      is_production_mode: false,
      is_development_environment: false,
      owner_team_id: null,
      onboarding_status: "completed",
      onboarding_state: undefined,
      pushed_config_error: null,
      config_warnings: [],
    },
    config: {
      automations: {
        rules: {
          [enabledRuleId]: {
            enabled: options.enabled ?? true,
            source: {
              type: options.sourceType ?? "payments-item-quota",
              itemId: "api_credits",
              customerType: "user",
              thresholds: {
                nearRemainingQuantity: 10,
              },
            },
            action: {
              type: "send-email",
              templateId: "8c6f6960-7a87-4ebd-b2a6-bfd06d68e2d1",
              notificationCategoryName: "Marketing",
            },
            cooldown: {
              days: 7,
            },
          },
        },
      },
    },
  };
}

function createRunResult(nextCursor: string | null): AutomationRunResult {
  return {
    ruleId: enabledRuleId,
    mode: "run",
    evaluatedCount: 100,
    eligibleCount: 1,
    suppressedCount: 0,
    sentCount: 1,
    nextCursor,
    decisions: [],
  };
}

describe("scheduled automation discovery", () => {
  it("finds enabled V1 rules from bounded tenancy pages", async () => {
    const prisma = {
      tenancy: {
        findMany: vi.fn(async () => [{ id: "tenancy-1" }, { id: "tenancy-2" }]),
      },
    };
    const getTenancyById = vi.fn(async (tenancyId: string) => tenancyId === "tenancy-1"
      ? createTenancy()
      : createTenancy({ enabled: false }));

    await expect(discoverEnabledScheduledAutomationRules({
      prisma,
      getTenancyById,
      limit: 2,
      cursor: "previous-tenancy",
    })).resolves.toMatchInlineSnapshot(`
      {
        "nextCursor": "tenancy-2",
        "scannedTenancyCount": 2,
        "targets": [
          {
            "ruleId": "low-api-credits",
            "tenancyId": "tenancy-1",
          },
        ],
      }
    `);
    expect(prisma.tenancy.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          gt: "previous-tenancy",
        },
      },
      orderBy: {
        id: "asc",
      },
      take: 2,
      select: {
        id: true,
      },
    });
  });

  it("fails loudly for enabled non-V1 rules", async () => {
    const prisma = {
      tenancy: {
        findMany: vi.fn(async () => [{ id: "tenancy-1" }]),
      },
    };

    await expect(discoverEnabledScheduledAutomationRules({
      prisma,
      getTenancyById: async () => createTenancy({ sourceType: "client-push-quota" }),
    })).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Automation rule "low-api-credits" has unsupported source.type "client-push-quota". V1 supports only "payments-item-quota".]`,
    );
  });
});

describe("scheduled automation queueing", () => {
  it("enqueues deduped QStash work through OutgoingRequest", async () => {
    const prisma = {
      outgoingRequest: {
        createMany: vi.fn(async () => ({ count: 1 })),
      },
    };

    await expect(enqueueScheduledAutomationRuns({
      prisma,
      targets: [{
        tenancyId: "tenancy-1",
        ruleId: enabledRuleId,
      }],
      scheduledAt: new Date("2026-07-01T12:00:00.000Z"),
      limit: 75,
    })).resolves.toEqual({ enqueuedCount: 1 });

    expect(prisma.outgoingRequest.createMany).toHaveBeenCalledWith({
      data: [{
        deduplicationKey: "automation-rule-run:tenancy-1:low-api-credits:start",
        qstashOptions: {
          body: {
            cursor: null,
            limit: 75,
            ruleId: "low-api-credits",
            scheduledAtMillis: 1782907200000,
            tenancyId: "tenancy-1",
          },
          flowControl: {
            key: "automation-rule-run:tenancy-1",
            parallelism: 1,
          },
          url: scheduledAutomationRunRoutePath,
        },
      }],
      skipDuplicates: true,
    });
  });

  it("uses cursor-specific dedupe keys for continuation pages", () => {
    expect(getScheduledAutomationDeduplicationKey({
      tenancyId: "tenancy-1",
      ruleId: enabledRuleId,
      cursor: "user-100",
    })).toBe("automation-rule-run:tenancy-1:low-api-credits:user-100");
  });
});

describe("scheduled automation worker orchestration", () => {
  it("runs a page and enqueues continuation when the evaluator returns a next cursor", async () => {
    const runRule = vi.fn(async () => createRunResult("user-100"));
    const enqueueContinuation = vi.fn(async () => ({ enqueuedCount: 1 }));

    await expect(runScheduledAutomationRulePage({
      tenancyId: "tenancy-1",
      ruleId: enabledRuleId,
      limit: 100,
      scheduledAt: new Date("2026-07-01T12:00:00.000Z"),
      now: new Date("2026-07-01T12:01:00.000Z"),
      getTenancyById: async () => createTenancy(),
      runRule,
      enqueueContinuation,
    })).resolves.toMatchInlineSnapshot(`
      {
        "enqueuedContinuation": true,
        "result": {
          "decisions": [],
          "eligibleCount": 1,
          "evaluatedCount": 100,
          "mode": "run",
          "nextCursor": "user-100",
          "ruleId": "low-api-credits",
          "sentCount": 1,
          "suppressedCount": 0,
        },
        "status": "ran",
      }
    `);

    expect(runRule).toHaveBeenCalledWith(expect.objectContaining({
      cursor: null,
      limit: 100,
      ruleId: enabledRuleId,
    }));
    expect(enqueueContinuation).toHaveBeenCalledWith({
      tenancyId: "tenancy-1",
      ruleId: enabledRuleId,
      cursor: "user-100",
      limit: 100,
      scheduledAt: new Date("2026-07-01T12:00:00.000Z"),
    });
  });

  it("skips stale queued work when the rule was disabled after enqueue", async () => {
    const runRule = vi.fn(async () => createRunResult(null));

    await expect(runScheduledAutomationRulePage({
      tenancyId: "tenancy-1",
      ruleId: enabledRuleId,
      scheduledAt: new Date("2026-07-01T12:00:00.000Z"),
      now: new Date("2026-07-01T12:01:00.000Z"),
      getTenancyById: async () => createTenancy({ enabled: false }),
      runRule,
    })).resolves.toMatchInlineSnapshot(`
      {
        "reason": "rule-disabled",
        "status": "skipped",
      }
    `);

    expect(runRule).not.toHaveBeenCalled();
  });
});
