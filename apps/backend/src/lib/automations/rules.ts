export const paymentsItemQuotaSourceType = "payments-item-quota";
export const sendEmailActionType = "send-email";
export const userCustomerType = "user";
export const automationCadenceDurationsMs = {
  "every-15-minutes": 15 * 60 * 1000,
  hourly: 60 * 60 * 1000,
  "every-6-hours": 6 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
} satisfies Record<string, number>;

export type AutomationCadence = keyof typeof automationCadenceDurationsMs;

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
  schedule?: {
    cadence?: string,
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
  schedule?: {
    cadence?: string,
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

export type NonRetryableAutomationRuleErrorReason =
  | "rule-not-found"
  | "rule-disabled"
  | "unsupported-rule"
  | "missing-item"
  | "incompatible-item"
  | "missing-template"
  | "invalid-template"
  | "invalid-rule-context";

/** A deterministic rule/configuration failure that will not recover by retrying the same scheduler page. */
export class NonRetryableAutomationRuleError extends Error {
  constructor(
    readonly reason: NonRetryableAutomationRuleErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "NonRetryableAutomationRuleError";
  }
}

export function listAutomationRules(tenancy: AutomationRuleTenancy) {
  return Object.entries(tenancy.config.automations?.rules ?? {})
    .filter((entry): entry is [string, AutomationRuleConfig] => entry[1] !== undefined)
    .map(([ruleId, rule]) => ({ ruleId, rule }));
}

export function getAutomationRule(tenancy: AutomationRuleTenancy, ruleId: string) {
  return tenancy.config.automations?.rules?.[ruleId];
}

export class AutomationRuleNotFoundError extends NonRetryableAutomationRuleError {
  constructor(tenancyId: string, ruleId: string) {
    super("rule-not-found", `Automation rule "${ruleId}" was not found for tenancy "${tenancyId}".`);
    this.name = "AutomationRuleNotFoundError";
  }
}

export class AutomationRuleDisabledError extends NonRetryableAutomationRuleError {
  constructor(ruleId: string) {
    super("rule-disabled", `Automation rule "${ruleId}" is disabled and cannot be manually sent.`);
    this.name = "AutomationRuleDisabledError";
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
    throw new NonRetryableAutomationRuleError("unsupported-rule", `Automation rule "${ruleId}" has unsupported source.type "${rule.source.type}". V1 supports only "${paymentsItemQuotaSourceType}".`);
  }
  if (rule.source.customerType !== userCustomerType) {
    throw new NonRetryableAutomationRuleError("unsupported-rule", `Automation rule "${ruleId}" has unsupported source.customerType "${rule.source.customerType ?? "<missing>"}". V1 supports only "${userCustomerType}".`);
  }
  if (rule.action.type !== sendEmailActionType) {
    throw new NonRetryableAutomationRuleError("unsupported-rule", `Automation rule "${ruleId}" has unsupported action.type "${rule.action.type}". V1 supports only "${sendEmailActionType}".`);
  }
  if (rule.source.itemId === undefined) {
    throw new NonRetryableAutomationRuleError("unsupported-rule", `Automation rule "${ruleId}" is missing source.itemId.`);
  }
  if (rule.source.thresholds === undefined) {
    throw new NonRetryableAutomationRuleError("unsupported-rule", `Automation rule "${ruleId}" is missing source.thresholds.`);
  }
  if (
    rule.source.thresholds.nearRemainingRatio === undefined
    && rule.source.thresholds.nearRemainingQuantity === undefined
    && rule.source.thresholds.overLimitQuantity === undefined
  ) {
    throw new NonRetryableAutomationRuleError("unsupported-rule", `Automation rule "${ruleId}" must configure at least one source.thresholds value.`);
  }
  if (rule.action.templateId === undefined) {
    throw new NonRetryableAutomationRuleError("unsupported-rule", `Automation rule "${ruleId}" is missing action.templateId.`);
  }
  if (rule.cooldown.days === undefined) {
    throw new NonRetryableAutomationRuleError("unsupported-rule", `Automation rule "${ruleId}" is missing cooldown.days.`);
  }
}
