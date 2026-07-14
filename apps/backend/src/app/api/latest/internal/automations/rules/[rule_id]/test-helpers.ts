import { AutomationActionAdapter, AutomationSourceAdapter, AutomationSourceDecision } from "@/lib/automations/rule-evaluator";
import { vi } from "vitest";

export const automationRouteTestRuleId = "low-api-credits";

export function createAutomationRouteTestTenancy(options: {
  enabled?: boolean,
  ruleExists?: boolean,
} = {}) {
  return {
    id: "tenancy-1",
    project: {
      display_name: "Acme App",
    },
    config: {
      automations: {
        rules: options.ruleExists === false ? {} : {
          [automationRouteTestRuleId]: {
            enabled: options.enabled ?? true,
            source: {
              type: "payments-item-quota",
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

export function createAutomationRouteTestSourceDecision(options: {
  userId?: string,
  kind?: "near" | "over",
} = {}): AutomationSourceDecision {
  const kind = options.kind ?? "near";
  return {
    subject: {
      type: "user",
      id: options.userId ?? "user-1",
    },
    signal: {
      key: `api_credits:${kind}`,
      kind,
    },
    sourceSnapshot: {
      sourceType: "payments-item-quota",
      itemId: "api_credits",
      itemDisplayName: "API credits",
      currentQuantity: kind === "over" ? 0 : 7,
      entitlementQuantity: 100,
      thresholdKind: kind,
      ownedProductIds: ["pro"],
      activeSubscriptionIds: ["sub_1"],
    },
  };
}

export function createAutomationRouteTestSourceAdapter(
  decisionFactory: () => AutomationSourceDecision = createAutomationRouteTestSourceDecision,
  options: {
    evaluatedCount?: number,
  } = {},
): AutomationSourceAdapter {
  const evaluate: AutomationSourceAdapter["evaluate"] = async () => ({
    evaluatedCount: options.evaluatedCount ?? 2,
    nextCursor: "cursor-2",
    decisions: [decisionFactory()],
  });
  return {
    evaluate: vi.fn(evaluate),
  };
}

export function createAutomationRouteTestActionAdapter(): AutomationActionAdapter {
  const buildPlan: AutomationActionAdapter["buildPlan"] = async (options) => ({
    type: "send-email",
    recipient: {
      type: "user-primary-email",
      userId: options.decision.subject.id,
    },
    tsxSource: "export function EmailTemplate() { return null; }",
    templateId: options.rule.action.templateId,
    themeId: null,
    notificationCategoryName: "Marketing",
    notificationCategoryId: "4f6f8873-3d04-46bd-8bef-18338b1a1b4c",
    createdWith: {
      type: "programmatic-call",
      templateId: options.rule.action.templateId,
    },
    isHighPriority: false,
    shouldSkipDeliverabilityCheck: false,
    variables: {
      automationRuleId: options.ruleId,
      ...options.decision.sourceSnapshot,
      projectDisplayName: "Acme App",
    },
  });
  return {
    buildPlan: vi.fn(buildPlan),
  };
}
