import {
  AutomationJson,
  AutomationRuleTenancy,
  SupportedAutomationRule,
  getSupportedAutomationRule,
  paymentsItemQuotaSourceType,
  sendEmailActionType,
} from "./rules";

export type AutomationEvaluationMode = "dry-run" | "run";

export type AutomationSourceDecision = {
  subject: {
    type: "user",
    id: string,
  },
  signal: {
    key: string,
    kind: "near" | "over",
  },
  sourceSnapshot: Record<string, AutomationJson>,
};

export type AutomationSourceEvaluationResult = {
  evaluatedCount: number,
  nextCursor: string | null,
  decisions: AutomationSourceDecision[],
};

export type AutomationActionPlan = {
  type: typeof sendEmailActionType,
  recipient: {
    type: "user-primary-email",
    userId: string,
  },
  tsxSource: string,
  templateId: string,
  themeId?: string | null,
  subject?: string,
  notificationCategoryName: "Marketing",
  notificationCategoryId: string,
  createdWith: {
    type: "programmatic-call",
    templateId: string,
  },
  isHighPriority: false,
  shouldSkipDeliverabilityCheck: false,
  variables: Record<string, AutomationJson>,
};

export type EvaluatedAutomationDecision = AutomationSourceDecision & {
  action: AutomationActionPlan,
};

export type AutomationEvaluationResult = {
  ruleId: string,
  mode: AutomationEvaluationMode,
  evaluatedCount: number,
  eligibleCount: number,
  suppressedCount: number,
  nextCursor: string | null,
  decisions: EvaluatedAutomationDecision[],
};

export type AutomationSourceAdapter = {
  evaluate: (options: {
    tenancy: AutomationRuleTenancy,
    ruleId: string,
    rule: SupportedAutomationRule,
    limit?: number,
    cursor?: string | null,
  }) => Promise<AutomationSourceEvaluationResult>,
};

export type AutomationActionAdapter = {
  buildPlan: (options: {
    tenancy: AutomationRuleTenancy,
    ruleId: string,
    rule: SupportedAutomationRule,
    decision: AutomationSourceDecision,
  }) => Promise<AutomationActionPlan>,
};

export type AutomationEvaluatorAdapters = {
  sourceAdapters?: Partial<Record<typeof paymentsItemQuotaSourceType, AutomationSourceAdapter>>,
  actionAdapters?: Partial<Record<typeof sendEmailActionType, AutomationActionAdapter>>,
};

export async function evaluateAutomationRule(options: {
  tenancy: AutomationRuleTenancy,
  ruleId: string,
  mode: AutomationEvaluationMode,
  limit?: number,
  cursor?: string | null,
  adapters?: AutomationEvaluatorAdapters,
}): Promise<AutomationEvaluationResult> {
  const rule = getSupportedAutomationRule(options.tenancy, options.ruleId);
  const sourceAdapter = options.adapters?.sourceAdapters?.[rule.source.type];
  if (sourceAdapter === undefined) {
    throw new Error(`No automation source adapter is registered for "${rule.source.type}". Register the payments item quota source adapter before evaluating this rule.`);
  }
  const actionAdapter = options.adapters?.actionAdapters?.[rule.action.type];
  if (actionAdapter === undefined) {
    throw new Error(`No automation action adapter is registered for "${rule.action.type}". The "${sendEmailActionType}" implementation belongs to Commit 5.`);
  }

  const sourceResult = await sourceAdapter.evaluate({
    tenancy: options.tenancy,
    ruleId: options.ruleId,
    rule,
    limit: options.limit,
    cursor: options.cursor,
  });

  const decisions = [];
  for (const decision of sourceResult.decisions) {
    decisions.push({
      ...decision,
      action: await actionAdapter.buildPlan({
        tenancy: options.tenancy,
        ruleId: options.ruleId,
        rule,
        decision,
      }),
    });
  }

  return {
    ruleId: options.ruleId,
    mode: options.mode,
    evaluatedCount: sourceResult.evaluatedCount,
    eligibleCount: decisions.length,
    suppressedCount: 0,
    nextCursor: sourceResult.nextCursor,
    decisions,
  };
}
