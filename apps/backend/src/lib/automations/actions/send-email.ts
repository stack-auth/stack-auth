import { AutomationActionAdapter, AutomationActionPlan, AutomationSourceDecision } from "../rule-evaluator";
import { AutomationRuleTenancy, PaymentsItemQuotaAutomationRule, sendEmailActionType } from "../rules";

export type SendEmailNotificationCategory = {
  id: string,
  name: string,
};

export type SendEmailNotificationCategoryReader = (name: string) => Promise<SendEmailNotificationCategory | undefined>;

export function createSendEmailActionAdapter(options: {
  getNotificationCategoryByName?: SendEmailNotificationCategoryReader,
} = {}): AutomationActionAdapter {
  return {
    buildPlan: async (buildOptions) => await buildSendEmailActionPlan({
      ...buildOptions,
      getNotificationCategoryByName: options.getNotificationCategoryByName,
    }),
  };
}

export const sendEmailActionAdapter = createSendEmailActionAdapter();

async function getNotificationCategoryByNameFromExistingEmailSystem(name: string) {
  const { getNotificationCategoryByName } = await import("@/lib/notification-categories");
  return getNotificationCategoryByName(name);
}

export async function buildSendEmailActionPlan(options: {
  tenancy: AutomationRuleTenancy,
  ruleId: string,
  rule: PaymentsItemQuotaAutomationRule,
  decision: AutomationSourceDecision,
  getNotificationCategoryByName?: SendEmailNotificationCategoryReader,
}): Promise<AutomationActionPlan> {
  const template = options.tenancy.config.emails?.templates?.[options.rule.action.templateId];
  if (template === undefined) {
    throw new Error(`Automation rule "${options.ruleId}" references email template "${options.rule.action.templateId}", but that template does not exist.`);
  }
  if (template.tsxSource === undefined) {
    throw new Error(`Automation rule "${options.ruleId}" references email template "${options.rule.action.templateId}", but that template is missing tsxSource.`);
  }

  const notificationCategoryName: string = options.rule.action.notificationCategoryName ?? "Marketing";
  if (notificationCategoryName !== "Marketing") {
    throw new Error(`Automation rule "${options.ruleId}" has unsupported action.notificationCategoryName "${notificationCategoryName}". V1 supports only "Marketing".`);
  }
  const notificationCategoryReader = options.getNotificationCategoryByName ?? getNotificationCategoryByNameFromExistingEmailSystem;
  const notificationCategory = await notificationCategoryReader(notificationCategoryName);
  if (notificationCategory === undefined) {
    throw new Error(`Automation rule "${options.ruleId}" references notification category "${notificationCategoryName}", but that category does not exist.`);
  }

  const projectDisplayName = options.tenancy.project?.display_name;
  if (projectDisplayName === undefined) {
    throw new Error(`Automation rule "${options.ruleId}" cannot build email variables because tenancy.project.display_name is missing.`);
  }

  return {
    type: sendEmailActionType,
    recipient: {
      type: "user-primary-email",
      userId: options.decision.subject.id,
    },
    tsxSource: template.tsxSource,
    templateId: options.rule.action.templateId,
    themeId: resolveThemeId({
      actionThemeId: options.rule.action.themeId,
      templateThemeId: template.themeId,
      selectedThemeId: options.tenancy.config.emails?.selectedThemeId,
    }),
    ...(options.rule.action.subject === undefined ? {} : { subject: options.rule.action.subject }),
    notificationCategoryName,
    notificationCategoryId: notificationCategory.id,
    createdWith: {
      type: "programmatic-call",
      templateId: options.rule.action.templateId,
    },
    isHighPriority: false,
    shouldSkipDeliverabilityCheck: false,
    variables: {
      automationRuleId: options.ruleId,
      ...options.decision.sourceSnapshot,
      projectDisplayName,
    },
  };
}

function resolveThemeId(options: {
  actionThemeId?: string | null,
  templateThemeId?: string | null | false,
  selectedThemeId?: string | null,
}) {
  if (options.actionThemeId !== undefined) {
    return options.actionThemeId;
  }
  if (options.templateThemeId === false) {
    return null;
  }
  if (options.templateThemeId !== undefined) {
    return options.templateThemeId;
  }
  return options.selectedThemeId ?? null;
}
