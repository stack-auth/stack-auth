export const paymentsItemQuotaSourceType = "payments-item-quota";
export const sendEmailActionType = "send-email";
export const userCustomerType = "user";

export type AutomationJson = string | number | boolean | null | AutomationJson[] | { [key: string]: AutomationJson };

export type AutomationRuleThresholds = {
  nearRemainingRatio?: number,
  nearRemainingQuantity?: number,
  overLimitQuantity?: number,
};

export type AutomationRuleConfig = {
  displayName?: string,
  enabled: boolean,
  source: {
    type: string,
    itemId?: string,
    customerType?: string,
    thresholds?: AutomationRuleThresholds,
  },
  action: {
    type: string,
    templateId?: string,
    themeId?: string | null,
    subject?: string,
    notificationCategoryName?: string,
  },
  cooldown: {
    days?: number,
  },
};

export type PaymentsItemQuotaAutomationRule = AutomationRuleConfig & {
  source: {
    type: typeof paymentsItemQuotaSourceType,
    itemId: string,
    customerType: typeof userCustomerType,
    thresholds: AutomationRuleThresholds,
  },
  action: {
    type: typeof sendEmailActionType,
    templateId: string,
    themeId?: string | null,
    subject?: string,
    notificationCategoryName?: "Marketing",
  },
  cooldown: {
    days: number,
  },
};

export type SupportedAutomationRule = PaymentsItemQuotaAutomationRule;

export type AutomationRulesConfig = {
  automations?: {
    rules?: Record<string, AutomationRuleConfig | undefined>,
  },
  emails?: {
    selectedThemeId?: string | null,
    templates?: Record<string, {
      displayName?: string,
      tsxSource?: string,
      themeId?: string | null | false,
    } | undefined>,
  },
  payments?: {
    items?: Record<string, {
      displayName?: string,
      customerType?: string,
    } | undefined>,
  },
};

export type AutomationRuleTenancy = {
  id: string,
  project?: {
    display_name?: string,
  },
  config: AutomationRulesConfig,
};

export function listAutomationRules(tenancy: AutomationRuleTenancy) {
  return Object.entries(tenancy.config.automations?.rules ?? {})
    .filter((entry): entry is [string, AutomationRuleConfig] => entry[1] !== undefined)
    .map(([ruleId, rule]) => ({ ruleId, rule }));
}

export function getAutomationRule(tenancy: AutomationRuleTenancy, ruleId: string) {
  return tenancy.config.automations?.rules?.[ruleId];
}

export class AutomationRuleNotFoundError extends Error {
  constructor(tenancyId: string, ruleId: string) {
    super(`Automation rule "${ruleId}" was not found for tenancy "${tenancyId}".`);
    this.name = "AutomationRuleNotFoundError";
  }
}

export function getSupportedAutomationRule(tenancy: AutomationRuleTenancy, ruleId: string) {
  const rule = getAutomationRule(tenancy, ruleId);
  if (rule === undefined) {
    throw new AutomationRuleNotFoundError(tenancy.id, ruleId);
  }
  assertSupportedAutomationRule(ruleId, rule);
  return rule;
}

export function assertSupportedAutomationRule(ruleId: string, rule: AutomationRuleConfig): asserts rule is SupportedAutomationRule {
  if (rule.source.type !== paymentsItemQuotaSourceType) {
    throw new Error(`Automation rule "${ruleId}" has unsupported source.type "${rule.source.type}". V1 supports only "${paymentsItemQuotaSourceType}".`);
  }
  if (rule.source.customerType !== userCustomerType) {
    throw new Error(`Automation rule "${ruleId}" has unsupported source.customerType "${rule.source.customerType ?? "<missing>"}". V1 supports only "${userCustomerType}".`);
  }
  if (rule.action.type !== sendEmailActionType) {
    throw new Error(`Automation rule "${ruleId}" has unsupported action.type "${rule.action.type}". V1 supports only "${sendEmailActionType}".`);
  }
  if (rule.source.itemId === undefined) {
    throw new Error(`Automation rule "${ruleId}" is missing source.itemId.`);
  }
  if (rule.source.thresholds === undefined) {
    throw new Error(`Automation rule "${ruleId}" is missing source.thresholds.`);
  }
  if (
    rule.source.thresholds.nearRemainingRatio === undefined
    && rule.source.thresholds.nearRemainingQuantity === undefined
    && rule.source.thresholds.overLimitQuantity === undefined
  ) {
    throw new Error(`Automation rule "${ruleId}" must configure at least one source.thresholds value.`);
  }
  if (rule.action.templateId === undefined) {
    throw new Error(`Automation rule "${ruleId}" is missing action.templateId.`);
  }
  if (rule.cooldown.days === undefined) {
    throw new Error(`Automation rule "${ruleId}" is missing cooldown.days.`);
  }
}
